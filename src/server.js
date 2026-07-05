/**
 * Roundup Automator server — dashboard + JSON API.
 * Runs on port 3100 (recipe-automator uses 3000 — no clash).
 */
import express from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './shared/logger.js';
import { getDb } from './db/db.js';
import { Sites, Topics, KeywordScores } from './db/repos.js';
import { WordPress } from './shared/wordpress.js';
import { DolphinAnty } from './shared/dolphin.js';
import { secretOpt } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASH = join(__dirname, 'dashboard');
getDb(); // ensure db + schema exist

const app = express();
app.use(express.json());
// Serve the dashboard's static assets (app.css, fonts/*) directly.
// index:false — do NOT let express auto-serve the raw content-only index.html
// for "/"; our page() route wraps it with the stylesheet link.
app.use(express.static(DASH, { index: false }));

// Serve a content-only dashboard file wrapped in a minimal HTML document.
function page(title, file) {
  const body = readFileSync(join(DASH, file), 'utf8');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<link rel="preload" as="font" type="font/woff2" href="/fonts/geist.woff2" crossorigin>`
    + `<link rel="stylesheet" href="/app.css">`
    + `<title>${title}</title></head>`
    + `<body>${body}</body></html>`;
}

app.get('/', (req, res) => res.type('html').send(page('Roundup · Overview', 'index.html')));
app.get('/settings', (req, res) => res.type('html').send(page('Roundup · Settings', 'settings.html')));

// ── Sites API (multi-site) ──
app.get('/api/sites', (req, res) => { try { res.json(Sites.list()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/sites', (req, res) => { try { res.json({ ok: true, id: Sites.add(req.body || {}) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/sites/:id', (req, res) => { try { Sites.update(Number(req.params.id), req.body || {}); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/sites/:id', (req, res) => { try { Sites.remove(Number(req.params.id)); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/sites/:id/activate', (req, res) => { try { Sites.setActive(Number(req.params.id)); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── Auto-discovery ──
// Connect a WP site with just url+user+app-password and fetch what we need.
app.post('/api/wp/probe', async (req, res) => {
  try {
    const b = req.body || {};
    const site = { wp_url: b.wp_url, wp_username: b.wp_username, wp_app_password: b.wp_app_password };
    res.json(await WordPress.probe(site));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// List all Dolphin Anty profiles (cloud API — no desktop app needed) for the dropdown.
app.get('/api/dolphin/profiles', async (req, res) => {
  try {
    const cfg = secretOpt('dolphinAnty');
    if (!cfg?.apiToken) return res.status(400).json({ error: 'Dolphin token not set in config/secrets.json' });
    const d = new DolphinAnty({ dolphinAnty: cfg });
    const list = await d.listProfiles({ limit: 100 });
    res.json((Array.isArray(list) ? list : []).map(p => ({ id: String(p.id), name: p.name || p.title || ('Profile ' + p.id) })));
  } catch (e) {
    // Return 200 with an error field (not 500) — the UI expects this and falls
    // back to manual entry; avoids noisy console 500s when Dolphin is offline.
    res.json({ error: e.message });
  }
});

// ── read-only helpers for the dashboard ──
app.get('/api/topics', (req, res) => { try { res.json(Topics.list()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/keywords', (req, res) => { try { res.json(KeywordScores.top(50)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/logs', (req, res) => res.json(Logger.getLogs()));
app.get('/api/state', (req, res) => res.json({ ok: true, activeSite: Sites.getActive()?.name || null }));

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => Logger.success(`[server] roundup-automator → http://localhost:${PORT}`));

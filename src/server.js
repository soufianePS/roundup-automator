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
import { probePinterestAccount } from './shared/pinterest-probe.js';
import { startAgentRun, subscribeAgentRun, stopAgentRun } from './shared/agent-runner.js';
import { openLoginSession, closeLoginSession, isLoginSessionOpen, profileExists, DEFAULT_TABS } from './shared/research-browser.js';
import { listProfiles, createProfile, setActiveProfile, activeProfileName } from './shared/profiles.js';
import { secretOpt, saveSecretSection } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASH = join(__dirname, 'dashboard');
const PROJECT_ROOT = join(__dirname, '..');
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
app.get('/agent', (req, res) => res.type('html').send(page('Roundup · Agent', 'agent.html')));

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
    // Local API first (works on Dolphin's free plan), cloud as fallback.
    const list = await d.listProfilesAny({ limit: 100 });
    res.json((Array.isArray(list) ? list : []).map(p => ({ id: String(p.id), name: p.name || p.title || ('Profile ' + p.id) })));
  } catch (e) {
    // Return 200 with an error field (not 500) — the UI expects this and falls
    // back to manual entry; avoids noisy console 500s when Dolphin is offline.
    res.json({ error: e.message });
  }
});

// ── Connections (shared credentials in secrets.json) ──
// Status is masked — passwords/tokens are never returned to the client.
app.get('/api/connections', (req, res) => {
  const dolphin = secretOpt('dolphinAnty') || {};
  const pin = secretOpt('pinclicks') || {};
  const gem = secretOpt('gemini') || {};
  res.json({
    dolphin: { hasToken: !!dolphin.apiToken },
    pinclicks: { email: pin.email || '', hasPassword: !!pin.password },
    gemini: { keys: (gem.apiKeys || []).length },
  });
});
app.post('/api/connections/pinclicks', (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cur = secretOpt('pinclicks') || {};
    // Blank password field = keep existing (we never send it to the client).
    saveSecretSection('pinclicks', { email: email ?? cur.email, password: password ? password : cur.password });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/connections/dolphin', (req, res) => {
  try {
    const { apiToken } = req.body || {};
    if (!apiToken) return res.status(400).json({ error: 'apiToken required' });
    saveSecretSection('dolphinAnty', { apiToken });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Probe a Pinterest account (launches the Dolphin profile briefly → username + boards).
app.post('/api/pinterest/probe', async (req, res) => {
  try {
    const id = (req.body || {}).profileId;
    if (!id) return res.status(400).json({ ok: false, error: 'profileId required' });
    res.json(await probePinterestAccount(String(id)));
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Agent (headless Claude on the user's subscription) ──
app.post('/api/agent/run', async (req, res) => {
  try {
    const { prompt, sessionId } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' });
    // Free the research profile: only ONE chromium can hold it at a time, so if the
    // Settings login window is open the agent's browser can't launch. Close it first.
    if (isLoginSessionOpen()) {
      try { await closeLoginSession(); Logger.info('[agent] closed login window so the agent can use the browser'); }
      catch (e) { Logger.warn(`[agent] could not close login window: ${e.message}`); }
    }
    const runId = startAgentRun(prompt, { sessionId: sessionId || null, cwd: PROJECT_ROOT });
    res.json({ runId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/agent/stream/:runId', (req, res) => subscribeAgentRun(req.params.runId, res));
app.post('/api/agent/stop', (req, res) => res.json({ ok: stopAgentRun() }));

// ── Agent research browser (one persistent, logged-in profile) ──
app.get('/api/browser/status', (req, res) =>
  res.json({ profileExists: profileExists(), open: isLoginSessionOpen(), tabs: DEFAULT_TABS.map(t => t.name) }));
app.post('/api/browser/open', async (req, res) => {
  try { res.json(await openLoginSession()); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/browser/close', async (req, res) => {
  try { res.json(await closeLoginSession()); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Browser PROFILES (switch/add without deleting the old one) ──
app.get('/api/browser/profiles', (req, res) => {
  try { res.json({ active: activeProfileName(), profiles: listProfiles() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Create a NEW empty profile and make it active (old profiles are untouched).
app.post('/api/browser/profiles', async (req, res) => {
  try {
    if (isLoginSessionOpen()) await closeLoginSession();
    const name = createProfile((req.body || {}).name);
    res.json({ ok: true, active: name });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// Switch which existing profile is active.
app.post('/api/browser/profiles/activate', async (req, res) => {
  try {
    if (isLoginSessionOpen()) await closeLoginSession();
    const name = setActiveProfile((req.body || {}).name);
    res.json({ ok: true, active: name });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Trends fast harvest (network API — seconds, no agent needed) ──
app.post('/api/trends/harvest', async (req, res) => {
  try {
    const { harvestTrends, weeklyWindowsLastYear } = await import('./shared/trends-api.js');
    const b = req.body || {};
    const weeks = weeklyWindowsLastYear({ from: b.fromDays ?? 30, to: b.toDays ?? 90 });
    const out = await harvestTrends({ interest: b.interest || null, presets: b.presets || ['growing', 'seasonal'], weeks, perCall: b.perCall ?? 25 });
    res.json({ ...out, terms: out.terms.slice(0, b.top ?? 80) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── read-only helpers for the dashboard ──
app.get('/api/topics', (req, res) => { try { res.json(Topics.list()); } catch (e) { res.status(500).json({ error: e.message }); } });
// Queue a researched keyword as a topic (the dashboard "Queue" button).
app.post('/api/topics', (req, res) => {
  try {
    const { keyword, title, type, priority } = req.body || {};
    if (!keyword || !keyword.trim()) return res.status(400).json({ error: 'keyword required' });
    res.json({ ok: true, id: Topics.add(keyword.trim(), title || null, type || 'roundup', priority || 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/keywords', (req, res) => { try { res.json(KeywordScores.top(50)); } catch (e) { res.status(500).json({ error: e.message }); } });
// The latest research batch — powers the Trend Radar cards ("15 to work on now").
app.get('/api/keywords/latest', (req, res) => {
  try { res.json(KeywordScores.latest(Math.min(Number(req.query.limit) || 15, 50))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/logs', (req, res) => res.json(Logger.getLogs()));
app.get('/api/state', (req, res) => res.json({ ok: true, activeSite: Sites.getActive()?.name || null }));

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => Logger.success(`[server] roundup-automator → http://localhost:${PORT}`));

/**
 * PinClicks BULK EXPORT → local keyword bank.
 *
 * The cheap, high-yield half of PinClicks: ONE Keyword-Explorer Export per seed
 * downloads ~1000 keywords + volumes as CSV. A handful of exports builds a big
 * local keyword bank the agent then queries OFFLINE (instant, free, zero live
 * hits) to discover + shortlist — instead of looping PinClicks keyword-by-keyword.
 *
 * This does NOT export Top Pins (per-keyword, the block-inducing part) — keep that
 * targeted to the final shortlist via pinclicks.js enrichKeywords({withTopPins}).
 *
 * Human-paced + few seeds → low Cloudflare risk. Needs the profile FREE.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';
import { activeProfileDir } from './profiles.js';
import { KeywordBank } from '../db/repos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DL_DIR = join(__dirname, '..', '..', 'data', 'exports');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const looksBlocked = (t, u) => /just a moment|attention required|cloudflare/i.test(t || '') || /challenge|blocked/i.test(u || '');

/** Minimal RFC-4180 CSV parser (handles quotes, embedded commas + newlines). */
export function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// "Related Interests" cells look like "lawn and garden (https://...)\npumpkin
// carving inspiration (https://...)\n..." — one "name (url)" per line. Keep just names.
function parseRelatedInterests(cell) {
  if (!cell) return '';
  return String(cell).split('\n').map(l => l.split('(')[0].trim()).filter(Boolean).slice(0, 8).join(', ');
}

/** Parse a PinClicks keyword-explorer export → [{keyword, volume, url, taxonomy, relatedInterests}]. */
function parseExport(csvText) {
  const rows = parseCSV(csvText);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const iLabel = head.indexOf('label');
  const iVol = head.findIndex(h => h.includes('search volume') || h === 'volume');
  const iUrl = head.indexOf('url');
  const iTax = head.indexOf('taxonomy');
  const iRel = head.findIndex(h => h.includes('related interest'));
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const kw = (row[iLabel] || '').trim();
    if (!kw) continue;
    const vol = parseInt(String(row[iVol] || '').replace(/[^0-9]/g, ''), 10);
    out.push({
      keyword: kw, volume: Number.isFinite(vol) ? vol : null, url: (row[iUrl] || '').trim(),
      taxonomy: (row[iTax] || '').split('(')[0].trim(),
      relatedInterests: iRel >= 0 ? parseRelatedInterests(row[iRel]) : '',
    });
  }
  return out;
}

/**
 * Export several seeds → parse → upsert into the keyword bank.
 * @param {string[]} seeds  a FEW broad seeds/categories (not per-keyword!)
 * @returns {{seeds:[{seed,added,total}], bankTotal, blocked}}
 */
export async function exportSeeds(seeds, opts = {}) {
  const { minDelayMs = 15000, maxDelayMs = 30000, max = 12 } = opts;
  const list = [...new Set((seeds || []).map(s => String(s).trim()).filter(Boolean))].slice(0, max);
  if (!list.length) return { seeds: [], bankTotal: KeywordBank.count(), blocked: false };
  mkdirSync(DL_DIR, { recursive: true });

  const ctx = await chromium.launchPersistentContext(activeProfileDir(), {
    headless: false, viewport: null, acceptDownloads: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const report = []; let blocked = false;
  try {
    await page.goto('https://app.pinclicks.com/keyword-explorer', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(rand(5000, 8000));
    if (looksBlocked(await page.title(), page.url())) return { seeds: [], bankTotal: KeywordBank.count(), blocked: true };

    for (let i = 0; i < list.length; i++) {
      const seed = list[i];
      const box = await page.$('input[type="text"], input[placeholder*="keyword" i], input[placeholder*="topic" i]');
      if (!box) { Logger.warn('[pc-export] no search box'); break; }
      await box.click().catch(() => {});
      await box.fill('').catch(() => {});
      for (const ch of seed) await page.keyboard.type(ch, { delay: rand(70, 140) });
      await page.keyboard.press('Enter');
      await sleep(rand(8000, 11000));
      if (looksBlocked(await page.title(), page.url())) { blocked = true; break; }

      try {
        const btn = page.getByRole('button', { name: /export/i }).first();
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 25000 }), btn.click()]);
        const fp = join(DL_DIR, `${seed.replace(/[^a-z0-9]+/gi, '-')}.csv`);
        await dl.saveAs(fp);
        const parsed = parseExport(readFileSync(fp, 'utf8'));
        const added = KeywordBank.upsertMany(parsed, seed);
        report.push({ seed, added, total: parsed.length });
        Logger.success(`[pc-export] "${seed}" → ${parsed.length} keywords (bank now ${KeywordBank.count()})`);
      } catch (e) {
        Logger.warn(`[pc-export] export failed for "${seed}": ${e.message.split('\n')[0]}`);
        report.push({ seed, added: 0, total: 0, error: e.message.split('\n')[0] });
      }
      if (i < list.length - 1) await sleep(rand(minDelayMs, maxDelayMs));
    }
  } finally {
    await ctx.close();
  }
  return { seeds: report, bankTotal: KeywordBank.count(), blocked };
}

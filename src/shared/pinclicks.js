/**
 * PinClicks enricher — HUMAN-PACED, shortlist-only.
 *
 * PinClicks is a Livewire (server-rendered) app behind Cloudflare, so there is no
 * clean JSON API to replay. Instead we drive the REAL logged-in profile headed,
 * type each keyword like a person, wait for the table to render, and scrape it from
 * the live DOM. Deliberately slow + capped so we look human and never trip the
 * Cloudflare block again (bulk automation is what got the old profile blocked).
 *
 * Run ONLY on the small shortlist the fast Trends harvest already produced — a
 * handful of keywords, never hundreds. Needs the active browser profile FREE
 * (close the Settings login window first; only one Chromium can hold the profile).
 */
import { chromium } from 'playwright';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';
import { activeProfileDir } from './profiles.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const KW_URL = 'https://app.pinclicks.com/keyword-explorer';

// Per-keyword cache. PinClicks volumes are monthly-ish, so a few days is safe — and
// every cache hit is one fewer slow (~25s) + Cloudflare-risky live lookup.
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'cache', 'pinclicks');
const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const ckey = (kw) => createHash('sha1').update(kw).digest('hex').slice(0, 16);
function cacheGet(kw) {
  try {
    const f = join(CACHE_DIR, ckey(kw) + '.json');
    if (!existsSync(f)) return null;
    const { ts, data } = JSON.parse(readFileSync(f, 'utf8'));
    return (Date.now() - ts > CACHE_TTL_MS) ? null : data;
  } catch { return null; }
}
function cachePut(kw, data) {
  try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(join(CACHE_DIR, ckey(kw) + '.json'), JSON.stringify({ ts: Date.now(), data })); } catch {}
}

function looksBlocked(title, url) {
  return /just a moment|attention required|cloudflare/i.test(title || '') || /challenge|blocked/i.test(url || '');
}

/** Scrape the rendered keyword-explorer results table → [{keyword, volume}]. */
async function scrapeTable(page) {
  return page.$$eval('table tbody tr', (trs) => {
    const out = [];
    for (const tr of trs) {
      const link = tr.querySelector('a[href*="/pins?search="], a[href*="pinterest.com/ideas"]');
      let kw = '';
      if (link) {
        const href = link.getAttribute('href') || '';
        const m = href.match(/search=([^&]+)/);
        kw = m ? decodeURIComponent(m[1]).replace(/\+/g, ' ') : (link.textContent || '').trim();
      }
      if (!kw) { const c = tr.querySelector('a, [data-keyword]'); kw = (c?.textContent || '').trim(); }
      let volume = null;
      for (const td of tr.querySelectorAll('td')) {
        const t = (td.textContent || '').trim().replace(/,/g, '');
        if (/^\d{2,}$/.test(t)) { volume = parseInt(t, 10); break; }
      }
      if (kw && kw.length < 80) out.push({ keyword: kw.toLowerCase(), volume });
    }
    return out;
  }).catch(() => []);
}

/**
 * Enrich a shortlist of keywords with PinClicks volume + related terms.
 * @param {string[]} keywords  the shortlist (capped)
 * @param {object} opts { max=8, minDelayMs=18000, maxDelayMs=35000 }
 * @returns {Promise<{results, blocked, done}>}
 *   results: [{ keyword, volume, related:[{keyword,volume}] }]
 */
export async function enrichKeywords(keywords, opts = {}) {
  const { max = 8, minDelayMs = 18000, maxDelayMs = 35000, force = false } = opts;
  const requested = [...new Set((keywords || []).map(k => String(k).trim().toLowerCase()).filter(Boolean))].slice(0, max);
  if (!requested.length) return { results: [], blocked: false, done: true };

  // Serve cached keywords instantly; only browse the misses (fewer slow + risky hits).
  const results = [];
  const toFetch = [];
  for (const kw of requested) {
    const hit = force ? null : cacheGet(kw);
    if (hit) results.push({ ...hit, cached: true });
    else toFetch.push(kw);
  }
  if (!toFetch.length) { Logger.info(`[pinclicks] all ${requested.length} keywords from cache — 0 live lookups`); return { results, blocked: false, done: true, fromCache: results.length }; }
  Logger.info(`[pinclicks] ${results.length} cached, ${toFetch.length} to look up live`);
  const list = toFetch;

  const ctx = await chromium.launchPersistentContext(activeProfileDir(), {
    headless: false, viewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  let blocked = false;
  try {
    await page.goto(KW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(rand(5000, 8000));
    if (looksBlocked(await page.title(), page.url())) {
      Logger.warn('[pinclicks] Cloudflare block detected on load — aborting. Try a fresh profile (Settings → Profiles).');
      return { results, blocked: true, done: false };  // return any cached results we already had
    }

    for (let i = 0; i < list.length; i++) {
      const kw = list[i];
      const box = await page.$('input[type="text"], input[placeholder*="keyword" i], input[placeholder*="topic" i]');
      if (!box) { Logger.warn('[pinclicks] no search box — page changed?'); break; }
      await box.click().catch(() => {});
      await box.fill('').catch(() => {});
      for (const ch of kw) await page.keyboard.type(ch, { delay: rand(70, 150) });
      await sleep(rand(500, 1100));
      await page.keyboard.press('Enter');
      await sleep(rand(7000, 10000)); // let the Livewire table render

      if (looksBlocked(await page.title(), page.url())) { blocked = true; Logger.warn(`[pinclicks] blocked after "${kw}" — stopping early.`); break; }

      const rows = await scrapeTable(page);
      const self = rows.find(r => r.keyword === kw) || rows.find(r => r.keyword.includes(kw)) || null;
      const rec = {
        keyword: kw,
        volume: self?.volume ?? null,
        related: rows.filter(r => r.keyword !== (self?.keyword)).slice(0, 12),
      };
      results.push(rec);
      cachePut(kw, rec);   // remember so we never re-browse this keyword within the TTL
      Logger.info(`[pinclicks] ${kw} → vol ${self?.volume ?? '?'}, ${rows.length} rows (${i + 1}/${list.length})`);

      if (i < list.length - 1) await sleep(rand(minDelayMs, maxDelayMs)); // human gap
    }
  } finally {
    await ctx.close();
  }
  return { results, blocked, done: !blocked };
}

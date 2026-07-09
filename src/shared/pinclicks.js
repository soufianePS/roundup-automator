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

// Circuit breaker — cap live PinClicks Top-Pins visits so a scan can't hammer it
// into a Cloudflare block (both audits insisted). MUST be disk-persisted, not just
// in-memory: the MCP server is a FRESH process per agent run, so an in-memory-only
// counter resets to a full budget every single run — several separate runs within
// the same hour can each think they have 12 fresh lookups, and a real block's 24h
// cooldown wouldn't carry over to the very next run either. Confirmed as the likely
// cause of a real block (2026-07-08): two agent runs + one ad-hoc script each used
// their own "fresh" budget back to back.
const BREAKER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'cache', 'pinclicks');
const BREAKER_FILE = join(BREAKER_DIR, '_breaker.json');
function loadBreaker() {
  try { return JSON.parse(readFileSync(BREAKER_FILE, 'utf8')); }
  catch { return { hour: [], day: [], blockedUntil: 0 }; }
}
function saveBreaker(b) {
  try { mkdirSync(BREAKER_DIR, { recursive: true }); writeFileSync(BREAKER_FILE, JSON.stringify(b)); } catch {}
}
const LIVE = { MAX_HOUR: 12, MAX_DAY: 40, COOLDOWN_MS: 24 * 3600 * 1000 };
function liveBudgetLeft(now) {
  const b = loadBreaker();
  if (now < b.blockedUntil) return 0;
  b.hour = b.hour.filter(t => now - t < 3600e3);
  b.day = b.day.filter(t => now - t < 86400e3);
  saveBreaker(b);
  return Math.min(LIVE.MAX_HOUR - b.hour.length, LIVE.MAX_DAY - b.day.length);
}
function liveTick(now) { const b = loadBreaker(); b.hour.push(now); b.day.push(now); saveBreaker(b); }
function tripBreaker(now) { const b = loadBreaker(); b.blockedUntil = now + LIVE.COOLDOWN_MS; saveBreaker(b); }

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

const BIG_MEDIA = /thespruce|bhg|betterhomes|hgtv|apartmenttherapy|foodnetwork|marthastewart|allrecipes|delish|tasteofhome|goodhousekeeping|realsimple|southernliving|countryliving/i;
const ROUNDUP_URL = /\/\d+-|\bideas\b|\bbest-|roundup|listicle|-recipes\b/i;
// Pure grammatical filler only — NOT words like "easy"/"best"/"ideas" that carry
// real click-intent/roundup-vs-single signal elsewhere in this app.
const STOP_WORDS = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'in', 'and', 'how', 'with', 'on', 'is', 'are', 'your']);
function normTokens(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .map(w => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) ? w.replace(/es$/, '').replace(/s$/, '') : w);
}

/** "Go inside" a keyword → scrape Top Pins (title, domain, date, saves) + verdict. */
export async function topPinsFor(page, keyword, { niche = 'recipe' } = {}) {
  await page.goto('https://app.pinclicks.com/pins?search=' + encodeURIComponent(keyword), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(rand(7000, 10000));
  if (looksBlocked(await page.title(), page.url())) return { blocked: true };

  const pins = await page.$$eval('table tbody tr', (trs) => {
    const rows = [];
    for (const tr of trs.slice(0, 10)) {
      const cells = [...tr.querySelectorAll('td')].map(td => (td.textContent || '').trim());
      const rowText = cells.join(' ');
      const domain = (rowText.match(/([a-z0-9-]+\.(?:com|net|org|co|us|ca|uk|blog))/i) || [])[1] || '';
      const date = (rowText.match(/[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/) || [])[0] || '';
      // title = text after "Open preview" and before the domain (strip the checkbox label)
      let title = rowText
        .replace(/Select\/deselect item \d+ for bulk actions\.?/i, '')
        .replace(/Open preview/i, '').trim();
      if (domain) title = title.slice(0, title.indexOf(domain));
      title = title.replace(/\s+/g, ' ').trim().slice(0, 90);
      // saves = largest plain integer among cells (pin-id lives in an aria-label, not a cell)
      let saves = 0;
      for (const c of cells) { const n = c.replace(/,/g, ''); if (/^\d{1,7}$/.test(n)) saves = Math.max(saves, parseInt(n, 10)); }
      if (title) rows.push({ title, domain, date, saves });
    }
    return rows;
  }).catch(() => []);
  if (!pins.length) return { blocked: false, pins: [], competition: 0.1, verdict: 'empty SERP — likely wide open (verify keyword is real)' };

  // derive signals
  const nowMs = Date.parse('2026-07-06'); // stamped; scripts can't use Date.now()
  const kwWords = normTokens(keyword);
  let exactTop5 = 0, freshHighSave = 0, staleCount = 0, bigMedia = 0, freshBigMedia = 0, staleBigMedia = 0, roundupCount = 0;
  const savesArr = [];
  pins.forEach((p, i) => {
    savesArr.push(p.saves);
    const ageMonths = p.date ? Math.max(0.5, (nowMs - Date.parse(p.date)) / (30 * 864e5)) : 24;
    const velocity = p.saves / ageMonths;
    // Token-set match, not substring — substring wrongly matched "cake" inside
    // "cupcake". Normalized (stop words stripped, plurals stemmed) so "recipes"
    // matches "recipe" and filler words don't inflate/deflate the score.
    const tlWords = new Set(normTokens(p.title));
    const exact = kwWords.length ? kwWords.filter(w => tlWords.has(w)).length / kwWords.length : 0;
    if (i < 5 && exact >= 0.7) exactTop5++;
    if (ageMonths < 3 && p.saves > 500) freshHighSave++;
    if (ageMonths > 12) staleCount++;
    const isBigMedia = BIG_MEDIA.test(p.domain);
    if (isBigMedia) {
      bigMedia++;
      // A single FRESH big-media pin is a near-unbeatable wall (domain authority +
      // freshness both maxed). A STALE big-media pin is the opposite — Pinterest's
      // 2026 ranking explicitly favors fresh pins, so an old big-media pin holding
      // rank on authority alone is a vulnerable, winnable target, not a wall. The
      // old formula penalized both identically, which misclassified stale-big-media
      // SERPs as LOCKED when they're actually a real opportunity.
      if (ageMonths < 6) freshBigMedia++;
      else if (ageMonths > 12) staleBigMedia++;
    }
    if (ROUNDUP_URL.test(p.title) || /\b\d{2}\b/.test(p.title)) roundupCount++;
    p.ageMonths = Math.round(ageMonths); p.velocity = Math.round(velocity);
  });
  const sorted = [...savesArr].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const weak = savesArr.filter(s => s < (niche === 'recipe' ? 150 : 100)).length;

  // competition estimate (0 open → 1 locked)
  let comp = 0.4;
  if (exactTop5 >= 4) comp += 0.35; else if (exactTop5 <= 1) comp -= 0.2;
  if (freshHighSave >= 1) comp += 0.3;
  if (median > 1000) comp += 0.2; else if (median < (niche === 'recipe' ? 300 : 150)) comp -= 0.2;
  if (freshBigMedia >= 1) comp += 0.3;   // fresh + big-media = near-unbeatable, hard lock
  else if (staleBigMedia >= 2) comp -= 0.15; // stale big-media = vulnerable, not a wall
  if (staleCount >= 3) comp -= 0.15;
  if (weak >= 3) comp -= 0.15;
  comp = Math.max(0.05, Math.min(1, comp));

  const verdict = comp <= 0.35 ? 'WINNABLE' : comp <= 0.6 ? 'maybe (needs a better angle)' : 'LOCKED — skip / go longer-tail';
  return {
    blocked: false, pins,
    competition: Math.round(comp * 100) / 100,
    verdict,
    signals: { medianSaves: median, exactMatchTop5: exactTop5, freshHighSave, staleCount, bigMedia, freshBigMedia, staleBigMedia, weakPins: weak, roundupCount },
  };
}

/**
 * Click into the top pins from an ALREADY-SCRAPED Top Pins page (call right after
 * topPinsFor(), same page, don't re-navigate) to collect each pin's real
 * "Annotated Interests" — confirmed live 2026-07-09 by direct owner verification:
 * click a pin row → a sidebar opens showing "Annotated Interests" with Pinterest's
 * real tag list for that exact pin.
 *
 * ⚠ NOT YET LIVE-TESTED. Written from the described structure (sidebar heading
 * "Annotated Interests", tag list beneath it) — the exact click target and sidebar
 * selectors are a reasonable first guess, not verified against the real DOM. The
 * circuit breaker was in cooldown (until 2026-07-09 23:02 UTC, from the 2026-07-08
 * block) at the time this was written, so live verification was deliberately
 * deferred rather than testing against a profile mid-cooldown. Verify + fix
 * selectors on the FIRST real call once the breaker clears, using page.screenshot()
 * to confirm the sidebar actually opened before trusting the scraped list.
 *
 * Only call this for keywords that already passed the competition read
 * (WINNABLE/maybe) — never spend the extra per-pin cost on a LOCKED keyword.
 */
export async function annotationsForTopPins(page, { max = 5 } = {}) {
  const rows = await page.$$('table tbody tr');
  const out = [];
  for (let i = 0; i < Math.min(rows.length, max); i++) {
    try {
      await rows[i].click();
      await sleep(rand(2000, 4000));
      const annotations = await page.evaluate(() => {
        const heading = [...document.querySelectorAll('*')].find(el =>
          el.children.length === 0 && /annotated interests/i.test(el.textContent || ''));
        if (!heading) return [];
        const panel = heading.closest('[class*="sidebar"], [class*="panel"], aside') || heading.parentElement?.parentElement;
        if (!panel) return [];
        return [...panel.querySelectorAll('li, [class*="tag"], [class*="chip"], [class*="annotation"]')]
          .map(el => (el.textContent || '').trim()).filter(t => t && t.length < 60).slice(0, 20);
      });
      out.push({ index: i, annotations });
      await page.keyboard.press('Escape').catch(() => {}); // close sidebar — selector unverified, Escape is a safe generic fallback
      await sleep(rand(1500, 3000));
    } catch (e) {
      Logger.warn(`[pinclicks] annotation click failed for pin ${i}: ${e.message}`);
    }
  }
  return out;
}

/**
 * Enrich a shortlist of keywords with PinClicks volume + related terms.
 * @param {string[]} keywords  the shortlist (capped)
 * @param {object} opts { max=8, minDelayMs=18000, maxDelayMs=35000 }
 * @returns {Promise<{results, blocked, done}>}
 *   results: [{ keyword, volume, related:[{keyword,volume}] }]
 */
export async function enrichKeywords(keywords, opts = {}) {
  const { max = 8, minDelayMs = 18000, maxDelayMs = 35000, force = false, withTopPins = false, niche = 'recipe' } = opts;
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

  // Circuit breaker: only Top-Pins visits count against the live budget (the risky part).
  let list = toFetch;
  if (withTopPins) {
    const budget = liveBudgetLeft(Date.now());
    if (budget <= 0) {
      Logger.warn('[pinclicks] live budget exhausted / cooling down — returning cached only.');
      return { results, blocked: false, done: false, budgetExhausted: true };
    }
    if (toFetch.length > budget) { Logger.warn(`[pinclicks] capping live lookups ${toFetch.length}→${budget} (budget)`); list = toFetch.slice(0, budget); }
  }
  Logger.info(`[pinclicks] ${results.length} cached, ${list.length} to look up live${withTopPins ? ' (+Top Pins)' : ''}`);

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
      tripBreaker(Date.now());
      // NOTE: this can be an IP-level block, not just this profile's cookies — a fresh
      // profile does NOT reliably fix it (confirmed 2026-07-08: a brand-new never-used
      // profile hit the same block immediately on the login page, same network). Don't
      // tell the user "just add a profile" as if that's guaranteed to work; the real
      // fix is waiting out the cooldown (or changing network, if that's an option).
      Logger.warn('[pinclicks] Cloudflare block detected on load — breaker tripped (24h cooldown). This may be an IP-level block, not just this profile — a fresh profile is not guaranteed to fix it. Wait for the cooldown, or try from a different network.');
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

      if (looksBlocked(await page.title(), page.url())) { blocked = true; tripBreaker(Date.now()); Logger.warn(`[pinclicks] blocked after "${kw}" — breaker tripped, stopping early.`); break; }

      const rows = await scrapeTable(page);
      const self = rows.find(r => r.keyword === kw) || rows.find(r => r.keyword.includes(kw)) || null;
      const rec = {
        keyword: kw,
        volume: self?.volume ?? null,
        related: rows.filter(r => r.keyword !== (self?.keyword)).slice(0, 12),
      };
      // optionally "go inside" → Top Pins competition read
      if (withTopPins) {
        liveTick(Date.now());   // count this Top-Pins visit against the budget
        const tp = await topPinsFor(page, kw, { niche });
        if (tp.blocked) { blocked = true; tripBreaker(Date.now()); Logger.warn(`[pinclicks] blocked in Top Pins for "${kw}" — breaker tripped`); results.push(rec); cachePut(kw, rec); break; }
        rec.competition = tp.competition;
        rec.verdict = tp.verdict;
        rec.topPins = tp.signals;
        rec.topPinsSample = (tp.pins || []).slice(0, 5).map(p => ({ title: p.title.slice(0, 60), domain: p.domain, saves: p.saves, ageMonths: p.ageMonths }));
        Logger.info(`[pinclicks] ${kw} → vol ${self?.volume ?? '?'} | comp ${tp.competition} ${tp.verdict} | medSaves ${tp.signals?.medianSaves}, exact ${tp.signals?.exactMatchTop5}/5 (${i + 1}/${list.length})`);
      } else {
        Logger.info(`[pinclicks] ${kw} → vol ${self?.volume ?? '?'}, ${rows.length} rows (${i + 1}/${list.length})`);
      }
      results.push(rec);
      cachePut(kw, rec);   // remember so we never re-browse this keyword within the TTL

      if (i < list.length - 1) await sleep(rand(minDelayMs, maxDelayMs)); // human gap
    }
  } finally {
    await ctx.close();
  }
  return { results, blocked, done: !blocked };
}

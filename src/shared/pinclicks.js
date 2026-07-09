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
import { parseCSV } from './pinclicks-export.js';

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
// COOLDOWN_MS was 24h — changed 2026-07-09 to 30min after a real incident showed
// 24h was overly conservative: a block detected on 2026-07-08 had fully cleared by
// the next morning's live test (clean export, no re-block), meaning the block
// itself was much shorter-lived than the cooldown assumed. 30min still respects a
// real detected block (never reduce to ~1min — that's indistinguishable from
// normal between-action pacing and defeats the point of a breaker) but doesn't
// hold the account hostage for a day on a guess. Revisit again with more real
// incident data if 30min turns out too short (re-blocks quickly) or too
// conservative (long confirmed-clear periods still refused).
const LIVE = { MAX_HOUR: 12, MAX_DAY: 40, COOLDOWN_MS: 30 * 60 * 1000 };
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
 * "Annotated Interests" — confirmed live 2026-07-09 by direct owner AND agent
 * verification (screenshotted the real sidebar): click a pin's "Open preview"
 * button (`aria-label="Open preview for <title>"`, `[data-pin-preview-media-trigger]`)
 * → a sidebar opens with a "Pin Performance" box (pin score/appearances/saves/
 * repins/comments/reactions — MORE ACCURATE than the plain table scrape's saves
 * column, e.g. real saves seen at 108,948 for a pin the table row read much lower
 * for — worth switching topPinsFor()'s saves signal to this sidebar value once
 * this function is wired in) followed by an "Annotated Interests" section with
 * pill-style tag buttons underneath (e.g. "Easy Cinnamon Apple Bread", "Homemade
 * Apple Bread Loaf").
 *
 * CONFIRMED WORKING (2026-07-09, live-verified with screenshots): the click
 * target — `previewBtns[i].click({force:true})` — a `[data-pin-preview-overlay]`
 * hover layer intercepts the plain click, hence `force`. Clicking it DOES open a
 * real sidebar with a real "Annotated Interests" section and real pill tags.
 *
 * ⚠ STILL BROKEN as of this version: the in-page extraction JS below reliably
 * returns the wrong elements (table-header text: "Sort by", "Pin score", "Saves",
 * etc.) instead of the annotation pills, across multiple attempted fixes
 * (ancestor-walking, then forward document-position filtering via
 * compareDocumentPosition — both gave the identical wrong output). The leaf-node
 * text search for "annotated interest" is very likely matching something OTHER
 * than the visible sidebar heading — possibly a hydration/state JSON blob
 * embedded near the top of the page that Livewire/Vue apps commonly ship for
 * initial render, which would explain why "everything after it" resolves to
 * content from near the top of the page every time. NOT resolved after 7 live
 * attempts in one session (2026-07-09) — needs either manual DevTools inspection
 * of the real heading element (right-click → Inspect on "Annotated Interests" in
 * a live sidebar, read its actual tag/class/ancestor chain directly) rather than
 * continued blind selector guessing, or a completely different extraction
 * strategy (e.g. query specifically for `[class*="pill"]`/`[class*="badge"]`-like
 * classes instead of searching by heading-adjacency at all).
 *
 * Only call this for keywords that already passed the competition read
 * (WINNABLE/maybe) — never spend the extra per-pin cost on a LOCKED keyword.
 */
export async function annotationsForTopPins(page, { max = 5 } = {}) {
  const KNOWN_HEADER = new Set(['Export', 'Track Keyword', 'Pin Data', 'Annotated Interests']);
  const previewBtns = await page.getByRole('button', { name: /open preview/i }).all();
  const out = [];
  for (let i = 0; i < Math.min(previewBtns.length, max); i++) {
    try {
      await previewBtns[i].click({ force: true, timeout: 10000 });
      await sleep(rand(2000, 4000));
      const annotations = await page.evaluate(() => {
        const heading = [...document.querySelectorAll('*')].find(el =>
          el.children.length === 0 && /annotated interest/i.test(el.textContent || ''));
        if (!heading) return [];
        // Forward document-position slice: everything that comes AFTER the
        // heading in DOM order, within a bounded distance, is far more robust
        // than guessing the exact ancestor/container nesting (which varies).
        // Use compareDocumentPosition directly against each candidate — trying
        // to find the heading's own index inside a differently-typed element
        // list (button/span/li) doesn't work since the heading itself may not
        // match those tags, which silently fell back to scanning the WHOLE page
        // from the top (grabbing the table header instead) in an earlier version.
        const all = [...document.querySelectorAll('button, span, li')];
        const after = all.filter(el => heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).slice(0, 40);
        const KNOWN = ['Export', 'Track Keyword', 'Pin Data', 'Annotated Interests'];
        const seen = new Set();
        const items = [];
        for (const el of after) {
          const t = (el.textContent || '').trim();
          if (!t || t.length < 2 || t.length > 60 || KNOWN.includes(t) || seen.has(t)) continue;
          // Stop once we clearly leave the annotations section (hit the next
          // named section heading, e.g. a following "Related Pins"-style block).
          if (/^(related|top pins|similar|source|domain)/i.test(t)) break;
          seen.add(t); items.push(t);
          if (items.length >= 20) break;
        }
        return items;
      });
      out.push({ index: i, annotations });
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(rand(1500, 3000));
    } catch (e) {
      Logger.warn(`[pinclicks] annotation click failed for pin ${i}: ${e.message}`);
    }
  }
  return out;
}

const EXPORTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'exports');

/**
 * PREFERRED annotations method (2026-07-09, owner-confirmed): Top Pins has TWO
 * export buttons — "Pin Data" export and "Annotation Interests" export — giving
 * richer per-pin data + real annotations in one click each, same safe pattern as
 * Keyword Explorer's export (click Export → download → parse CSV), NOT per-pin
 * clicking. This supersedes annotationsForTopPins() above as the primary method —
 * one page + two button clicks beats clicking into 3-5 individual pins.
 *
 * ⚠ STILL NOT LIVE-TESTED (the "download the CSV and read it" part). What IS
 * confirmed live (2026-07-09): the button labels are exactly "Export", "Pin
 * Data", "Annotated Interests" (verified via a real page inspection), and the
 * two-step click (Export first, then the specific option) is now built in —
 * the original version tried to click "Pin Data"/"Annotated Interests" directly
 * without opening the dropdown, which was wrong. What's NOT yet confirmed: that
 * clicking these actually triggers a file download (vs. e.g. opening a modal or
 * requiring a date-range picker first) and the resulting CSV's column names.
 *
 * Call this INSTEAD of (not in addition to) the plain topPinsFor() DOM-scrape for
 * keywords that matter enough to check — it should replace that function's table
 * scrape once verified, since the exported CSV will have more reliable data than
 * scraping rendered `<table>` text.
 */
export async function exportTopPins(page, keyword) {
  mkdirSync(EXPORTS_DIR, { recursive: true });
  await page.goto('https://app.pinclicks.com/pins?search=' + encodeURIComponent(keyword), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(rand(7000, 10000));
  if (looksBlocked(await page.title(), page.url())) return { blocked: true };

  const safe = keyword.replace(/[^a-z0-9]+/gi, '-');
  // Confirmed live 2026-07-09: there is ONE "Export" trigger button (top-right of
  // the Top Pins page, next to "Track Keyword"); clicking it reveals "Pin Data"
  // and "Annotated Interests" as two separate options — they exist as real
  // <button> elements in the DOM even before "Export" is clicked (found via a
  // flat page-wide button query), so they're likely a pre-mounted, hidden
  // dropdown menu rather than lazily rendered. Click "Export" first to make the
  // option interactable, THEN click the specific option — the previous version
  // tried to click "Pin Data"/"Annotated Interests" directly without opening the
  // dropdown first, which was never live-tested and likely would have hung
  // waiting for a hidden element to become visible.
  const downloadOne = async (nameRe, outSuffix) => {
    const exportBtn = page.getByRole('button', { name: /^export$/i }).first();
    if (!(await exportBtn.count())) return null;
    await exportBtn.click({ force: true, timeout: 10000 });
    await sleep(rand(1000, 2000));
    const btn = page.getByRole('button', { name: nameRe }).first();
    if (!(await btn.count())) return null;
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 25000 }), btn.click({ force: true, timeout: 10000 })]);
    const fp = join(EXPORTS_DIR, `toppins-${safe}-${outSuffix}.csv`);
    await dl.saveAs(fp);
    return parseCSV(readFileSync(fp, 'utf8'));
  };

  let pinData = null, annotationData = null;
  try { pinData = await downloadOne(/pin.*data|export.*pin/i, 'pindata'); }
  catch (e) { Logger.warn(`[pinclicks] Pin Data export failed for "${keyword}": ${e.message.split('\n')[0]}`); }
  await sleep(rand(3000, 6000));
  try { annotationData = await downloadOne(/annotat/i, 'annotations'); }
  catch (e) { Logger.warn(`[pinclicks] Annotation export failed for "${keyword}": ${e.message.split('\n')[0]}`); }

  return { blocked: false, keyword, pinDataRows: pinData, annotationRows: annotationData };
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

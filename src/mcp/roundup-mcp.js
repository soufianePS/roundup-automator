/**
 * Roundup MCP server — the agent's HANDS.
 *
 * Exposes the app's real functions (SQLite repos + WordPress + Dolphin) as MCP
 * tools so the in-app Agent (headless Claude) can EXECUTE, not just read/think.
 * Runs as a separate stdio process spawned by `claude -p --mcp-config`.
 *
 * IMPORTANT: an stdio MCP server must keep stdout CLEAN — only JSON-RPC frames
 * go there. Our Logger uses console.log (→ stdout), so we redirect console.log
 * to stderr BEFORE importing anything that logs. The SDK writes protocol frames
 * straight to process.stdout, which stays untouched.
 */
console.log = (...a) => console.error(...a);   // keep stdout for JSON-RPC only

import { readFileSync } from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getDb } from '../db/db.js';
import { Sites, Topics, KeywordScores, Articles, ArticleItems, Pins, KeywordBank } from '../db/repos.js';
import { WordPress } from '../shared/wordpress.js';
import { DolphinAnty } from '../shared/dolphin.js';
import { probePinterestAccount } from '../shared/pinterest-probe.js';
import { harvestTrends, fetchCurves, weeklyWindowsLastYear, INTEREST_IDS, fetchMoments, matchMoment } from '../shared/trends-api.js';
import { enrichKeywords } from '../shared/pinclicks.js';
import { exportSeeds } from '../shared/pinclicks-export.js';
import { buildShortlist, seasonalTiming, timingFromMoment, trendTitles, detectLiftoff, liftoffVerdict, predictLiftoffFromHistory, predictedLiftoffVerdict, combinedTimingVerdict } from '../shared/keyword-scoring.js';
import { secretOpt } from '../config.js';
import { Logger } from '../shared/logger.js';

getDb(); // ensure db + schema exist

// Tracks WINNABLE pinclicks_enrich results not yet saved this run (this MCP
// server process is spawned fresh per agent run, so this is naturally
// scoped to one run — no session ID needed). Fixes a recurring real bug:
// the agent finding a WINNABLE keyword and never calling save_keyword_score
// for it (observed 3x — "fig recipes", "homemade tomato sauce", and
// "easy game day food"/"healthy dump and go crockpot recipes" in the same
// run). Wording-only fixes didn't hold across repeats — this makes the gap
// impossible to miss instead of relying on the agent remembering.
const pendingWinnables = new Map();

// ── result helpers ──
const ok = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ content: [{ type: 'text', text: `ERROR: ${e?.message || e}` }], isError: true });
const wrap = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

// Resolve the site a tool should act on: explicit id, else the active site.
function resolveSite(siteId) {
  const site = siteId ? Sites.get(Number(siteId)) : Sites.getActive();
  if (!site) throw new Error(siteId ? `No site with id ${siteId}` : 'No active site — activate one first (list_sites / activate_site)');
  return site;
}

const server = new McpServer({ name: 'roundup', version: '0.1.0' });

// ─────────────────────────── Sites ───────────────────────────
server.tool('list_sites', 'List all configured blogs/sites (which one is active, WP + Pinterest config).', {},
  wrap(() => Sites.list()));

server.tool('get_active_site', 'Get the currently active site (the one tools act on by default).', {},
  wrap(() => Sites.getActive() || { active: null }));

server.tool('activate_site', 'Make a site the active one (by id).', { id: z.number().int() },
  wrap(({ id }) => { Sites.setActive(id); return { ok: true, active: Sites.getActive()?.name }; }));

// ─────────────────────────── Topics (input queue) ───────────────────────────
server.tool('add_topic', 'Add a roundup topic to the input queue.',
  { keyword: z.string(), title: z.string().optional(), type: z.string().optional(), priority: z.number().int().optional() },
  wrap(({ keyword, title, type, priority }) => ({ id: Topics.add(keyword, title ?? null, type ?? 'roundup', priority ?? 0) })));

server.tool('list_topics', 'List topics in the queue, optionally filtered by status (pending/done/…).',
  { status: z.string().optional() },
  wrap(({ status }) => Topics.list(status ?? null)));

server.tool('set_topic_status', 'Update a topic\'s status (e.g. pending → in_progress → done).',
  { id: z.number().int(), status: z.string() },
  wrap(({ id, status }) => { Topics.setStatus(id, status); return { ok: true }; }));

// ─────────────────────────── Keyword intelligence ───────────────────────────
// Guard against skipping smart_timing: a bare ISO date ("2026-07-07") or empty
// string is NOT a real timing verdict — smart_timing always returns prose like
// "start now — by Jul 17, 2026" or "MISSED this cycle — queue for ~May 2027".
// This rejects deterministically regardless of which engine/model calls the tool
// (Claude, Codex, Gemini, ...) — observed Codex writing a bare today's-date here.
const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validatePublishBy(publish_by) {
  const v = String(publish_by || '').trim();
  if (!v) return 'publish_by is empty. Call trend_curves([keyword]) first (preferred — real per-keyword curve) or smart_timing(keyword, peak_month) as fallback, and use its verdict text verbatim.';
  if (BARE_DATE_RE.test(v)) return `publish_by ("${v}") looks like a bare date, not a timing verdict — you likely skipped the real timing check. Call trend_curves([keyword]) and use its liftoff_verdict, or smart_timing(keyword, peak_month) if trend_curves has insufficient data, and use that verdict text (e.g. "LIFTOFF: ... catch it now" or "MISSED this cycle — queue for ~May 2027").`;
  return null;
}

// SOFT check (warns, never blocks the save — a good title sometimes legitimately
// paraphrases rather than quoting an annotation verbatim, and the skill explicitly
// discourages keyword-stuffing). Catches the case where real annotations were
// fetched (a live pinclicks_enrich withTopPins lookup, real cost paid) but then
// completely ignored when writing the title/description — wasted signal, not a
// hard error.
const ANNOTATION_MATCH_STOP_WORDS = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'in', 'and', 'with', 'on', 'is', 'are', 'your', 'recipe', 'recipes']);
function annotationUsageWarning(k) {
  if (!k.annotations || !k.annotations.length) return null;
  const text = `${k.title_suggestion || ''} ${k.pin_description || ''}`.toLowerCase();
  if (!text.trim()) return null; // nothing written yet to check against
  const used = k.annotations.some(a => {
    const words = String(a).toLowerCase().split(/\s+/).filter(w => w.length > 3 && !ANNOTATION_MATCH_STOP_WORDS.has(w));
    return words.some(w => text.includes(w));
  });
  if (used) return null;
  return `⚠ You fetched ${k.annotations.length} real Pinterest annotations for "${k.keyword}" (a live PinClicks lookup, real cost paid) but none of their words appear in title_suggestion or pin_description — that real signal is being thrown away. Consider naturally incorporating one (paraphrase is fine, just don't ignore them entirely).`;
}

server.tool('save_keyword_score',
  'Save a researched keyword with its opportunity score, sub-signals and annotations (the training data). REQUIRES publish_by to be the real verdict text from smart_timing (not a bare date) — call smart_timing(keyword, peak_month) first.',
  {
    keyword: z.string(),
    opportunity_score: z.number().optional(),
    demand: z.number().optional(),
    ctr_intent: z.number().optional(),
    momentum: z.number().optional(),
    competition: z.number().optional(),
    seasonal_timing: z.number().optional(),
    fit: z.number().optional(),
    title_suggestion: z.string().optional(),
    pin_description: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    parent_trend: z.string().min(1).describe('REQUIRED — the EXACT trend term as returned by harvest_trends (or the exact seed you passed to pinclicks_export_seeds), copied verbatim. Do NOT paraphrase, shorten, or invent a cleaner label (e.g. if harvest_trends returned "fig recipes", save "fig recipes", not just "fig"). This is shown on the dashboard card so the user can see exactly which real Pinterest trend produced this keyword.'),
    peak_month: z.string().optional(),
    publish_by: z.string().optional(),
    annotations: z.array(z.string()).optional(),
    top_pin_saves: z.number().optional(),
    search_volume: z.number().optional(),
    trend_points: z.array(z.number()).optional(),
    source_notes: z.string().optional(),
  },
  wrap((k) => {
    const err = validatePublishBy(k.publish_by);
    if (err) throw new Error(err);
    pendingWinnables.delete(String(k.keyword).toLowerCase());
    const id = KeywordScores.save(k);
    const warning = annotationUsageWarning(k);
    return warning ? { id, ANNOTATION_USAGE_WARNING: warning } : { id };
  }));

server.tool('check_unsaved_winnables',
  'SAFETY NET — call this before writing your final summary, every time, no exceptions. Returns any WINNABLE keywords from pinclicks_enrich this run that were never saved via save_keyword_score. If it returns any, you have a bug in progress: go save them right now (or dismiss deliberately with a stated reason), THEN write your summary — never end the run with pending items still listed here.',
  {},
  wrap(() => ({ count: pendingWinnables.size, pending: [...pendingWinnables.values()] })));

server.tool('list_keyword_scores', 'Top researched keywords by opportunity score.',
  { limit: z.number().int().optional() },
  wrap(({ limit }) => KeywordScores.top(limit ?? 25)));

server.tool('recent_keywords',
  'List keywords already surfaced before (incl. dismissed) so you DON\'T re-suggest the same trend twice. Call this BEFORE saving — skip any candidate already here unless the user asked to re-check.',
  { limit: z.number().int().optional() },
  wrap(({ limit }) => KeywordScores.recentKeywords(limit ?? 300)));

// ─────────────────────────── Articles / items / pins (data) ───────────────────────────
server.tool('create_article', 'Create an article row (roundup) in the DB.',
  { title: z.string(), slug: z.string().optional(), topic_id: z.number().int().optional(), hero_path: z.string().optional(), status: z.string().optional() },
  wrap((a) => ({ id: Articles.create(a) })));

server.tool('add_article_item', 'Add one idea/item to an article (description, image, source credit).',
  {
    article_id: z.number().int(), position: z.number().int().optional(), description: z.string().optional(),
    image_url: z.string().optional(), image_local_path: z.string().optional(), source_url: z.string().optional(),
    credit: z.string().optional(), ai_vet_score: z.number().optional(), ai_vet_reason: z.string().optional(),
  },
  wrap(({ article_id, ...item }) => ({ id: ArticleItems.add(article_id, item) })));

server.tool('list_article_items', 'List all items for an article, ordered by position.',
  { article_id: z.number().int() },
  wrap(({ article_id }) => ArticleItems.forArticle(article_id)));

server.tool('enqueue_pin', 'Queue a Pinterest pin (image + title + description + schedule).',
  {
    article_id: z.number().int().optional(), account_id: z.string().optional(), image_path: z.string().optional(),
    title: z.string().optional(), description: z.string().optional(), status: z.string().optional(), scheduled_at: z.string().optional(),
  },
  wrap((p) => ({ id: Pins.enqueue(p) })));

// ─────────────────────────── WordPress ───────────────────────────
server.tool('wp_create_draft',
  'Publish a roundup article to WordPress as a DRAFT on the active site (or a given siteId). Returns {id, link}.',
  {
    title: z.string(), html: z.string(), slug: z.string().optional(),
    categoryName: z.string().optional(), featuredImageId: z.number().int().optional(), siteId: z.number().int().optional(),
  },
  wrap(async ({ title, html, slug, categoryName, featuredImageId, siteId }) => {
    const site = resolveSite(siteId);
    return WordPress.createDraft(site, title, html, { slug: slug || '', categoryName: categoryName || '', featuredImageId: featuredImageId || 0 });
  }));

server.tool('wp_upload_image',
  'Upload a local image file to the WordPress media library (auto WebP). Returns {id, url}.',
  { path: z.string(), filename: z.string().optional(), alt: z.string().optional(), title: z.string().optional(), description: z.string().optional(), siteId: z.number().int().optional() },
  wrap(async ({ path, filename, alt, title, description, siteId }) => {
    const site = resolveSite(siteId);
    const buf = readFileSync(path);
    const name = filename || path.split(/[\\/]/).pop();
    return WordPress.uploadImage(site, buf, name, { alt_text: alt, title, description });
  }));

server.tool('wp_probe', 'Re-connect to a WP site and fetch site name + authors + categories (active site or siteId).',
  { siteId: z.number().int().optional() },
  wrap(async ({ siteId }) => WordPress.probe(resolveSite(siteId))));

// ─────────────────────────── Dolphin / Pinterest ───────────────────────────
server.tool('list_dolphin_profiles', 'List Dolphin Anty browser profiles (Pinterest accounts) — local API first, cloud fallback.', {},
  wrap(async () => {
    const cfg = secretOpt('dolphinAnty');
    if (!cfg?.apiToken) throw new Error('Dolphin token not set (Settings → Connections)');
    const d = new DolphinAnty({ dolphinAnty: cfg });
    const list = await d.listProfilesAny({ limit: 100 });
    return (Array.isArray(list) ? list : []).map(p => ({ id: String(p.id), name: p.name || p.title || ('Profile ' + p.id) }));
  }));

server.tool('probe_pinterest_account', 'Briefly launch a Dolphin profile to read its Pinterest username + boards.',
  { profileId: z.string() },
  wrap(async ({ profileId }) => probePinterestAccount(String(profileId))));

// ─────────────────────────── Trends fast path (network API, no browser UI) ───────────────────────────
server.tool('harvest_trends',
  'FAST Pinterest Trends harvest via direct network API (~2s, no browser clicking). Pulls the Growing/Seasonal/monthly/yearly leaderboards for a category across weekly windows of LAST YEAR matching +30..+90 days from today (cyclical prediction). Returns deduped terms with normalizedCount, wow/mom/yoy change, seasonality score, and how many weekly windows each appeared in (weeksSeen — persistence = real seasonal demand, not a one-off). USE THIS FIRST for discovery instead of browsing trends.pinterest.com. NOTE: needs the research browser profile free — if your playwright browser is open, browser_close it first, or this errors.',
  {
    interest: z.string().optional().describe('Category name (e.g. "food and drinks", "home decor", "diy and crafts", "parenting") or raw l1 interest id. Omit for all categories.'),
    presets: z.array(z.enum(['growing', 'seasonal', 'monthly', 'yearly'])).optional().describe('Default ["growing","seasonal"] — the two forward-looking boards.'),
    fromDays: z.number().int().optional().describe('Forecast horizon start, days from today (default 30).'),
    toDays: z.number().int().optional().describe('Forecast horizon end, days from today (default 90).'),
    perCall: z.number().int().optional().describe('Terms per leaderboard call (default 25).'),
    top: z.number().int().optional().describe('Return only the top N merged terms (default 60).'),
    force: z.boolean().optional().describe('Bypass the 6h cache and re-fetch (default false — repeat harvests of the same category return instantly from cache).'),
  },
  wrap(async ({ interest, presets, fromDays, toDays, perCall, top, force }) => {
    const weeks = weeklyWindowsLastYear({ from: fromDays ?? 30, to: toDays ?? 90 });
    const res = await harvestTrends({ interest: interest || null, presets: presets || ['growing', 'seasonal'], weeks, perCall: perCall ?? 25, force: !!force });
    return { ...res, terms: res.terms.slice(0, top ?? 60) };
  }));

// Shared by the trend_curves tool and best_keywords_for_trend below.
async function computeTiming(terms, leadDays) {
  const rows = await fetchCurves(terms);
  return rows.map(r => {
    const historical = (r.counts || []).filter(c => c.predictedUpperBoundNormalizedCount == null);
    const liftoff = detectLiftoff(historical);
    const predicted = predictLiftoffFromHistory(r.counts, { leadDays: leadDays ?? 30 });
    return {
      term: r.term, growth_rates: r.growth_rates, has_prediction: r.has_prediction, counts: r.counts.slice(-16),
      liftoff, predicted,
      verdict: combinedTimingVerdict(r.term, liftoff, predicted),
    };
  });
}

server.tool('trend_curves',
  'Fetch the REAL weekly interest-over-time curve (same data as the graph on trends.pinterest.com, 2 years so a full prior cycle is visible) for up to ~25 terms at once, via the Trends network API (~2-4s, no browser clicking). Each result includes: `liftoff` (this YEAR\'s confirmed live signal: LIFTOFF/RISING/NEAR_PEAK/FLAT/DECLINING), `predicted` (a FORECAST from LAST cycle\'s curve — projects when the next bend should happen and recommends starting ~30 days before it, so the pin is indexed before the rise hits, instead of reacting after it\'s already visible), and `verdict` (the one to actually use — reconciles the two: trusts live confirmation when something is already moving, falls back to the historical forecast when live is still flat/quiet). Use this on your FINAL shortlist (not the whole harvest_trends list) as the primary timing signal. Feed the `counts` (last ~12 points) into save_keyword_score\'s `trend_points`.',
  { terms: z.array(z.string()).min(1).max(50), leadDays: z.number().int().optional().describe('Days of indexing lead time to recommend before the predicted liftoff (default 30).') },
  wrap(async ({ terms, leadDays }) => computeTiming(terms, leadDays)));

server.tool('list_trend_categories', 'List the valid Pinterest Trends interest/category names usable with harvest_trends.', {},
  wrap(() => Object.keys(INTEREST_IDS)));

// ─────────────────────────── Keyword bank (bulk export → offline discovery) ───────────────────────────
server.tool('pinclicks_export_seeds',
  'BULK-EXPORT PinClicks Keyword Explorer for a FEW broad seeds → ~1000 keywords+volumes each into the local keyword bank. This is the CHEAP high-yield half of PinClicks (one page load + one Export per seed). Do this ONCE per topic area, then use query_keyword_bank (offline, instant, free) to discover/shortlist instead of looping PinClicks live. Pass 3-8 BROAD seeds (e.g. "pumpkin", "fall dinner", "chicken"), NOT narrow long-tails. Needs the profile free; slow + human-paced by design. Does NOT fetch Top Pins competition — use pinclicks_enrich(withTopPins) on the final shortlist for that.',
  { seeds: z.array(z.string()).min(1).max(12) },
  wrap(async ({ seeds }) => exportSeeds(seeds)));

server.tool('query_keyword_bank',
  'OFFLINE discovery over the local keyword bank (instant, free, zero PinClicks hits). Filter/sort the exported keywords to build a shortlist WITHOUT live looping. Use this as the main discovery step after pinclicks_export_seeds.',
  {
    like: z.string().optional().describe('substring the keyword must contain (e.g. "muffin").'),
    anyOf: z.array(z.string()).optional().describe('keyword must contain at least one of these (e.g. ["recipe","how to"]).'),
    minVolume: z.number().int().optional().describe('min volume (new-blog floor ~1000).'),
    maxVolume: z.number().int().optional().describe('max volume (new-blog ceiling ~10000-15000 to avoid locked heads).'),
    exclude: z.array(z.string()).optional().describe('drop keywords containing any of these (e.g. ["ideas","best","inspo"] to skip roundups).'),
    sort: z.enum(['volume', 'keyword']).optional(),
    limit: z.number().int().optional(),
  },
  wrap((q) => KeywordBank.query(q)));

server.tool('keyword_bank_status', 'How many keywords are banked + which seeds have been exported (freshness).', {},
  wrap(() => ({ total: KeywordBank.count(), seeds: KeywordBank.seeds() })));

server.tool('compute_timing',
  'DETERMINISTIC seasonal timing for a peak month — anchors on LIFT-OFF (a seasonal term rises ~90d before peak; a new account must publish BEFORE that). Returns {seasonal_timing 0-1, publish_by, verdict, days_to_peak}. FALLBACK ONLY when smart_timing has no moment match — prefer smart_timing.',
  { peak_month: z.string().describe('e.g. "August", "September", "year-round"') },
  wrap(({ peak_month }) => seasonalTiming(peak_month)));

server.tool('smart_timing',
  'BEST timing call — use this INSTEAD of compute_timing. Tries to match the keyword against Pinterest\'s OWN named-moment calendar (real takeoff/lift-off date + peak date + plateau width, fetched live from Trends, cached 24h) — e.g. "peach cobbler" -> summer, "pumpkin bread" -> halloween/fall. If matched, returns REAL dates and a shape (spike = narrow window like Halloween/New Year, hump = wide window like produce/summer topics, medium) — this is far more precise than guessing from a peak month. Falls back to the peak-month heuristic (like compute_timing) if no moment matches. ALWAYS call this to set seasonal_timing + publish_by.',
  { keyword: z.string(), peak_month: z.string().optional().describe('fallback if no moment matches, e.g. "August"') },
  wrap(async ({ keyword, peak_month }) => {
    const { moments } = await fetchMoments();
    const m = matchMoment(keyword, moments);
    if (m && m.peakDate) return timingFromMoment(m);
    return { ...seasonalTiming(peak_month || ''), source: 'peak_month_fallback' };
  }));

server.tool('list_moments', 'List Pinterest\'s official named seasonal moments with real takeoff/peak dates + shape (spike/medium/hump). Useful to see the full yearly calendar at a glance.', {},
  wrap(async () => (await fetchMoments()).moments));

server.tool('trend_titles',
  'For ONE parent trend/seed (e.g. "peach", "zucchini", "pumpkin"), return MULTIPLE distinct winnable dish/title candidates from the keyword bank — "peach cobbler", "peach fridge cake", "peach cookies" are DIFFERENT dishes and all come back (unlike shortlist_candidates, which collapses near-duplicates to one). Each candidate includes real annotations (Pinterest\'s related-interest tags from the export) to use in the title/description. Call this once per trend when the user wants several best titles under a topic, not just one. Requires the seed to already be exported (pinclicks_export_seeds) or reasonably covered by an existing seed in the bank.',
  {
    seed: z.string().describe('the parent trend, e.g. "peach"'),
    niche: z.enum(['food', 'home', 'any']).optional().describe('filters out off-topic dishes sharing the seed word (e.g. "peach nails", "peach 1st birthday") when the request is for recipes. Default "any" = no filter.'),
    volMin: z.number().int().optional().describe('default 500'),
    volMax: z.number().int().optional().describe('default 60000'),
    limit: z.number().int().optional().describe('how many distinct dishes to return (default 12)'),
  },
  wrap(({ seed, niche, volMin, volMax, limit }) => {
    const rows = KeywordBank.query({ like: seed, minVolume: 0, limit: 1000 });
    const exclude = new Set(KeywordScores.recentKeywords(500));
    const taxonomyContains = niche === 'food' ? 'food' : niche === 'home' ? 'home' : null;
    return trendTitles(rows, { exclude, volMin: volMin ?? 500, volMax: volMax ?? 60000, limit: limit ?? 12, taxonomyContains });
  }));

server.tool('shortlist_candidates',
  'ONE-CALL offline shortlist (replaces multiple query_keyword_bank calls + agent filtering). Reads the keyword bank, extracts keyword shape, computes a CHEAP competition + winnability PRIOR, drops predicted-LOCKED / bare-head / roundup / already-seen terms, clusters near-duplicate variants to one canonical each, and returns the top pre-ranked candidates. USE THIS to pick which few keywords deserve a live pinclicks_enrich(withTopPins) — do NOT live-check terms it marks predict:"MAYBE" with low cheapWinnability. Saves agent tokens + live PinClicks visits.',
  {
    like: z.string().optional().describe('substring filter (e.g. "muffin")'),
    anyOf: z.array(z.string()).optional().describe('keyword must contain one of these'),
    volMin: z.number().int().optional().describe('default 800'),
    volMax: z.number().int().optional().describe('default 35000 (new-account ceiling)'),
    requireWedge: z.boolean().optional().describe('require an audience/format/constraint/season modifier (recommended for recipes)'),
    limit: z.number().int().optional().describe('how many candidates to return (default 8)'),
  },
  wrap(({ like, anyOf, volMin, volMax, requireWedge, limit }) => {
    const rows = KeywordBank.query({ like: like || null, anyOf: anyOf || null, minVolume: 0, limit: 1000 });
    const exclude = new Set(KeywordScores.recentKeywords(500));   // dedup vs already-surfaced
    return buildShortlist(rows, { exclude, volMin: volMin ?? 800, volMax: volMax ?? 35000, requireWedge: !!requireWedge, limit: limit ?? 8 });
  }));

server.tool('pinclicks_enrich',
  'HUMAN-PACED PinClicks lookup for a SMALL shortlist (real search volume + related long-tails per keyword). Drives the logged-in browser slowly and scrapes the rendered table — deliberately slow (~25s/keyword) and CAPPED so it never trips PinClicks\' Cloudflare block. Rules: (1) only pass the FINAL shortlist harvest_trends produced (≤8 keywords), never a big list; (2) needs the browser profile FREE — close the Settings login window and your own playwright browser first; (3) if it returns blocked:true, STOP immediately — do not retry, do not open a fresh profile as a "fix" (confirmed 2026-07-08: this can be an IP-level Cloudflare block, and a brand-new never-used profile hit the identical block on the same network within minutes). Tell the user it looks like an IP-level block, the cooldown needs to run its course (or they can try from a different network), and wait — retrying makes it worse, not better. Returns real PinClicks volumes to feed `demand` + related terms to expand.',
  {
    keywords: z.array(z.string()).min(1).max(8),
    max: z.number().int().optional().describe('Hard cap (default 8).'),
    withTopPins: z.boolean().optional().describe('ALSO "go inside" each keyword → real Top Pins competition read via PinClicks\' own Pin Data export (not a fragile table-scrape): {competition 0-1, verdict, signals:{medianSaves, exactMatchTop5, freshHighSave, staleCount, bigMedia, freshBigMedia, staleBigMedia, weakPins}, topPinsSample, topPinAnnotations}. `topPinAnnotations` is the REAL per-pin Pinterest tags aggregated across the ranking pins for this exact keyword — use this as the PREFERRED source for save_keyword_score\'s `annotations` field. Slower (adds a page load per keyword) but gives the exact-match-weakness + save-velocity judgment the skill needs, plus real annotations in the same call. Recommended for the FINAL shortlist.'),
    niche: z.enum(['recipe', 'home']).optional().describe('Save thresholds differ — recipes tolerate more saves (default "recipe").'),
    force: z.boolean().optional().describe('Bypass the 3-day per-keyword cache and re-look-up live (default false).'),
  },
  wrap(async ({ keywords, max, withTopPins, niche, force }) => {
    const res = await enrichKeywords(keywords, { max: max ?? 8, withTopPins: !!withTopPins, niche: niche || 'recipe', force: !!force });
    for (const r of res.results || []) {
      if (r.verdict === 'WINNABLE') pendingWinnables.set(String(r.keyword).toLowerCase(), { keyword: r.keyword, competition: r.competition, foundAt: new Date().toISOString() });
    }
    if (pendingWinnables.size > 0) {
      res.UNSAVED_WINNABLE_REMINDER = `⚠ ${pendingWinnables.size} WINNABLE keyword(s) found and not yet saved: ${[...pendingWinnables.values()].map(w => w.keyword).join(', ')}. Call save_keyword_score for EACH one now, before doing anything else — do not batch this for later, do not move to the next trend first.`;
    }
    return res;
  }));

server.tool('best_keywords_for_trend',
  'ONE-CALL automated pipeline for the "user gives me a trend" workflow: pass a trend name, get back RANKED best keyword titles for it — each with real competition (from PinClicks Top Pins), real annotations (PinClicks\' own Related Interests), and real timing (trend_curves verdict) — sorted lowest-competition-first. Internally composes query_keyword_bank/trend_titles (offline, free) + pinclicks_enrich withTopPins (live, capped, cached) + trend_curves (Trends API) — same safety budget and cache as calling them separately, so this does NOT bypass the Cloudflare circuit breaker. Does NOT auto-save (still call save_keyword_score yourself for the ones worth keeping, parent_trend = the trend you passed in) — this tool is discovery + scoring only. If the trend isn\'t banked yet, returns a note telling you to pinclicks_export_seeds([trend]) first. If live PinClicks budget is exhausted/blocked, still returns whatever the cache + bank can offer, clearly marked.',
  {
    trend: z.string().min(1),
    max: z.number().int().optional().describe('How many candidates to live-check + rank (default 6, cap 8).'),
    niche: z.enum(['recipe', 'home']).optional(),
  },
  wrap(async ({ trend, max, niche }) => {
    const cap = Math.min(max ?? 6, 8);
    const bankRows = KeywordBank.query({ like: trend, minVolume: 0, limit: 500 });
    if (!bankRows.length) {
      return { trend, candidates: [], note: `No bank data for "${trend}" yet. Call pinclicks_export_seeds(["${trend}"]) first (live, human-paced, one-time per trend), then retry this call.` };
    }
    const exclude = new Set(KeywordScores.recentKeywords(500));
    const shortlisted = trendTitles(bankRows, { exclude, limit: cap * 2, taxonomyContains: niche === 'home' ? null : 'food' });
    if (!shortlisted.length) {
      return { trend, candidates: [], note: `Bank has ${bankRows.length} rows for "${trend}" but none survived the offline pre-filter (all predicted-LOCKED, off-topic, or already surfaced).` };
    }
    const toCheck = shortlisted.slice(0, cap).map(c => c.keyword);
    const enrichRes = await enrichKeywords(toCheck, { withTopPins: true, niche: niche || 'recipe', max: cap });
    for (const r of enrichRes.results || []) {
      if (r.verdict === 'WINNABLE') pendingWinnables.set(String(r.keyword).toLowerCase(), { keyword: r.keyword, competition: r.competition, foundAt: new Date().toISOString() });
    }
    const checked = (enrichRes.results || []).filter(r => r.verdict);
    const timings = checked.length ? await computeTiming(checked.map(r => r.keyword)) : [];
    const timingByTerm = new Map(timings.map(t => [t.term.toLowerCase(), t]));

    const candidates = checked.map(r => {
      const cand = shortlisted.find(c => c.keyword === r.keyword) || {};
      const timing = timingByTerm.get(r.keyword.toLowerCase());
      return {
        keyword: r.keyword, dish: cand.dish || null, volume: cand.volume ?? r.volume ?? null,
        competition: r.competition, verdict: r.verdict, annotations: cand.annotations || '',
        publish_by: timing ? timing.verdict : null, trend_points: timing ? timing.counts.map(c => c.normalizedCount) : null,
      };
    }).sort((a, b) => (a.competition ?? 1) - (b.competition ?? 1));

    const skippedForBudget = toCheck.length - checked.length;
    const result = {
      trend, candidates, checkedCount: checked.length,
      skippedNoLiveData: skippedForBudget || undefined,
      blocked: enrichRes.blocked || undefined, budgetExhausted: enrichRes.budgetExhausted || undefined,
    };
    if (pendingWinnables.size > 0) {
      result.UNSAVED_WINNABLE_REMINDER = `⚠ ${pendingWinnables.size} WINNABLE keyword(s) found and not yet saved: ${[...pendingWinnables.values()].map(w => w.keyword).join(', ')}. Call save_keyword_score for EACH one now — parent_trend = "${trend}".`;
    }
    return result;
  }));

// ─────────────────────────── Data / introspection (full visibility) ───────────────────────────
server.tool('sql_query',
  'Run a READ-ONLY SQL query against the app database (SELECT/PRAGMA/EXPLAIN/WITH only). Full visibility into all tables.',
  { sql: z.string() },
  wrap(({ sql }) => {
    if (!/^\s*(select|pragma|explain|with)\b/i.test(sql)) throw new Error('Only SELECT/PRAGMA/EXPLAIN/WITH queries are allowed');
    return getDb().prepare(sql).all();
  }));

server.tool('list_tables', 'List all database tables.', {},
  wrap(() => getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name)));

server.tool('read_logs', 'Read the most recent app log lines (in-memory buffer).',
  { limit: z.number().int().optional() },
  wrap(({ limit }) => Logger.getLogs().slice(-(limit ?? 100))));

// ─────────────────────────── boot ───────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[roundup-mcp] ready — tools registered');

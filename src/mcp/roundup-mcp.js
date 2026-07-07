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
import { buildShortlist, seasonalTiming, timingFromMoment, trendTitles } from '../shared/keyword-scoring.js';
import { secretOpt } from '../config.js';
import { Logger } from '../shared/logger.js';

getDb(); // ensure db + schema exist

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
  if (!v) return 'publish_by is empty. Call smart_timing(keyword, peak_month) first and use its publish_by/verdict verbatim.';
  if (BARE_DATE_RE.test(v)) return `publish_by ("${v}") looks like a bare date, not a timing verdict — you likely skipped smart_timing. Call smart_timing(keyword, peak_month) and use its actual publish_by/verdict text (e.g. "start now — by Jul 17, 2026" or "MISSED this cycle — queue for ~May 2027").`;
  return null;
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
    return { id: KeywordScores.save(k) };
  }));

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

server.tool('trend_curves',
  'Fetch current 12-month interest curves (weekly points + crystal-ball predictions where available) for up to ~25 terms at once, via the Trends network API (~2s). Use AFTER harvest_trends to read exact curve shape/timing for your shortlist without opening the browser. Same profile-free requirement as harvest_trends.',
  { terms: z.array(z.string()).min(1).max(50) },
  wrap(async ({ terms }) => fetchCurves(terms)));

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
  'HUMAN-PACED PinClicks lookup for a SMALL shortlist (real search volume + related long-tails per keyword). Drives the logged-in browser slowly and scrapes the rendered table — deliberately slow (~25s/keyword) and CAPPED so it never trips PinClicks\' Cloudflare block. Rules: (1) only pass the FINAL shortlist harvest_trends produced (≤8 keywords), never a big list; (2) needs the browser profile FREE — close the Settings login window and your own playwright browser first; (3) if it returns blocked:true, tell the user to add a fresh profile in Settings → Profiles and log in there. Returns real PinClicks volumes to feed `demand` + related terms to expand.',
  {
    keywords: z.array(z.string()).min(1).max(8),
    max: z.number().int().optional().describe('Hard cap (default 8).'),
    withTopPins: z.boolean().optional().describe('ALSO "go inside" each keyword → scrape Top Pins and return a real competition read: {competition 0-1, verdict, signals:{medianSaves, exactMatchTop5, freshHighSave, staleCount, bigMedia, weakPins}, topPinsSample}. Slower (adds a page load per keyword) but gives the exact-match-weakness + save-velocity judgment the skill needs. Recommended for the FINAL shortlist.'),
    niche: z.enum(['recipe', 'home']).optional().describe('Save thresholds differ — recipes tolerate more saves (default "recipe").'),
    force: z.boolean().optional().describe('Bypass the 3-day per-keyword cache and re-look-up live (default false).'),
  },
  wrap(async ({ keywords, max, withTopPins, niche, force }) => enrichKeywords(keywords, { max: max ?? 8, withTopPins: !!withTopPins, niche: niche || 'recipe', force: !!force })));

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

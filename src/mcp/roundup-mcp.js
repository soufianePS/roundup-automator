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
import { Sites, Topics, KeywordScores, Articles, ArticleItems, Pins } from '../db/repos.js';
import { WordPress } from '../shared/wordpress.js';
import { DolphinAnty } from '../shared/dolphin.js';
import { probePinterestAccount } from '../shared/pinterest-probe.js';
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
server.tool('save_keyword_score',
  'Save a researched keyword with its opportunity score, sub-signals and annotations (the training data).',
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
  wrap((k) => ({ id: KeywordScores.save(k) })));

server.tool('list_keyword_scores', 'Top researched keywords by opportunity score.',
  { limit: z.number().int().optional() },
  wrap(({ limit }) => KeywordScores.top(limit ?? 25)));

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

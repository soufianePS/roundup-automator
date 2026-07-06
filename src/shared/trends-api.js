/**
 * Pinterest Trends — direct network API (no UI clicking). FAST path.
 *
 * Reverse-engineered from trends.pinterest.com (2026-07):
 *   GET /top_trends_filtered/?lookbackWindow=N&endDate=YYYY-MM-DD&country=US
 *       &trendsPreset=P[&l1interests=ID][&numTermsToReturn=N]
 *       presets: 1=Top monthly, 2=Top yearly, 3=Growing, 4=Seasonal
 *       endDate accepts PAST dates → weekly windows of last year predict this year.
 *   GET /metrics/?terms=a,b,c   → weekly curve points per term (+ predictions).
 *
 * Auth = cookies from the logged-in research profile. We launch it headless
 * once per harvest, make all calls through ctx.request (parallel, seconds),
 * then close. Only ONE chromium may hold the profile — callers must ensure
 * the agent browser / login window is closed.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, '..', '..', 'data', 'browser-profiles', 'research');
const BASE = 'https://trends.pinterest.com';

// UI category name → l1interests id (harvested from the live filter, 2026-07)
export const INTEREST_IDS = {
  'animals': '925056443165', 'architecture': '918105274631', 'art': '961238559656',
  'beauty': '935541271955', "children's fashion": '903733943146', 'design': '902065567321',
  'diy and crafts': '934876475639', 'education': '922134410098', 'electronics': '960887632144',
  'entertainment': '953061268473', 'event planning': '941870572865', 'finance': '913207199297',
  'food and drinks': '918530398158', 'gardening': '909983286710', 'health': '898620064290',
  'home decor': '935249274030', "men's fashion": '924581335376', 'parenting': '920236059316',
  'quotes': '948192800438', 'sport': '919812032692', 'travel': '908182459161',
  'vehicles': '918093243960', 'wedding': '903260720461', "women's fashion": '948967005229',
};
export const PRESETS = { monthly: 1, yearly: 2, growing: 3, seasonal: 4 };

function resolveInterest(nameOrId) {
  if (!nameOrId) return null;
  if (/^\d{9,}$/.test(String(nameOrId))) return String(nameOrId);
  const id = INTEREST_IDS[String(nameOrId).toLowerCase().trim()];
  if (!id) throw new Error(`Unknown interest "${nameOrId}". Valid: ${Object.keys(INTEREST_IDS).join(', ')}`);
  return id;
}

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * The user's weekly-window trick: for a forecast horizon of +30..+90 days from
 * today, generate LAST YEAR's equivalent weekly end-dates. What was rising then
 * predicts what rises now (Pinterest search is cyclical).
 */
export function weeklyWindowsLastYear({ from = 30, to = 90, stepDays = 7, today = new Date() } = {}) {
  const dates = [];
  for (let offset = from; offset <= to; offset += stepDays) {
    const d = new Date(today.getTime() + offset * 86400000);
    d.setFullYear(d.getFullYear() - 1);
    dates.push(iso(d));
  }
  return dates;
}

async function openApi() {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true });
  return {
    ctx,
    get: async (path, params) => {
      const qs = new URLSearchParams(params).toString();
      const r = await ctx.request.get(`${BASE}${path}?${qs}`, { headers: { Accept: 'application/json' } });
      if (r.status() !== 200) throw new Error(`${path} → HTTP ${r.status()}`);
      return r.json();
    },
    close: () => ctx.close(),
  };
}

/**
 * Harvest trend terms across weekly windows × presets for one category.
 * Returns deduped terms with their best metrics + which weeks they appeared in.
 *
 * opts: { interest ('food and drinks' | id | null=all), presets (['growing','seasonal']),
 *         weeks (ISO dates; default = last-year +30..+90d weekly), country, perCall }
 */
export async function harvestTrends(opts = {}) {
  const {
    interest = null,
    presets = ['growing', 'seasonal'],
    weeks = weeklyWindowsLastYear(),
    country = 'US',
    perCall = 25,
  } = opts;
  const interestId = resolveInterest(interest);
  const api = await openApi();
  const terms = new Map();   // term → merged record
  const t0 = Date.now();
  try {
    const jobs = [];
    for (const week of weeks) {
      for (const presetName of presets) {
        const preset = PRESETS[presetName] ?? presetName;
        const params = { lookbackWindow: 2, endDate: week, rankingMethod: 3, country, trendsPreset: preset, numTermsToReturn: perCall };
        if (interestId) params.l1interests = interestId;
        jobs.push(
          api.get('/top_trends_filtered/', params).then(j => ({ week, presetName, values: j.values || [] }))
            .catch(e => ({ week, presetName, values: [], error: e.message }))
        );
      }
    }
    const results = await Promise.all(jobs);
    for (const r of results) {
      if (r.error) Logger.warn(`[trends-api] ${r.week}/${r.presetName}: ${r.error}`);
      for (const v of r.values) {
        const key = v.term.toLowerCase();
        const rec = terms.get(key) || {
          term: v.term, weeks: [], presets: new Set(),
          bestNormalizedCount: 0, wow: null, mom: null, yoy: null, seasonality: null,
        };
        rec.weeks.push(r.week);
        rec.presets.add(r.presetName);
        rec.bestNormalizedCount = Math.max(rec.bestNormalizedCount, v.normalizedCount ?? 0);
        rec.wow = v.wow_change?.value ?? rec.wow;
        rec.mom = v.mom_change?.value ?? rec.mom;
        rec.yoy = v.yoy_change?.value ?? rec.yoy;
        rec.seasonality = v.seasonality_score ?? rec.seasonality;
        terms.set(key, rec);
      }
    }
  } finally {
    await api.close();
  }
  const list = [...terms.values()]
    .map(r => ({ ...r, presets: [...r.presets], weeksSeen: r.weeks.length }))
    .sort((a, b) => b.weeksSeen - a.weeksSeen || b.bestNormalizedCount - a.bestNormalizedCount);
  Logger.success(`[trends-api] harvested ${list.length} unique terms in ${((Date.now() - t0) / 1000).toFixed(1)}s (${weeks.length} weeks × ${presets.length} presets)`);
  return { terms: list, weeks, presets, interest: interest || 'all', country };
}

/**
 * Fetch current interest curves (+ predictions where available) for up to ~25 terms.
 * Returns [{term, counts:[{date, normalizedCount, predicted…}], growth_rates, has_prediction}]
 */
export async function fetchCurves(termList, { country = 'US' } = {}) {
  if (!termList?.length) return [];
  const api = await openApi();
  try {
    const out = [];
    for (let i = 0; i < termList.length; i += 25) {
      const batch = termList.slice(i, i + 25);
      const j = await api.get('/metrics/', { terms: batch.join(','), country });
      for (const k of Object.keys(j)) out.push(j[k]);
    }
    return out;
  } finally {
    await api.close();
  }
}

/** Probe top_trends_filtered params directly (cookies from research profile). */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, '..', 'data', 'browser-profiles', 'research');
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true });

const BASE = 'https://trends.pinterest.com/top_trends_filtered/';
const get = async (params) => {
  const qs = new URLSearchParams(params).toString();
  const r = await ctx.request.get(`${BASE}?${qs}`, { headers: { Accept: 'application/json' } });
  let terms = null;
  try { const j = await r.json(); terms = (j.values || []).map(v => v.term).slice(0, 6); } catch {}
  return { status: r.status(), terms };
};

const base = { lookbackWindow: 2, endDate: '2026-07-01', rankingMethod: 3, country: 'US', trendsPreset: 3, numTermsToReturn: 8 };

console.log('baseline       :', JSON.stringify(await get(base)));
for (const preset of [0, 1, 2, 3, 4, 5]) {
  console.log(`trendsPreset=${preset}:`, JSON.stringify(await get({ ...base, trendsPreset: preset })));
}
// interest param candidates
for (const [k, v] of [
  ['interests', 'food_and_drinks'], ['interest', 'food_and_drinks'],
  ['interests', 'Food and drinks'], ['l1Interest', 'food_and_drinks'],
  ['l1_interest', 'food_and_drinks'], ['interests', '918'], ['interests', 'food'],
  ['articleCategory', 'food'], ['category', 'food_and_drinks'],
]) {
  console.log(`${k}=${v}:`, JSON.stringify(await get({ ...base, [k]: v })));
}
// past endDate (your per-week idea uses endDate; check it accepts past dates + different windows)
console.log('endDate 2025-08-06:', JSON.stringify(await get({ ...base, endDate: '2025-08-06' })));
console.log('lookback=1        :', JSON.stringify(await get({ ...base, lookbackWindow: 1 })));

await ctx.close();

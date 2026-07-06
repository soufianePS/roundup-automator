/** Find the interest name→ID mapping in the page's embedded state. */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, '..', 'data', 'browser-profiles', 'research');
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true });
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://trends.pinterest.com/search?country=US', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

const mapping = await page.evaluate(() => {
  const results = {};
  const visit = (obj, depth) => {
    if (!obj || depth > 8) return;
    if (Array.isArray(obj)) { obj.forEach(o => visit(o, depth + 1)); return; }
    if (typeof obj !== 'object') return;
    // an interest entry looks like {id:'918...', name:'Food and Drinks'} or similar
    const id = obj.id || obj.interest_id || obj.interestId;
    const name = obj.name || obj.label || obj.display_name;
    if (id && name && /^\d{6,}$/.test(String(id)) && typeof name === 'string' && name.length < 40) {
      results[name] = String(id);
    }
    Object.values(obj).forEach(v => visit(v, depth + 1));
  };
  // scan embedded script JSON + common globals
  for (const s of document.querySelectorAll('script')) {
    const t = s.textContent || '';
    if (!t.includes('918530398158') && !t.includes('interest')) continue;
    try { visit(JSON.parse(t), 0); } catch {
      // try to find JSON objects inside
      const m = t.match(/\{.*"918530398158".*\}/s);
    }
  }
  if (window.__PWS_INITIAL_PROPS__) visit(window.__PWS_INITIAL_PROPS__, 0);
  if (window.__initialState) visit(window.__initialState, 0);
  return results;
});
console.log(JSON.stringify(mapping, null, 1));

// fallback: search raw HTML around the known ID
if (!Object.keys(mapping).length) {
  const html = await page.content();
  const i = html.indexOf('918530398158');
  console.log('raw context:', html.slice(Math.max(0, i - 600), i + 600));
}
await ctx.close();

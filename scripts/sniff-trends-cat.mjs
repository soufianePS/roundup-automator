/** Discover the category/interest filter param on top_trends_filtered. */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, '..', 'data', 'browser-profiles', 'research');

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 950 } });
const page = ctx.pages()[0] || await ctx.newPage();

page.on('request', (req) => {
  const u = req.url();
  if (u.includes('top_trends_filtered')) console.log('[REQ]', decodeURIComponent(u));
});

await page.goto('https://trends.pinterest.com/?country=US', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

// Dump visible filter/chip controls so we know what the UI calls them
const controls = await page.$$eval('button, [role="tab"], [role="combobox"], select', els =>
  els.map(e => (e.textContent || '').trim()).filter(t => t && t.length < 45).slice(0, 60));
console.log('[controls]', JSON.stringify(controls));

// Try clicking a category/interests dropdown then "Food" option
const tryClick = async (labels) => {
  for (const l of labels) {
    const el = await page.$(`text="${l}"`).catch(() => null);
    if (el) { console.log('[click]', l); await el.click().catch(()=>{}); await page.waitForTimeout(1800); return true; }
  }
  return false;
};
await tryClick(['Intérêts', 'Interests', 'Interest', 'Catégories', 'Categories', 'Category', 'Centres d’intérêt']);
// after opening, dump options
const opts = await page.$$eval('[role="option"], [role="menuitem"], label', els =>
  els.map(e => (e.textContent || '').trim()).filter(t => t && t.length < 45).slice(0, 60)).catch(() => []);
console.log('[options]', JSON.stringify(opts));
await tryClick(['Food and drinks', 'Alimentation et boissons', 'Food & drink', 'Food']);
await page.waitForTimeout(2500);

await ctx.close();

/** Open the FULL search-trends page (with category/date filters) and capture requests. */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, '..', 'data', 'browser-profiles', 'research');
const OUT = join(__dirname, '..', 'data', 'sniff');
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 950 } });
const page = ctx.pages()[0] || await ctx.newPage();

page.on('request', (req) => {
  const u = req.url();
  if (u.includes('top_trends_filtered')) console.log('[REQ]', decodeURIComponent(u).slice(0, 400));
});

await page.goto('https://trends.pinterest.com/?country=US', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);
const btn = page.getByText('View search trends', { exact: true }).first();
await btn.click().catch(e => console.log('btn:', e.message.split('\n')[0]));
await page.waitForTimeout(4000);
console.log('[url]', page.url());
await page.screenshot({ path: join(OUT, 'search-trends-page.png'), fullPage: false });

// dump visible controls on this page
const vis = [];
for (const b of await page.$$('button, [role="combobox"], select')) {
  if (await b.isVisible().catch(() => false)) {
    const t = ((await b.textContent()) || '').trim();
    if (t && t.length < 50) vis.push(t);
  }
}
console.log('[controls]', JSON.stringify([...new Set(vis)]));
await ctx.close();

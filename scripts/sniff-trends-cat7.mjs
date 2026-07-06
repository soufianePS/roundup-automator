/** On /search page: pick Interest=Food and Drinks, capture the filtered request. */
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

await page.goto('https://trends.pinterest.com/search?country=US', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);

// open the Interest filter
for (const b of await page.$$('button')) {
  const t = ((await b.textContent()) || '').trim();
  if (/^Interest$/i.test(t) && await b.isVisible().catch(() => false)) { await b.click(); break; }
}
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, 'search-interest-open.png') });

// pick Food and Drinks (checkbox or option)
const cands = await page.getByText('Food and Drinks', { exact: true }).all();
console.log('[candidates]', cands.length);
for (const c of cands) {
  if (await c.isVisible().catch(() => false)) { console.log('[pick]'); await c.click({ timeout: 5000 }).catch(e=>console.log('cl:',e.message.split('\n')[0])); break; }
}
await page.waitForTimeout(2000);
// maybe needs an Apply/Done button
for (const label of ['Apply', 'Done', 'Save', 'Appliquer']) {
  const a = page.getByText(label, { exact: true }).first();
  if (await a.isVisible().catch(() => false)) { console.log('[apply]', label); await a.click().catch(()=>{}); break; }
}
await page.waitForTimeout(6000);
await page.screenshot({ path: join(OUT, 'search-after-interest.png') });
console.log('[url]', page.url());
await ctx.close();

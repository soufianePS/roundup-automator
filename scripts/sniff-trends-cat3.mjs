/** Pick 'Food and Drinks' exactly and capture the filtered top_trends request. */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, '..', 'data', 'browser-profiles', 'research');
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 950 } });
const page = ctx.pages()[0] || await ctx.newPage();

page.on('request', (req) => {
  const u = req.url();
  if (u.includes('top_trends_filtered')) console.log('[REQ]', decodeURIComponent(u).slice(0, 300));
});

await page.goto('https://trends.pinterest.com/?country=US', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

const btns = await page.$$('button');
for (const b of btns) {
  const t = ((await b.textContent()) || '').trim();
  if (/^Interest/i.test(t)) { await b.click(); break; }
}
await page.waitForTimeout(1200);
// exact option text from the menu dump — click the VISIBLE instance
const cands = await page.getByText('Food and Drinks', { exact: true }).all();
console.log('[candidates]', cands.length);
let clicked = false;
for (const c of cands) {
  if (await c.isVisible().catch(() => false)) {
    console.log('[pick] visible Food and Drinks');
    await c.click({ timeout: 5000 }).catch(e => console.log('click fail:', e.message.split('\n')[0]));
    clicked = true; break;
  }
}
if (!clicked) console.log('[pick] no visible candidate');
await page.waitForTimeout(5000);
console.log('[url now]', page.url());
await ctx.close();

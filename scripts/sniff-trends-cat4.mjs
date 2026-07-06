/** Full capture: open Interest dropdown, screenshot, pick Food and Drinks, log ALL requests. */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, '..', 'data', 'browser-profiles', 'research');
const OUT = join(__dirname, '..', 'data', 'sniff');
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 950 } });
const page = ctx.pages()[0] || await ctx.newPage();

let logAll = false;
page.on('request', (req) => {
  const u = req.url();
  if (!/trends\.pinterest\.com/.test(u)) return;
  if (/\.(js|css|png|jpg|svg|woff)/.test(u)) return;
  if (logAll || u.includes('top_trends')) console.log(`[${req.method()}]`, decodeURIComponent(u).slice(0, 280));
});

await page.goto('https://trends.pinterest.com/?country=US', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

const btns = await page.$$('button');
for (const b of btns) {
  const t = ((await b.textContent()) || '').trim();
  if (/^Interest/i.test(t)) { await b.click(); break; }
}
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, 'dropdown-open.png') });

logAll = true;
const cands = await page.getByText('Food and Drinks', { exact: true }).all();
for (const c of cands) {
  if (await c.isVisible().catch(() => false)) { await c.click({ timeout: 5000 }).catch(()=>{}); break; }
}
await page.waitForTimeout(6000);
await page.screenshot({ path: join(OUT, 'after-pick.png') });
console.log('[done]');
await ctx.close();

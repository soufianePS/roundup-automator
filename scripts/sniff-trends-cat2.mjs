/** Open the Interest dropdown for real and capture the filtered request. */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, '..', 'data', 'browser-profiles', 'research');
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 950 } });
const page = ctx.pages()[0] || await ctx.newPage();

page.on('request', (req) => {
  const u = req.url();
  if (u.includes('top_trends_filtered') || u.includes('metrics')) console.log('[REQ]', decodeURIComponent(u).slice(0, 260));
});

await page.goto('https://trends.pinterest.com/?country=US', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

// The filters bar: find the button whose accessible name mentions Interest
const btns = await page.$$('button');
for (const b of btns) {
  const t = ((await b.textContent()) || '').trim();
  if (/^Interest/i.test(t)) { console.log('[open]', t); await b.click(); break; }
}
await page.waitForTimeout(1500);
// dump whatever appeared
const menu = await page.$$eval('div[role="listbox"] *, [role="option"], [role="menu"] *, [data-test-id*="interest"] *', els =>
  [...new Set(els.map(e => (e.textContent || '').trim()).filter(t => t && t.length < 40))].slice(0, 40)).catch(() => []);
console.log('[menu]', JSON.stringify(menu));
// click Food option (en or fr)
for (const label of ['Food and drink', 'Food and drinks', 'Food & drink', 'Alimentation']) {
  const o = await page.$(`text=${label}`).catch(() => null);
  if (o) { console.log('[pick]', label); await o.click().catch(()=>{}); await page.waitForTimeout(3000); break; }
}
await page.screenshot({ path: join(__dirname, '..', 'data', 'sniff', 'interest-dropdown.png') });
await ctx.close();

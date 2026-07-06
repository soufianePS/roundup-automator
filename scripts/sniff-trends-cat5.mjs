/** Scroll to the leaderboard section, use ITS interest filter, capture the request. */
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
  if (u.includes('top_trends_filtered')) console.log('[REQ]', decodeURIComponent(u).slice(0, 320));
});

await page.goto('https://trends.pinterest.com/?country=US', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

// scroll to the Growing trends tab (the leaderboard section)
const growing = page.getByText('Growing trends', { exact: true }).first();
await growing.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, 'leaderboard-section.png') });

// find filter buttons near the leaderboard — dump all visible buttons after scroll
const vis = [];
for (const b of await page.$$('button')) {
  if (await b.isVisible().catch(() => false)) {
    const t = ((await b.textContent()) || '').trim();
    if (t && t.length < 45) vis.push(t);
  }
}
console.log('[visible buttons]', JSON.stringify([...new Set(vis)]));

// click the leaderboard's Interest filter (the LAST Interest-ish button = the one in this section)
const interestBtns = [];
for (const b of await page.$$('button')) {
  const t = ((await b.textContent()) || '').trim();
  if (/Interest/i.test(t) && await b.isVisible().catch(() => false)) interestBtns.push(b);
}
console.log('[interest buttons visible]', interestBtns.length);
if (interestBtns.length) {
  await interestBtns[interestBtns.length - 1].click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'leaderboard-interest-open.png') });
  const cands = await page.getByText('Food and Drinks', { exact: true }).all();
  for (const c of cands) {
    if (await c.isVisible().catch(() => false)) { console.log('[pick]'); await c.click({ timeout: 5000 }).catch(()=>{}); break; }
  }
  await page.waitForTimeout(6000);
}
await page.screenshot({ path: join(OUT, 'leaderboard-after-pick.png') });
console.log('[done]');
await ctx.close();

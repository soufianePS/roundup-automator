/** Click each Interest option and record the l1interests id that fires. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, '..', 'data', 'browser-profiles', 'research');
const OUT = join(__dirname, '..', 'data', 'sniff', 'interest-ids.json');

const NAMES = ['Animals','Architecture','Art','Beauty',"Children's Fashion",'Design','DIY and Crafts',
  'Education','Electronics','Entertainment','Event Planning','Finance','Food and Drinks','Gardening',
  'Health','Home Decor',"Men's Fashion",'Parenting','Quotes','Sport','Travel','Vehicles','Wedding',
  "Women's Fashion"];

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 950 } });
const page = ctx.pages()[0] || await ctx.newPage();

let lastIds = null;
page.on('request', (req) => {
  const u = req.url();
  if (!u.includes('top_trends_filtered')) return;
  const m = decodeURIComponent(u).match(/l1interests=([\d,]+)/);
  lastIds = m ? m[1] : '';
});

await page.goto('https://trends.pinterest.com/search?country=US', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);

const openInterest = async () => {
  for (const b of await page.$$('button')) {
    const t = ((await b.textContent()) || '').trim();
    if (/^Interest/i.test(t) && await b.isVisible().catch(() => false)) { await b.click(); await page.waitForTimeout(900); return true; }
  }
  return false;
};

const map = {};
for (const name of NAMES) {
  lastIds = null;
  if (!await openInterest()) { console.log('no interest button'); break; }
  const cands = await page.getByText(name, { exact: true }).all();
  let hit = false;
  for (const c of cands) {
    if (await c.isVisible().catch(() => false)) { await c.click({ timeout: 4000 }).catch(()=>{}); hit = true; break; }
  }
  if (!hit) { console.log(`skip (not visible): ${name}`); await page.keyboard.press('Escape').catch(()=>{}); continue; }
  await page.waitForTimeout(2200);
  if (lastIds) { map[name] = lastIds; console.log(`${name} = ${lastIds}`); }
  else console.log(`no request for: ${name}`);
  // deselect (click again) so ids don't accumulate
  lastIds = null;
  await openInterest();
  for (const c of await page.getByText(name, { exact: true }).all()) {
    if (await c.isVisible().catch(() => false)) { await c.click({ timeout: 4000 }).catch(()=>{}); break; }
  }
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape').catch(()=>{});
}
writeFileSync(OUT, JSON.stringify(map, null, 1));
console.log('saved →', OUT);
await ctx.close();

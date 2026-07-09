---
name: keyword-research
description: How to research high-opportunity, low-competition Pinterest keywords for the family/home blog (home decor, DIY, holidays, lifestyle, AND family recipe/meal roundups — recipe roundups are in scope here, distinct from the separate leagueofcooking.com recipe site) by navigating Pinterest Trends + PinClicks in the browser, reading trends for ANY date, scoring them, and saving to the app DB. Use whenever the user asks to find keywords, research a niche/seed (including recipe/meal roundup topics), score keyword opportunity, spot seasonal trends, or fill the keyword pipeline.
---

# Keyword research — your job on this app

You find **high-opportunity, low-competition** keywords for a family/home blog
(home decor, DIY, holidays, home, lifestyle, **and family recipe/meal roundups** —
"25 Easy Weeknight Dinners" is a normal topic here, same as "25 Cozy Living Room
Ideas") and save them with an opportunity score + ready-to-use annotations. Recipe
ROUNDUPS are in scope; individual food-recipe SEO for the separate leagueofcooking.com
site is not — don't re-litigate that distinction each run, only ask if a request is
genuinely unclear about which site/pipeline it targets. You do this by **navigating
real sites in the browser** (Playwright MCP tools) and using your judgment — not guessing.

## The one fact that drives everything

**Pinterest is a planning search engine, not a social feed.** Users save ideas
**30–90 days before they act**, and the algorithm favors pins that have been in the
system long enough to accumulate engagement. So the whole game is: find a keyword
with real, *rising* demand, then publish **during its rise, weeks before its peak**,
so your pin is already ranking when everyone starts searching. Publish at the peak and
you lose — your pin is brand-new (no history) exactly when mature pins own the feed.

Two consequences to internalize:
- **Pinterest Trends shows RELATIVE interest (0–100), never real volume.** The curve
  is that term's popularity indexed to its *own* peak. You must cross-check volume
  from another source before trusting that demand is actually big.
- **Timing is a first-class signal**, not an afterthought. A great keyword published
  at the wrong time is a wasted article.

## Tools you use
- **Browser** (Playwright MCP): `browser_navigate`, `browser_snapshot`,
  `browser_click`, `browser_type`, `browser_take_screenshot`. Snapshot first to
  see structure; screenshot when you need to *read* a chart/number/curve.
- **App** (roundup MCP): `save_keyword_score`, `list_keyword_scores`, `add_topic`.
- The research browser is a persistent profile that should already be logged into
  PinClicks + Pinterest. If you hit a login page, STOP and tell the user to open
  **Settings → Agent browser** (or run `npm run browser:login`), then continue.

## The sources of truth (best → complementary)
1. **PinClicks** (`https://app.pinclicks.com/`) — paid, logged in. The richest source:
   millions of official Pinterest keywords WITH (estimated) search volume, top-pin
   saves, ranking accounts, and annotations. **Use ALL of it, not just volume** — see
   the PinClicks playbook below. It is where you both find candidates AND kill the
   high-competition ones.
2. **Pinterest Trends** (`https://trends.pinterest.com/`) — free. Interest curve
   (0–100, up to **2 years** back), 4-keyword comparison, the trend-type leaderboard
   (Top monthly / Top yearly / **Growing** / **Seasonal**), a **crystal-ball forecast**
   (~3 months ahead for seasonal terms), weekly/monthly/yearly % change, a seasonal
   flag, related terms, and region/age/gender/category filters. This is your timing
   and momentum engine — see "Reading Trends for any date" below.
3. **Pinterest guided search** — free. Type a seed in the Pinterest search bar and
   *read the autocomplete dropdown before pressing enter* (that's real user demand).
   After searching, read the colored **modifier bubbles/tiles** under the bar
   (e.g. "living room" → "small", "cozy", "modern", "apartment"). **Tell: if a seed
   shows few or no bubbles, that's a low-interest signal — abandon it.**
4. **Pinterest Ads Manager keyword tool** (free business acct, no spend): Ads →
   Create Campaign → keyword targeting field returns related keywords WITH
   monthly-volume ranges — the closest thing to real Pinterest volume. Use to break
   ties. Caveat: some practitioners now find this data partly hidden/less reliable, so
   treat it as **directional**, and cross-check with an external proxy (Google Keyword
   Planner / Keywords Everywhere, or the Google-volume × Pinterest-trend heuristic).

## When the user GIVES YOU the trend name — skip discovery entirely

The dashboard has a "Trend" field the user can fill in directly. When they give you
a specific trend/topic themselves (e.g. "peach recipes"), that changes the job:
**discovery is done, don't repeat it.** Do NOT call `harvest_trends` — the user
already decided this is the trend worth working on; second-guessing that with
another discovery pass wastes time and can surface a DIFFERENT trend than the one
they asked for.

**Fastest path: `best_keywords_for_trend(trend)`** — a single tool call that composes
the bank lookup + `trend_titles` + `pinclicks_enrich(withTopPins)` + `trend_curves`
internally and returns ranked candidates (competition, annotations, timing) in one
shot, using the exact same cache/circuit-breaker safety as calling each tool
separately. It does NOT auto-save. Use this by default for the "user gives me a
trend" case; fall back to the manual step-by-step workflow below only if you need
finer control (e.g. checking more than 8 candidates, or a niche/taxonomy filter it
doesn't expose).

Manual workflow (what `best_keywords_for_trend` does internally, spelled out):
1. `recent_keywords` first — dedup against anything already saved for this trend.
2. `pinclicks_export_seeds([trend])` if not already banked, then
   `trend_titles(trend, {niche:'food'})` to pull several candidate dish/title
   options under that ONE given trend.
3. Live-check (`pinclicks_enrich withTopPins`) enough candidates to find ALL the
   genuinely winnable ones — could be 1, could be several. Same worth-it-only rule:
   don't pad to hit a requested count.
4. For each keeper, give the same signals as always: viral potential
   (`opportunity_score`), the real competition read (from Top Pins, not guessed),
   and specifically **what helps it get impressions** — the right annotations/
   hashtags, an exact-match-friendly title, a board-worthy angle. This is the part
   the user explicitly asked to see: not just "is it winnable" but "what makes this
   one reachable."
5. `trend_curves(keyword)` for real timing per keyword (fall back to `smart_timing`
   only if insufficient data) — same as the discovery workflow.
6. Save with `save_keyword_score`, `parent_trend` = the user's exact given trend
   string. `check_unsaved_winnables()` before the final summary, same as always.

Everything else (card fields, timing precedence, competition scoring, the
never-silently-drop rule) is identical to the discovery workflow below — the ONLY
difference is skipping `harvest_trends` and using the user's given term as the seed
instead of a discovered one.

## When the user asks for N "recipes" / "topics on X" — give N TRENDS, each with SEVERAL titles
This is the primary interpretation of "give me N recipes": **N is the number of
distinct TRENDS to cover, and each trend should surface several distinct winnable
titles under it** (different dishes/angles, not phrasing variants) — e.g. asking for
"2 recipes" on a rising trend "peach" should look inside the peach trend and hand
back several real options: peach cobbler, peach dump cake, peach crisp, peach
cookies, gluten-free peach cobbler — genuinely different dishes, each scored, not
one keyword per trend.

Workflow:
1. `harvest_trends` (category, discovery) → pick the top N rising, non-locked
   **parent trends** (e.g. "peach", "zucchini").
2. For EACH trend: `pinclicks_export_seeds([seed])` if not already banked, then
   `trend_titles(seed, {niche:'food'})` — this returns MULTIPLE distinct dish/title
   candidates for that ONE trend, each with real Pinterest annotations
   (`related_interests` from the export) ready to reuse in the title/description.
3. Live-check (`pinclicks_enrich withTopPins`) as many of `trend_titles`' candidates
   as needed to find ALL the genuinely winnable ones under that trend — this varies
   per trend: could be 1, could be 4+. Don't artificially cap it to match N or force
   exactly one per trend; also don't blow the whole live budget on one trend if others
   still need checking. Then `trend_curves([keyword])` for the real publish window
   (fall back to `smart_timing` only if it returns insufficient data).
4. Save EVERY winnable title with `save_keyword_score`. `parent_trend` is now a
   **required** field (the tool call fails without it) — set it to the EXACT term
   `harvest_trends` returned (or the exact seed you passed to `pinclicks_export_seeds`),
   copied verbatim. Do NOT shorten or paraphrase it (if the trend term was "fig recipes",
   save "fig recipes", not "fig") — the user wants to see the real Pinterest Trends term
   on the dashboard card, not your own summary of it. A trend with 4 good dishes
   contributes 4 rows (all sharing the same exact `parent_trend` string); a trend with 1
   contributes 1; a trend with none contributes 0 (say so).

## PinClicks — BANK FIRST (offline), enrich the shortlist only
The efficient path separates cheap bulk *collection* from free *analysis*:
1. **`keyword_bank_status`** — see what's already banked. If your topic area is covered
   and fresh, skip straight to step 3 (zero live PinClicks hits).
2. **`pinclicks_export_seeds(["broad seed", ...])`** — if not covered, bulk-export a FEW
   broad seeds (3–8). Each export = ~1000 keywords+volumes into the local bank in one
   cheap page load. Do NOT export narrow long-tails or dozens of seeds.
3. **`shortlist_candidates({like/anyOf, requireWedge:true, limit})`** — the ONE call to
   pick what to check. It reads the bank, computes a cheap competition + winnability
   PRIOR offline, drops predicted-LOCKED / bare-head / roundup / already-seen terms,
   clusters variants to one each, and returns the top pre-ranked candidates with
   `cheapCompetition`, `cheapWinnability`, `predict`. **Do NOT run a live check on
   anything it marks `predict:"MAYBE"` with low `cheapWinnability`.** (Prefer this over
   many `query_keyword_bank` calls — it saves your tokens.)
4. **`pinclicks_enrich(topFew, {withTopPins:true, niche})`** — live Top-Pins verdict.
   **BUDGET: up to ~10-12 live lookups per hour (matches the actual enforced circuit
   breaker — see below), not a self-imposed "~6 total".** A stricter "~6 hard budget"
   guideline used to be here and caused a real, confirmed problem (2026-07-09): a
   session that explored 3 live-checked trends (2 + 1 + 4 = 7 lookups) stopped at
   exactly that point, even though the offline filter had predicted **12 WINNABLE
   candidates for the 3rd trend alone** ("butternut squash soup") and only 4 had been
   checked — 8 promising candidates (some with BETTER volume than what got checked,
   e.g. "crockpot butternut squash soup" vol 2971 vs. checked "sheet pan roasted" vol
   978) were left completely untested. The user correctly noticed and complained: "he
   still give me just 1 keyword per trend". Don't repeat this — the app enforces the
   REAL safety limit in code (12/hour, 40/day, persisted circuit breaker); you don't
   need a tighter self-imposed cap on top of it. Respect a `budgetExhausted`/`blocked`
   result and stop when it actually happens — don't pre-emptively ration far below the
   real limit "just in case".
   **PRIORITIZE DEPTH OVER BREADTH.** The same incident also explored 8 DIFFERENT
   trend seeds via `trend_titles` (fall baking, halloween cocktails, canning pears,
   huckleberry, nectarine, butternut squash, butternut squash soup, sourdough
   focaccia) when the user likely asked for far fewer — spreading the live budget so
   thin that most trends got 1-4 checks and some (huckleberry, nectarine, sourdough
   focaccia, fall baking) got explored offline but NEVER live-checked at all. Pick
   your N trends FIRST (matching what the user asked for), commit to them, and check
   most of each one's genuinely-promising candidates before considering a new seed —
   don't sample broadly across many more seeds than requested.
   **BAIL OUT OF A DEAD TREND FAST — still applies.** The live budget is shared across
   ALL trends in the request, so spending it on one bad trend starves the others. If
   the first **2–3** checks under a trend all come back LOCKED, STOP checking more
   candidates from THAT trend — move to the next trend. This is different from the
   butternut-squash-soup incident above: that trend was NOT dead (it had a WINNABLE
   result mixed in), so bailing didn't apply — the fix there is checking more of a
   promising trend's candidates, not fewer.

**Legacy live path** (`pinclicks_enrich` without a bank) still works but is slower — the
bank is preferred. RULES (PinClicks is behind Cloudflare and WILL block bulk automation):
- Pass **only your final shortlist** (≤8 keywords) that `harvest_trends` already narrowed
  — NEVER a big list. Discovery happens in Trends; PinClicks just confirms volume + finds
  long-tails for the few winners.
- It's slow on purpose (~25s/keyword). That's the point — don't try to speed it up.
- Needs the browser profile FREE. Close any open login window / your own playwright
  browser first.
- If it returns `blocked: true`: STOP hitting PinClicks immediately — do not retry, do
  not try a fresh profile as a fix. Confirmed 2026-07-08: this can be an **IP-level**
  Cloudflare block, not a per-profile one — a brand-new never-used profile hit the
  identical "Sorry, you have been blocked" page within minutes, on the same network.
  Tell the user it looks IP-level, retrying will not help and may extend the cooldown,
  and they should either wait it out or try from a different network if that's an
  option. The circuit breaker persists this to disk now (`data/cache/pinclicks/
  _breaker.json`) specifically so a NEW agent run won't blindly retry against an
  already-blocked profile — respect that budget, don't work around it.

**For the competition read, call `pinclicks_enrich` with `withTopPins: true`** on your
final shortlist. It "goes inside" each keyword (opens Top Pins) and returns a real
competition verdict computed with the rules below: `{competition 0-1, verdict,
signals:{medianSaves, exactMatchTop5, freshHighSave, staleCount, bigMedia, weakPins},
topPinsSample}`. Use its `competition` value directly as the sub-signal and quote its
signals in `source_notes`. Pass `niche:'recipe'` or `'home'` so the save thresholds fit.

Only fall back to manually browsing app.pinclicks.com for things the tool can't give —
Account Explorer competitor mining, annotation-hop clustering. Do that gently, final picks only.

### PinClicks manual playbook (Top Pins competition read + extras)
The research profile is logged in. The left nav (real URLs) is your toolbox — don't
stop at Keyword Explorer:
- **Keyword Explorer** (`/keyword-explorer`) — type a seed → a table of related
  keywords each with a **Volume** cell (sortable), **Taxonomy** + **Related Interests**
  toggles, a per-row **See Top Pins** link, bulk-select checkboxes, and **Export**.
  This is expansion + demand. Volume is an *estimate* (directionally reliable for
  ranking keywords against each other, NOT a literal monthly count) — say so.
- **Top Pins** (`/pins?search=<kw>`, or the row's "See Top Pins") — **THE competition
  view. Sort by saves.** Read the top 5–10 pins: save counts, how big the ranking
  accounts are, and how fresh the pins are.
- **Account Explorer** (`/accounts`) — paste a competitor account → its monthly views,
  followers, and which keywords it ranks #1 / Top-10 / Top-25 for. Mine a *small* blog
  that's winning your niche for keywords you'd never have guessed.
- **Interest Explorer / Related Interests** — Pinterest's official taxonomy; match each
  candidate to a real interest so pins align with what Pinterest wants.
- **Rankings** (`/rankings`, "Track Rankings" button) and **Searches** (`/searches`,
  Search Tracker — new guided-search bubbles = emerging demand) and **Saved / Saved
  Keywords** for planning. Use them when relevant.
- **Annotations** (per pin, one-click copy) — the interest tags Pinterest itself
  assigned to winning pins; paste them into the title/description you save.

### Judging competition in PinClicks — the REAL rule (cross-AI validated)
PinClicks has no difficulty score. **The #1 mistake is reading raw saves as difficulty.**
The actual question is: *does this keyword have proof of demand but NO dominant exact-match
winner?* Open **Top Pins** for the keyword and read the top 5–10 in this priority order:

1. **Exact-match weakness (THE signal).** Count how many of the top 5 pins are *actually
   about the exact keyword* vs. broad/roundup pins ranking "close enough". If Pinterest is
   ranking **broad content ("Easy Fall Baking Ideas") for a specific query ("pumpkin cream
   cheese muffins")**, that's your opening — a focused exact-match single post beats it.
   Top 5 all tightly exact-match + polished = locked, skip.
2. **Save VELOCITY, not raw saves.** `velocity = saves ÷ age_in_months`. A pin with 900
   saves over 4 years (~19/mo) is beatable; 300 saves in 30 days (~300/mo) is dangerous.
   **The single worst red flag = a FRESH (<90 day) exact-match pin already high-saved +
   top-ranked** → Pinterest just crowned a current winner; skip.
3. **Freshness of the incumbents.** Top pins all **>12–18 months old and still ranking =
   stale SERP nobody refreshed = winnable** with a better/newer pin.
4. **Domain lockout.** Top spots owned by major media (The Spruce, BHG, HGTV, Apartment
   Therapy, Food Network, Martha Stewart) = treat as locked regardless of one pin's saves.
   Independent/small blogs or unclaimed profiles ranking = a real opening.
5. **Design/format gap.** Weak/illegible/stale designs among leaders = beatable; a format
   you can't execute (all pro collage photography vs. your edit) raises effective competition.

**Concrete thresholds (niche-split — recipes naturally collect more saves than home/DIY):**
- **RECIPE keyword winnable (green)** if ≥3 true: top-10 median saves < ~300–500; ≥3 pins
  under ~150 saves; no more than 2 pins over ~1,000 saves; no fresh (<3mo) pin already
  over ~300–500 saves.
- **HOME/FAMILY how-to winnable (green)** if ≥3 true: top-10 median saves < ~150–250; ≥3
  pins under ~75–100 saves; top 3 older than 6–12 months with < ~250 saves each.
- **RED / skip (any):** top 5 all exact-match + polished; a <90-day exact-match pin with
  500+ saves; top-10 median saves > ~1,000; the *same* pins rank on both desktop & mobile
  (stable SERP); the keyword is broad/plural ("game day dips", "fall desserts").

Map to the `competition` sub-signal: green → ~0.15–0.35, yellow (mixed) → ~0.45–0.6,
red → ≥0.7 (which the gate then tanks). **NEW-BLOG (this account): stricter** — require
≥6 of the top 10 under ~150 saves, and the #1–2 pins must be under ~100 saves OR older
than ~2 years. Always record the actual saves/ages/exact-match count you saw in
`source_notes` — if you didn't open Top Pins, you didn't measure competition.

### Content-feasibility gate (roundups only) — can we actually source this?
Before approving a roundup topic, confirm you can find **~1.5× the needed real,
creditable photos** — for a 25-item roundup, you should be able to identify roughly
35–40 plausible real-image candidates (from small blogs/creators, not locked
big-brand-only imagery) before committing. If a topic's real images mostly come from
magazines/designers/retailers with restrictive usage terms and no small-creator
alternative exists, downgrade `fit` and say so in `source_notes` — a great keyword
with no sourceable images is not actually usable for this pipeline (real photos only,
credit-linked, no AI in the article body).

### HARD RULE — avoid high-competition keywords
Do NOT save a keyword as a strong pick if its Top Pins are dominated by big accounts
with high saves and stale dates, *even if its volume is huge*. High volume + high
competition is a trap. Instead:
1. Take the head term's **volume** as proof the demand exists, then
2. go to its **long-tail expansions** (room / style / audience / budget / season
   modifiers) and find the variant with **decent volume but a soft Top-Pins SERP**.
3. Save THAT one, and set its `competition` sub-signal high (→ low score) for any head
   term you keep only for reference. Prefer 3+ word phrases.
Every saved keyword's `source_notes` must state what the Top Pins looked like (saves,
account size, freshness) — if you didn't open Top Pins, you didn't check competition.

## Reading Pinterest Trends for ANY date (the core skill)

There are TWO ways in: seed-first (you already have a keyword guess) or **category
discovery** (you don't — you just want to know what's worth writing about). Prefer
category discovery when the user gives you a broad ask ("find me topics") rather than
a specific keyword; it surfaces ideas you wouldn't have guessed to type.

### Category + date-window discovery — USE THE FAST TOOL, not the browser
**Call `harvest_trends` (roundup MCP) FIRST for all discovery.** It hits the Trends
network API directly (~2 seconds, no clicking) and does the whole category+date-window
sweep in one call: Growing + Seasonal leaderboards for your category, across weekly
windows of LAST YEAR matching +30..+90 days from today (cyclical prediction).
- `harvest_trends({interest: "food and drinks"})` → deduped terms with
  normalizedCount (relative demand), wow/mom/yoy % change, seasonality score, and
  **weeksSeen** (how many weekly windows it appeared in — persistence across weeks =
  real recurring seasonal demand; 1 week = possible one-off).
- Then `trend_curves({terms: [...]})` for your shortlist → the REAL weekly interest
  curve, a live `liftoff` status, a `predicted` forecast from last cycle (when to
  start writing so the pin is indexed BEFORE the next rise, not after), and a merged
  `verdict` — again no browser. This is your primary timing signal — see seasonalTiming
  section below.
- `list_trend_categories` shows valid category names.
- **Caveat:** these tools need the research profile free. If YOUR playwright browser
  is open, `browser_close` first. If they error anyway, fall back to browsing
  trends.pinterest.com manually (the old way, below).
- **Filter judgment stays yours:** prefer SPECIFIC terms ("pumpkin bread", "school
  lunch ideas for kids") over global heads ("dinner ideas", "soup recipes" — massive
  but unwinnable). weeksSeen ≥3 + seasonality ≥0.8 + a mom spike = prime candidates.

Manual browsing fallback (only if the fast tools fail):
1. Go to Pinterest Trends, set **Region → United States**, pick the **Category**
   filter (e.g. "Food and Drinks", "Home Decor") instead of typing a seed.
2. Set the **date window forward** — today +30 to +90 days.
3. Scan the **Growing / Seasonal leaderboard** in that category+window.
4. Take each promising topic as a "seed" for the normal workflow below. Discovery
   finds candidates; PinClicks + Top Pins still decides if each one is winnable.

When the user asks "what should we publish for [month/season/date]", do this:

1. **Set the frame:** Region → United States (or the target market — the season
   surfaces different exact keywords per country). Pick the interest category
   (Home Decor / Holidays / etc.). Confirm age/gender match the audience.
2. **Work the leaderboard:** open the **Growing** filter (breakout/forward-looking
   terms) and the **Seasonal** filter (climbing now because people are planning).
   These two are where you spot trends *before* they peak. Check the **crystal-ball
   forecast** for seasonal terms — it projects the peak up to ~3 months out.
3. **Use last year to predict this year:** open the 2-year view for a candidate. Find
   the week the curve **started climbing last year** (roughly when it hit ~25–30% of
   its seasonal peak). That inflection, minus nothing, is your *publish trigger* for
   this year; the peak week last year is when you'd be too late. Pinterest search is
   cyclical — last November predicts this November.
4. **Compare wording:** enter up to **4 variants** at once ("fall decor" vs
   "fall decorations" vs "autumn decor" vs "fall home decor"). Use the winning line as
   the exact phrasing in the title + pin description. Add Trends' related-term
   suggestions into the comparison to find lower-competition long-tails.
5. **Real trend vs noise:** trust a term when — smooth recurring annual hump across
   the 2-year view; a *cluster* of related terms rising together; demographic breadth;
   rising saves not just views. Distrust — a single sharp spike then crash; a lone term
   with no rising cluster; no repeat in the prior year; one narrow demographic.

### The seasonal lead-time rule (pick by content type)
- **Ordinary seasonal content: publish 45–60 days (6–8 weeks) before the peak.**
  (Pinterest's own guidance says 4–6 weeks — treat that as the *minimum*.)
- **Major holidays (Christmas, Halloween, back-to-school): 60–90 days ahead.**
  Christmas → start October; Valentine's → December; back-to-school → June.
- **Practical trigger:** start when the keyword sits at **~25–30% of its peak** on the
  curve. Cited effect: seasonal content posted 45–60 days early got ~68% more
  impressions than the same content posted within 2 weeks of the event.
- After publishing, **pace fresh pins**: multiple distinct pins per topic, one every
  **7–14 days** through the run-up — don't dump them all at once (spam risk + waste).

## Workflow

### 1. Expand the seed into long-tail candidates
Long-tail keywords are winnable; head terms ("home decor") are owned by giants.
Aim for 15–25 candidates like "small living room ideas", "cozy reading nook",
"boho gallery wall". Best expansion order: **PinClicks Interest Explorer** → then
**Pinterest guided search** (autocomplete + colored modifier bubbles) → then Trends
related terms → then the **alphabet-soup trick**: type the seed followed by each
letter a–z ("fall porch decor a", "fall porch decor b", ...) in the Pinterest search
bar and read what autocomplete returns — this surfaces real long-tail queries people
are actively typing that Interest Explorer/Trends won't show you. Combine modifiers
(audience, room, style, budget, season). Target **3+ word phrases** (4+ in brutal
niches) to escape saturation.

**Cluster, don't scatter — one article per intent, not per keyword.** Group the
long-tail variants that share the same underlying intent (e.g. "cozy fall porch
decor", "small front porch fall decor", "fall porch ideas on a budget") under ONE
article/topic rather than writing a separate thin article per keyword. Save each
variant's score individually via `save_keyword_score`, but note the cluster they
belong to in `source_notes` (e.g. "cluster: fall front porch decor") and only
`add_topic` once for the cluster's best title — then plan multiple *pin* angles
(not multiple articles) against the different variants later.

### 2. Gather signals per candidate (navigate + read)
**Pinterest Trends** (set Region first): demand (0–100 curve, screenshot to read),
momentum (rising/falling over 12 months + the %-change figures), seasonal timing
(peak month + where we are on the curve now vs the lead-time rule).

**PinClicks**: search the keyword → read **search volume** (the demand cross-check
Trends can't give you) and, from the top pins, **saves + freshness + brand mix**.
High saves on a FEW *recent* pins from *small* blogs = winnable.

**Competition = eyeball the top ~20 results** (any source), scoring these tells:
- **Big-account lockout** — top pins dominated by verified/100k+ accounts → skip,
  go longer-tail.
- **Stale top pins** — old top-rankers = opportunity (fresh content can displace them).
- **Beatable visuals** — generic stock + vague overlays among the leaders = you can
  out-design them; uniform high quality = hard.
- **Exact-phrase pin volume** — fewer competing pins = easier.
Don't only chase low competition — a healthy mix of low/medium is fine if demand is
real and rising.

**Note on UI**: the profile may render Pinterest in **French** ("Tendances",
"Se connecter" = log in, "Région", "En hausse" ≈ Growing, "Saisonnier" = Seasonal).
If a page's layout differs from the above, `browser_snapshot` / screenshot and adapt —
reading the live page is the whole point.

### 3. Score with the opportunity rubric (0–100) — competition is a GATE, not an add-on
Pinterest is a **distribution engine, not just an SEO engine**: it pushes *pins*, and a
brand-new account gets ~zero reach on a locked SERP no matter how big the volume. So
competition must **multiply** the score down, and we must reward **click-intent**, not
just search demand. Use this gated formula:

`base = 0.20*demand + 0.25*ctr_intent + 0.20*seasonalTiming + 0.20*momentum + 0.15*fit`

This blog is a **brand-new, unestablished Pinterest account** right now (no history,
no domain trust yet), which changes how harshly competition should gate the score.
Cross-AI review converged that a static `^1.5` is too forgiving for a new account —
use this harsher, tiered gate instead (revisit/relax once the account has real
traction — see the feedback-loop note at the end of this skill):
```
if competition >= 0.6:            score ≈ 0-10   (treat as rejected; note "locked — skip" in source_notes)
elif competition >= 0.3:           score = round(100 * base * (1 - competition)^2.2)
else:                              score = round(100 * base * (1 - competition)^1.5)
```
These exact thresholds/exponents are a reasoned estimate, not measured from our own
data yet — once real pins have 30–90 days of performance, compare predicted scores to
actual outbound clicks (via the `performance` table) and adjust.

Each sub-signal is 0–1:
- **demand** — PinClicks volume, **comparative only** (unit unknown — never a literal
  monthly count), **long-tail biased**. NEW-BLOG volume floor (cross-AI consensus):
  sweet spot **~1,000–5,000**; below ~1,000 the traffic won't repay the work UNLESS the
  keyword is very specific with clear click intent AND part of a cluster; above ~10,000
  is usually locked for a zero-trust domain — go longer-tail. Also accept a **relative
  floor**: keyword ≥ ~5–10% of its parent seed's volume, or a **cluster floor** (several
  sibling keywords that together justify one post). Down-weight head terms even if huge.
- **ctr_intent** — will searchers CLICK to the blog, or does the Pin image alone
  already answer them (saves, no visit)? Don't judge by phrasing alone — check the
  **Top Pins SERP itself**:
  - Do top pins link out to a real blog/article, or are they product-only /
    image-only pins with nowhere to click? Outbound-linking top pins = good sign.
  - Does the pin image show the FULL answer (a complete recipe card, a finished
    tutorial, one static room photo) with nothing left to learn? That satisfies the
    user inside Pinterest — lower ctr_intent even if saves are high.
  - Phrasing still matters as a proxy: solution/list/how-to/problem/budget/checklist
    wording ("small-space X ideas", "DIY X", "X on a budget", "X mistakes to avoid")
    = high (0.8–1.0), because it promises more than one image can show — a genuine
    curiosity gap. Pure aesthetic/mood terms ("cozy fall aesthetic", "dream living
    room") = low (0.2–0.4): people save the picture and never click.
- **seasonalTiming** — DON'T guess this. Two sources, in this order of preference:
  1. **`trend_curves([keyword, ...])` (PREFERRED)** — reads that exact keyword's REAL
     weekly interest curve (the same data as the graph on trends.pinterest.com, 2 years
     of history) and returns THREE things per term: `liftoff` (this YEAR's confirmed
     live signal — LIFTOFF/RISING/NEAR_PEAK/FLAT/DECLINING), `predicted` (a FORECAST
     from LAST cycle's curve — projects when the next bend should happen and
     recommends starting ~30 days before it, so the pin is already indexed BEFORE the
     rise hits — don't wait for live confirmation, that's already reacting late), and
     `verdict` (the one to actually use — reconciles the two: trusts live confirmation
     when something is already visibly moving, falls back to the historical forecast
     when live is still flat/quiet so you're not caught reacting after the fact). Use
     `verdict` as `publish_by` verbatim. Works for ANY keyword (not just named
     holidays) because it reads that term's own real curve — always try this first.
  2. **`smart_timing(keyword, peak_month)` (FALLBACK)** — use only when `trend_curves`
     returns `insufficient_data`/`lowSignal` (live) and `insufficient_history`/
     `no_clear_cycle` (predicted) for that term — too little curve data to read a shape
     at all. It first tries to match the keyword against **Pinterest's own
     named-moment calendar** (real takeoff/peak dates + shape) — e.g. peach/zucchini →
     "summer", pumpkin/spooky → "halloween" — with a **shape**: `spike` (narrow window,
     miss the lift-off and it's gone) vs `hump` (wide window, still pays off well into
     the rise) vs `medium`. No match → falls back further to the peak-month heuristic
     (`compute_timing`). It anchors on LIFT-OFF (must publish BEFORE that), so a term
     whose peak is <45 days out scores LATE ("missed — queue for next year"), not
     "start now". This is the fix for the peach/zucchini mistake — never mark a topic
     "start now" when its peak is already <45 days away.
- **momentum** — Trends 30-day curve rising (a whole related cluster rising = high).
- **fit** — thematic coherence to a site category (Pinterest scores image↔title↔board↔
  landing-page consistency; incoherence gets suppressed, so only keep on-theme picks).
- **competition** — 0=open, 1=locked. Read it from Top Pins using the exact-match-weakness
  + save-velocity + threshold rules above (NOT raw saves). The tiered gate (reject ≥0.6,
  ^2.2 mid, ^1.5 low) punishes competition hard, correct for this new account; relax later
  as the account earns authority.

Output an **opportunity score**, NOT a virality promise. Be honest.

### 4. Write annotations for the good ones — NOT everything is a roundup
Don't default every topic to a numbered listicle. Read what the user actually asked for:
- **Roundup** ("ideas", "list", "best X", a plural theme, or the user says "roundup") →
  `title_suggestion`: `Number + power adjective + exact keyword + audience/benefit`,
  e.g. "25 Cozy Small Living Room Ideas (Renter-Friendly)". Odd numbers + a parenthetical
  hook lift clicks. Set `type: 'roundup'` when you `add_topic`.
- **Single / standalone article** (the user names one specific topic, asks a how-to
  question, or explicitly says "just one" / "not a roundup" / "single article") → write
  a normal single-topic title with NO big number, e.g. "How to Style a Small Living Room
  Without Buying New Furniture" or "The Cozy Fall Porch Look Everyone's Copying This
  Year". Set `type: 'how-to'` or `type: 'single'` (pick whichever fits) when you
  `add_topic` — never force it into a roundup shape.
- When unclear, default to whichever format matches how the keyword itself reads (a
  broad theme → roundup; a specific question or single idea → single) rather than
  always assuming roundup.
- **CHECK THE SERP, not just the phrasing (cross-AI rule).** Even when the keyword reads
  singular, look at its Top Pins: if the top 5 are **roundups/collages/numbered lists**,
  Pinterest has decided this query wants a *list* — a single post will struggle; either
  make it a roundup or pick a more specific long-tail. Only commit to a single post when
  the Top Pins confirm single-deliverable intent (they show the same one dish/project/
  result, links go to one recipe/tutorial). Single-intent phrasing patterns:
  `[ingredient] [dish]` ("pumpkin cream cheese muffins"), `[method] [dish]` ("air fryer
  chicken thighs"), `[dish] recipe`, `how to [task]`, `[X] without/with [ingredient]`.
  Roundup phrasing: "ideas / inspo / best / ways to / [number] / party food / dinner ideas".
- **ONE TOPIC = ONE POST, not one keyword = one post.** Cluster the close variations
  ("pumpkin cream cheese muffins" / "…recipe" / "easy…" / "…with cake mix") into a SINGLE
  article, and target the variations with different *pins*, not separate thin articles.
  So `add_topic` ONCE per cluster (the best exact-match title); note the sibling variations
  in `source_notes` as the pin angles. Never queue 4 near-duplicate topics.
- **Title length** (cross-checked via web research, 2026-07-09): Pinterest's hard cap
  is 100 characters, but only the first ~30-40 show before mobile truncation — put
  the exact keyword at the very START of `title_suggestion`, not buried after a hook.
  A roundup's leading number doesn't violate this (it's part of the front-loaded
  keyword phrase), but don't bury the real keyword behind a long clever preamble.
- **pin_description**: 2–3 natural sentences (~220-232 characters reads well before
  Pinterest truncates it) with the exact keyword once + 2–3 related
  terms **written as plain language, not a keyword list**. Pinterest is a search
  engine — sentence-form keywords rank; keyword-stuffing gets suppressed.
- **hashtags**: **default to NONE.** Practitioner + Pinterest-rep consensus in 2025–26
  is that hashtags are dead-to-harmful on Pinterest (unlike Instagram) — Pinterest
  deprioritized them since 2022, and one benchmark found only ~19% of viral pins used
  any. If you include
  any, cap at **0–3** at the very end. Do not stuff. (This overrides older advice.)

### 5. Save
Call `save_keyword_score` once per keyword with:
`{keyword, opportunity_score, demand, ctr_intent, momentum, competition, seasonal_timing,
fit, title_suggestion, pin_description, hashtags, peak_month, publish_by,
annotations, top_pin_saves, search_volume, trend_points, source_notes}`.
- `ctr_intent` (0–1): how likely searchers CLICK through vs. just save (see rubric).
- **`annotations`** (array of strings): the PinClicks interest annotations on the winning
  top pins — the exact tags Pinterest assigned. Prefer `topPinAnnotations` from
  `pinclicks_enrich(withTopPins:true)`'s result — real tags aggregated across the pins
  actually ranking for THIS exact keyword (most precise). Fall back to `trend_titles`'
  `annotations` field (bank-level Related Interests, less precise but still real) only if
  `topPinAnnotations` wasn't fetched. These are gold for the pin title/description — never
  invent tags. (The dashboard shows them as chips to reuse.)
- **`top_pin_saves`** (number): the median save count of the top ~10 pins for this keyword
  (the REAL competition benchmark you already read to set `competition`). This is what a
  winner in this SERP actually earns — record it.
- **`search_volume`** (number): the raw PinClicks volume figure (order-of-magnitude).
- **`trend_points`** (array of ~12 numbers, 0–100): the last-12-months relative-interest
  values off the Pinterest Trends curve, so the dashboard can draw a sparkline. Use the
  REAL `counts` (normalizedCount per week) from `trend_curves` — take the last ~12
  values, don't estimate/eyeball; omit only if `trend_curves` returned no data for it.
- `opportunity_score` is what the dashboard shows as the **viral-potential %** — make it
  honest and **on a 0–100 scale** (e.g. 62, NOT 0.62 — remember the `round(100 * …)` in
  the formula; saving a 0–1 fraction is a bug).
- `peak_month`: the month demand peaks (e.g. "November"), or "year-round" for evergreen.
- `seasonal_timing` + `publish_by`: take BOTH from `trend_curves`' `verdict` (preferred
  — already reconciles live vs predicted), or `smart_timing(keyword, peak_month)` if
  that term had insufficient curve data — do not hand-write them. If the verdict is
  LATE/MISSED/DECLINING/NEAR PEAK, either drop the topic (past its window) or keep it
  only with the honest
  "queue for next year" publish_by; never label a past-lift-off topic "start now".
Put a one-line note in `source_notes` on what you saw AND the timing verdict, e.g.
"Trends 78, rising cluster, peaks Nov → publish by ~mid-Sep; PinClicks vol solid,
small blogs ranking, low competition".

For the strongest keywords, also `add_topic(keyword, title_suggestion, type)` — set
`type` to `'roundup'` or `'how-to'`/`'single'` per the format you decided above, so they
enter the article queue as the right content shape, not always a roundup.

## 2025–2026 reality — read before you overpromise
The platform changed; calibrate expectations and strategy accordingly.
- **Aug 2024 update + Feb 2025 dip:** virality slowed. New/low-trust accounts sit in a
  **60–90 day "trust sandbox"** before traffic builds. Sustained engagement over months
  beats short spikes. Don't promise fast results.
- **New-account topic strategy: narrower and deeper, not scattered.** For roughly the
  first 60 days, favor a small number of tightly related clusters (e.g. small-space
  living rooms, entryways, front porches — all "small home" adjacent) over jumping
  between unrelated niches (decor one day, recipes the next, nurseries after that).
  Pinterest needs a clean signal of what the account/domain is about before it trusts
  it with competitive keywords. Bias toward the softest, most specific long-tails
  during this window even more than usual.
- **New-account timing nudge:** for this account specifically, err toward publishing
  at the START of the lead window (nearer 90 days / the flat trough) rather than the
  end (45 days / 25–30% up the curve) — an unestablished domain takes longer to get
  indexed and trusted, so the extra runway compensates for slower initial pickup.
- **Fresh pins drive >90% of outbound traffic** (new "Creates", not repins). "Fresh"
  also includes **updating titles/descriptions/boards on existing pins** — so refreshing
  metadata is a real lever, not just net-new pins.
- **Content mix:** ~60% evergreen / ~40% seasonal-trend; focus on only **2–3 primary
  trends per quarter** to avoid saturating the profile with one topic.
- **Video/Idea pins** get algorithmic preference over static pins (debated, but real).
- **Don't chase recovery** after a drop — data (168-account study) shows manual
  "recovery" tactics mostly fail; better to keep publishing fresh + diversify platforms.
- **AI-image caution (directly affects our pipeline):** Pinterest rolled out (Oct 2025)
  user controls to limit AI content, more visible GenAI labels, and an auto-labeler for
  AI-created/edited pins — with a real false-positive risk (even hand-made work gets
  flagged). Our articles use REAL sourced images (good), but our pins are AI-edited, so
  expect possible GenAI labeling / feed suppression from users who opt out of AI. Favor
  light edits over heavy AI transformation on pins, and flag this if the user asks why a
  pin underperforms.

## Feedback loop (once pins are live — not part of today's scan)
This is a prediction system running on estimates; it should get more accurate over
time. Once pins have been live 30–90 days, real numbers land in the `performance`
table (impressions, saves, clicks per pin/keyword). When asked to review past
predictions, compare `opportunity_score`/`ctr_intent` against actual outbound clicks
and flag any systematic miss (e.g. "aesthetic-phrased keywords are underperforming
their ctr_intent estimate — lower that weighting") rather than silently repeating the
same bias forever.

## Don't repeat topics + don't pad (cross-checked with the dashboard)
- **DEDUP:** call `recent_keywords` before saving and SKIP any candidate already there
  (it's already been surfaced/worked). The user does not want the same trend twice.
  `save_keyword_score` also upserts by keyword, but skip proactively so you spend the
  scan on NEW opportunities. Only re-check an existing keyword if the user explicitly asks.
- **WORTH-IT ONLY, never pad:** if the user asks for N but only M are genuinely worth it
  (WINNABLE / real volume for a new blog), save M and clearly say which you dropped and
  why ("3 requested; 2 worth it — dropped 'X': locked SERP, 8k-save fresh incumbent").
  A weak pick padded to hit a number wastes the user's work.
- **NEVER SILENTLY DROP A WINNABLE FIND.** If a live-checked candidate comes back
  WINNABLE (or MAYBE and you'd otherwise keep it), you MUST either `save_keyword_score`
  it or explicitly say in your final summary why you chose not to (e.g. "redundant with
  #2's cluster", "same dish as X"). Do not just omit a good find from the output with no
  trace — this has happened THREE times now (a WINNABLE "fig recipes healthy"; later a
  WINNABLE "homemade tomato sauce with fresh tomatoes", comp 0.25; then a whole trend
  ("crockpot recipes") whose only WINNABLE result never got saved while the other trend
  did) — all live-checked, all silently dropped. Wording alone hasn't fixed this, so
  there's now a hard backstop:
  1. `pinclicks_enrich` itself returns an `UNSAVED_WINNABLE_REMINDER` field the moment a
     WINNABLE result comes back unsaved — act on it immediately, don't move to the next
     keyword or trend first.
  2. **`check_unsaved_winnables()` — call this before writing your final summary, every
     single run, no exceptions.** It returns every WINNABLE keyword from this run that
     was never saved. If it returns anything, that IS the bug happening right now — go
     save those keywords (or state why not) before you write anything else. An empty
     result is your proof the run is complete; do not skip this check.
- **publish_by = the START date**, phrased concretely and actionably ("start now", "start
  by mid-August") — the dashboard shows it as the "Start working" cue, so make it a real
  go-signal, not just the peak month.

## Report back
Give the user a short ranked table (keyword — score — verdict — start-by — why), say how
many you saved, and list anything you deliberately dropped as not worth it. Lead with the
timing verdict for anything seasonal. Don't dump raw page text.

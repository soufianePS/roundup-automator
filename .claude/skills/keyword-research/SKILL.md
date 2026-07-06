---
name: keyword-research
description: How to research high-opportunity, low-competition Pinterest keywords for the family/home blog by navigating Pinterest Trends + PinClicks in the browser, reading trends for ANY date, scoring them, and saving to the app DB. Use whenever the user asks to find keywords, research a niche/seed, score keyword opportunity, spot seasonal trends, or fill the keyword pipeline.
---

# Keyword research — your job on this app

You find **high-opportunity, low-competition** keywords for a family/home blog
(home decor, DIY, holidays, home, lifestyle) and save them with an opportunity
score + ready-to-use annotations. You do this by **navigating real sites in the
browser** (Playwright MCP tools) and using your judgment — not guessing.

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

## PinClicks playbook (use ALL of it — this is where you win)

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

### Judging competition in PinClicks — there is NO difficulty score, so you MUST look
PinClicks gives no "competition" number. Open **Top Pins, sorted by saves**, and read
the top ~10 in this priority order (validated by cross-AI review):
0. **BEST CASE — check this first: how many pins/accounts even target the exact
   keyword?** If Top Pins returns **zero results, or just ONE account** actually
   targeting that exact phrase, that is the strongest possible opportunity signal —
   set `competition` to ~0.05–0.15 regardless of the other checks below. Nobody
   competing beats "low saves but 20 competitors trying." Always look for this before
   falling back to the saves-based read.
1. **Saves on the top 10 (primary signal, when more than 0–1 competitors exist).**
   Save = long-term planning intent, the action Pinterest values most. **>~1,000 saves
   across most of the top 10 = locked (competition ≈ 0.8–1.0); <~100 saves on ≥3 top
   spots = wide open (≈ 0.1–0.3).**
2. **Freshness / created dates.** Top pins all **>12–18 months old and still ranking =
   stale SERP = beatable** with a modern pin. A wall of pins <3 months old holding = hard.
3. **Pinner authority / domain lockout.** A claimed-domain globe / verified blog on the
   top spots = serious competition. **If the ranking accounts are major established
   media** (e.g. The Spruce, Better Homes & Gardens, HGTV, Apartment Therapy, Good
   Housekeeping) treat it as locked REGARDLESS of an individual pin's save count — a
   12-save pin from a media giant still out-competes you on domain trust. Unclaimed
   personal profiles or small independent blogs ranking = a real opening.
4. **Visual sameness / format match.** If every top pin has the same composition
   (e.g. all tight pumpkin close-ups) or the same format (all single hero photos, all
   collages, all text-overlay listicles, all video pins), note which format dominates
   — a different angle or format you can actually execute well can break in. If the
   dominant format is one your pipeline can't beat (e.g. all professional collage
   photography and yours would be a rough AI edit), that raises effective competition.
Set the `competition` sub-signal mainly from #1, adjusted down by #2, up hard by #3 if
media-dominated, and by #4. Locked SERP (high saves + fresh + big-media domains) →
**skip and go longer-tail.**

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

### Category + date-window discovery (use this FIRST when there's no seed keyword)
1. Go to Pinterest Trends, set **Region → United States**, then pick the **Category**
   filter for the niche (e.g. "Food and Drinks", "Home Decor") instead of typing a seed.
2. Set the **date window forward** — today's date out to **+30 to +90 days** (this is
   exactly the lead-time window you'll need to publish in anyway). Browsing the
   category filtered to that future window shows what's *about to* be in demand, not
   just what's hot today.
3. Scan the **Growing / Seasonal leaderboard** inside that category+window for the best
   topics — the ones with a clear rising curve landing inside your window.
4. Take each promising leaderboard topic as your "seed" and run it through the normal
   workflow below (Trends detail + PinClicks). Category browsing finds candidates;
   PinClicks + Top Pins still decides if each one is actually winnable.

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
- **demand** — PinClicks volume, **long-tail biased**: treat volume as *order of
  magnitude / a qualification filter*, not a literal count. Down-weight head terms even
  if huge (they're where competition locks you out). Weighted lower than ctr_intent —
  for a new account, the "biggest" keyword matters less than one Pinterest will
  actually let you win.
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
- **seasonalTiming** — 1.0 if we're **60–90 days before the peak** right now (or
  ~25–30% up last year's curve), declining linearly to ~0 by <30 days out; 0.5 for
  true evergreen.
- **momentum** — Trends 30-day curve rising (a whole related cluster rising = high).
- **fit** — thematic coherence to a site category (Pinterest scores image↔title↔board↔
  landing-page consistency; incoherence gets suppressed, so only keep on-theme picks).
- **competition** — 0=open, 1=locked. Read it primarily from **Top-10 saves** (see
  hierarchy below). The `^1.5` gate punishes high competition hard, which is correct for
  a new account; as the account gains authority you can relax the exponent toward 1.

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
- **pin_description**: 2–3 natural sentences with the exact keyword once + 2–3 related
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
  top pins — the exact tags Pinterest assigned. These are gold for the pin title/desc; grab
  them from the top pins / Pin Stats. (The dashboard shows them as chips to reuse.)
- **`top_pin_saves`** (number): the median save count of the top ~10 pins for this keyword
  (the REAL competition benchmark you already read to set `competition`). This is what a
  winner in this SERP actually earns — record it.
- **`search_volume`** (number): the raw PinClicks volume figure (order-of-magnitude).
- **`trend_points`** (array of ~12 numbers, 0–100): the last-12-months relative-interest
  values off the Pinterest Trends curve, so the dashboard can draw a sparkline. Read them
  off the graph as best you can (approximate is fine); omit if you truly can't.
- `opportunity_score` is what the dashboard shows as the **viral-potential %** — make it
  honest (0–100 from the rubric).
- `peak_month`: the month demand peaks (e.g. "November"), or "year-round" for evergreen.
- `publish_by`: the concrete publish-by date to catch the rise (e.g. "mid-September"),
  derived from the lead-time rule. This drives the "Publish by" badge on each card.
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

## Report back
Give the user a short ranked table (keyword — score — peak/publish-by — why) and say
how many you saved. Lead with the timing verdict for anything seasonal. Don't dump raw
page text.

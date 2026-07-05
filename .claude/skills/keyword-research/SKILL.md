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
1. **PinClicks** (`https://app.pinclicks.com/`) — paid, logged in. 12M+ official
   Pinterest keywords WITH search volume, top-pin saves, position ranking, related
   terms, per-pin score, and the only real rank tracker. The richest single source.
   Key areas: **Keyword Explorer** (volume + save data), **Interest Explorer**
   (related/adjacent terms — best expansion source), **top pins** view (saves + which
   formats/roundups win), **Account Explorer** (a competitor's high-ranking keywords),
   **Rank Tracker**. Group/sort by Popularity.
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

## Reading Pinterest Trends for ANY date (the core skill)

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
related terms. Combine modifiers (audience, room, style, budget, season). Target
**3+ word phrases** (4+ in brutal niches) to escape saturation.

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

### 3. Score with the opportunity rubric (0–100)
`score = 0.30*demand + 0.20*momentum + 0.25*(1 - competition) + 0.15*seasonalTiming + 0.10*fit`
- Each sub-signal is 0–1. demand: 0–100 curve → /100, but **discount if volume
  cross-check is weak** (relative interest on a tiny-volume term is a trap).
  momentum: rising cluster = high, flat = mid, declining = low. competition: high=1
  (lockout/saturated), low=0 (small blogs ranking). seasonalTiming = 1.0 if we're in
  the 45–60-day pre-peak window (or ~25–30% up the curve) right now, tapering to ~0.2
  if the peak already passed or is >90 days out; 0.5 for evergreen (no strong season).
  fit: matches a site category.
- Output an **opportunity score**, NOT a virality promise. Be honest.

### 4. Write annotations for the good ones
- **title_suggestion**: `Number + power adjective + exact keyword + audience/benefit`,
  e.g. "25 Cozy Small Living Room Ideas (Renter-Friendly)". Odd numbers + a
  parenthetical hook lift clicks.
- **pin_description**: 2–3 natural sentences with the exact keyword once + 2–3 related
  terms **written as plain language, not a keyword list**. Pinterest is a search
  engine — sentence-form keywords rank; keyword-stuffing gets suppressed.
- **hashtags**: **default to NONE.** Practitioner + Pinterest-rep consensus in 2025–26
  is that hashtags are dead-to-harmful on Pinterest (unlike Instagram). If you include
  any, cap at **0–3** at the very end. Do not stuff. (This overrides older advice.)

### 5. Save
Call `save_keyword_score` once per keyword with:
`{keyword, opportunity_score, demand, momentum, competition, seasonal_timing, fit,
title_suggestion, pin_description, hashtags, peak_month, publish_by, source_notes}`.
- `opportunity_score` is what the dashboard shows as the **viral-potential %** — make it
  honest (0–100 from the rubric).
- `peak_month`: the month demand peaks (e.g. "November"), or "year-round" for evergreen.
- `publish_by`: the concrete publish-by date to catch the rise (e.g. "mid-September"),
  derived from the lead-time rule. This drives the "Publish by" badge on each card.
Put a one-line note in `source_notes` on what you saw AND the timing verdict, e.g.
"Trends 78, rising cluster, peaks Nov → publish by ~mid-Sep; PinClicks vol solid,
small blogs ranking, low competition".

For the strongest keywords, also `add_topic(keyword, title_suggestion)` so they
enter the article queue.

## 2025–2026 reality — read before you overpromise
The platform changed; calibrate expectations and strategy accordingly.
- **Aug 2024 update + Feb 2025 dip:** virality slowed. New/low-trust accounts sit in a
  **60–90 day "trust sandbox"** before traffic builds. Sustained engagement over months
  beats short spikes. Don't promise fast results.
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

## Report back
Give the user a short ranked table (keyword — score — peak/publish-by — why) and say
how many you saved. Lead with the timing verdict for anything seasonal. Don't dump raw
page text.

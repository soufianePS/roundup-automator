# Audit request — for ChatGPT / Codex

Hi ChatGPT. You are auditing a real, working app. **Please use web browsing/search** to
verify anything about PinClicks, Pinterest Trends, or the current Pinterest algorithm
before you answer — don't rely on memory alone. Be concrete, skeptical, and specific.
**Write your answer in the "## YOUR RESPONSE" section at the bottom of THIS file.**

---

## What the app is
`roundup-automator` — a Node app that helps a brand-new **family/home + recipe blog**
find winnable Pinterest keywords and (later) publish roundup/single-topic posts. It runs
an **AI agent = headless Claude on the owner's subscription** (so **agent tokens = real
cost**; minimizing them matters a lot). The agent has tools (MCP) that wrap real app
functions + a real browser. No paid Pinterest/PinClicks API exists — everything is the
logged-in web UI or reverse-engineered internal endpoints.

Constraints that shape everything:
- **Brand-new Pinterest account** (post-2024 "trust sandbox", low domain authority).
- **PinClicks is behind Cloudflare** — bulk automation gets the profile BLOCKED (already
  happened once). So live PinClicks work must be slow, human-paced, and small.
- **Pinterest Trends volume is relative (0–100); PinClicks volume is comparative**, unit
  unknown — not literal monthly searches.

## The current keyword pipeline (what to audit)

**Stage 1 — Trends discovery (fast, deterministic app code).** We reverse-engineered
trends.pinterest.com internal endpoints. For a category (e.g. "food and drinks") we pull
the Growing + Seasonal leaderboards across **weekly windows of LAST YEAR matching today
+30…+90 days** (cyclical prediction). ~2s, cached 6h. Returns per term: normalizedCount,
weekly/monthly/yearly % change, seasonality score, and `weeksSeen` (how many of the ~9
weekly windows it appeared in = persistence).

**Stage 2 — Keyword bank (bulk export, cheap).** PinClicks Keyword Explorer has an
**Export** button → CSV of **~1000 keywords + volumes per seed** in one page load. We
export a few broad seeds into a local SQLite `keyword_bank`. The agent then queries this
**offline** (instant, free, zero live hits) to build a shortlist — filtering by volume
band, substring, excluding roundup words. This replaced per-keyword live looping for
discovery.

**Stage 3 — Competition read (expensive, live, per-keyword).** Only for the final
shortlist (≤8), the agent runs `pinclicks_enrich(withTopPins)`: opens each keyword's Top
Pins page (human-paced, ~25s each, cached 3 days) and scrapes the top 10 pins'
**title, destination domain, date, saves**, then computes:
- **exact-match-in-top-5** (are the ranking pins actually about this exact keyword, or
  broad/roundup pins ranking "close enough"?)
- **save velocity** = saves ÷ age_in_months
- median saves, fresh-high-save red flag (<90d pin already >500 saves), stale count,
  big-media lockout (The Spruce/BHG/etc.)
- → a 0–1 **competition** score + **WINNABLE / MAYBE / LOCKED** verdict.

**Stage 4 — Gated score (0–100).**
```
base  = 0.20*demand + 0.25*ctr_intent + 0.20*seasonalTiming + 0.20*momentum + 0.15*fit
gate  = competition >= 0.6 ? reject : competition >= 0.3 ? (1-competition)^2.2 : (1-competition)^1.5
score = round(100 * base * gate)
```
Plus rules: dedup (never re-suggest a surfaced keyword), no padding (return fewer if
fewer are worth it), single-vs-roundup decided by the SERP not just phrasing, one topic =
one post (cluster variants → pin angles), new-blog volume floor ~1000–5000.

## The problems we want you to solve
On a competitive niche (recipes), a single "give me 5" scan took the agent **~15 minutes
and ~19 live PinClicks Top-Pins lookups across several pivot rounds**, because most
obvious heads came back LOCKED and it kept pivoting to long-tails. That's expensive in
**agent tokens, wall-clock, and Cloudflare exposure.**

## Questions (please answer each, concretely)
1. **Predict "locked" cheaply.** Can we estimate competition from the BANK/EXPORT data
   alone (volume, volume-vs-parent ratio, how many sibling variations exist, keyword
   shape) — enough to *rank shortlist candidates by likely winnability BEFORE* spending a
   live Top-Pins visit? Give a concrete heuristic/formula we can code.
2. **Fewer live visits.** How do we raise the shortlist hit-rate so we don't waste
   Top-Pins visits on LOCKED terms? Is there any way to infer competition WITHOUT opening
   Top Pins per keyword?
3. **Minimize agent tokens.** Which decisions currently done by agent reasoning should be
   moved into deterministic app code (pre-filter, pre-score, pre-cluster) so the agent
   only judges a tiny final set? Be specific about what to hard-code vs leave to the LLM.
4. **Scoring.** Is the gated formula + thresholds sound for a new account? What would you
   change (weights, exponents, floors)?
5. **Use PinClicks better.** Are we underusing anything (Account Explorer / competitor
   keyword lists, annotations, bulk exports, rank tracker) that would find *better*
   keywords with *less* work? Give concrete tactics.
6. **Anything wrong, outdated, or risky** in this approach (Cloudflare, volume meaning,
   algorithm changes in 2025–2026)?

Be specific enough that we can turn your answer into code. Cite sources you browsed.

---

## YOUR RESPONSE
### Sources checked

- PinClicks public site: `https://www.pinclicks.com/` returned a Cloudflare "Please wait while your request is being verified..." page in the browser check; `https://pinclicks.com/` returned 403. I could not independently inspect PinClicks' logged-in feature UI from public web search, so I treat Keyword Explorer export, Top Pins, Account Explorer, annotations, and Rank Tracker as product facts from your working app/brief, not externally documented facts. Source: https://www.pinclicks.com/
- Pinterest Trends help says Trends shows up to two years of top search, save, and shopping trends; search trends expose weekly/monthly/yearly change and seasonality; keyword graph values are normalized by ratio of searches to total platform searches in the same period, with each plotted term indexed 0-100. Source: https://help.pinterest.com/en/business/article/pinterest-trends
- Pinterest Community Guidelines, last updated May 2026, explicitly prohibit unapproved automation, scraping/undocumented access, repetitive/deceptive content, keyword stuffing, untrustworthy/unoriginal linked sites, and attempts to evade anti-spam systems. Source: https://policy.pinterest.com/en/community-guidelines
- Pinterest Developer Guidelines prohibit automated scraping/data extraction except as permitted, reverse-ish platform insight/competitor research without written authorization, and automated end-user actions that lessen authentic engagement. Source: https://policy.pinterest.com/en/developer-guidelines
- Pinterest GenAI policy prohibits reverse engineering/data scraping in the GenAI context and applies normal safety/spam rules to GenAI outputs. Source: https://policy.pinterest.com/en/genai-acceptable-use-guidelines
- Pinterest search/recommendation research supports that modern Pinterest ranking is not just text keyword matching: query/pin/product embeddings use image captions, historical engagement, boards, and real-time serving; cold-start content historically receives lower scores and Pinterest has worked on fresh-content engagement; PinLanding shows Pinterest can generate/serve topical landing pages from visual and textual attributes rather than only search logs. Sources: https://arxiv.org/abs/2404.16260, https://arxiv.org/abs/2512.17277, https://arxiv.org/abs/2503.00619
- 2025-2026 reporting confirms user/platform pressure around AI-generated low-quality Pinterest content and Pinterest's rollout of AI labels / controls. Use this as risk context, not ranking documentation. Sources: https://www.theverge.com/news/659485/pinterest-ai-image-label-filter-features, https://www.wired.com/story/pinterst-ai-slop-content

### 1. Predict "locked" cheaply from bank/export data

Yes, but only as a probabilistic pre-ranker. Bank/export data cannot know actual SERP domain lockout, save velocity, or exact-match quality. It can predict "likely locked" well enough to avoid spending live Top-Pins visits on obvious losers.

Add a deterministic `cheap_competition_prior` in the keyword bank. Store these fields per keyword:

```js
{
  keyword,
  volume,
  seed,
  parentKeyword,          // nearest shorter bank keyword contained in keyword
  parentVolume,
  tokens,
  tokenCount,
  modifierCount,
  hasAudienceModifier,    // toddler, kids, family, beginner, picky eater, budget, small batch
  hasFormatModifier,      // no bake, sheet pan, crockpot, air fryer, meal prep, freezer
  hasConstraintModifier,  // gluten free, dairy free, eggless, high protein, low carb
  hasSeasonModifier,      // halloween, christmas, summer, back to school
  hasCommodityHead,       // chicken, dinner, dessert, pasta, cookie, cake, soup, salad...
  siblingCount,
  siblingVolumeSum,
  phraseFamilySize,
  trendWeeksSeen,
  trendMomentum,
  trendSeasonality
}
```

Compute parent/family metrics offline:

```js
parent = highestVolumeKeywordWhere(candidate.includes(parent) && parent !== candidate)
parentRatio = volume / max(parentVolume, volume)
siblingCount = count(bankKeywords where shareStem(candidate, kw) >= 0.65)
siblingVolumeSum = sum(volume for siblings)
headTokenVolume = max(volume of one/two-token head contained in candidate)
headRatio = volume / max(headTokenVolume, volume)
```

Then score likely competition:

```js
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

cheapCompetition =
  0.28 * volumePressure(volume) +
  0.18 * headPressure(headRatio) +
  0.14 * parentPressure(parentRatio) +
  0.13 * siblingPressure(siblingCount, siblingVolumeSum, volume) +
  0.12 * headTermPenalty(keyword) +
  0.09 * roundupPenalty(keyword) +
  0.08 * noModifierPenalty(keyword) +
  0.08 * trendCrowdingPenalty(trendWeeksSeen, trendMomentum);

cheapCompetition = clamp01(cheapCompetition);
```

Concrete component functions:

```js
function volumePressure(v) {
  // For a brand-new recipe/home account, exported PinClicks volume above ~20k is usually not a first target.
  return clamp01((Math.log10(v + 1) - Math.log10(1500)) / (Math.log10(50000) - Math.log10(1500)));
}

function headPressure(headRatio) {
  // If the long-tail keeps a large share of the head's volume, it is probably a mainstream SERP.
  if (headRatio >= 0.45) return 1;
  if (headRatio >= 0.25) return 0.75;
  if (headRatio >= 0.12) return 0.45;
  return 0.15;
}

function parentPressure(parentRatio) {
  // A child phrase with near-parent volume is probably not a true niche.
  if (parentRatio >= 0.70) return 1;
  if (parentRatio >= 0.40) return 0.7;
  if (parentRatio >= 0.18) return 0.4;
  return 0.1;
}

function siblingPressure(count, sum, volume) {
  // Many siblings with high aggregate volume means a heavily mined cluster.
  const countScore = clamp01((count - 8) / 35);
  const sumScore = clamp01(Math.log10(sum + 1) / Math.log10(Math.max(volume * 30, 2)) - 0.45);
  return clamp01(0.65 * countScore + 0.35 * sumScore);
}

function headTermPenalty(k) {
  const headTerms = [
    "chicken dinner","dinner ideas","easy dinner","healthy dinner","dessert",
    "cookies","cake","soup","salad","pasta","casserole","ground beef",
    "meal prep","breakfast","lunch ideas","appetizers"
  ];
  return headTerms.some(t => k.includes(t)) ? 1 : 0;
}

function roundupPenalty(k) {
  return /\b(ideas|recipes|roundup|best|easy recipes|dinner ideas|meals)\b/.test(k) ? 0.75 : 0;
}

function noModifierPenalty(k) {
  const useful = /\b(no bake|air fryer|crockpot|slow cooker|sheet pan|instant pot|freezer|meal prep|budget|cheap|kid|toddler|family|beginner|small batch|eggless|dairy free|gluten free|high protein|low carb|5 ingredient|30 minute|one pot|leftover)\b/;
  return useful.test(k) ? 0 : 0.65;
}

function trendCrowdingPenalty(weeksSeen, momentum) {
  // Persistent + sharply growing terms are valuable but crowded; require stronger long-tail shape.
  return clamp01((weeksSeen / 9) * 0.55 + clamp01(momentum) * 0.45);
}
```

Also compute a separate `cheapWinnabilityPrior`; do not just invert competition:

```js
demandFit = bandScore(volume, 1000, 12000, 35000); // best around 1k-12k, fades after 35k
specificity = clamp01((tokenCount - 2) / 4);
modifierFit =
  0.35 * hasConstraintModifier +
  0.30 * hasFormatModifier +
  0.20 * hasAudienceModifier +
  0.15 * hasSeasonModifier;
trendFit = clamp01(0.5 * trendSeasonality + 0.3 * trendMomentum + 0.2 * trendWeeksSeen / 9);

cheapWinnabilityPrior = clamp01(
  0.35 * demandFit +
  0.25 * specificity +
  0.25 * modifierFit +
  0.15 * trendFit -
  0.55 * cheapCompetition
);
```

Pre-live verdict:

```js
if (cheapCompetition >= 0.72) likely = "PREDICT_LOCKED";
else if (cheapCompetition >= 0.48) likely = "PREDICT_MAYBE";
else likely = "PREDICT_WINNABLE";
```

For recipes, require at least one "wedge" before live lookup:

```js
hasWedge = hasAudienceModifier || hasFormatModifier || hasConstraintModifier || hasSeasonModifier;
allowLive = cheapWinnabilityPrior >= 0.42 && cheapCompetition < 0.72 && hasWedge;
```

### 2. Fewer live visits / infer competition without Top Pins

You cannot reliably infer final competition without seeing SERP winners, but you can cut live visits by making the app prove a candidate deserves a visit.

Recommended funnel:

1. Generate 200-500 candidates from bank + Trends.
2. Deterministically discard:
   - volume `< 800` unless trendMomentum is extreme and seasonality is imminent
   - volume `> 35000` for new recipe account unless the phrase has at least two strong modifiers
   - tokenCount `< 3` in recipes
   - no wedge modifier
   - `cheapCompetition >= 0.72`
   - duplicate cluster already surfaced or published
3. Cluster by normalized stem and keep only top 1-2 candidates per cluster before any agent call.
4. Rank by `cheapWinnabilityPrior`.
5. Live-enrich only the top 5, not pivot loops. If fewer than 2 pass live validation, return fewer results and schedule a broader offline bank import instead of continuing live.

Add a hard live budget:

```js
MAX_TOP_PIN_LOOKUPS_PER_REQUEST = 6;
MAX_PIVOT_ROUNDS = 1;
STOP_IF_LOCKED_RATE_AFTER_4 >= 0.75;
```

Infer competition without Top Pins using cheaper signals:

- Keyword-bank sibling saturation: many variations around a phrase indicate many creators/tools are mining the same cluster.
- Parent/child volume compression: if "easy chicken dinner" and "easy chicken dinner for family" have similar volume, the child is not meaningfully niche.
- Generic head tokens: "easy", "best", "healthy", "dinner ideas", "recipes" increase competition unless paired with a constraint.
- Trends persistence + strong momentum: great demand, but also a crowd magnet. Use as a "needs specificity" flag, not an auto-pass.
- Pinterest Trends Popular Pins: the official Trends UI exposes Popular Pins for searched keywords. If your reverse-engineered Trends endpoint includes popular pins or destination/title snippets, use that as a cheaper pre-SERP read. If it requires opening the Pinterest UI per keyword, it is still live risk and should be budgeted separately.
- Pinterest autocomplete / related trends: if a phrase returns many close suggestions, it is commercially understood; that is not bad, but it raises the need for a narrower angle.
- Account Explorer exports: competitor domains already ranking/saving around a topic are a better competition proxy than keyword volume alone.

Implementation change: introduce `preLiveReasonCodes` and reject reasons. Example:

```js
[
  "HIGH_PARENT_RATIO",
  "GENERIC_RECIPE_HEAD",
  "NO_AUDIENCE_OR_CONSTRAINT_WEDGE",
  "SATURATED_SIBLING_CLUSTER",
  "TREND_CROWDED_NEEDS_NARROWER_VARIANT"
]
```

The agent should see only:

```js
{
  keyword,
  volume,
  trendSummary,
  cheapCompetition,
  cheapWinnabilityPrior,
  clusterId,
  reasonCodes,
  proposedPostType
}
```

### 3. Minimize agent tokens

Move almost everything before final judgment into deterministic app code.

Hard-code in app code:

- Normalization: lowercase, singular/plural folding, punctuation removal, stopword cleanup.
- Keyword shape extraction: tokenCount, modifier classes, head-term detection, roundup phrase detection, audience/constraint/format/season modifiers.
- Volume banding: account-stage-specific floors/ceilings.
- Parent/child and sibling calculations from `keyword_bank`.
- Trend joins: attach `normalizedCount`, `weeksSeen`, weekly/monthly/yearly change, seasonality, target publish window.
- Cheap competition prior and cheap winnability prior.
- Clustering: group variants into one topic cluster and choose canonical primary keyword.
- SERP-derived live scoring after scraping: exact-match count, big-media count, save velocity, fresh-high-save flag, stale count, median saves, domain diversity, verdict.
- Stop rules: live lookup budget, locked-rate stop, no-padding result count.
- Post type classifier v1:
  - If query contains plural collection words (`ideas`, `recipes`, `meals`, `lunches`) and Top Pins are lists/roundups: roundup.
  - If query has one dish/entity (`cottage cheese cookie dough`, `air fryer salmon bites`) and Top Pins are single recipes: single.
  - If mixed, prefer single for new site unless exact-match roundups are weak and there is a strong cluster.
- Dedup against surfaced/published topics.
- JSON output contract and reason-code generation.

Leave to the LLM only:

- Semantic sanity check: "Is this keyword actually a family/home/recipe topic the site can satisfy?"
- SERP mismatch judgment when exact-match is ambiguous: e.g. "healthy lunch box ideas for picky eaters" vs broad school-lunch pins.
- Angle selection from variants: convert cluster variants into pin titles/angles.
- Rejecting weird/ungrammatical bank exports.
- Deciding whether a cluster should be split into separate posts because user intent differs materially.

Do not let the agent pivot freely. Give it a bounded function:

```js
agent_input = top 8 pre-scored candidates
agent_task = "Choose up to 5 for live validation, no replacements unless app provides next batch."
```

Then after live validation:

```js
agent_input = live-enriched candidates that passed deterministic gates
agent_task = "Return final recommendations and pin angles; do not request more live lookups."
```

This should reduce the 15-minute/19-lookup behavior to 5-6 lookups and two short LLM calls.

### 4. Scoring formula / thresholds

The current gated formula is directionally right for a new account because competition should be a multiplicative gate, not just another weighted feature. I would make it harsher and add hard floors.

Current issue: with `competition = 0.59`, a candidate can still survive with `(1 - .59)^2.2 ~= .14`. For a brand-new recipe account, that is usually too generous. Also, a high demand/momentum term can still score above weak but truly winnable terms.

Recommended scoring:

```js
base =
  0.18 * demand +
  0.18 * ctr_intent +
  0.18 * seasonalTiming +
  0.16 * momentum +
  0.15 * siteFit +
  0.15 * specificity;

if (competition >= 0.55) reject("LOCKED_FOR_NEW_ACCOUNT");
if (exactMatchTop5 >= 4 && medianSaves >= 750) reject("EXACT_MATCH_STRONG_SERP");
if (freshHighSaveCount >= 2) reject("FRESH_WINNERS_TOO_STRONG");
if (bigMediaTop10 >= 4) reject("BIG_MEDIA_LOCKOUT");
if (domainDiversityTop10 <= 3 && medianSaves >= 400) reject("LOW_DIVERSITY_LOCKOUT");

gate =
  competition < 0.20 ? Math.pow(1 - competition, 1.2) :
  competition < 0.35 ? Math.pow(1 - competition, 2.0) :
  Math.pow(1 - competition, 3.2);

score = Math.round(100 * base * gate);
```

Thresholds:

```js
score >= 55 => RECOMMEND
score 42-54 => BACKLOG / TEST PIN ONLY
score < 42 => REJECT
```

Demand should not be linear. Use a new-account demand curve:

```js
function demandScore(volume) {
  if (volume < 800) return 0.15;
  if (volume < 1500) return 0.45;
  if (volume < 5000) return 0.85;
  if (volume < 12000) return 1.00;
  if (volume < 25000) return 0.75;
  if (volume < 50000) return 0.45;
  return 0.20;
}
```

Seasonal timing should be a hard-ish gate:

```js
if (seasonalTopic && daysToPeak < 21) penalize("TOO_LATE", 0.65);
if (seasonalTopic && daysToPeak >= 30 && daysToPeak <= 90) boost("RIGHT_WINDOW", 1.0);
if (seasonalTopic && daysToPeak > 120) penalize("TOO_EARLY", 0.75);
```

Volume floor: keep `1000-5000` as a good early floor, but allow:

- `800-1500` if `cheapCompetition < 0.25` and trend timing is excellent.
- `5000-12000` as the sweet spot when modifier/specificity is strong.
- `12000-35000` only with two wedges and `competition < 0.25`.
- `>35000` usually reject for a new recipe account unless Account Explorer proves small domains are winning.

### 5. Use PinClicks better

Given Cloudflare risk, use PinClicks in fewer, larger, more reusable human-paced sessions.

Concrete tactics:

- Build competitor seed lists with Account Explorer:
  - Find 20-50 small/medium recipe and family-home domains, not The Spruce/BHG/Food Network.
  - Export their visible/ranking keywords if PinClicks allows it.
  - Store rows as `competitor_keyword_bank(domain, keyword, volume, rank/url/pin if available, observed_at)`.
  - Score keywords higher when 2+ small domains appear and no huge media domain is needed to validate demand.

- Create a "small-domain wins" table:

```sql
CREATE TABLE serp_domain_observations (
  keyword TEXT,
  domain TEXT,
  domain_class TEXT, -- small_blog, medium_blog, big_media, ecommerce, social
  position INTEGER,
  saves INTEGER,
  pin_age_days INTEGER,
  observed_at TEXT
);
```

If a small blog appears top 10 for one keyword in a cluster, boost sibling candidates in the same cluster before live lookup.

- Use exports as seed expansion, not just volume lookup:
  - Broad seed exports: "dinner", "dessert", "chicken", "family meals".
  - Modifier seed exports: "toddler meals", "no bake dessert", "crockpot chicken", "school lunch", "budget dinners".
  - Competitor seed exports: export keywords for domains that look like your target site.
  - Seasonal seed exports 60-90 days ahead: "halloween treats", "back to school lunch", "christmas appetizers".

- Annotations:
  - Mark manually verified patterns: `SMALL_BLOG_WIN`, `AI_SLOP_SERP`, `BIG_MEDIA_LOCK`, `EXACT_MATCH_GAP`, `ROUNDUP_SERP`, `SINGLE_RECIPE_SERP`.
  - Feed annotations back into cheap scoring. Example: if a stem has two `BIG_MEDIA_LOCK` annotations, raise cheapCompetition for siblings by `+0.12`.

- Rank tracker:
  - Use it only after publishing/testing, not during discovery.
  - Track 20-50 published primary keywords plus 2 variants each.
  - Use movement after 14/30/60 days to calibrate thresholds. If keywords with `cheapCompetition > .45` never move, lower the live threshold.

- Reuse Top Pins observations across clusters:
  - Top Pins for "air fryer salmon bites" should inform "air fryer salmon bites for kids", "healthy air fryer salmon bites", etc.
  - Cache by `clusterId` and stem, not only exact keyword.

- Add a weekly "human export batch" workflow:
  - Owner logs into PinClicks manually.
  - Export 10-20 seeds in one sitting.
  - App imports CSVs.
  - Agent spends the week querying local SQLite only, with at most 20-30 live Top Pins lookups total.

### 6. Wrong, outdated, or risky

Main risk: the reverse-engineering/scraping posture is fragile. Pinterest's May 2026 Community Guidelines prohibit unapproved automation, undocumented access, reverse engineering, scraping/data extraction, keyword stuffing, unoriginal sites, and anti-spam evasion. Developer Guidelines are also strict about automated scraping and competitor insight features without authorization. Even if this is for internal use, build rate limits, manual controls, and fail-closed behavior.

Specific corrections/risk controls:

- Do not treat Pinterest Trends volume as absolute demand. Your brief is right: Trends is normalized 0-100 per plotted term, relative to searches in the same period. Never combine it directly with PinClicks volume without normalization.
- Do not treat PinClicks volume as monthly searches. Label it `pinclicks_volume_index` or `comparative_volume`, not `monthly_volume`.
- Do not assume the "2024 trust sandbox" is a documented Pinterest mechanism. Treat it as an observed new-account/domain-risk model. Code should use measurable proxies: account age, claimed-domain age, outbound click history, save rate, impression trend, publish cadence.
- Fresh content is not enough. Pinterest research indicates ranking/recommendation uses embeddings, historical engagement, boards, captions, image understanding, and cold-start handling. A new pin can be helped by non-historical/content features, but strong incumbents with engagement history still matter.
- Avoid AI-looking recipe imagery. 2025-2026 reporting shows Pinterest is labeling/filtering GenAI content and users are pushing back on low-quality synthetic images, especially in practical categories like recipes/home. For recipes, prioritize real process/final photos over generated hero images.
- Watch keyword stuffing. Pinterest explicitly lists irrelevant keyword stuffing as spam. Pin titles/descriptions should use one primary keyword plus natural variants, not export-list dumps.
- Limit live PinClicks calls. The Cloudflare block you observed is a product-risk signal. Add a global throttle and circuit breaker:

```js
MIN_SECONDS_BETWEEN_PINCLICKS_PAGES = 25;
MAX_PINCLICKS_TOPPINS_PER_HOUR = 12;
MAX_PINCLICKS_TOPPINS_PER_DAY = 40;
COOLDOWN_AFTER_BLOCK_OR_CHALLENGE_HOURS = 24;
```

- Make "return fewer" the default. If only two candidates pass gates, return two. Do not pivot live until five are found.
- Calibrate with outcomes. Store every recommendation, cheap prior, live score, publish status, and 30/60/90-day Pinterest result. After 50-100 published/tested topics, fit the cheapCompetition weights from actual wins instead of hand-tuning.

### Recommended implementation order

1. Add deterministic feature extraction and `cheapCompetition` / `cheapWinnabilityPrior` to `keyword_bank`.
2. Add cluster-level dedup and one-candidate-per-cluster shortlist selection.
3. Add hard live budgets and stop rules.
4. Add Account Explorer / competitor exports into a separate bank.
5. Add annotation feedback into cheap scoring.
6. Change final scoring thresholds to reject `competition >= .55` for the new account.
7. Add outcome logging so the heuristic can be calibrated from real Pinterest performance.

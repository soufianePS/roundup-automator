# Audit request — for Gemini

Hi Gemini. You are auditing a real, working app. **Please use Google Search / web
browsing** to verify anything about PinClicks, Pinterest Trends, or the current Pinterest
algorithm before you answer — don't rely on memory alone. Be concrete, skeptical, and
specific. **Write your answer in the "## YOUR RESPONSE" section at the bottom of THIS
file.**

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

### Executive Summary & 2026 Context
This audit addresses the critical inefficiencies of the current `roundup-automator` keyword pipeline. By shifting computational weight from expensive, slow agent loops to fast, deterministic database queries and lightweight browser-evaluated HTTP requests, we can reduce both LLM token costs and Cloudflare block risks to near zero. 

---

### 1. Predict "Locked" Cheaply (Offline Competition Formula)
To rank shortlist candidates and weed out high-competition terms *before* spending a live Top-Pins lookup, we can calculate a **Predicted Competition Score ($C_{pred}$)** from the offline SQLite `keyword_bank` alone. 

#### Heuristic Formula
$$C_{pred} = 0.35 \times V_{norm} + 0.25 \times W_{penalty} + 0.20 \times R_{head} + 0.10 \times S_{sib} + 0.10 \times T_{depth}$$

Where:
*   **Normalized Volume ($V_{norm}$)**: Logarithmic scale mapping volumes between 1,000 and 100,000.
    $$V_{norm} = \text{clamp}\left(\frac{\log_{10}(\text{volume}) - 3.0}{5.0 - 3.0}, 0.0, 1.0\right)$$
*   **Word Count Penalty ($W_{penalty}$)**: Head terms are highly competitive; long-tail terms are winnable.
    $$W_{penalty} = \begin{cases} 1.0 & \text{words } \le 2 \\ 0.8 & \text{words } = 3 \\ 0.4 & \text{words } = 4 \\ 0.1 & \text{words } \ge 5 \end{cases}$$
*   **Head Term Ratio ($R_{head}$)**: Ratio of keyword volume to the seed/parent term's volume.
    $$R_{head} = \min\left(1.0, \frac{\text{volume}}{\text{seed\_volume}}\right)$$
*   **Sibling Saturation ($S_{sib}$)**: The count of keywords in the bank sharing the first two words (e.g. "apple crisp %"). High variation counts signal high category density.
    $$S_{sib} = \text{clamp}\left(\frac{\text{sibling\_count}}{30}, 0.0, 1.0\right)$$
*   **Taxonomy Depth ($T_{depth}$)**: Broad category vs. deep niche.
    $$T_{depth} = \text{clamp}\left(1.0 - 0.25 \times (\text{taxonomy\_levels} - 1), 0.0, 1.0\right)$$

#### Node.js Implementation
Add this function to [src/db/repos.js](file:///C:/Users/xassi/Desktop/All%20work/Chek%20domains/Automation%20WP/roundup-automator/src/db/repos.js) or a utility helper:

```javascript
export function calculateOfflineCompetition(row, maxSeedVolume, siblingCount) {
  const { keyword, volume, taxonomy } = row;
  
  // 1. Volume Factor (1,000 to 100,000 scale)
  const logVol = Math.log10(Math.max(volume, 1000));
  const vNorm = Math.min(1.0, Math.max(0.0, (logVol - 3.0) / (5.0 - 3.0)));
  
  // 2. Word Count Penalty
  const words = keyword.trim().split(/\s+/).length;
  const wPenalty = words <= 2 ? 1.0 : words === 3 ? 0.8 : words === 4 ? 0.4 : 0.1;
  
  // 3. Head Term Ratio
  const ratio = volume / (maxSeedVolume || volume);
  const rHead = ratio > 0.3 ? 1.0 : ratio > 0.1 ? 0.6 : 0.0;
  
  // 4. Sibling Saturation
  const sSib = Math.min(1.0, siblingCount / 30);
  
  // 5. Taxonomy Depth (Split by newline for PinClicks layout)
  const taxLevels = taxonomy ? taxonomy.trim().split('\n').filter(Boolean).length : 1;
  const tDepth = Math.max(0.0, 1.0 - 0.25 * (taxLevels - 1));
  
  // Composite Score
  const cPred = 0.35 * vNorm + 0.25 * wPenalty + 0.20 * rHead + 0.10 * sSib + 0.10 * tDepth;
  return parseFloat(cPred.toFixed(3));
}
```

*Rule of Thumb:* Run this calculation during the database importing phase. **Pre-filter any keyword with $C_{pred} \ge 0.65$ as LOCKED automatically.**

---

### 2. Fewer Live Visits (Lightweight SERP Sniffing)
To avoid opening the expensive Top Pins UI page via Playwright/Dolphin and risking Cloudflare blocks, you can fetch Pinterest's search results directly as JSON. Because the browser page is already authenticated/initialized, you can run a `fetch` directly inside the page context. This inherits cookies, CSRF tokens, and user-agent perfectly, returning data in `< 1s` without UI rendering.

#### Playwright Implementation
Use the following method inside your browser manager:

```javascript
async function fetchPinterestSERP(page, keyword) {
  const options = {
    options: {
      query: keyword,
      scope: "pins",
      page_size: 10
    }
  };
  
  const targetUrl = `https://www.pinterest.com/resource/BaseSearchResource/get/?data=${encodeURIComponent(JSON.stringify(options))}`;
  
  // Evaluate fetch within the page context to inherit active cookies/headers
  const serpData = await page.evaluate(async (url) => {
    try {
      const response = await fetch(url, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01'
        }
      });
      return await response.json();
    } catch (e) {
      return { error: e.message };
    }
  }, targetUrl);

  if (serpData.error || !serpData.resource_response?.data?.results) {
    throw new Error(`Failed to scrape SERP for "${keyword}": ${JSON.stringify(serpData)}`);
  }

  // Parse results
  return serpData.resource_response.data.results.slice(0, 10).map(pin => ({
    id: pin.id,
    title: pin.title || pin.grid_title,
    domain: pin.link ? new URL(pin.link).hostname : 'pinterest.com',
    saves: pin.repin_count || 0,
    created_at: pin.created_at
  }));
}
```

#### Competition Score Calculation from Scraped Pins
Instead of opening PinClicks, evaluate competition instantly on this parsed JSON array:

```javascript
function evaluateScrapedCompetition(pins) {
  const bigMediaDomains = ['thespruce.com', 'bhg.com', 'hgtv.com', 'apartmenttherapy.com', 'foodnetwork.com', 'allrecipes.com', 'epicurious.com'];
  
  // 1. Median saves calculation
  const saves = pins.map(p => p.saves).sort((a, b) => a - b);
  const medianSaves = saves[Math.floor(saves.length / 2)] || 0;
  const sComp = Math.min(1.0, Math.max(0.0, (medianSaves - 100) / (1000 - 100)));
  
  // 2. Big media domain check in Top 5
  const top5 = pins.slice(0, 5);
  const bigMediaCount = top5.filter(p => bigMediaDomains.some(domain => p.domain.includes(domain))).length;
  
  // Hard Lock: If 2 or more top 5 positions are major publishers, keyword is LOCKED
  if (bigMediaCount >= 2) {
    return 1.0;
  }
  
  // Otherwise, use saves + domain presence weight
  const domainWeight = bigMediaCount * 0.15; 
  return Math.min(1.0, sComp + domainWeight);
}
```

This saves $25\text{s}$ per keyword and eliminates the necessity of hitting PinClicks live for competitor details.

---

### 3. Minimize Agent Tokens (Deterministic Filtering & Clustering)
Currently, the agent consumes high token counts doing basic data filtering. We must strip logic out of the LLM context and hard-code it into node/SQL scripts.

```
[Raw Keyword Bank (SQLite)]
         │
         ▼  (Deterministic App Pre-filters)
[Filter by Volume: 1k - 25k]
[Filter out Negative words (e.g., "how to cook")]
[Calculate C_pred -> Filter out C_pred >= 0.65]
         │
         ▼  (Deduplicate Sibling Clusters in Node.js)
[N-Gram Sibling Grouping: Keep only the highest volume term per group]
         │
         ▼  (Lightweight SERP Sniffing - Top 10 Pins)
[Calculate Scraped Competition -> Filter out LOCKED terms]
         │
         ▼  (Final Candidate Shortlist: Max 5-8 terms)
[Agent evaluate CTR Intent + Writes Annotations (Titles, descriptions)]
```

#### Node.js Sibling Clustering Helper
Group keywords that share a root context to avoid wasting live lookups on variants (e.g., "easy apple pie" and "apple pie easy"):

```javascript
function clusterKeywords(rows) {
  const seenRoots = new Set();
  const uniqueList = [];

  for (const row of rows) {
    // Sort words to create a normalized character root (bag of words)
    const root = row.keyword
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .sort()
      .join(' ');
      
    if (!seenRoots.has(root)) {
      seenRoots.add(root);
      uniqueList.push(row);
    }
  }
  return uniqueList; // Passes only distinct intents to downstream steps
}
```

#### Shared Interface (Output sent to Agent)
The agent only receives this tiny JSON payload:
```json
[
  {
    "keyword": "gluten free apple crisp bars",
    "volume": 4500,
    "scraped_competition": 0.28,
    "demand_trend": 85,
    "top_pin_titles": [
      "Healthy Oatmeal Apple Crisp Bars",
      "Easy Gluten Free Apple Crisp (Vegan)",
      "Best Cinnamon Apple Bars"
    ]
  }
]
```
The agent’s sole tasks are:
1.  Rate **CTR intent (0-1)** based on whether the `top_pin_titles` satisfy user query on-screen or require clicking.
2.  Assess roundup image feasibility.
3.  Write the title card and pin text.

---

### 4. Scoring Formula Calibration
For a **brand-new account** stuck in the Pinterest sandbox (which takes 3–6 months for indexing trust), we need a much tighter competition gate and a shifted lead time.

#### Current vs. Recommended Formulas

| Metric / Parameter | Old Formula / Value | New Account Formula / Value | Rationale |
| :--- | :--- | :--- | :--- |
| **`seasonalTiming` Peak** | 30–45 days lead time | **75–90 days lead time** | New accounts need 3 months to rank; publishing 30 days before a peak is too late. |
| **`ctr_intent` Weight** | 0.25 | **0.30** | Outbound clicks are the goal; high-intent terms must be prioritized. |
| **`demand` Weight** | 0.20 | **0.15** | Trends data is relative; lower weight helps avoid false head-term spikes. |
| **Volume Floor / Ceiling** | Floor ~1,000 | **1,000 (Floor) to 25,000 (Ceiling)** | New accounts cannot rank for terms >25k volume; ceilings prevent locked head chases. |
| **Gate Math** | Exponents applied up to 0.6 | **Hard reject at $\ge 0.5$** | A new site cannot win a term with $\ge 0.5$ competition. Reject it outright. |

#### New Account Scoring Formula
```javascript
// Calculate Seasonal Timing peaking at 90 days lead time
const daysToPeak = getDaysToPeak(row.peak_month);
const seasonalTiming = Math.max(0.0, 1.0 - Math.abs(daysToPeak - 90) / 45);

const base = 0.15 * demand + 0.30 * ctr_intent + 0.20 * seasonalTiming + 0.20 * momentum + 0.15 * fit;

// Gate Math
let gate = 0;
if (competition < 0.50) {
  gate = Math.pow(1 - competition, 2.0); // Strict penalty for any friction
} else {
  gate = 0; // REJECT
}

const score = Math.round(100 * base * gate);
```

---

### 5. Advanced PinClicks Optimization
1.  **Competitor Domain Mining (Account Explorer):**
    Instead of entering generic seeds, find 10-15 mid-tier blogs in your niche (DA 25-45, e.g., *JoyFoodSunshine*, *RoomForTuesday*). Paste their domains into the **Account Explorer** and export all ranking keywords. This populates your `keyword_bank` with keywords pre-validated as winnable by a domain of moderate authority.
2.  **Automated Board Classification:**
    Parse the `Taxonomy` fields in the PinClicks export (e.g. `food and drink\ndessert\npie`). Setup a script to match taxonomy paths with your WordPress categories and existing Pinterest Boards. If no board matches the sub-level (e.g. `pie`), queue an app warning: *"Create Board: [Parent Category] [Sub-level] Recipes"*. Board optimization must happen first, as Pinterest ranks boards before pins.
3.  **Annotated Interest Injection:**
    PinClicks reveals the exact annotated interests Pinterest associates with top pins. Extract these from the export CSV and enforce their placement directly into Pin descriptions, alt tags, and the WP post tags to guarantee contextual relevance.

---

### 6. Risks & Algorithmic Realities (2025–2026)
*   **The Cloudflare Anti-Bot Ring:** Scraping PinClicks live will lead to blocks. *Mitigation:* Conduct all PinClicks research via manual monthly exports of keyword lists. Keep live research strictly to the Pinterest `/resource/` endpoints within Playwright, which mimic standard user search behavior.
*   **AI-Pin Suppression & Visual Shielding:** Pinterest actively flags Gen-AI content using pixel-pattern classifiers (bypassing metadata strip tools). *Mitigation:* Ensure all article images are authentic, sourced photos. For Pin creative designs, overlay a heavy graphic and text layer (the "graphic overlap shield") over the background photo. This breaks up AI detection grids and preserves distribution.
*   **Saves are the Core Signal (TransActV2):** Pinterest's current ranking engine tracks up to 16,000 historical actions per user. **Saves** are the primary signal of intent. If a pin is saved to a board, it signals long-term value, leading to wider feed distribution. Tailor roundup posts to be highly "save-worthy" (inspiration lists, cheat sheets).
*   **Fresh Pin Rule & Cadence:** Pinterest defines a "fresh pin" as a brand-new image file. Repinning or changing minor details is detected as duplicate spam. Ensure your pipeline generates 3–5 visually distinct graphic layouts for each URL, scheduled at least **7–10 days apart** to avoid sandbox shadowbans.

---

### Sources Cited
*   [PinClicks Official Product Specifications & Plan Details](https://app.pinclicks.com/)
*   [Sprout Social: Pinterest Algorithm Dynamics and Optimization](https://sproutsocial.com/)
*   [Pinterest Newsroom: Generative AI Identification and Feeds Labeling Policy](https://newsroom.pinterest.com/)
*   [Search Engine Land: Visual Search and Metadata Authority Signals](https://searchengineland.com/)
*   [MadPin Media: TransActV2 Search Classification and Real-Time Feed Diversification](https://madpinmedia.com/)
*   [84Pins: Pinterest Search Autocomplete and Scraping Guidelines](https://84pins.com/)

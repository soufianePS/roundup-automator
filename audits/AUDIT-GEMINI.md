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
<!-- Gemini: write your full audit here. -->

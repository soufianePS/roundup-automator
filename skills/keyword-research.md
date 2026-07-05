# Skill: keyword-research

Goal: given a seed keyword (or a theme + target month), return a ranked list of
high-opportunity, low-competition keywords for the family/home blog, each with an
opportunity score and ready-to-use annotations. Save results to the DB.

## Inputs
- `seed` (e.g. "home decor") or `theme` + `targetMonth`
- optional `count` (default 20)

## Steps
1. Expand the seed into long-tail variants via `pinterest_autocomplete(seed)` and
   related terms from Pinterest Trends. (Long-tail = winnable; head terms are owned
   by giants.)
2. For each candidate, gather signals:
   - `fetch_pinterest_trends(keyword)` → interest curve (demand), YoY direction
     (momentum), whether it peaks near the target month (seasonal timing).
   - `fetch_pinclicks(keyword)` → top-pin save density + difficulty (competition).
     (Owner has paid PinClicks. If unavailable, use the Pinterest-search heuristic:
     few fresh pins + small blogs ranking = winnable.)
3. Score each with the opportunity rubric (see BLUEPRINT.md):
   `score = w1*demand + w2*momentum + w3*(1-competition) + w4*seasonalTiming + w5*fit`
   Output 0-100. This is an OPPORTUNITY score, not a promise of virality.
4. For the top N, write annotations:
   - `title_suggestion`: `Number + power adjective + exact keyword + audience/benefit`
     e.g. "25 Cozy Small Living Room Ideas (Renter-Friendly)". Odd numbers + a
     parenthetical hook lift clicks.
   - `pin_description`: 2 natural sentences with the exact keyword once + 2-3 related
     terms, then 4-6 hashtags (1 broad + niche).
5. Save via `save_keyword_scores(list)`.

## Guardrails
- Be honest: "opportunity", not "will go viral". No one can guarantee virality.
- Prefer keywords that peak ~30-45 days out (Pinterest needs lead time to distribute).
- Trends interest is relative (0-100), not absolute traffic.
- Later: read `read_past_performance()` and weight toward patterns that actually
  worked for THIS site (the feedback/training loop).

## Output
Ranked JSON: `[{keyword, opportunity_score, demand, momentum, competition,
seasonal_timing, fit, title_suggestion, pin_description, hashtags, source_notes}]`

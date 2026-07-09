---
name: pinclicks
description: How to safely drive PinClicks (app.pinclicks.com) — bulk keyword export, per-keyword volume + competition lookups, Cloudflare-block avoidance, and what each data field actually is. Read this before writing ANY code or script that touches pinclicks.com directly, even for one-off testing/exploration.
---

# PinClicks — safe usage, real data sources, Cloudflare risk

PinClicks is a third-party Pinterest keyword research tool. It has no public API —
the app drives the real logged-in browser and scrapes the rendered UI. It sits
behind Cloudflare, and Cloudflare blocks are real, have actually happened to this
project multiple times, and can be **IP-level, not just profile-level** (confirmed
2026-07-08 — see "What actually happened" below). Treat every interaction with it
as something that costs safety budget, not something free to retry.

## THE ONE RULE THAT MATTERS MOST

**Never write your own script/page.goto() against pinclicks.com — always go through
`src/shared/pinclicks.js` (`enrichKeywords`) or `src/shared/pinclicks-export.js`
(`exportSeeds`), i.e. the MCP tools `pinclicks_enrich` / `pinclicks_export_seeds`.**

Those functions are the ONLY places that carry the safe launch pattern, the human
pacing, the block detector, and the circuit breaker. A raw/ad-hoc script bypasses
ALL of that — including the persisted rate-limit budget, so it doesn't even show up
as "spent" for the next real run. This is exactly what caused a real block on
2026-07-08 (see below).

## One-call automation: `best_keywords_for_trend(trend)`

For the common case — "here's a trend, give me the best keywords for it" — there's a
single composed MCP tool that does the whole pipeline in one call: bank lookup
(`query_keyword_bank`/`trend_titles`, offline) → live competition read
(`pinclicks_enrich withTopPins`, respects cache + circuit breaker) → real timing
(`trend_curves`). Returns candidates ranked lowest-competition-first, each with
`competition`, `verdict`, `annotations` (real PinClicks Related Interests),
`publish_by` (real graph-based timing). It does not auto-save — review, then
`save_keyword_score` the keepers with `parent_trend` set to the trend you passed in.
If the trend isn't banked yet, it tells you to `pinclicks_export_seeds([trend])`
first rather than silently failing. If live budget is exhausted/blocked, it still
returns whatever the cache can offer and marks `budgetExhausted`/`blocked` clearly
rather than pretending everything was checked.

Verified 2026-07-08 (cache-only, zero live PinClicks calls, safe under the current
block): given `"zucchini bread"`, correctly ranked 3 real cached candidates by
competition, attached real annotations/timing where available, and correctly
reported `null` timing for two very-long-tail terms Pinterest Trends itself has no
curve data for (not a bug — genuine data absence, confirmed by checking `trend_curves`
directly for those exact terms).

## Two workflows — know which one you need

### 1. Bulk export (`pinclicks_export_seeds` → `exportSeeds()`)
The CHEAP, high-yield path. Drives **Keyword Explorer**
(`app.pinclicks.com/keyword-explorer`), types a broad seed (e.g. "pumpkin", NOT
"pumpkin bread air fryer"), waits for results, clicks the real **Export** button,
downloads the CSV, and parses it into the local `keyword_bank` table (~1000 rows per
seed, one page load + one Export click). Do this ONCE per topic area, then query the
bank OFFLINE and FREE afterward (`query_keyword_bank`, `shortlist_candidates`) —
never re-loop PinClicks live for discovery.

CSV columns actually used (`parseExport()` in pinclicks-export.js):
- **Label** → the keyword itself
- **Search Volume** → parsed to an integer
- **URL**, **Taxonomy** → category context
- **Related Interests** → the cell looks like `"lawn and garden (url)\npumpkin
  carving (url)\n..."` — one `name (url)` per line. Parsed to just the names, capped
  at 8, comma-joined. **This is where the `annotations` field on saved keywords
  comes from.** It is genuinely PulledPinterest data, not invented — but it is
  frequently EMPTY for narrow long-tail keywords (PinClicks doesn't always have
  related-interest data for every row). An empty annotations field is a real data
  gap, not a bug — don't try to backfill it with guessed tags.

### 2. Per-keyword live lookup (`pinclicks_enrich` → `enrichKeywords()`)
The SLOW, capped path — only for your FINAL shortlist (≤8 keywords), never a big
list. Two things it can do:
- **Volume + related terms**: types the keyword into the search box, reads the
  rendered table row for that exact keyword + up to 12 related rows.
- **Top Pins competition read** (`withTopPins: true`): navigates to
  `app.pinclicks.com/pins?search=<keyword>`, scrapes the top 10 pin rows (title,
  domain, date, saves), and computes a competition score:
  ```
  comp = 0.4
    + 0.35 if exactMatchTop5 >= 4     (else -0.2 if <= 1) — token-set match, not
                                        substring: stop words stripped, plurals
                                        stemmed, so "muffins" matches "muffin" and
                                        "cake" no longer false-matches "cupcake"
    + 0.30 if freshHighSave >= 1      (a <3mo-old pin with >500 saves = a real incumbent)
    + 0.20 if medianSaves > 1000      (else -0.2 if < 300 recipe / 150 home)
    + 0.30 if freshBigMedia >= 1      (a <6mo big-media pin — domain authority AND
                                        freshness both maxed = near-unbeatable)
    - 0.15 if staleBigMedia >= 2      (fixed 2026-07-09, was a real bug: a >12mo
                                        big-media pin holding rank on authority alone
                                        is VULNERABLE, not a wall — Pinterest's own
                                        ranking favors fresh pins; the old formula
                                        penalized fresh and stale big-media
                                        identically, which misclassified a stale-
                                        big-media SERP as LOCKED when it's actually
                                        a real opportunity)
    - 0.15 if staleCount >= 3         (3+ pins >12mo old, any domain = opening)
    - 0.15 if weakPins >= 3           (3+ pins under the save floor = thin competition)
  clamped to [0.05, 1]
  verdict: <=0.35 WINNABLE | <=0.6 "maybe, needs a better angle" | >0.6 LOCKED
  ```
  This is the REAL competition signal — never guess competition from keyword
  phrasing alone.

**What's NOT currently scraped — TWO real, documented features (via web research,
2026-07-08 — not yet verified by direct inspection, PinClicks was blocked at the
time):**

1. **"Pin Stats" tool — paste an individual Pin URL → get that pin's own annotated
   interests + stats** (saves, comments, reactions, pin score), also exportable as
   CSV. **CONVERGED lead**: two independent research passes (ChatGPT 2026-07-09 and
   Gemini 2026-07-09), working from different sources, both landed on this
   specifically and both explicitly said NOT hover. This is now the top-priority
   thing to verify. Planned flow: `topPinsFor()` already collects the top pin URLs
   (or would need to start capturing them — currently only scrapes title/domain/
   date/saves, not the href) → feed those URLs into a new `pinStatsFor(pinUrl)`
   function → extract annotations → this is most likely the exact "open a pin, see
   its keywords" feature described in conversation. Not yet built.
2. **Top Pins may have its own Export button**, same pattern as Keyword Explorer —
   one research pass described exporting Top Pins results as a CSV containing
   saves, position, reactions, annotations, and a "pin score" per ranking pin. The
   current code (`topPinsFor()` in pinclicks.js) scrapes the raw rendered `<table>`
   via `$$eval` instead — exactly the fragile approach the app is supposed to
   avoid in favor of the established click-Export-parse-CSV pattern already used
   correctly for Keyword Explorer. Check this if Pin Stats (above) doesn't pan out.
3. **Hovering a Top Pins row may show annotations inline** — only ONE of the two
   most recent research passes suggested this, and the other explicitly said NOT
   hover ("may change... URL input sounds more stable"). Demoted to last —
   cheapest to try, but least corroborated.

These leads may all describe the SAME underlying feature seen via different UI
paths, or PinClicks' UI may have changed between when each source was written. Do
not assume any is implemented until actually built and verified live — these are
research leads, not working features. An investigation attempt on 2026-07-08 was
cut short by a real Cloudflare block before any could be checked directly in the UI
(see incident below). When unblocked: check Pin Stats first (most corroborated),
then Export button, then hover — stop as soon as one confirms real annotation data.

## Safety mechanics (all in `pinclicks.js`)

- **Human-paced typing**: each character typed with `rand(70-150ms)` delay, not
  `.fill()`.
- **Waits after actions**: 5-11s after page loads, 7-10s after Enter (let the
  Livewire table render), 15-35s between different keywords/seeds.
- **Launch pattern — always headed, always with anti-detection args**:
  ```js
  chromium.launchPersistentContext(activeProfileDir(), {
    headless: false, viewport: null,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  ```
  `headless: true` and/or omitting these args is a detectable bot fingerprint —
  believed to be a direct contributing cause of the 2026-07-08 block (see below).
- **Circuit breaker**: max 12 live lookups/hour, 40/day, persisted to disk at
  `data/cache/pinclicks/_breaker.json` (fixed 2026-07-08 — it used to be in-memory
  only, which reset to a fresh budget every single agent run since the MCP server is
  a new process each time; several separate runs could each burn their own "full"
  budget with no shared awareness). On a detected block, it writes a 24h cooldown to
  that same file — respected by every future run, not just the one that got blocked.
- **Per-keyword cache**: 3-day TTL, so repeat scans of the same keyword don't cost a
  live lookup at all.
- **Block detection** (`looksBlocked()`): checks page title/URL for
  "just a moment" / "attention required" / "cloudflare" / "challenge" / "blocked".

## What actually happened — 2026-07-08 real incident (read this before touching PinClicks)

An ad-hoc exploration script was written directly against `pinclicks.com` (bypassing
`pinclicks.js` entirely) to investigate the "open a pin" feature above. It used
`headless: true` and omitted the anti-detection launch args — an immediate deviation
from the safe pattern. It hit a real Cloudflare "Sorry, you have been blocked" page
on the first navigation.

To recover, a brand-new, never-before-used browser profile was created and a slow,
human-paced login was attempted (headed this time, but still without the full
anti-detection arg set) using the stored credentials. **It hit the identical block
page, on the login page itself, within minutes** — on the same network.

Conclusions:
1. This can be an **IP-level Cloudflare block**, not purely per-profile/cookie. "Add
   a fresh profile" is NOT a reliable fix and the code/skill previously said it was —
   corrected in commit `abbb52d`.
2. `headless: true` + missing anti-detection args is a real, independent risk factor
   — always match the exact safe launch pattern above, never a shortcut.
3. Once blocked, retrying — even "more carefully" — within the same short window did
   NOT work. The right response to `blocked: true` is STOP completely and wait (or
   change network), not iterate on technique hoping to slip through.
4. The circuit breaker persistence fix (above) exists specifically so this can't
   repeat silently across separate agent runs.

## If you see `blocked: true`

STOP. Do not retry. Do not open a fresh profile as a workaround. Tell the user
plainly: this may be an IP-level block, the safe move is to wait out the cooldown
(or try from a different network if that's genuinely available), and that retrying
makes it more likely to extend the block, not less.

## Explicitly declined: deeper anti-bot evasion

External research (2026-07-09) also recommended `playwright-extra` + stealth
plugins, residential proxy rotation, bezier-curve "ghost cursor" mouse movement,
and typo-injection typing to more thoroughly defeat Cloudflare/PinClicks' bot
detection. **Deliberately not implemented.** Reasons:
- The block on 2026-07-08 was caused by a script that bypassed the existing safe
  pattern entirely (headless, no anti-detection args), not by the safe pattern
  itself being insufficient. The lesson was "always use the safe wrapper," not
  "the wrapper needs to be sneakier."
- This account's own paid PinClicks login is what's being automated — routing it
  through a rotating residential proxy would make login traffic look like account
  takeover (same cookies, different IP each session), risking the account itself
  getting flagged, not just an IP.
- This conflicts with the actual policy already established here: when blocked,
  STOP and wait — don't escalate technique to slip past the block. If PinClicks
  starts blocking more often even with the existing safe pattern followed
  correctly, that's a signal to slow down further (longer pacing, lower daily
  cap), not to invest in evasion engineering.

## Researched pacing context (general Cloudflare behavior, not PinClicks-specific —
no official PinClicks rate-limit docs exist since it has no public API)

Cloudflare's own WAF docs suggest ~4-5 requests/minute is a common threshold before
a Managed Challenge fires on sensitive/dynamic endpoints (login-like or
search-triggering actions), vs. 20-100/min for static page views. PinClicks searches
are dynamic/server-rendered (Livewire), closer to the sensitive end. The existing
15-35s per-action pacing works out to roughly 1.7-4 actions/minute during an active
burst — already at or under that threshold. There is no reason to speed this up;
if anything, err slower, not faster, especially right after any recent block.

## Cross-checking a title beyond PinClicks

PinClicks (volume + Top Pins competition) is the primary signal, but it's not the
only tool available for validating a candidate title/keyword:
- `WebSearch` can sanity-check whether a title's exact phrase is already saturated
  with content elsewhere on the web (blogs, other Pinterest-adjacent sites) —
  useful when PinClicks' own data is thin (null volume, empty related interests) and
  you want a second read before committing to a save.
- This skill (and `keyword-research`) is shared identically across all three agent
  engines (Claude, Codex/ChatGPT, Antigravity/Gemini — confirmed 2026-07-08 via
  direct session-transcript inspection, Codex reads this exact file). Running the
  same trend through a different engine via the dashboard's Engine dropdown is
  itself a natural second-opinion mechanism if you want independent verification of
  a judgment call — no extra tooling needed, just re-run with `provider: "codex"`.
- Don't use either of these to bypass PinClicks' own live competition read — they're
  a supplement for thin/ambiguous data, not a replacement for `pinclicks_enrich
  withTopPins`.

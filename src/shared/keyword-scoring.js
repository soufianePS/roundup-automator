/**
 * Deterministic keyword scoring — moves work OUT of the agent (tokens/loops) into
 * fast app code, per the cross-AI audit (ChatGPT + Gemini converged on this).
 *
 * From the offline keyword_bank alone (no live PinClicks), we:
 *  - extract keyword shape (tokens, modifier "wedges", head-term, roundup intent)
 *  - compute a CHEAP competition PRIOR (predict "locked" before any live visit)
 *  - compute a CHEAP winnability prior (rank what deserves a live check)
 *  - cluster near-duplicate variants → one canonical per cluster
 *  - build a small ranked shortlist the agent judges, instead of raw bank rows.
 *
 * These priors are heuristics, not truth — they PRE-RANK so live Top-Pins checks are
 * spent on likely winners, cutting agent tokens + PinClicks/Cloudflare exposure.
 */
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const WEDGES = {
  audience: /\b(toddler|kids?|family|families|beginner|picky eater|crowd|group|party)\b/,
  format:   /\b(no ?bake|sheet pan|crock ?pot|slow cooker|air fryer|instant pot|meal prep|freezer|one pot|dump|5 ingredient|30 minute|make ahead|overnight)\b/,
  constraint:/\b(gluten ?free|dairy ?free|egg ?less|vegan|vegetarian|high protein|low carb|keto|sugar ?free|healthy|whole30|paleo)\b/,
  season:   /\b(halloween|christmas|thanksgiving|fall|autumn|summer|spring|winter|back to school|valentine|easter|4th of july|super bowl|game day)\b/,
};
const ROUNDUP = /\b(ideas|recipes|best|ways|inspo|inspiration|roundup|meals|list|dinners|lunches|desserts|treats|appetizers|snacks)\b/;
const HEAD_TOKENS = /\b(dinner|dessert|cookies?|cake|soup|salad|pasta|chicken|beef|breakfast|lunch|appetizers?|meals?|bread|muffins?|pie)\b/;

export function extractFeatures(keyword) {
  const k = String(keyword || '').toLowerCase().trim();
  const tokens = k.split(/\s+/).filter(Boolean);
  const wedges = Object.entries(WEDGES).filter(([, re]) => re.test(k)).map(([n]) => n);
  return {
    keyword: k,
    tokenCount: tokens.length,
    wedges,
    hasWedge: wedges.length > 0,
    isRoundup: ROUNDUP.test(k),
    isBareHead: tokens.length <= 2 || (tokens.length === 3 && HEAD_TOKENS.test(k) && wedges.length === 0),
  };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const fmtDate = (d) => `${MONTHS[d.getMonth()].slice(0, 3).replace(/^\w/, c => c.toUpperCase())} ${d.getDate()}, ${d.getFullYear()}`;

/**
 * Lift-off-anchored seasonal timing (deterministic — no fragile curve API).
 * A seasonal keyword lifts off ~90 days before its peak; a NEW account must publish
 * in the flat BEFORE lift-off. So the ideal START window is peak−120 … peak−60 days.
 * Past that (getting close to / into the peak) = too late this cycle → queue next year.
 *
 * @param peakMonth  e.g. "August", "September (secondary Jan)", "year-round"
 * @returns { seasonal_timing 0-1, publish_by, verdict, days_to_peak }
 */
export function seasonalTiming(peakMonth, today = new Date()) {
  const pm = String(peakMonth || '').toLowerCase();
  if (!pm || /year.?round|evergreen|anytime|no strong season/.test(pm)) {
    return { seasonal_timing: 0.5, publish_by: 'anytime (evergreen)', verdict: 'evergreen — publish whenever', days_to_peak: null };
  }
  const idx = MONTHS.findIndex(m => pm.includes(m));
  if (idx < 0) return { seasonal_timing: 0.5, publish_by: 'unknown', verdict: 'unknown peak month', days_to_peak: null };

  // next upcoming ~15th of the peak month
  let peak = new Date(today.getFullYear(), idx, 15);
  if (peak < today) peak = new Date(today.getFullYear() + 1, idx, 15);
  const dtp = Math.round((peak - today) / 86400000);
  const idealStart = new Date(peak.getTime() - 90 * 86400000);   // publish ~90d before peak

  let score, verdict, publish_by;
  if (dtp >= 150) {
    score = 0.4; publish_by = `plan — start ~${fmtDate(idealStart)}`;
    verdict = `EARLY: peak ~${MONTHS[idx]}; ideal start ~${fmtDate(idealStart)} — queue, don't start yet`;
  } else if (dtp >= 90) {
    score = 1.0; publish_by = `start now — by ${fmtDate(idealStart)}`;
    verdict = `PRIME: ~${dtp}d to peak, right in the pre-lift-off window`;
  } else if (dtp >= 60) {
    score = 0.8; publish_by = `start this week`;
    verdict = `GOOD: ~${dtp}d to peak — still time before the climb`;
  } else if (dtp >= 45) {
    score = 0.5; publish_by = `start immediately`;
    verdict = `TIGHT: only ~${dtp}d to peak — lift-off is basically now, publish today or skip`;
  } else {
    // dtp < 45 → we're in/at the rise or past lift-off → too late for a new account
    score = dtp >= 21 ? 0.25 : 0.08;
    const nextStart = new Date(peak.getFullYear() + 1, idx, 15).getTime() - 90 * 86400000;
    publish_by = `MISSED this cycle — queue for ~${fmtDate(new Date(nextStart))}`;
    verdict = `LATE: only ~${dtp}d to peak — past lift-off, publishing now enters the peak against aged pins. Queue for next year (start ~${fmtDate(new Date(nextStart))}).`;
  }
  return { seasonal_timing: score, publish_by, verdict, days_to_peak: dtp };
}

/**
 * REAL timing from Pinterest's own Moments data (takeoff/peak dates + shape),
 * when the keyword matches a named moment (via trends-api.matchMoment). More
 * precise than the peak-month guess: a SPIKE (Halloween-like, narrow plateau)
 * needs to be caught before takeoff or the window is basically gone; a HUMP
 * (produce/recipe-like, wide plateau) still pays off well into the rise.
 */
export function timingFromMoment(m, today = new Date()) {
  const peak = new Date(m.peakDate), takeoff = m.takeoffDate ? new Date(m.takeoffDate) : null;
  const daysToPeak = Math.round((peak - today) / 86400000);
  const daysToTakeoff = takeoff ? Math.round((takeoff - today) / 86400000) : null;
  const shape = m.shape || 'medium';
  let score, verdict;

  if (daysToPeak < 0) {
    score = 0.08; verdict = `MISSED: ${m.name} already peaked (${m.peakDate}) — queue for next cycle`;
  } else if (daysToTakeoff != null && today < takeoff) {
    const window = shape === 'spike' ? 30 : shape === 'hump' ? 75 : 50;
    if (daysToTakeoff <= window) { score = 1.0; verdict = `PRIME: ${m.name} lifts off ${m.takeoffDate} (${daysToTakeoff}d) — publish now, ${shape}`; }
    else { score = 0.4; verdict = `EARLY: ${m.name} lift-off not until ${m.takeoffDate} (${daysToTakeoff}d out) — queue, don't start yet`; }
  } else {
    // already past takeoff — inside the rise/plateau
    if (shape === 'spike') { score = daysToPeak >= 21 ? 0.25 : 0.1; verdict = `LATE: ${m.name} is a SHARP SPIKE already lifting off — narrow window nearly gone (peak ${m.peakDate})`; }
    else if (shape === 'hump') { score = daysToPeak >= 14 ? 0.6 : 0.3; verdict = `MID-RISE: ${m.name} is a WIDE HUMP (${m.plateauDays}d plateau) — still a long runway to peak ${m.peakDate}`; }
    else { score = daysToPeak >= 21 ? 0.45 : 0.2; verdict = `MID-RISE: ${m.name}, moderate window, peak ${m.peakDate}`; }
  }
  return { seasonal_timing: score, publish_by: verdict.split(':')[0] === 'PRIME' ? 'start now' : verdict, verdict, days_to_peak: daysToPeak, shape, source: 'pinterest_moments' };
}

/**
 * "Catch it before it rises" — reads a real weekly interest curve (from
 * fetchCurves' /metrics/ data) and finds the exact bend where a flat/low line
 * just started curling upward, before it becomes the steep climb. This is the
 * per-keyword equivalent of timingFromMoment, but works for ANY term (not just
 * named holidays) since it reads the term's own real curve instead of a
 * category-level moment match.
 *
 * counts: [{date, normalizedCount}] ascending by date, ideally the FULL ~52wk
 * history fetchCurves returns (not just the tail) — the true reference peak
 * for "how far already risen" must come from last cycle's real high, not from
 * a short trailing window that's contaminated by the very rise being measured.
 */
export function detectLiftoff(counts) {
  const pts = (counts || []).filter(c => c && c.normalizedCount != null);
  if (pts.length < 6) return { status: 'insufficient_data' };
  const vals = pts.map(p => p.normalizedCount);
  const n = vals.length;
  const longTermPeak = Math.max(...vals); // full-history high (last cycle's real peak)
  const currentVal = vals[n - 1];
  // Below this, the index is basically 0/1/2 noise — too little signal to read a
  // shape from at all (e.g. thanksgiving in July: 0,0,0,1,1,1 is not a "rise").
  if (longTermPeak < 5) return { status: 'flat', currentVal, recentMax: longTermPeak, weeksIntoRise: 0, lowSignal: true };

  // Walk back over the trailing window to find where the current non-decreasing
  // run started (15% noise tolerance so one wobbly week doesn't break the streak).
  const win = Math.min(n, 16);
  const floor = n - win;
  let i = n - 1;
  while (i > floor && vals[i] >= vals[i - 1] * 0.85) i--;
  const weeksIntoRise = n - 1 - i;
  const streakStartVal = vals[i];
  const risePct = currentVal / longTermPeak;
  // A "rise" must be a real, meaningful net increase — not equal/flat values
  // passing the noise tolerance (a 6wk plateau at 3,3,3,3,3,3 is FLAT, not
  // rising), and not a 0→1 blip near the floor (needs an absolute delta too).
  const netRise = streakStartVal > 0 ? currentVal / streakStartVal : (currentVal > 0 ? Infinity : 1);
  const absDelta = currentVal - streakStartVal;
  const meaningfulRise = weeksIntoRise >= 2 && netRise >= 1.3 && absDelta >= Math.max(2, longTermPeak * 0.05);

  let status;
  if (!meaningfulRise) status = currentVal < vals[n - 2] * 0.9 ? 'declining' : 'flat';
  else if (risePct >= 0.85) status = 'near_peak';
  else if (weeksIntoRise <= 4 && risePct <= 0.4) status = 'liftoff';
  else status = 'rising';

  return { status, currentVal, recentMax: longTermPeak, risePct: +risePct.toFixed(2), weeksIntoRise, streakStartVal, startDate: pts[i]?.date, latestDate: pts[n - 1]?.date };
}

/** Turns detectLiftoff()'s raw numbers into the same kind of verdict string timingFromMoment produces. */
export function liftoffVerdict(term, liftoff) {
  const l = liftoff;
  if (!l || l.status === 'insufficient_data') return `NO CURVE DATA: not enough history for "${term}" — fall back to smart_timing`;
  switch (l.status) {
    case 'liftoff':
      return `LIFTOFF: "${term}" just bent upward ${l.weeksIntoRise}wk ago (${l.streakStartVal}→${l.currentVal}, still only ${Math.round(l.risePct * 100)}% of its recent high) — catch it now, before the climb`;
    case 'rising':
      return `MID-RISE: "${term}" has been climbing ${l.weeksIntoRise}wk (${l.streakStartVal}→${l.currentVal}, ${Math.round(l.risePct * 100)}% of high) — still winnable but past the earliest catch point`;
    case 'near_peak':
      return `NEAR PEAK: "${term}" is at ${Math.round(l.risePct * 100)}% of its recent high — the early window already passed`;
    case 'declining':
      return `DECLINING: "${term}" fell last week (${l.currentVal} vs recent high ${l.recentMax}) — likely past its cycle`;
    case 'flat':
    default:
      return `FLAT: "${term}" hasn't bent upward yet (steady around ${l.currentVal}) — no liftoff signal, keep watching or use category timing instead`;
  }
}

/** Post type from phrasing (SERP still overrides later). */
export function classifyPostType(keyword) {
  const k = String(keyword || '').toLowerCase();
  if (/\b(ideas|inspo|inspiration|best|ways to|roundup)\b/.test(k)) return 'roundup';
  if (/\b(recipe|how to|tutorial)\b/.test(k) || /^[a-z]/.test(k)) return 'single';
  return 'single';
}

/** Cheap competition prior 0..1 (higher = likelier LOCKED). */
export function cheapCompetition(row, ctx = {}) {
  const f = extractFeatures(row.keyword);
  const vol = Number(row.volume) || 0;
  const { parentVolume = 0, siblingCount = 0, headVolume = 0 } = ctx;

  // volume pressure: big volume on a new account = crowded (log 1500..50000)
  const volP = clamp01((Math.log10(vol + 1) - Math.log10(1500)) / (Math.log10(50000) - Math.log10(1500)));
  // head/parent ratio: child keeping most of head's volume = mainstream SERP
  const headRatio = headVolume ? vol / headVolume : (parentVolume ? vol / parentVolume : 0);
  const headP = headRatio >= 0.45 ? 1 : headRatio >= 0.25 ? 0.75 : headRatio >= 0.12 ? 0.45 : 0.15;
  // sibling saturation: heavily-mined cluster
  const sibP = clamp01((siblingCount - 8) / 35);
  const headTokenP = f.isBareHead ? 1 : 0;
  const roundupP = f.isRoundup ? 0.6 : 0;
  const noWedgeP = f.hasWedge ? 0 : 0.6;

  const c = 0.30 * volP + 0.18 * headP + 0.14 * sibP + 0.14 * headTokenP + 0.12 * roundupP + 0.12 * noWedgeP;
  return Math.round(clamp01(c) * 100) / 100;
}

/** New-account demand band: peak ~1k–12k, fades after. */
export function demandScore(volume) {
  const v = Number(volume) || 0;
  if (v < 800) return 0.15;
  if (v < 1500) return 0.45;
  if (v < 5000) return 0.85;
  if (v < 12000) return 1.0;
  if (v < 25000) return 0.75;
  if (v < 50000) return 0.45;
  return 0.2;
}

/** Cheap winnability prior 0..1 — don't just invert competition. */
export function cheapWinnability(row, ctx = {}) {
  const f = extractFeatures(row.keyword);
  const comp = cheapCompetition(row, ctx);
  const demandFit = demandScore(row.volume);
  const specificity = clamp01((f.tokenCount - 2) / 4);
  const modifierFit = clamp01(f.wedges.length / 2);
  const w = clamp01(0.35 * demandFit + 0.25 * specificity + 0.25 * modifierFit - 0.55 * comp + 0.15);
  return Math.round(w * 100) / 100;
}

/** Normalized stem for clustering (bag-of-words, drop stopwords). */
function stem(keyword) {
  const stop = new Set(['the', 'a', 'an', 'for', 'with', 'and', 'to', 'of', 'in', 'easy', 'best', 'recipe', 'recipes', 'ideas']);
  return String(keyword || '').toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
    .filter(t => t && !stop.has(t)).sort().join(' ');
}

/**
 * Build a small ranked shortlist from bank rows.
 * @param rows  bank rows [{keyword, volume, taxonomy, source_seed}]
 * @param opts  { exclude:Set(seen keywords), volMin, volMax, limit, requireWedge }
 * @returns ranked candidates with priors + reasonCodes + clusterId + siblings
 */
export function buildShortlist(rows, opts = {}) {
  const { exclude = new Set(), volMin = 800, volMax = 35000, limit = 8, requireWedge = false } = opts;
  const seen = new Set([...exclude].map(s => String(s).toLowerCase()));
  const headVolume = Math.max(...rows.map(r => (extractFeatures(r.keyword).isBareHead ? Number(r.volume) || 0 : 0)), 0);

  // sibling counts by stem-prefix (first two significant words)
  const prefixCount = new Map();
  for (const r of rows) {
    const p = extractFeatures(r.keyword).keyword.split(/\s+/).slice(0, 2).join(' ');
    prefixCount.set(p, (prefixCount.get(p) || 0) + 1);
  }

  const scored = [];
  for (const r of rows) {
    const f = extractFeatures(r.keyword);
    const vol = Number(r.volume) || 0;
    const reason = [];
    if (seen.has(f.keyword)) continue;                         // dedup
    if (vol < volMin) { continue; }
    if (vol > volMax) { reason.push('OVER_CEILING'); continue; }
    if (f.tokenCount < 3) { reason.push('TOO_SHORT'); continue; }
    if (requireWedge && !f.hasWedge && !f.isRoundup) { reason.push('NO_WEDGE'); continue; }
    const prefix = f.keyword.split(/\s+/).slice(0, 2).join(' ');
    const siblingCount = prefixCount.get(prefix) || 1;
    const comp = cheapCompetition(r, { headVolume, siblingCount });
    if (comp >= 0.72) { continue; }                            // predicted LOCKED — skip
    const win = cheapWinnability(r, { headVolume, siblingCount });
    scored.push({
      keyword: f.keyword, volume: vol, clusterId: stem(r.keyword),
      cheapCompetition: comp, cheapWinnability: win,
      predict: comp >= 0.48 ? 'MAYBE' : 'WINNABLE',
      postType: classifyPostType(r.keyword), wedges: f.wedges,
      taxonomy: (r.taxonomy || '').split('\n')[0] || '',
      annotations: r.related_interests || r.relatedInterests || '',
    });
  }

  // one canonical per cluster: highest winnability
  const byCluster = new Map();
  for (const c of scored) {
    const cur = byCluster.get(c.clusterId);
    if (!cur || c.cheapWinnability > cur.cheapWinnability) byCluster.set(c.clusterId, c);
  }
  return [...byCluster.values()]
    .sort((a, b) => b.cheapWinnability - a.cheapWinnability)
    .slice(0, limit);
}

/**
 * MULTI-TITLE expansion for ONE parent trend (e.g. "peach"): unlike buildShortlist
 * (which collapses everything to a single best-per-cluster shortlist across the
 * WHOLE category), this keeps every DISTINCT dish/title under the trend — "peach
 * cobbler", "peach fridge cake", "peach cookies" are different clusters and all
 * survive, each with its own volume + real annotations (related_interests).
 * @param rows  bank rows already filtered to this trend (e.g. KeywordBank.query({like:seed}))
 * @param opts  { exclude, volMin, volMax, maxPerDish=1, limit=12 }
 * @returns [{keyword, volume, cheapCompetition, cheapWinnability, predict, postType, annotations, dish}]
 */
const OFF_TOPIC_FOR_FOOD = /\bnails?\b|\bbirthday\b|\bparty (?:decor|outfit|theme)|\boutfit\b|\bdress\b|\bhair(style)?\b|\bmakeup\b|\bnursery\b|\bwallpaper\b|\btattoo\b/;

export function trendTitles(rows, opts = {}) {
  const { exclude = new Set(), volMin = 500, volMax = 60000, limit = 12, taxonomyContains = null } = opts;
  const seen = new Set([...exclude].map(s => String(s).toLowerCase()));
  const headVolume = Math.max(...rows.map(r => (extractFeatures(r.keyword).isBareHead ? Number(r.volume) || 0 : 0)), 0);
  const prefixCount = new Map();
  for (const r of rows) {
    const p = extractFeatures(r.keyword).keyword.split(/\s+/).slice(0, 2).join(' ');
    prefixCount.set(p, (prefixCount.get(p) || 0) + 1);
  }
  const byDish = new Map();   // dish (stem) -> best candidate for that dish
  for (const r of rows) {
    const f = extractFeatures(r.keyword);
    const vol = Number(r.volume) || 0;
    if (seen.has(f.keyword)) continue;
    if (vol < volMin || vol > volMax) continue;
    if (f.tokenCount < 2) continue;   // "peach" alone isn't a dish; "peach cake" is
    if (taxonomyContains) {
      const tax = (r.taxonomy || '').toLowerCase();
      if (tax && !tax.includes(taxonomyContains)) continue;   // off-topic (e.g. "peach nails")
      // Blank taxonomy rows can't be checked that way — fall back to an off-topic
      // keyword filter for recipe requests (nails/fashion/party themes etc).
      if (!tax && taxonomyContains === 'food' && OFF_TOPIC_FOR_FOOD.test(f.keyword)) continue;
    }
    const prefix = f.keyword.split(/\s+/).slice(0, 2).join(' ');
    const siblingCount = prefixCount.get(prefix) || 1;
    const comp = cheapCompetition(r, { headVolume, siblingCount });
    if (comp >= 0.78) continue;   // predicted hard-LOCKED — not worth even listing
    const win = cheapWinnability(r, { headVolume, siblingCount });
    const dish = stem(r.keyword);
    const cand = {
      keyword: f.keyword, volume: vol, dish,
      cheapCompetition: comp, cheapWinnability: win,
      predict: comp >= 0.48 ? 'MAYBE' : 'WINNABLE',
      postType: classifyPostType(r.keyword),
      annotations: r.related_interests || r.relatedInterests || '',
    };
    const cur = byDish.get(dish);
    if (!cur || cand.cheapWinnability > cur.cheapWinnability) byDish.set(dish, cand);
  }
  return [...byDish.values()].sort((a, b) => b.cheapWinnability - a.cheapWinnability).slice(0, limit);
}

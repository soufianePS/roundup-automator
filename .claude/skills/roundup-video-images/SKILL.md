# Roundup video images — sourcing step photos from YouTube tutorials

An alternative to `roundup-images` (single Google-Images photo per item): for a
craft/DIY/build topic, find a real YouTube tutorial, pull its transcript, and
extract clean step photos directly from the video frames — instead of
searching for separate standalone photos per step.

Built and validated 2026-07-10 across 4 real videos (fairy lantern jar, DIY
serving tray, wall clip frame, string egg treat holder). Shared code lives in
`src/shared/youtube-video.js`.

## Image sizing (owner decision, 2026-07-10)

All standard sizes are LANDSCAPE, matched to real web/SEO/OG conventions —
not mobile-portrait cropping (that was tried first, then explicitly reversed
in favor of these):
- **In-article images**: `ARTICLE_SIZES.threeTwo` (1200x800) or `.fourThree`
  (1200x900).
- **Featured/cover image**: `FEATURED_SIZES.og` (1200x630 — standard
  Facebook/Twitter Open Graph share size) or `.wide` (1600x900).

Use `resizeToTarget(inputPath, outputPath, size)` from the module. This
REQUIRES capturing frames at `openVideo`'s default 2200x1400 viewport (real
tested value — YouTube's player scales with viewport, giving a genuine
~1577x887 native render at that size) so the resize is a real crop/mild
downscale, not a fake upscale. A same-run test showed a completely different
bounding box (1513x851) for the same viewport on a different launch — some
variance is normal; the function logs a console warning if the source is
smaller than the target so you notice if it's about to upscale.

## Copyright stance (owner decision, 2026-07-10)

Video-frame extraction is a BIGGER legal exposure than single-photo sourcing —
a frame is still part of the video's copyrighted footage regardless of what's
in it. Owner has explicitly decided to proceed with credit+link only (same
policy as `roundup-images`), knowingly accepting the higher risk rather than
restricting to CC-licensed videos only. Do not re-litigate this each run —
always caption every video-sourced image "Image credit: [Channel] via
YouTube" linked to the video, same as before.

## Capture resolution (fixed 2026-07-14)

`openVideo()` now sets `deviceScaleFactor: 2` by default. Before this fix,
every captured frame was visibly softer than it needed to be — not because
of video quality or viewport size, but because Playwright defaults to 1
screenshot pixel per CSS pixel, while a manual screen recording captures at
the real monitor's pixel density (2x+ on most modern displays). Same CSS
video box size, genuinely double the real captured pixels once fixed —
confirmed visually (crisp yarn strands/wood grain vs a visibly soft crop at
the old setting). Don't revert this without re-testing.

## The pipeline

1. **`searchVideos(query)`** — search YouTube, returns candidate titles/URLs.
2. **Screen candidates before committing** — open 2-3 candidates,
   `getVideoMeta()` (real channel, real view count, real description — reject
   anything that reads like pasted AI-SEO text, e.g. "designed to hook
   viewers... drive traffic to your website"), `getChapters()`,
   `getTranscript()`, then `scoreStepCoverage()`. Prefer the video with the
   highest score, real chapters, and markers spread across most of the
   runtime (not clumped in the first 20%).
3. **`findCompletionWindow(segments, lengthSeconds)`** — locates the real
   "finished result" moment via transcript completion-cue phrases anchored
   near the true end (not a mid-video "subscribe" plug — see false-positive
   notes in the source, both bugs found via real testing and fixed).
4. **`prepPlayerForFrameGrabs(page)`** — forces the highest available video
   quality (confirmed +13% sharpness) AND hard-disables captions so they
   never get burned into the screenshot. Always call this before grabbing
   frames.
5. **`grabBestFrames(page, baseSeconds, prefix, {keepTop})`** — grabs
   candidates spread across a WIDE window (default ~-2s to +5.6s around
   `baseSeconds`, not a tight sub-second cluster — composition changes over
   whole seconds as hands/camera move, a tight burst just gives near-
   duplicates with nothing real to pick between) and ranks by a COMPOSITE
   score: sharpness (Laplacian-variance, rejects blur) blended with a
   composition heuristic (centered vs clipped/cluttered) and an exposure
   heuristic (real tonal range vs flat/washed-out or too-dark). Returns the
   TOP 4 by default, not just one, each tagged `lowConfidence: true/false`
   (see "Quality signals" below). This is a plain pixel-math heuristic, NOT a
   neural aesthetic model (no CLIP/NIMA — that would mean downloading a large
   external model, and separately, the owner does not want any AI-generated/
   AI-touched imagery on the site at all) — it surfaces better raw candidates
   than blur-only ranking did, it does not replace the mandatory human visual
   check below.

## MANDATORY manual step — visually check the TOP candidates, not just the winner

There is no automated face detector wired in (would need a Python/CV stack we
don't have — see the ChatGPT/Gemini research from 2026-07-10 for the full
tooling list: MediaPipe, YOLO, SCRFD, if this ever needs to scale). Instead
the agent itself is the check — and this was found to be under-applied in
practice: early runs only looked at the #1 sharpness-ranked candidate and
trusted the score blindly, never opening #2 or #3. That's not good enough —
a lower-scored candidate can be the better choice (no face, better
composition) and it goes unseen if only the winner is checked.

**Required per step, every time:**
1. Call `grabBestFrames(..., {keepTop: 4})` — always keep at least 4, not 1.
2. **Actually view all 4** (Read tool / vision), not just the top-ranked one.
3. Pick the best considering the composite score AND: no recognizable face,
   right subject/moment, good composition, caption match, genuine sharpness —
   the composite score is a real improvement over blur-only but is still a
   pixel-math heuristic, not judgment. It can still rank a technically
   well-framed but wrong-subject or face-containing frame above a better one.
   **Check the WHOLE frame, not just the main subject** — a background
   laptop/phone screen (video call, photo), a mirror, a framed photo, or a TV
   can carry a recognizable face too. Confirmed live 2026-07-14: an
   autonomous run (queue feature, Codex) let a face through on a laptop
   screen in the background of an otherwise-clean "layering feathers" shot —
   easy to miss when scanning for the main subject's face only.
4. If the best candidate still has a face but is otherwise the right shot,
   **crop it out** rather than discarding — validated live: a real "finished
   coasters" shot had the presenter's face in frame, cropping to the lower
   half (just hands/product on the table) removed the face while keeping a
   perfectly usable result photo.
5. Only reject the whole step/re-grab at a different (wider) timestamp
   window if none of the 4 candidates work even after considering a crop.

This is not optional — skipping it was flagged as a real problem in the first
3 test posts (both had clearly visible kids'/adults' faces in every image).

## Hero/featured image — rank the thumbnail AND extracted frames together, then pick

Confirmed live 2026-07-14 (post #6833, baby foot mold keepsake): even a sharp,
correctly-matched, fully-uncropped extracted video frame still made a weak
hero/featured image — it's a random close-up moment from mid-action, not a
composed shot, and reads as unattractive/amateurish on the site's cover.
YouTube's own video thumbnail is creator-designed specifically to look good
and get clicks (staged framing, decent lighting, the finished subject held up
clearly), so it's usually the better pick — but "usually" is not "always": a
thumbnail can be dim, off-center, or buried in text/clickbait styling. Use
**`getHeroCandidates(page, videoId, completionWindow, outPathPrefix)`**
(added 2026-07-15) instead of assuming the thumbnail wins — it fetches the
real thumbnail (checking actual pixel dimensions, since YouTube serves a
~120x90 grey placeholder with a 200 OK, not a 404, when a size doesn't exist)
AND grabs the best extracted "finished result" frames, scores everything the
same way (sharpness + composition + exposure), and returns ONE ranked list
tagged `source: 'thumbnail'` or `'frame'`.

1. Call `getHeroCandidates(...)` and **actually view the top 2-3** (not just
   the #1 by score) — same "don't trust the number blindly" rule as any other
   frame.
2. Shorts thumbnails are usually the vertical video letterboxed into a 16:9
   frame with dark/blurred pillarbox bars on the sides — crop those out
   (`sharp().extract()` to the real 9:16 content region) before judging it.
3. Creators often burn a title/text overlay onto the thumbnail (e.g. "Baby
   keepsake") — crop it out same as any other burned-in caption/branding.
4. Face-check it exactly like any other frame (reject/crop a recognizable
   face) — a thumbnail is not exempt just because it comes from a different
   source.
5. If every candidate is flagged `lowConfidence: true` (contrast or exposure
   below the absolute floor — see "Quality signals" below), widen: try a
   different completion-window timestamp, or check the other thumbnail
   quality tiers, before accepting the least-bad option.
6. Resize with `resizeToTarget(..., { hero: true })` — this applies the
   stronger enhancement lift (see below) meant only for the one cover image.

## Quality signals + automatic enhancement (added 2026-07-15)

Two changes address the two real gaps in this pipeline: no absolute quality
floor (scoring was only ever relative, batch-to-batch), and no consistency
pass across images pulled from different cameras/lighting.

- **`lowConfidence` flag** — every candidate from `grabBestFrames()` and
  `getHeroCandidates()` now carries `lowConfidence: true/false`. Unlike raw
  sharpness (only comparable WITHIN one batch — the winner's `sharpNorm`
  always hits 1.0 even in an all-blurry batch, so it can't detect "this whole
  batch is weak"), `contrast` and `exposure` are both normalized to a fixed
  0..1 scale independent of source resolution/quality, so a value below the
  floor (`contrast < 0.20` or `exposure < 0.35`) is a real absolute signal,
  not just "worse than its neighbors." If the candidate you're about to pick
  is `lowConfidence: true`, treat that as a widen-the-search signal, not
  something to silently ship.
- **Automatic enhancement** — `resizeToTarget()` now applies a photographic
  enhancement pass by default (auto-levels/contrast stretch, a mild
  saturation + brightness lift, two-stage sharpening for fine detail +
  broader "clarity"). Pure pixel math via sharp — no AI upscaling/generation
  model, consistent with the owner's no-AI-touched-imagery rule — it exists
  because source videos vary wildly in camera/lighting and a flat raw
  screenshot reads as noticeably weaker than a normal "finished photo" once
  you put it next to real editorial photography. Pass `{ hero: true }` only
  for the one featured/cover image (stronger lift); leave it default `true`/
  `false` for regular step images. Pass `{ enhance: false }` only if you
  specifically need an untouched comparison.

## MANDATORY manual step 2 — caption match, blur, and hero-crop check

Confirmed live 2026-07-14: TWO separate autonomous runs (Codex, posts #6826
and #6833) each passed the face-check above and still shipped bad images —
this is a distinct failure class the face-check does NOT cover. Before
uploading ANY frame, check all three of these, every time:

1. **Does the frame actually show what the caption is about to claim?**
   Write the caption text FIRST (or have it in mind), then look at the frame
   and ask "would a reader agree this photo shows that action/result?" — not
   "is this frame from roughly the right part of the video." Real failure:
   a caption said "paint the cardboard base" but the picked frame showed
   coloring feathers, a different step entirely, just because it was close
   in time.
2. **Is the frame actually sharp, not just "less blurry than its neighbors"?**
   A relative comparison between a handful of nearby candidates is not
   enough if the whole neighborhood is soft (fast motion, camera-focus hunt,
   heavy motion blur). Look at the frame itself and ask "could a reader read
   the fine detail this step depends on" (e.g. liquid actually visibly
   flowing, texture actually visible) — if not, widen the search window well
   beyond the immediate neighbors (jump several seconds away, not 0.4s) until
   you find one that is genuinely sharp, even if that means abandoning the
   original timestamp guess entirely.
3. **For the featured/"finished result" hero image specifically: is the
   whole subject actually IN frame, uncropped?** Never trust
   `fit:'cover', position:'attention'` blindly for a hero shot — it has
   picked the wrong region at least twice in real testing (once keeping
   background clutter and losing the actual subject entirely, once still
   including an unwanted face after a first crop attempt). For a hero/result
   image: pick a frame where the finished subject is already fully visible
   and centered-enough in the RAW frame before any resize, and only reach
   for a manual `sharp().extract({left, top, width, height})` with bounds
   you determined by actually looking at the raw frame — never assume the
   auto-crop guessed correctly. If cropping would cut off part of the
   subject (a foot missing toes, wings cut off at the edge, etc.), pick a
   different timestamp instead of forcing that crop.

Do this check for every image, not just the hero — a normal step image with
a caption/content mismatch or unreadable blur is just as much a failure as a
badly-cropped hero.

## Known failure modes (found via real testing, not theoretical)

- **Panning shots**: even the default wide window can land entirely inside
  camera motion. If every candidate's composite score is low for a step,
  pass an even wider/shifted `offsets` array rather than accepting the
  "best of a bad batch."
- **Baked-in creator captions** (e.g. "CUT 3PCS @ 24\"") are burned into the
  video itself, not toggleable like YouTube's CC — the only fix is picking a
  different timestamp a few seconds away, not a code-level fix.
- **Sharpness scores are NOT comparable across videos** — they depend on the
  source's max available quality (720p vs 4K). Always visually confirm a
  frame, don't trust the number blindly across different videos.
- **Generic completion phrases false-positive constantly** — a bare "here" or
  "subscribe" appears throughout ordinary narration/mid-video plugs, not just
  at the real end. `COMPLETION_CUES`/`OUTRO_CUES` in the source require
  fuller phrases and are restricted to the back portion of the runtime for
  exactly this reason — don't loosen them without re-testing on a real video.
- **A video finishing one of several sub-projects** (e.g. two coaster styles
  in one video) can trigger an early false "completion" match — that's why
  completion cues are only trusted in the last 40% of the runtime.

## Video selection scoring (`scoreStepCoverage`)

Cheap, regex-based, no ML — deliberately scoped down from the full
NLP/embeddings pipeline the research described (spaCy, sentence-transformers,
CLIP) since that's Python infra we don't have for a low-volume pipeline.
Signals: sequencing-marker density per minute, how many of the video's 10
deciles contain a marker (catches videos that front-load all their "steps" in
the intro and coast), chapter count/quality, and whether a genuine completion
cue exists at all. If this pipeline scales up significantly, revisit the full
research (saved in conversation history 2026-07-10) for the heavier
semantic-matching version.

## Full example flow (see `src/shared/youtube-video.js` for real signatures)

```
const results = await searchVideos('<topic> tutorial');
// screen 2-3 candidates, pick by scoreStepCoverage + real legitimacy checks
const { browser, page } = await openVideo(videoId);
const meta = await getVideoMeta(page);
const chapters = await getChapters(page);
const segments = await getTranscript(page);
const coverage = scoreStepCoverage({ segments, chapters, lengthSeconds: meta.lengthSeconds });
await prepPlayerForFrameGrabs(page);
// for each step: grabBestFrames(page, timestamp, prefix) -> visually pick top candidate, face-check, crop if needed
// resizeToTarget(rawPath, outPath, { width, height }) -> resize + auto enhancement pass (default on)
const completionWindow = findCompletionWindow(segments, meta.lengthSeconds);
const heroCandidates = await getHeroCandidates(page, videoId, completionWindow, prefix);
// view top 2-3 of heroCandidates, pick by score + visual check + lowConfidence flag
// resizeToTarget(chosenHeroPath, outPath, { ...FEATURED_SIZES.og, hero: true }) -> stronger enhancement lift
await browser.close();
// upload via WordPress.uploadImage(), caption "Image credit: X via YouTube", createDraft()
```

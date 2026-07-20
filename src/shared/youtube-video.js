/**
 * YouTube video sourcing — search a tutorial video, score it for step-coverage
 * completeness, pull its transcript/chapters, and extract clean, sharp,
 * caption-free step frames at forced max quality. Every output image gets a
 * final photographic enhancement pass (auto-levels + saturation lift +
 * two-stage sharpen, see applyEnhancement/resizeToTarget) and the hero/cover
 * image is chosen from a single ranked list of thumbnail-vs-frame candidates
 * (see getHeroCandidates), not a blind "always use the thumbnail" rule.
 *
 * COPYRIGHT NOTE: extracting frames from a YouTube video is a bigger legal
 * exposure than sourcing a single credited photo — a video frame is still
 * part of the video's copyrighted footage. Owner decision (2026-07-10):
 * proceed with credit+link only, same as the image policy, knowingly
 * accepting the higher risk rather than requiring CC-licensed sources.
 *
 * FACE/PERSON CHECK: detectFaces() (added 2026-07-15, owner-approved same day)
 * runs an automatic face-detection PRE-FILTER using MediaPipe's FaceDetector
 * (WASM, loaded via CDN into a throwaway headless page — no Python, no GPU,
 * no paid API, no new npm dependency). This is a safety net, NOT a
 * replacement for the manual check: grabBestFrame() still returns the TOP N
 * candidates, not just one, and the caller (the agent) MUST still look at
 * whichever it picks and reject/re-pick if a recognizable face is visible —
 * a model can miss a face (an unusual angle, low light, a photo-of-a-photo)
 * just as a human scanning quickly can. Treat a positive detection as a hard
 * stop; treat a negative detection as "no additional red flag," not "safe."
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const TASKS_VISION_VERSION = '0.10.14';
const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

// Confidence tiers — found via a real test run 2026-07-15 (20 coarse frames
// from a real 6.5-min DIY tutorial, visually checked against the raw model
// output): scores 0.9+ were genuine on-camera-presenter hits every time;
// scores in the 0.5-0.6 band were FALSE POSITIVES on a plain mason jar lid
// and a small fairy-shaped decal sticker — shiny/circular or small
// silhouette shapes trip the model at low confidence. A flat boolean would
// either miss real faces (threshold too high) or flag jar lids constantly
// (threshold too low), so this is a hard stop at high confidence and a
// "worth a second look" flag at the lower end, not a single cutoff.
const FACE_CONFIDENT_THRESHOLD = 0.75;
const FACE_UNCERTAIN_THRESHOLD = 0.35;

const LAUNCH_ARGS = {
  headless: false,
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
  ignoreDefaultArgs: ['--enable-automation'],
};

const SEQUENCE_MARKERS = /\b(first|firstly|next|then|now|after that|once (that|it)('s| is)? (dry|done|set|cool(ed)?)|finally|last step|lastly|to finish)\b/gi;
// NOTE: bare "here" is deliberately excluded — it matched constantly in ordinary
// descriptive speech ("here is how you can do it") with zero connection to an
// actual finished-result reveal. Every phrase below requires the completion
// framing to be explicit, not just the word "here" on its own.
const COMPLETION_CUES = /\b(here('s| is) the finished|here it is|and there you have it|the finished (product|piece|result)|all done|ta-?da|how it turn(ed|s) out|finished (project|piece)|final (look|result))\b/gi;
// NOTE: outro phrases like "subscribe" are often used as a MID-video plug too
// (e.g. "subscribe so you don't miss the next video"), not just at the real
// end. Treating the FIRST match as "the outro" truncated the search window
// way too early on a real video. We now require the outro-cue evidence to be
// clustered near the end (see findCompletionWindow), and prefer the LAST
// match chronologically over the first.
const OUTRO_CUES = /\b(thanks?( you)? (so much )?for watching|link(s)? (is|are)? ?in the description|see you next time|don't forget to like)\b/gi;

/** Search YouTube and return the top result titles/URLs. */
export async function searchVideos(query, { max = 12 } = {}) {
  const browser = await chromium.launch(LAUNCH_ARGS);
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const results = await page.evaluate((n) => {
      const anchors = Array.from(document.querySelectorAll('a#video-title'));
      return anchors.slice(0, n).map(a => ({ title: a.getAttribute('title') || a.innerText, href: a.href }))
        .filter(r => r.href && r.href.includes('/watch'));
    }, max);
    return results.map(r => ({ ...r, videoId: new URL(r.href).searchParams.get('v') }));
  } finally {
    await browser.close();
  }
}

/**
 * Open a video page once; caller must close the returned browser when done.
 *
 * Viewport defaults to 2200x1400 — confirmed via real testing that YouTube's
 * responsive player scales with viewport size, giving a genuinely larger
 * decoded video render (~1577x887 at this size) rather than a fixed 960x540
 * regardless of window size. This matters for hitting real (not upscaled)
 * 1200px-class output for article/featured images — a bigger viewport means
 * more real source pixels to crop from, not fake upscaled ones.
 *
 * deviceScaleFactor defaults to 2 — found via real testing (2026-07-14) that
 * Playwright's default is 1 (one screenshot pixel per CSS pixel), which is
 * WHY our captured frames looked visibly softer than a manual screen
 * recording: a normal screen recording captures at the monitor's real pixel
 * density (usually 2x+ on modern displays), so it was never a "worse camera"
 * problem, it was an uncalibrated capture setting. Confirmed: same CSS video
 * box (1577x887) produced a 3154x1774 screenshot at deviceScaleFactor 2 —
 * genuinely double the real pixel data, verified visually (crisp individual
 * yarn strands and wood grain vs a visibly softer DPR-1 crop of the same
 * moment). Do not lower this back to 1 without re-testing.
 */
export async function openVideo(videoId, { viewport = { width: 2200, height: 1400 }, deviceScaleFactor = 2 } = {}) {
  const browser = await chromium.launch(LAUNCH_ARGS);
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('video')?.play());
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('video')?.pause());
  return { browser, page };
}

/**
 * Automatic face-detection pre-filter over a batch of already-captured image
 * files. Launches its own throwaway HEADLESS Chromium (decoupled from the
 * main anti-bot YouTube session in LAUNCH_ARGS — this never navigates to
 * YouTube, just runs a local WASM model against local image files) and loads
 * MediaPipe's FaceDetector (BlazeFace short-range) via CDN <script>/model
 * fetch, exactly like any third-party script a real page would load — no
 * Python, no GPU requirement, no paid API, no new npm dependency.
 *
 * Returns one entry per input path:
 * `{ path, hasFace, uncertain, detections }` — `hasFace: true` only above
 * FACE_CONFIDENT_THRESHOLD (treat as a hard stop); `uncertain: true` for
 * detections between the two thresholds (real face OR a false-positive
 * object — glance at it, don't auto-reject); below FACE_UNCERTAIN_THRESHOLD
 * is dropped entirely as noise. Each surviving detection has a confidence
 * `score` (0..1) and a pixel `box` ({ originX, originY, width, height }) in
 * the image's own coordinates — useful for cropping the face out rather than
 * discarding the whole frame, same as the skill file's existing "crop it
 * out" guidance.
 */
export async function detectFaces(imagePaths) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    const ready = await page.evaluate(async ({ version, modelUrl }) => {
      try {
        const vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`);
        const filesetResolver = await vision.FilesetResolver.forVisionTasks(
          `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`
        );
        window.__faceDetector = await vision.FaceDetector.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: modelUrl },
          runningMode: 'IMAGE',
        });
        return true;
      } catch (e) {
        window.__faceDetectorError = String(e && e.stack || e);
        return false;
      }
    }, { version: TASKS_VISION_VERSION, modelUrl: FACE_MODEL_URL });

    if (!ready) {
      const err = await page.evaluate(() => window.__faceDetectorError);
      throw new Error(`detectFaces: failed to load MediaPipe FaceDetector — ${err}`);
    }

    const results = [];
    for (const imagePath of imagePaths) {
      const buf = await readFile(imagePath);
      const ext = imagePath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
      const b64 = buf.toString('base64');
      const detections = await page.evaluate(async ({ b64, ext }) => {
        const img = new Image();
        const loaded = new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
        img.src = `data:image/${ext};base64,${b64}`;
        await loaded;
        const res = window.__faceDetector.detect(img);
        return res.detections.map(d => ({
          score: d.categories?.[0]?.score ?? null,
          box: d.boundingBox,
        }));
      }, { b64, ext });
      const kept = detections.filter(d => (d.score ?? 0) >= FACE_UNCERTAIN_THRESHOLD);
      const hasFace = kept.some(d => (d.score ?? 0) >= FACE_CONFIDENT_THRESHOLD);
      results.push({ path: imagePath, hasFace, uncertain: !hasFace && kept.length > 0, detections: kept });
    }
    return results;
  } finally {
    await browser.close();
  }
}

/** Basic legitimacy signals: title, author, view count, description, captions. */
export async function getVideoMeta(page) {
  return page.evaluate(() => {
    const pr = window.ytInitialPlayerResponse;
    const vd = pr?.videoDetails || {};
    return {
      title: vd.title,
      author: vd.author,
      lengthSeconds: Number(vd.lengthSeconds || 0),
      viewCount: Number(vd.viewCount || 0),
      shortDescription: (vd.shortDescription || '').slice(0, 400),
      hasCaptions: (pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).length > 0,
    };
  });
}

/** Real YouTube chapters (auto-generated or creator-set), if any. */
export async function getChapters(page) {
  return page.evaluate(() => {
    const idata = window.ytInitialData;
    const panels = idata?.engagementPanels || [];
    const panel = panels.find(p => JSON.stringify(p).includes('macroMarkersListItemRenderer'));
    if (!panel) return [];
    const items = panel.engagementPanelSectionListRenderer?.content?.macroMarkersListRenderer?.contents || [];
    return items.map(it => it.macroMarkersListItemRenderer).filter(Boolean).map(r => ({
      title: r.title?.simpleText,
      time: r.timeDescription?.simpleText,
      startSeconds: r.onTap?.watchEndpoint?.startTimeSeconds ?? null,
    }));
  });
}

/** Scrape the transcript panel — timestamped segments with real caption text. */
export async function getTranscript(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('tp-yt-paper-button#expand, #expand, ytd-text-inline-expander tp-yt-paper-button');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const target = all.find(el => el.children.length === 0 && /afficher la transcription|show transcript/i.test(el.textContent || ''));
    if (!target) return 'not found';
    let node = target;
    for (let i = 0; i < 5 && node; i++) {
      if (node.tagName === 'BUTTON' || node.getAttribute?.('role') === 'button') { node.click(); return; }
      node = node.parentElement;
    }
    target.click();
  });
  await page.waitForTimeout(1500);
  const raw = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
    return els.map(el => ({
      time: el.querySelector('.segment-timestamp')?.innerText?.trim(),
      text: el.querySelector('.segment-text')?.innerText?.trim(),
    }));
  });
  // dedupe (the panel can double-render on some layouts) and parse "m:ss" -> seconds
  const seen = new Set();
  const segments = [];
  for (const s of raw) {
    const key = s.time + '|' + s.text;
    if (seen.has(key) || !s.time) continue;
    seen.add(key);
    const parts = s.time.split(':').map(Number);
    const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    segments.push({ time: s.time, seconds, text: s.text || '' });
  }
  return segments;
}

/**
 * Score a video's step-coverage completeness from its transcript + chapters.
 * Cheap, regex-based — no ML. Returns a 0..1 score plus the signals used.
 */
export function scoreStepCoverage({ segments, chapters, lengthSeconds }) {
  const fullText = segments.map(s => s.text).join(' ');
  const markerMatches = fullText.match(SEQUENCE_MARKERS) || [];
  const minutes = Math.max(lengthSeconds / 60, 0.5);
  const markerDensity = markerMatches.length / minutes; // markers per minute

  // Distribution: which deciles of the video have at least one marker?
  const deciles = new Set();
  for (const seg of segments) {
    if (SEQUENCE_MARKERS.test(seg.text)) {
      SEQUENCE_MARKERS.lastIndex = 0;
      deciles.add(Math.min(9, Math.floor((seg.seconds / lengthSeconds) * 10)));
    }
  }
  const distributionScore = deciles.size / 10;

  // Chapter quality: real chapters, reasonable count, not just Intro/Outro
  const procedural = chapters.filter(c => !/^(intro|outro)$/i.test(c.title || ''));
  const chapterScore = chapters.length === 0 ? 0 : Math.min(1, procedural.length / 4);

  // Has a real completion cue anywhere (some evidence of an actual finished-result moment)
  const hasCompletionCue = COMPLETION_CUES.test(fullText);
  COMPLETION_CUES.lastIndex = 0;

  const densityScore = Math.min(1, markerDensity / 3); // ~3 markers/min = good tutorial pacing

  const score =
    0.35 * densityScore +
    0.30 * distributionScore +
    0.25 * chapterScore +
    0.10 * (hasCompletionCue ? 1 : 0);

  return {
    score: Math.round(score * 100) / 100,
    signals: {
      markerCount: markerMatches.length,
      markerDensityPerMin: Math.round(markerDensity * 10) / 10,
      distributionDeciles: deciles.size,
      chapterCount: chapters.length,
      proceduralChapterCount: procedural.length,
      hasCompletionCue,
    },
  };
}

/**
 * Find the likely "finished result" window from transcript completion cues,
 * anchored before the real outro. Falls back to the last 20% of the video.
 *
 * Two false-positive traps this deliberately avoids (found via real testing):
 *  1. Creators often plug "subscribe"/"link in the description" MID-video,
 *     not just at the true end — an outro cue is only trusted if it falls in
 *     the last 30% of the runtime, otherwise it's ignored as a mid-video plug.
 *  2. A completion cue early in the video (e.g. finishing a sub-step, or a
 *     multi-project video finishing project #1 of 2) is not the final
 *     result — only completion cues in the last 40% of the runtime are
 *     considered as real "final result" anchors.
 */
export function findCompletionWindow(segments, lengthSeconds) {
  const lateOutroHits = segments.filter(s => s.seconds >= lengthSeconds * 0.7 && OUTRO_CUES.test(s.text));
  OUTRO_CUES.lastIndex = 0;
  const searchEnd = lateOutroHits.length ? lateOutroHits[0].seconds : lengthSeconds;

  const lateCompletionHits = segments.filter(s =>
    s.seconds >= lengthSeconds * 0.4 && s.seconds < searchEnd && COMPLETION_CUES.test(s.text));
  COMPLETION_CUES.lastIndex = 0;

  if (lateCompletionHits.length > 0) {
    const anchor = lateCompletionHits[lateCompletionHits.length - 1].seconds;
    return { start: Math.max(0, anchor), end: Math.min(searchEnd, anchor + 20), anchor: 'completion-cue' };
  }
  // fallback: last 20% of the (pre-outro) video
  const start = Math.max(0, searchEnd - lengthSeconds * 0.2);
  return { start, end: searchEnd, anchor: 'fallback-last-20pct' };
}

/** Force best available quality + hard-disable captions so they never get burned into a screenshot. */
export async function prepPlayerForFrameGrabs(page) {
  const quality = await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    const levels = player.getAvailableQualityLevels();
    const best = levels[0];
    player.setPlaybackQualityRange(best, best);
    return best;
  });
  const captionsDisabled = await page.evaluate(() => {
    const player = document.getElementById('movie_player');
    if (player?.isSubtitlesOn && player.isSubtitlesOn()) { player.unloadModule('captions'); return true; }
    return false;
  });
  await page.waitForTimeout(1000);
  return { quality, captionsDisabled };
}

async function seekAndScreenshot(page, t, outPath) {
  await page.evaluate((tt) => new Promise((resolve) => {
    const v = document.querySelector('video');
    const onSeeked = () => {
      v.removeEventListener('seeked', onSeeked);
      v.play().then(() => setTimeout(() => { v.pause(); resolve(); }, 200)).catch(() => resolve());
    };
    v.addEventListener('seeked', onSeeked);
    v.currentTime = tt;
  }), t);
  // Move the mouse off the player and force-hide the native control chrome —
  // otherwise the play/pause nudge above can leave YouTube's own UI (play
  // button, timestamp, settings icons) baked into the screenshot. Found via
  // real testing: a captured frame had "2:16 / 3:02" and player buttons
  // visible over the actual video content.
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const chrome = document.querySelector('.ytp-chrome-bottom, .ytp-gradient-bottom, .ytp-large-play-button');
    document.querySelectorAll('.ytp-chrome-bottom, .ytp-gradient-bottom, .ytp-gradient-top, .ytp-large-play-button-bg')
      .forEach(el => { el.style.opacity = '0'; el.style.transition = 'none'; });
  });
  await page.waitForTimeout(300);
  await page.locator('video').first().screenshot({ path: outPath });
}

async function sharpnessScore(path) {
  const { data } = await sharp(path).greyscale()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw().toBuffer({ resolveWithObject: true });
  let sum = 0, sumSq = 0;
  for (let i = 0; i < data.length; i++) { sum += data[i]; sumSq += data[i] * data[i]; }
  const mean = sum / data.length;
  return sumSq / data.length - mean * mean;
}

/**
 * Composition heuristic (added 2026-07-14 — the "blur-only ranking picks
 * technically-sharp-but-ugly frames" problem, confirmed live on posts #6826/
 * #6833). This is NOT a neural aesthetic model (CLIP/NIMA) — that would mean
 * downloading and running a large external model, and the owner explicitly
 * does not want any AI-generated/AI-touched imagery on the site, so this
 * stays a plain pixel-math heuristic over the real, unmodified frame:
 *
 *  - centrality: is visual detail/energy concentrated toward the middle of
 *    the frame rather than the edges? A subject that's centered and a clean
 *    (low-detail) border scores higher than a frame where the "interesting"
 *    content is clipped at the edge (a strong sign of a bad crop/off-center
 *    subject) or the border is just as busy as the middle (cluttered
 *    background).
 *  - contrast: plain intensity spread — penalizes flat, washed-out,
 *    low-light frames in favor of ones with real tonal range.
 *
 * Cheap (resizes to 160x160 first), no external model, no network call —
 * just a better proxy than blur alone for "does this look like a deliberate,
 * clean shot," not a substitute for the mandatory human visual check.
 */
async function compositionScore(path) {
  const size = 160;
  const { data } = await sharp(path).resize(size, size, { fit: 'fill' }).greyscale()
    .raw().toBuffer({ resolveWithObject: true });
  const w = size, h = size;
  const energy = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const right = x + 1 < w ? data[i + 1] : data[i];
      const down = y + 1 < h ? data[i + w] : data[i];
      energy[i] = Math.abs(data[i] - right) + Math.abs(data[i] - down);
    }
  }
  const cx0 = Math.floor(w * 0.2), cx1 = Math.ceil(w * 0.8);
  const cy0 = Math.floor(h * 0.2), cy1 = Math.ceil(h * 0.8);
  let centerSum = 0, centerN = 0, borderSum = 0, borderN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = energy[y * w + x];
      if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) { centerSum += e; centerN++; }
      else { borderSum += e; borderN++; }
    }
  }
  const centerMean = centerSum / centerN, borderMean = borderSum / borderN;
  const centrality = centerMean / (centerMean + borderMean + 1e-6);

  let sum = 0, sumSq = 0;
  for (let i = 0; i < data.length; i++) { sum += data[i]; sumSq += data[i] * data[i]; }
  const mean = sum / data.length;
  const variance = Math.max(sumSq / data.length - mean * mean, 0);
  const contrast = Math.min(1, Math.sqrt(variance) / 90); // ~90 std-dev ≈ well-lit, capped at 1

  return { centrality, contrast };
}

/**
 * Exposure heuristic — mean brightness against a well-lit midpoint (~130/255).
 * Unlike raw sharpness (not comparable across videos/resolutions, see the
 * skill file's "known failure modes"), this is normalized to a fixed 0..255
 * scale independent of source resolution, so — like `contrast` in
 * compositionScore() — it IS a valid absolute floor, not just a within-batch
 * ranker. Flags frames that are washed out or too dark to read real detail in.
 */
async function exposureScore(path) {
  const { data } = await sharp(path).resize(160, 160, { fit: 'fill' }).greyscale()
    .raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  const score = Math.max(0, 1 - Math.abs(mean - 130) / 130);
  return { mean: Math.round(mean), score: Math.round(score * 1000) / 1000 };
}

// Absolute floors (not relative to the batch) — contrast and exposure are
// both normalized to a fixed scale regardless of source resolution/quality,
// so unlike raw sharpness they can flag "every candidate here is genuinely
// weak" instead of only ever comparing candidates to each other. A frame
// below either floor is marked lowConfidence: true so the caller sees an
// explicit signal instead of silently accepting the best of a bad batch.
const LOW_CONFIDENCE_CONTRAST = 0.20;
const LOW_CONFIDENCE_EXPOSURE = 0.35;

/**
 * Photographic enhancement pass — auto-levels (stretch contrast to the full
 * range), a mild saturation/brightness lift, and two-stage sharpening (a
 * small-sigma pass for fine detail, a larger low-amount pass for broad
 * "clarity") — pure pixel math, no AI upscaling/generation model, consistent
 * with the owner's no-AI-touched-imagery rule. Source videos vary wildly in
 * camera/lighting; this gives every shipped image a consistent, deliberate
 * "finished photo" look instead of a flat raw screenshot. `hero: true` applies
 * a stronger lift, meant only for the one featured/cover image per article.
 */
function applyEnhancement(img, { hero = false } = {}) {
  img = img.normalize().modulate({ saturation: hero ? 1.18 : 1.08, brightness: 1.02 });
  img = img.sharpen({ sigma: 0.6 }).sharpen({ sigma: 3, m1: 0.25, m2: 0.25 });
  if (hero) img = img.linear(1.05, -8); // small extra contrast punch, cover image only
  return img;
}

/**
 * Fetch the real YouTube thumbnail, checking actual pixel dimensions rather
 * than trusting HTTP status — YouTube serves a ~120x90 grey placeholder with
 * a 200 OK (not a 404) for a size that doesn't exist for a given video, so a
 * naive "response.ok" check would silently accept a blank tile. Tries
 * maxresdefault → sddefault → hqdefault, in quality order.
 */
export async function fetchThumbnail(videoId, outPath) {
  for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
    try {
      const res = await fetch(`https://img.youtube.com/vi/${videoId}/${name}.jpg`);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();
      if (meta.width >= 480) {
        await sharp(buf).toFile(outPath);
        return { quality: name, path: outPath, width: meta.width, height: meta.height };
      }
    } catch { /* try the next size */ }
  }
  return null;
}

/**
 * Build ONE ranked list of hero/featured-image candidates — the real YouTube
 * thumbnail AND the best extracted "finished result" frames, scored the same
 * way (sharpness + composition + exposure) — instead of a blind "always
 * prefer the thumbnail" rule. A thumbnail can still be a bad photo (dim,
 * off-center, heavy text overlay); this surfaces that as a visible, ranked
 * choice. The agent still MUST visually pick from these, same as any other
 * frame — this ranks candidates, it does not replace the manual check.
 */
export async function getHeroCandidates(page, videoId, completionWindow, outPathPrefix) {
  const candidates = [];
  const thumb = await fetchThumbnail(videoId, `${outPathPrefix}_thumb.jpg`);
  if (thumb) {
    const sharpness = await sharpnessScore(thumb.path);
    const { centrality, contrast } = await compositionScore(thumb.path);
    const { score: exposure, mean: exposureMean } = await exposureScore(thumb.path);
    candidates.push({ source: 'thumbnail', quality: thumb.quality, path: thumb.path, sharpness, centrality, contrast, exposure, exposureMean });
  }
  const mid = (completionWindow.start + completionWindow.end) / 2;
  const frames = await grabBestFrames(page, mid, `${outPathPrefix}_frame`, { keepTop: 3 });
  for (const f of frames) candidates.push({ source: 'frame', ...f });

  const maxSharp = Math.max(...candidates.map(c => c.sharpness), 1);
  for (const c of candidates) {
    const sharpNorm = c.sharpness / maxSharp;
    c.score = Math.round((0.30 * sharpNorm + 0.28 * c.centrality + 0.14 * c.contrast + 0.28 * c.exposure) * 1000) / 1000;
    c.lowConfidence = c.contrast < LOW_CONFIDENCE_CONTRAST || c.exposure < LOW_CONFIDENCE_EXPOSURE;
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Grab candidate frames spread across a WIDE window around `baseSeconds` (not
 * a tight sub-second cluster — composition/framing changes over whole
 * seconds as hands/camera move, not milliseconds, so a tight burst gives the
 * ranker near-duplicate options with nothing real to choose between; see
 * SKILL.md's "hero image" section for the incident this fixes). Each frame
 * gets a composite score — sharpness (blur rejection) blended with the
 * composition heuristic above (centered subject, clean border, real
 * contrast) — and the TOP N by that composite score are returned, NOT just
 * one and NOT ranked by sharpness alone.
 *
 * The caller (agent) must STILL visually check the winner for faces/actual
 * composition/caption-match before accepting it — this scoring surfaces
 * better raw candidates, it does not replace the mandatory human-in-the-loop
 * visual check.
 */
export async function grabBestFrames(page, baseSeconds, outPathPrefix, {
  offsets = [-2, -1.2, -0.4, 0.4, 1.2, 2, 2.8, 3.6, 4.6, 5.6],
  keepTop = 4,
} = {}) {
  const candidates = [];
  for (const off of offsets) {
    const t = Math.max(0, baseSeconds + off);
    const path = `${outPathPrefix}_${off.toFixed(1)}.png`;
    await seekAndScreenshot(page, t, path);
    const sharpness = await sharpnessScore(path);
    const { centrality, contrast } = await compositionScore(path);
    const { score: exposure, mean: exposureMean } = await exposureScore(path);
    candidates.push({ t, path, sharpness: Math.round(sharpness), centrality, contrast, exposure, exposureMean });
  }
  const maxSharp = Math.max(...candidates.map(c => c.sharpness), 1);
  for (const c of candidates) {
    const sharpNorm = c.sharpness / maxSharp;
    c.score = Math.round((0.40 * sharpNorm + 0.28 * c.centrality + 0.16 * c.contrast + 0.16 * c.exposure) * 1000) / 1000;
    // Sharpness is only ever comparable WITHIN this batch (sharpNorm always
    // peaks at 1 for the winner, even in an all-blurry batch) — contrast and
    // exposure are the two absolute floors, see their definitions above.
    c.lowConfidence = c.contrast < LOW_CONFIDENCE_CONTRAST || c.exposure < LOW_CONFIDENCE_EXPOSURE;
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, keepTop);
}

/**
 * COARSE-TO-FINE stage 1: sample sparse frames (default every 5s) across a
 * wide time range so the agent can quickly scan a whole step/chapter's real
 * footage and spot where the actual action is, instead of guessing one
 * timestamp blind. Return these to the agent to review BEFORE spending time
 * on dense sharpness-scored sampling — narrow to the right few seconds first,
 * then call grabBestFrames() or grabTriplet() only in that narrow window.
 * Keep this cheap: no scoring here, just capture + return paths.
 */
export async function sampleCoarse(page, startSeconds, endSeconds, outPathPrefix, { intervalSeconds = 5 } = {}) {
  const frames = [];
  for (let t = startSeconds; t <= endSeconds; t += intervalSeconds) {
    const path = `${outPathPrefix}_${t.toFixed(1)}.png`;
    await seekAndScreenshot(page, t, path);
    frames.push({ t, path });
  }
  return frames;
}

/**
 * FRAME TRIPLET: grab the frame BEFORE, AT, and AFTER a candidate timestamp
 * so the agent can judge it in temporal context instead of in isolation —
 * this is how to tell "action in progress" vs "about to happen" vs "already
 * done," and how to catch a transition-ghosting artifact (compare the middle
 * frame against both neighbors; if it looks like neither, it's likely a
 * cut/dissolve remnant, not a real moment — reject and try a different t).
 */
export async function grabTriplet(page, t, outPathPrefix, { gap = 0.4 } = {}) {
  const times = [
    { label: 'before', t: Math.max(0, t - gap) },
    { label: 'middle', t },
    { label: 'after', t: t + gap },
  ];
  const frames = [];
  for (const { label, t: tt } of times) {
    const path = `${outPathPrefix}_${label}.png`;
    await seekAndScreenshot(page, tt, path);
    frames.push({ label, t: tt, path });
  }
  return frames;
}

// Standard output sizes (owner decision 2026-07-10) — all landscape, matched
// to real web/SEO/OG conventions rather than mobile-portrait cropping:
//  - IN-ARTICLE images: 3:2 (1200x800) or 4:3 (1200x900)
//  - FEATURED/cover image: ~1.91:1 (1200x630, standard Facebook/Twitter OG
//    size) or 16:9 (1600x900)
export const ARTICLE_SIZES = {
  threeTwo: { width: 1200, height: 800 },
  fourThree: { width: 1200, height: 900 },
  // Square 1024x1024 — for contexts that need a 1:1 crop (e.g. Pinterest-style
  // tiles), added 2026-07-14. Not part of the landscape-only in-article policy
  // above; use only where a square is explicitly called for.
  square: { width: 1024, height: 1024 },
};
export const FEATURED_SIZES = {
  og: { width: 1200, height: 630 },
  wide: { width: 1600, height: 900 },
};

/**
 * Resize/crop a video-frame screenshot to an exact target size, then apply
 * the photographic enhancement pass (see applyEnhancement above) by default.
 * Uses fit:'cover' (crop to fill, no distortion) — requires the source frame
 * be captured at a large enough viewport (see openVideo's 2200x1400 default)
 * so this is a real crop/mild-downscale, not an upscale fabricating detail.
 * Always check the source composition first: a centered subject crops
 * cleanly, a wide two-element composition can lose one side.
 *
 * Enhancement runs AFTER resize (not before) so the unsharp-mask radius is
 * tuned to the actual output pixel dimensions, not the larger raw capture.
 * Pass `enhance: false` to get a plain untouched resize (e.g. for A/B
 * comparison); pass `hero: true` for the one featured/cover image per
 * article to get the stronger saturation/contrast lift.
 */
export async function resizeToTarget(inputPath, outputPath, { width, height, enhance = true, hero = false } = {}) {
  const meta = await sharp(inputPath).metadata();
  if (meta.width < width || meta.height < height) {
    // still works, but flags the caller that this will upscale — capture at
    // a larger viewport instead if this warning shows up.
    console.warn(`[youtube-video] resizeToTarget: source ${meta.width}x${meta.height} is smaller than target ${width}x${height} — this will upscale`);
  }
  let img = sharp(inputPath).resize(width, height, { fit: 'cover', position: 'attention' });
  if (enhance) img = applyEnhancement(img, { hero });
  await img.toFile(outputPath);
  return { width, height, enhanced: enhance };
}

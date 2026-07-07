/**
 * GRAPH HUNT — find exactly which network call carries the single-keyword
 * "Interest over time" curve, then test every replay strategy:
 *   A) identify the carrier call (full URL + headers + POST body)
 *   B) in-page fetch replay, exact
 *   C) in-page fetch with a SUBSTITUTED keyword (generality test)
 *   D) ctx.request replay (no page at all), exact
 *   E) ctx.request with substituted keyword
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { activeProfileDir } from '../src/shared/profiles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'sniff', 'graph-hunt');
mkdirSync(OUT, { recursive: true });

const KW = 'peach cobbler';
const SUB = 'banana bread';   // substitution target
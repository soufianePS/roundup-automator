/**
 * Logger — console + in-memory buffer (for the dashboard) + DURABLE file sink.
 *
 * Improvement over recipe-automator's logger, which was in-memory only (no file):
 * here every line is also appended to data/logs/app-YYYY-MM-DD.log so a run can be
 * reviewed after the fact (post-mortem on failures — the thing we wanted).
 */
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', '..', 'data', 'logs');

const COLORS = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', gray: '\x1b[90m' };
const MAX_LOGS = 1000;
const _buffer = []; // in-memory, for the dashboard

function _fileName() {
  const d = new Date();
  return `app-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.log`;
}

function _persist(level, text) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, _fileName()), `${new Date().toISOString()} ${level.toUpperCase()} ${text}\n`);
  } catch { /* never let logging break the app */ }
}

function _log(level, color, label, msg, args, toStderr = false) {
  const text = [msg, ...args].map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const time = new Date().toLocaleTimeString();
  (toStderr ? console.error : console.log)(`${COLORS.gray}[${time}]${color} ${label} ${COLORS.reset}${text}`);
  _buffer.push({ level, text, ts: Date.now() });
  if (_buffer.length > MAX_LOGS) _buffer.splice(0, _buffer.length - MAX_LOGS);
  _persist(level, text);
}

export const Logger = {
  info(msg, ...a) { _log('info', COLORS.blue, 'INFO', msg, a); },
  success(msg, ...a) { _log('success', COLORS.green, 'OK  ', msg, a); },
  warn(msg, ...a) { _log('warn', COLORS.yellow, 'WARN', msg, a); },
  error(msg, ...a) { _log('error', COLORS.red, 'ERR ', msg, a, true); },
  step(phase, msg, ...a) { _log('step', COLORS.magenta, `STEP[${phase}]`, msg, a); },
  debug(msg, ...a) { if (process.env.DEBUG) _log('debug', COLORS.gray, 'DBG ', msg, a); },
  getLogs() { return _buffer; },
  clearLogs() { _buffer.length = 0; },
};

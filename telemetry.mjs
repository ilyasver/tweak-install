// installer/telemetry.mjs
// THE INSTALLER'S OWN REPORTS (tracker u-mwddslwo119, 2026-11-15). The installed app reports its errors and timings
// (scripts/lib/telemetry.mjs), but no tester had sent one event in 8 days: either they did not use Tweak, or their
// install failed before Tweak ever ran, and nothing said which. Now the install says how far it got: started, each
// step's time, the step that failed with the first line of its error, and finished with its total time.
//
// Downloaded beside page.mjs before Tweak exists, so it cannot import the app's sender: Node built-ins only. It keeps
// the app's Panorama address, artifact and message shape, and the app's cleaning (first line, home folder as "~",
// redactSecrets). src/__tests__/installerTelemetry.test.ts holds the copies equal to scripts/lib.
//
// Two ways in, both from the installer's own processes:
//   node telemetry.mjs "install step" step=packages ms=184000     from install.sh, in the background (tell)
//   tellInstall('install finished', { ms })                        from page.mjs
//
// What it never sends: a file's contents, a token, the GitHub login, a path with the home folder in it. A failed
// step's line is the first line of that step's output that says what failed, cleaned. The tester is a hash of the
// login (the app's testerId), known once the sign-in wrote ~/Tweak/.signin.json; before that the install's own
// random id (TWEAK_INSTALL_ID) is the only id.
//
// What it costs: nothing the install waits for. Each report is one POST with a 4-second limit, from a process the
// install never waits on. Offline, at most QUEUE_MAX reports wait in a small file and leave with the next one.
//
// Who sends: install.sh decides once (TWEAK_INSTALL_CHANNEL): "installer" for a person's install from GitHub, "lab"
// for a local or test run that asked for it (TWEAK_TELEMETRY=1 or TWEAK_TELEMETRY_CHANNEL=lab), nothing otherwise.
// Without that setting nothing is sent, so tests and an old install.sh never send.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** The app's Panorama address and name (scripts/lib/telemetry.mjs): installs land beside the app's own events. */
export const PANORAMA_URL = 'https://panorama.wixapps.net/api/v1/bulklog';
export const ARTIFACT = 'com.wixpress.tweak.tweak-app';
export const SEND_TIMEOUT_MS = 4_000;
export const QUEUE_MAX = 20;
export const CHANNELS = new Set(['installer', 'lab']);
/** The installer's whole vocabulary, with each report's kind. Any other name is not sent. */
export const EVENTS = {
  'install started': 'usage',
  'install step': 'timing',
  'install finished': 'timing',
  'install failed': 'error',
  'install signin refused': 'usage',
};
const MESSAGE_MAX = 300;
const VALUE_MAX = 120;
const LOG_READ_MAX = 1024 * 1024;
const NUMBERS = new Set(['ms', 'exit']);

/* ---------- the app's cleaning, copied (scripts/lib/redact-secrets.mjs and cleanText in scripts/lib/telemetry.mjs) ---------- */

const mark = (kind) => `[removed: ${kind}]`;
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
const SECRET_NAME = '[A-Za-z0-9_.-]*(?:secret|token|passwd|password|api[_-]?key|apikey|private[_-]?key|access[_-]?key|credentials?)[A-Za-z0-9_.-]*';
const SKIP_VALUE = /^(?:true|false|null|undefined|none|yes|no|\[removed: .*\]|\$\{[^}]*\}|\$[A-Z_][A-Z0-9_]*|<[^>]*>|x+|\*+|\.\.\.)$/i;
const RULES = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ['Claude key', /\bsk-ant-[A-Za-z0-9_-]{16,}/g],
  ['API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ['Stripe key', /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['AWS key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Google key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['Slack webhook', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g],
  ['sign-in token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
];

/** scripts/lib/redact-secrets.mjs, unchanged. */
export function redactSecrets(input, { values = [], home = os.homedir() } = {}) {
  let text = String(input ?? '');
  let removed = 0;
  const kinds = new Set();
  const hit = (kind) => { removed += 1; kinds.add(kind); return mark(kind); };
  for (const v of [...values].filter((x) => typeof x === 'string' && x.length >= 4).sort((a, b) => b.length - a.length)) {
    if (text.includes(v)) text = text.split(v).map((part, i) => (i === 0 ? part : hit('a value you typed') + part)).join('');
  }
  for (const [kind, re] of RULES) text = text.replace(re, () => hit(kind));
  text = text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, (_, scheme) => `${scheme}${hit('password in a link')}@`);
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/g, () => `Bearer ${hit('sign-in token')}`);
  text = text.replace(/\b(authorization|cookie|set-cookie|x-tweak-token|x-tweak-run-token|x-frontdive-token|x-frontdive-run-token|x-zarrow-token|x-zarrow-run-token|x-wixfront-token|x-wixfront-run-token|x-api-key)(\s*[:=]\s*)("?)([^\s"']{6,})/gi, (_, name, sep, q) => `${name}${sep}${q}${hit('header value')}`);
  text = text.replace(/([?&](?:token|access_token|api_key|apikey|key|secret|signature|sig|password|auth|code)=)([^&\s"'#]+)/gi, (_, k) => `${k}${hit('value in a link')}`);
  text = text.replace(new RegExp(`("${SECRET_NAME}"\\s*:\\s*)"([^"]*)"`, 'gi'), (m, k, v) => (SKIP_VALUE.test(v) || v.length < 4 ? m : `${k}"${hit('named secret')}"`));
  text = text.replace(new RegExp(`\\b(${SECRET_NAME})(\\s*[=:]\\s*)(["']?)([^\\s"',;]+)\\3`, 'gi'), (m, k, sep, q, v) => (SKIP_VALUE.test(v) || v.length < 6 || /^\d+(?:\.\d+)?$/.test(v) ? m : `${k}${sep}${q}${hit('named secret')}${q}`));
  text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, () => hit('email address'));
  text = text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => { const d = m.replace(/[ -]/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d) ? hit('card number') : m; });
  if (home && home.length > 1) text = text.split(home).join('~');
  return { text, removed, kinds: [...kinds] };
}

/* eslint-disable-next-line no-control-regex */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const CODE_FRAME = /^\s*(?:>\s*)?\d*\s*\|/;
const ONLY_MARKS = /^[\s^~]*$/;
const meaningful = (input) => String(input ?? '').replace(ANSI, '').split('\n').map((l) => l.trim()).filter((l) => l && !CODE_FRAME.test(l) && !ONLY_MARKS.test(l));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One line, cleaned the app's way (cleanText with lines 1): colours off, code frames dropped, home as "~", redactSecrets,
 * cut to `max`. Two more removals of the installer's own: a Basic sign-in header's value (git's clone header), and the
 * GitHub login and the Mac's user name as whole words, after the home folder is "~" (git says "denied to <login>"). Pure.
 */
export function cleanLine(input, { values = [], words = [], home = os.homedir(), max = MESSAGE_MAX } = {}) {
  let text = meaningful(input)[0] ?? '';
  if (home && home.length > 1) text = text.split(home).join('~');
  text = text.replace(/\b(basic)\s+[A-Za-z0-9+/=]{12,}/gi, (_, b) => `${b} ${mark('sign-in token')}`);
  text = redactSecrets(text, { values, home }).text;
  for (const w of words.filter((x) => typeof x === 'string' && x.length >= 3)) text = text.replace(new RegExp(`\\b${escapeRe(w)}\\b`, 'gi'), mark('name'));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Which line of a failed step's output says what failed: the first that names an error, else the last. Pure. */
const SAYS_FAILED = /\b(?:error|err!|fatal|failed|failure|denied|refused|not found|no such|cannot|could not|unable|timed out|timeout|E[A-Z]{4,}|E\d{3})\b/i;
const ONLY_WARNS = /^(?:npm warn|warning:|npm notice)/i;
export function errorLine(output) {
  const lines = meaningful(output).filter((l) => !ONLY_WARNS.test(l));
  return lines.find((l) => SAYS_FAILED.test(l)) ?? lines[lines.length - 1] ?? '';
}

/** The app's testerId: a hash of the GitHub login. `npm run telemetry -- who <login>` says which hash is whose. */
export const testerId = (login) => (login ? `gh-${crypto.createHash('sha256').update(`tweak-tester:${String(login).toLowerCase()}`).digest('hex').slice(0, 12)}` : null);

/** The app's transactionName: Panorama silently drops a transaction whose name has a space. */
export const transactionName = (name) => String(name ?? '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unnamed';

/** The variables Claude Code, the Claude app and CI set (the app's AGENT_MARKERS): an install an agent ran. */
const AGENT_MARKERS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_AGENT_SDK_VERSION', 'CI', 'GITHUB_ACTIONS'];
export const actorOf = (env) => (AGENT_MARKERS.some((k) => env[k]) ? 'agent' : 'person');

/** Short words and numbers under plain names, the app's cleanData. Pure. */
export function cleanData(data, clean) {
  const out = {};
  for (const [k, v] of Object.entries(data ?? {}).slice(0, 16)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) continue;
    if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000; }
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v) out[k] = cleanLine(v, { ...clean, max: k === 'line' ? MESSAGE_MAX : VALUE_MAX });
  }
  return out;
}

/** This install's facts: who, which install, which channel, from the environment install.sh set and the sign-in file. */
export function installBase({ env = process.env, home = os.homedir(), now = Date.now() } = {}) {
  const channel = CHANNELS.has(env.TWEAK_INSTALL_CHANNEL) && !env.VITEST && env.NODE_ENV !== 'test' ? env.TWEAK_INSTALL_CHANNEL : null;
  let login = null;
  try { const s = JSON.parse(fs.readFileSync(path.join(home, 'Tweak', '.signin.json'), 'utf8')); if (s?.ok && typeof s.wixAccount === 'string') login = s.wixAccount; } catch { /* not signed in yet */ }
  const install = /^[a-f0-9]{8,32}$/.test(env.TWEAK_INSTALL_ID ?? '') ? env.TWEAK_INSTALL_ID : crypto.randomBytes(8).toString('hex');
  const started = Number(env.TWEAK_INSTALL_STARTED);
  let user = null; try { user = os.userInfo().username; } catch { /* no user name */ }
  return {
    channel, install, startedAt: Number.isFinite(started) && started > 0 ? started : now,
    data: { channel, install, ...(login ? { tester: testerId(login) } : {}), actor: actorOf(env), ...(/^[a-f0-9]{7,12}$/.test(env.TWEAK_INSTALL_APP ?? '') ? { app: env.TWEAK_INSTALL_APP } : {}) },
    clean: { words: [login, user].filter(Boolean), home },
  };
}

/** One report as Panorama's message: the app's toPanorama shape, component "installer". Pure. */
export function installMessage(ev, base) {
  const kind = EVENTS[ev.name];
  const m = {
    fullArtifactId: ARTIFACT,
    componentId: 'installer',
    artifactVersion: 'installer',
    platform: 'standalone',
    sessionId: base.install,
    sessionTime: Math.max(0, Math.round(ev.at - base.startedAt)),
    logLevel: kind === 'error' ? 'ERROR' : 'INFO',
    message: `${kind} ${ev.name}`,
    data: { ...base.data, ...ev.data, event: kind, name: ev.name, at: new Date(ev.at).toISOString() },
  };
  if (kind === 'error') m.message = ev.data?.line ? `${ev.name}: ${ev.data.line}` : ev.name;
  else if (kind === 'timing') {
    m.transactionName = transactionName(ev.name);
    m.transactionAction = 'FINISH';
    m.transactionDuration = Math.max(0, Math.round(ev.ms));
  }
  return m;
}

/** The Mac's facts worth knowing next to a start or a failure: disk above all (Tweak's parts are about 4 GB). */
function macFacts(home) {
  const out = { arch: process.arch, cpus: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30), ...machineNow() };
  try { const s = fs.statfsSync(home); out.diskGb = Math.round((s.bavail * s.bsize) / 2 ** 30); } catch { /* unknown */ }
  return out;
}

/** How busy the Mac is now, in the app's fields (scripts/lib/telemetry.mjs machineStamp: the install is a graded key action, roadmap
 *  task 14): the 1- and 5-minute load per core and free memory. Sent with the start (before the install loads the Mac itself) and
 *  with the finish. Never throws. */
export function machineNow({ loadavg = () => os.loadavg(), cores = () => (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length), freemem = () => os.freemem() } = {}) {
  const out = {};
  try { const l = loadavg(); const n = cores(); if (n > 0) { if (Number.isFinite(l[0])) out.loadPerCpu = Math.round((l[0] / n) * 100) / 100; if (Number.isFinite(l[1])) out.load5PerCpu = Math.round((l[1] / n) * 100) / 100; } } catch { /* unknown */ }
  try { const f = freemem(); if (Number.isFinite(f)) out.freeMB = Math.round(f / 1048576); } catch { /* unknown */ }
  return out;
}

/**
 * Builds one report: `name` from EVENTS, `fields` from install.sh's key=value words or page.mjs. `ms` is a timing's
 * time; `log` + `from` name a failed step's output (read here, never sent); `exit` is a step's exit code. Returns
 * null for a name outside EVENTS or a timing with no time. Pure apart from reading the log.
 */
export function buildReport(name, fields, base, { now = Date.now(), home = os.homedir() } = {}) {
  const kind = EVENTS[name];
  if (!kind) return null;
  const { ms, log, from, ...rest } = fields ?? {};
  const data = { ...rest };
  /* The whole install's time, when the finish does not say it: from install.sh's start (TWEAK_INSTALL_STARTED). */
  const t = name === 'install finished' && !Number.isFinite(ms) ? now - base.startedAt : ms;
  if (kind === 'timing') { if (!Number.isFinite(t) || t < 0) return null; data.seconds = Math.round(t / 100) / 10; }
  if (name === 'install failed') data.seconds = Math.round((now - base.startedAt) / 100) / 10;
  if (log) {
    try {
      const fd = fs.openSync(log, 'r');
      try {
        const start = Math.max(0, Number(from) || 0);
        const buf = Buffer.alloc(Math.max(0, Math.min(LOG_READ_MAX, fs.fstatSync(fd).size - start)));
        fs.readSync(fd, buf, 0, buf.length, start);
        data.line = errorLine(buf.toString('utf8'));
      } finally { fs.closeSync(fd); }
    } catch { /* no log: the step and its reason still go */ }
  }
  const all = name === 'install started' || name === 'install failed' ? { ...macFacts(home), ...data } : name === 'install finished' ? { ...machineNow(), ...data } : data;
  return installMessage({ name, at: now, ms: t, data: cleanData(all, base.clean) }, base);
}

/* ---------- sending: one POST, a short limit, a small file when offline ---------- */

const queueFile = (home) => path.join(home, 'Tweak', 'installer', 'telemetry-queue.jsonl');

/** Takes what an earlier report could not send. Only one sender gets it: the file is renamed away first. */
function takeQueue(file) {
  const mine = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}`;
  try { fs.renameSync(file, mine); } catch { return []; }
  try { return fs.readFileSync(mine, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((m) => m?.fullArtifactId === ARTIFACT); } catch { return []; } finally { fs.rmSync(mine, { force: true }); }
}
function keepQueue(file, messages) {
  try {
    let old = [];
    try { old = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { /* none yet */ }
    const lines = [...old, ...messages.map((m) => JSON.stringify(m))].slice(-QUEUE_MAX);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
  } catch { /* a full disk loses the report, never the install */ }
}

/** Sends `messages` with what waits offline. Resolves true when Panorama took them; never rejects, never throws. */
export async function sendReports(messages, { home = os.homedir(), send = (u, init) => fetch(u, init), timeoutMs = SEND_TIMEOUT_MS } = {}) {
  const file = queueFile(home);
  const all = [...takeQueue(file), ...messages];
  if (!all.length) return true;
  try {
    const r = await send(PANORAMA_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: all }), signal: AbortSignal.timeout(timeoutMs) });
    if (!r?.ok) throw new Error(`Panorama answered ${r?.status}`);
    return true;
  } catch {
    keepQueue(file, all);
    return false;
  }
}

/** One report from page.mjs. Off (resolves false at once) unless install.sh set a channel. Never throws. */
export async function tellInstall(name, fields = {}, { env = process.env, home = os.homedir(), send } = {}) {
  try {
    const base = installBase({ env, home });
    if (!base.channel) return false;
    const m = buildReport(name, fields, base, { home });
    return m ? await sendReports([m], { home, send }) : false;
  } catch { return false; }
}

/** install.sh's words, key=value, as fields: ms and exit are numbers, true/false are yes/no, the rest stays text. Pure. */
export function parseWords(words) {
  const out = {};
  for (const w of words) {
    const i = String(w).indexOf('=');
    if (i <= 0) continue;
    const k = w.slice(0, i); const v = w.slice(i + 1);
    if (!v) continue;
    if (NUMBERS.has(k)) { const n = Number(v); if (Number.isFinite(n)) out[k] = n; }
    else if (k === 'from') out.from = Number(v) || 0;
    else if (v === 'true' || v === 'false') out[k] = v === 'true';
    else out[k] = v;
  }
  return out;
}

const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const [name, ...words] = process.argv.slice(2);
  await tellInstall(name, parseWords(words));
}

// installer/page.mjs
// THE ONE TWEAK PAGE A NEW PERSON SEES BEFORE TWEAK (Ilya 2026-10-24: "the tweak sign in ... than
// login with wix user and the app show a installing loading progress bar while it loads, than show
// the teams welcome page"). Served on 127.0.0.1:5169 by installer/install.sh, in Tweak's brand look.
// 1. Sign in: GitHub's own sign-in with the account the person uses for Wix; the code is shown the
//    moment gh prints it. That account must be an active member of wix-private, else nothing more
//    is downloaded. Tweak's two repo invitations (the app and the teams) are accepted for them.
// 2. Progress: the installer writes ~/Tweak/install-progress.json; this page draws it as a bar.
// 3. Open: Tweak opens in its own window on its teams step; this page says so and stops.
// Every failure names the next step. Node built-ins only: this runs before anything is installed.
// Public on purpose: no Wix code here.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TWEAK_REPOS = ['ilyasver/tweak-app', 'ilyasver/tweak-teams'];
export const CODE_RE = /[A-Z0-9]{4}-[A-Z0-9]{4}/;
const PORT = 5169;
const HOME = os.homedir();
const SIGNIN_FILE = path.join(HOME, 'Tweak', '.signin.json');
const PROGRESS_FILE = path.join(HOME, 'Tweak', 'install-progress.json');
const W = {
  title: 'Sign in to Tweak',
  line: 'Use the GitHub account you use for Wix work.',
  copyOpen: 'Copy the code and open GitHub',
  hint: 'On GitHub, paste the code, then press Authorize next to wix\u2011private.',
  waiting: 'Starting the sign-in…',
  waitingAuth: 'Waiting for you to press Authorize on GitHub…',
  copied: 'Code copied. Open GitHub again',
  promise: 'Design changes that land in the real product.',
  notWix: 'That GitHub account is not in Wix’s GitHub. Press Sign in again and use the account you use for Wix work.',
  notDone: 'The GitHub sign-in did not finish. Press Sign in again.',
  sso: 'On GitHub, press Authorize next to wix-private, then press Sign in again.',
  again: 'Sign in again',
  welcome: 'Welcome, {login}',
  vpn: 'Connect to the Wix VPN. Tweak carries on by itself once it is on.',
  open: 'Tweak is open in its own window. Press Install Tweak there, then choose your team.',
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ghRun = (args, { input, env = process.env, onData } = {}) => new Promise((resolve) => {
  const child = spawn('gh', args, { env });
  let out = '';
  const take = (b) => { const s = String(b); out += s; onData?.(s); };
  child.stdout.on('data', take); child.stderr.on('data', take);
  if (input !== undefined) { child.stdin.write(input); child.stdin.end(); }
  child.on('close', (code) => resolve({ ok: code === 0, out }));
});

export function readProgress(file = PROGRESS_FILE) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

/** Sign in (unless `already`), find the Wix account, accept Tweak's invitations. */
export async function signinSteps({ gh = ghRun, onCode, already = false }) {
  if (!already) {
    let shown = false;
    const r = await gh(['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'], {
      input: '\n',
      onData: (chunk) => { const code = chunk.match(CODE_RE)?.[0]; if (code && !shown) { shown = true; onCode?.(code); } },
    });
    if (!r.ok) return { ok: false, sentence: W.notDone };
  }
  const status = await gh(['auth', 'status', '--hostname', 'github.com']);
  const accounts = [...status.out.matchAll(/account (\S+)/g)].map((m) => m[1]);
  /* The active account, for a sign-in gh holds as a GH_TOKEN setting: gh cannot hand that one out by name. */
  const active = status.out.match(/account (\S+)[^\n]*\n\s*- Active account: true/)?.[1] ?? null;
  let wixAccount = null;
  let tok = '';
  let sso = false;
  for (const a of accounts) {
    const byName = await gh(['auth', 'token', '--hostname', 'github.com', '--user', a]);
    const t = (byName.ok ? byName : a === active ? await gh(['auth', 'token', '--hostname', 'github.com']) : byName).out.trim();
    const m = await gh(['api', 'user/memberships/orgs/wix-private', '--jq', '.state'], { env: { ...process.env, GH_TOKEN: t } });
    if (m.out.trim() === 'active') { wixAccount = a; tok = t; break; }
    if (!m.ok && /HTTP 403|SAML/.test(m.out)) sso = true;   // a member who has not allowed this sign-in for Wix yet
  }
  if (!wixAccount) return { ok: false, sentence: sso ? W.sso : W.notWix };
  const asWix = { env: { ...process.env, GH_TOKEN: tok } };
  const inv = await gh(['api', 'user/repository_invitations'], asWix);
  let list = []; try { list = JSON.parse(inv.out || '[]'); } catch { list = []; }
  for (const i of list) if (TWEAK_REPOS.includes(i.repository?.full_name)) await gh(['api', '-X', 'PATCH', `user/repository_invitations/${i.id}`], asWix);
  return { ok: true, wixAccount };
}

// The five letters of the Tweak wordmark (src/chrome/tweakWordmark.ts, without "by Wix"), white.
const WORDMARK = (h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 232 65" height="${h}" width="${Math.round(h * 232 / 65)}" role="img" aria-label="Tweak"><path fill="#FFFFFF" d="M19.8127 61.1677C15.3714 61.1677 12.0693 59.9565 9.90634 57.534C7.74338 55.1115 6.66191 51.3912 6.66191 46.3731V22.9267H0L0.173037 15.2265H4.49895C5.9986 15.2265 7.12334 14.9814 7.87316 14.4911C8.62299 14.0009 9.08442 13.1213 9.25745 11.8523L10.1226 5.19043H15.7463V15.2265H28.1184V23.0997H15.7463V46.1136C15.7463 48.363 16.2654 49.978 17.3037 50.9586C18.3419 51.9391 19.8704 52.4294 21.8891 52.4294C22.985 52.4294 24.0953 52.2996 25.2201 52.0401C26.3448 51.7805 27.4263 51.2758 28.4645 50.526V59.6104C26.7341 60.1872 25.148 60.591 23.706 60.8217C22.264 61.0524 20.9663 61.1677 19.8127 61.1677Z"/><path fill="#FFFFFF" d="M41.9612 60.2161H55.0255L63.5043 23.0997H64.629L73.1943 60.2161H86.2586L98.025 15.2266H88.4215L80.4618 52.4294H79.0775L70.0796 15.2266H58.3132L49.4883 52.4294H48.0175L39.9713 15.2266H30.2812L41.9612 60.2161Z"/><path fill="#FFFFFF" d="M119.742 14.1016C122.914 14.1016 125.755 14.6211 128.264 15.6592C130.773 16.6974 132.893 18.2688 134.623 20.374C136.353 22.4792 137.651 25.1037 138.517 28.2471C139.382 31.3905 139.698 35.0678 139.468 39.2783L107.283 39.5381C107.456 44.1524 108.61 47.642 110.744 50.0068C113.051 52.66 116.339 53.9863 120.607 53.9863C122.395 53.9863 123.924 53.7704 125.192 53.3379C126.461 52.9053 127.528 52.3283 128.394 51.6074C129.259 50.8864 129.966 50.0211 130.514 49.0117C131.062 48.0024 131.508 46.9494 131.854 45.8535L140.074 47.7568C139.555 49.8909 138.761 51.78 137.694 53.4238C136.627 55.0677 135.287 56.4816 133.672 57.6641C132.057 58.8464 130.168 59.7542 128.005 60.3887C125.842 61.0231 123.347 61.3408 120.521 61.3408C116.945 61.3408 113.772 60.8072 111.004 59.7402C108.235 58.6732 105.899 57.1442 103.996 55.1543C102.093 53.1644 100.65 50.771 99.6699 47.9736C98.6894 45.1763 98.1992 42.0183 98.1992 38.5C98.1992 34.9816 98.6894 31.737 99.6699 28.7666C100.65 25.7962 102.049 23.2152 103.866 21.0234C105.683 18.8317 107.932 17.1302 110.614 15.9189C113.296 14.7077 116.339 14.1016 119.742 14.1016ZM119.829 21.8018C117.291 21.8018 115.085 22.4503 113.21 23.748C111.335 25.0458 109.879 26.9349 108.841 29.415C108.322 30.6839 107.918 32.0971 107.63 33.6543L130.73 33.3945C130.673 31.5491 130.355 29.9056 129.778 28.4639C128.855 26.2145 127.529 24.5412 125.799 23.4453C124.069 22.3495 122.078 21.8018 119.829 21.8018Z"/><path fill="#FFFFFF" d="M163.348 14.1016C167.327 14.1016 170.615 14.7653 173.21 16.0918C175.806 17.4184 177.753 19.4517 179.051 22.1914C180.348 24.9311 180.997 28.4351 180.997 32.7031V41.874C180.997 43.7773 181.04 45.7816 181.127 47.8867C181.213 49.992 181.328 52.0978 181.473 54.2031C181.617 56.3083 181.804 58.3125 182.035 60.2158H173.47C173.297 58.4855 173.138 56.6973 172.994 54.8516C172.85 53.006 172.72 51.1317 172.604 49.2285H171.307C170.499 51.4201 169.36 53.4386 167.89 55.2842C166.419 57.1299 164.601 58.6014 162.438 59.6973C160.276 60.793 157.752 61.3408 154.868 61.3408C152.388 61.3408 150.168 60.8646 148.207 59.9131C146.246 58.9615 144.703 57.5341 143.578 55.6309C142.453 53.7275 141.891 51.3623 141.891 48.5361C141.891 46.2867 142.309 44.3401 143.146 42.6963C143.982 41.0524 145.251 39.6677 146.952 38.543C148.654 37.4183 150.831 36.4954 153.484 35.7744C156.138 35.0534 159.281 34.4332 162.915 33.9141C164.934 33.6257 166.592 33.3372 167.89 33.0488C169.187 32.7604 170.14 32.2995 170.745 31.665C171.351 31.0306 171.653 30.0784 171.653 28.8096C171.653 26.8486 170.976 25.1611 169.62 23.748C168.265 22.335 166.087 21.6289 163.088 21.6289C161.415 21.6289 159.757 21.9174 158.113 22.4941C156.47 23.0709 155.056 24.008 153.874 25.3057C152.692 26.6034 151.898 28.3483 151.494 30.54L143.016 27.8584C143.535 25.6668 144.371 23.72 145.524 22.0186C146.678 20.317 148.12 18.8748 149.851 17.6924C151.581 16.51 153.585 15.6154 155.863 15.0098C158.142 14.4041 160.637 14.1016 163.348 14.1016ZM170.354 37.8945C168.855 38.3559 167.24 38.716 165.51 38.9756C163.779 39.2351 162.063 39.5236 160.361 39.8408C158.66 40.158 157.103 40.5908 155.689 41.1387C154.276 41.6866 153.152 42.4511 152.315 43.4316C151.479 44.4122 151.061 45.7678 151.061 47.498C151.061 49.6319 151.724 51.2611 153.051 52.3857C154.377 53.5105 156.079 54.0732 158.155 54.0732C159.366 54.0732 160.592 53.8714 161.832 53.4678C163.072 53.064 164.313 52.4437 165.553 51.6074C166.793 50.7711 167.947 49.6898 169.014 48.3633C170.081 47.0367 171.018 45.4501 171.825 43.6045L171.738 37.375L170.354 37.8945Z"/><path fill="#FFFFFF" d="M194.937 0.0109544C194.925 9.39178 194.918 18.8152 194.917 27.9602C196.529 25.6202 198.299 23.5779 200.16 21.822C203.786 18.4026 207.738 16.0924 211.478 14.8053C215.016 13.5875 218.681 13.1843 221.773 13.9795L222.071 14.0604L222.171 14.0903C225.56 15.1494 228.18 17.2789 229.654 20.1489C231.109 22.9827 231.276 26.2063 230.405 29.1972C228.655 35.2148 222.879 40.1832 214.421 41.6132C213.931 41.7088 213.433 41.7829 212.931 41.839C214.093 43.207 215.222 44.5646 216.19 45.6499C220.362 50.3318 224.279 53.3904 230.402 52.9531L231.004 61.3879C220.814 62.1157 214.519 56.4845 209.877 51.2762C207.338 48.4268 205.749 46.2949 203.606 44.0682C201.676 42.0635 200.003 40.7995 198.304 40.195C198.208 40.1693 198.117 40.1443 198.031 40.1208C196.294 44.6206 195.125 50.0958 194.932 56.6843C194.933 57.938 194.935 59.1768 194.937 60.3995L186.481 60.413C186.481 60.1414 186.48 59.8688 186.48 59.5956L186.453 59.596C186.44 58.5748 186.449 57.5716 186.475 56.5865C186.453 39.5022 186.455 19.6576 186.481 0L194.937 0.0109544ZM219.705 22.1801C218.743 21.9207 216.832 21.9054 214.229 22.8011C211.675 23.6803 208.753 25.3426 205.962 27.9741C204.634 29.2267 203.33 30.7054 202.11 32.4304C203.309 32.7095 204.821 33.0178 206.425 33.236C208.866 33.5679 211.164 33.6416 212.832 33.3081L212.967 33.2836C218.969 32.2832 221.625 29.1076 222.286 26.8353C222.624 25.6737 222.488 24.7069 222.131 24.0112C221.797 23.3603 221.109 22.6325 219.705 22.1801Z"/></svg>`;
// Small line icons, the same drawings as Tweak's own (src/chrome/icons.tsx). Always beside words.
const ICONS = { clock: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7v5l3 2'], warning: ['M12 4l9 16H3l9-16z', 'M12 10v4', 'M12 17h.01'], check: ['M5 12l4 4L19 7'] };
const icon = (n) => `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[n].map((d) => `<path d="${d}"/>`).join('')}</svg>`;
const note = (n, text) => `<p class="note" role="status">${icon(n)}<span>${text}</span></p>`;
// The step dots of Tweak's welcome wizard: sign in, installing, open. The current one is long.
const dots = (at) => `<div class="steps">${[1, 2, 3].map((n) => `<span class="dot${n === at ? ' on' : ''}${n <= at ? ' done' : ''}" aria-hidden="true"></span>`).join('')}<span class="sr">Step ${at} of 3: ${['Sign in', 'Installing', 'Open'][at - 1]}</span></div>`;

const CSS = `
:root{--ink:#2C2D30;--body:#3E3F3B;--steel:#5B5C56;--paper:#F0F1EA;--panel:#F7F7F2;--dot:#CACBC0;--line:#E3E4DB}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr);place-items:center;padding:12px;background:var(--paper);font:16px/24px "Funnel Sans","Helvetica Neue",Helvetica,Arial,sans-serif;color:var(--ink)}
main{width:1000px;max-width:100%;min-height:560px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.brand{position:relative;overflow:hidden;isolation:isolate;border-radius:20px;color:#fff;display:flex;flex-direction:column;padding:32px;min-height:240px;background:#53699A}
.art{position:absolute;inset:-8%;z-index:-2;background:radial-gradient(60% 50% at 12% 0%,#634F9A 0%,transparent 72%),radial-gradient(65% 55% at 0% 100%,#2F3F58 0%,transparent 78%),radial-gradient(55% 45% at 100% 8%,#4E92C4 0%,transparent 70%),radial-gradient(70% 55% at 100% 100%,#A58AD1 0%,transparent 72%),radial-gradient(50% 40% at 60% 55%,#5B7FB8 0%,transparent 75%),#53699A}
.brand::after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background-image:radial-gradient(rgba(255,255,255,.34) 1.3px,transparent 1.5px);background-size:24px 24px;background-position:12px 12px;-webkit-mask-image:radial-gradient(closest-side,transparent 30%,#000 100%);mask-image:radial-gradient(closest-side,transparent 30%,#000 100%)}
.mark{flex:1;display:flex;align-items:center;justify-content:center}.mark svg{display:block}
.promise{margin:0;font-size:17px;line-height:24px;font-weight:500}
.side{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:48px 40px;border-radius:20px;background-color:var(--panel);background-image:radial-gradient(var(--dot) 1.2px,transparent 1.2px);background-size:24px 24px}
.col{width:100%;max-width:400px}
.steps{display:flex;align-items:center;gap:6px;margin-bottom:32px}.dot{width:8px;height:8px;border-radius:999px;background:var(--dot)}.dot.done{background:var(--ink)}.dot.on{width:24px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
h1{margin:0 0 12px;font:700 40px/1.05 "Funnel Display","Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:-.03em;color:var(--ink);overflow-wrap:anywhere}
.lede{margin:0 0 28px;color:var(--steel)}
.code{margin:8px 0 24px;font:500 40px/48px "Geist Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.12em;color:var(--ink);overflow-wrap:anywhere}
.hint{margin:16px 0 0;min-height:20px;font-size:14px;line-height:20px;color:var(--steel)}
.step{margin:0 0 12px;font:500 12px/16px "Geist Mono",ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--steel)}
.note{display:flex;align-items:flex-start;gap:8px;margin:16px 0 0;font-size:14px;line-height:20px;color:var(--body)}.note svg{flex:none;margin-top:2px;color:var(--steel)}
progress{display:block;width:100%;height:6px;border:0;border-radius:999px;overflow:hidden;appearance:none;-webkit-appearance:none;background:var(--line);color:var(--ink)}
progress::-webkit-progress-bar{background:var(--line);border-radius:999px}progress::-webkit-progress-value{background:var(--ink);border-radius:999px}progress::-moz-progress-bar{background:var(--ink);border-radius:999px}
.again{margin-top:20px}
button{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:52px;padding:8px 20px;border:0;border-radius:14px;background:var(--ink);color:#fff;font:500 14px/20px "Geist Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;cursor:pointer;transition:background-color .16s ease}
button:hover{background:#45464A}button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
@media(max-width:759px){main{grid-template-columns:1fr;min-height:0}.brand{min-height:0;padding:20px 24px}.mark{flex:none}.mark svg{height:32px;width:auto}.promise{display:none}.side{padding:32px 24px}.code{font-size:34px}h1{font-size:34px}}
@media(prefers-reduced-motion:reduce){button{transition:none}}`;

export function pageHtml(state) {
  const p = state.progress;
  let body;
  let at = 1;
  if (state.phase === 'code') {
    body = state.code
      ? `<h1>${W.title}</h1><p class="lede">${W.line}</p><p class="code" aria-label="Your one-time code">${esc(state.code)}</p>
         <button type="button" onclick="navigator.clipboard.writeText('${esc(state.code)}');window.open('https://github.com/login/device','_blank');this.textContent='${esc(W.copied)}'">${W.copyOpen}</button><p class="hint">${W.hint}</p>${note('clock', W.waitingAuth)}`
      : `<h1>${W.title}</h1>${note('clock', W.waiting)}`;
  } else if (state.phase === 'failed') {
    body = `<h1>${W.title}</h1>${note('warning', esc(state.sentence))}<div class="again"><button type="button" onclick="fetch('/again',{method:'POST'}).then(()=>location.reload())">${W.again}</button></div>`;
  } else {
    const title = state.login ? W.welcome.replace('{login}', esc(state.login)) : 'Tweak';
    at = 2;
    if (p?.open) { at = 3; body = `<h1>${title}</h1>${note('check', W.open)}`; }
    else if (p?.failed) body = `<h1>${title}</h1>${note('warning', esc(p.failed))}<p class="hint">${esc(p.next ?? '')}</p>`;
    else body = `<h1>${title}</h1>
      <p class="step">${esc(p?.step ?? 1)} of ${esc(p?.of ?? 5)} · ${esc(p?.label ?? 'Getting ready')}</p>
      <progress value="${esc(p?.pct ?? 0)}" max="100" aria-label="${esc(p?.label ?? 'Getting ready')}"></progress>
      ${p?.vpn ? note('warning', W.vpn) : `<p class="hint" aria-live="polite">${esc(p?.line ?? '')}</p>`}`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tweak</title><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Funnel+Display:wght@300..800&family=Funnel+Sans:wght@400..700&family=Geist+Mono:wght@400..600&display=swap" rel="stylesheet">
<style>${CSS}</style>
<script>const last=${JSON.stringify(JSON.stringify(state))};setInterval(()=>fetch("/state").then(r=>r.text()).then(t=>{if(t!==last)location.reload()}).catch(()=>{}),1200)</script>
</head><body><main><div class="brand"><div class="art" aria-hidden="true"></div><div class="mark">${WORDMARK(56)}</div><p class="promise">${W.promise}</p></div>
<div class="side"><div class="col">${dots(at)}${body}</div></div></main></body></html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let state = { phase: 'code', code: '' };
  const current = () => (state.phase === 'progress' ? { ...state, progress: readProgress() } : state);
  const server = http.createServer((req, res) => {
    if (req.url === '/state') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(current())); return; }
    if (req.url === '/again' && req.method === 'POST') { state = { phase: 'code', code: '' }; void run({ tryAlready: false }); res.end('{}'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(pageHtml(current()));
  }).listen(PORT, '127.0.0.1', () => { execFile('open', [`http://127.0.0.1:${PORT}`]); void run({ tryAlready: true }); });
  async function run({ tryAlready }) {
    fs.rmSync(SIGNIN_FILE, { force: true });
    const onCode = (code) => { state = { phase: 'code', code }; };
    /* The person pasted the line again: gh may already be signed in with an active wix-private
       member. Use that and skip GitHub's device sign-in. "Sign in again" always runs the full one. */
    let r = tryAlready ? await signinSteps({ already: true, onCode }) : { ok: false };
    if (!r.ok) r = await signinSteps({ onCode });
    if (!r.ok) { state = { phase: 'failed', sentence: r.sentence }; return; }
    state = { phase: 'progress', login: r.wixAccount };
    fs.mkdirSync(path.dirname(SIGNIN_FILE), { recursive: true });
    fs.writeFileSync(SIGNIN_FILE, JSON.stringify(r), { mode: 0o600 });
  }
  /* Stop a minute after Tweak opened, or after an hour whatever happens. */
  setInterval(() => { if (readProgress()?.open) setTimeout(() => process.exit(0), 60_000); }, 5000);
  setTimeout(() => process.exit(0), 3_600_000);
  process.on('SIGTERM', () => { server.close(); process.exit(0); });
}

/**
 * The consent page a location request links to.
 *
 * Self-contained HTML: no external assets, no analytics. The only thing it
 * does is explain what is about to happen, wait for an explicit button press,
 * read the browser geolocation, and post { lat, lon, accuracyM } back to the
 * same URL. A refusal to share (denied permission) sends an error instead of
 * a coordinate. The page is rendered server-side, so the token stays in the
 * URL and never in the HTML.
 */

const PAGE_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: #0b0f14; color: #d8dee9;
}
.card {
  width: min(520px, 92vw); padding: 28px; border: 1px solid #2a3441;
  border-radius: 12px; background: #10161f;
}
h1 { font-size: 1.05rem; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 16px; color: #8ab4ff; }
p { font-size: 0.9rem; line-height: 1.6; margin: 0 0 14px; color: #b7c1cf; }
code {
  display: inline-block; padding: 2px 8px; border-radius: 6px;
  background: #1a2430; color: #e5ecf5; font-size: 0.85rem;
}
.meta { font-size: 0.72rem; color: #7b8794; margin-bottom: 18px; }
button {
  width: 100%; padding: 12px 16px; margin-top: 6px; cursor: pointer;
  border: 1px solid #8ab4ff; border-radius: 8px; color: #0b0f14;
  background: #8ab4ff; font: inherit; font-weight: 700; letter-spacing: 0.04em;
}
button:disabled { opacity: 0.5; cursor: wait; }
button.deny { margin-top: 10px; background: transparent; color: #9aa7b5; border-color: #2a3441; }
#out { margin-top: 14px; font-size: 0.82rem; min-height: 1.2em; }
.ok { color: #7ee2a8; }
.err { color: #ff8a8a; }
`;

const PAGE_SCRIPT = `
const btn = document.getElementById('share');
const deny = document.getElementById('deny');
const out = document.getElementById('out');
function setOut(text, cls) { out.textContent = text; out.className = cls || ''; }
async function post(payload) {
  const res = await fetch(location.pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, json };
}
function isTrusted() {
  try { return !!(window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'); }
  catch { return false; }
}
async function share() {
  if (!isTrusted()) {
    const r = await post({ error: 'insecure-context' });
    setOut(r.ok ? 'SHARED' : r.json && r.json.detail || 'ERROR', r.ok ? 'ok' : 'err');
    return;
  }
  btn.disabled = true; deny.disabled = true;
  setOut('ASKING THE BROWSER FOR THE POSITION\u2026');
  if (!navigator.geolocation) {
    const r = await post({ error: 'unsupported' });
    setOut(r.ok ? 'SHARED' : 'THIS BROWSER HAS NO GEOLOCATION', 'err');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const r = await post({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracyM: Math.round(pos.coords.accuracy),
      });
      if (r.ok) { setOut('SHARED \u2713', 'ok'); btn.disabled = true; }
      else { setOut(r.json && r.json.detail || 'ERROR', 'err'); btn.disabled = false; deny.disabled = false; }
    },
    async () => {
      const r = await post({ error: 'denied' });
      setOut('NOT SHARED', 'err'); btn.disabled = false; deny.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  );
}
btn.addEventListener('click', share);
deny.addEventListener('click', () => post({ error: 'declined' }).then((r) => setOut(r.ok ? 'NOT SHARED' : 'ERROR', 'err')));
`;

/**
 * @param {object} opts
 * @param {string} opts.numberMasked - display-safe number
 * @param {string} opts.legalBasis - the stated reason for the request
 * @param {number} opts.expiresAt - epoch ms; the page shows a deadline
 * @param {string} opts.title - heading, defaulted per locale
 */
export function renderConsentPage(opts) {
  const {
    numberMasked = '—',
    legalBasis = 'consent',
    expiresAt = 0,
    title = 'LOCATION REQUEST',
  } = opts;
  const minutes = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60000));
  const expires = Number.isFinite(minutes) ? `${minutes} min` : 'soon';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="card">
  <h1>${title}</h1>
  <p>A location request was made for the number <code>${numberMasked}</code>.</p>
  <p>The requester stated this basis: <code>${legalBasis}</code>.</p>
  <p>Sharing sends your current position <em>once</em> to the requester. Nothing else is read, nothing is stored beyond this one fix, and the link dies after it is used or expires (${expires}).</p>
  <div class="meta">This page is the consent. Without your tap, no position leaves this browser.</div>
  <button id="share" type="button">SHARE MY POSITION</button>
  <button id="deny" type="button" class="deny">DO NOT SHARE</button>
  <div id="out" role="status" aria-live="polite"></div>
</div>
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
}

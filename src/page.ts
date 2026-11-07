/** Driving-safe Drivr cabin glass — tap-with-voice capture mirror + fleet cards. */

import { GLASS_UI_VER } from "./ui-ver";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Absolute pair paths. A relative "pair" from /s/<id> (no slash) resolves to /s/pair. */
export function pairPaths(sessionId: string): { start: string; wait: string; home: string } {
  const id = encodeURIComponent(sessionId);
  return { start: `/s/${id}/pair`, wait: `/s/${id}/pair/wait`, home: `/s/${id}` };
}

const PAIR_STYLE = `
    body { margin: 0; padding: 1.5rem; background: #050607; color: #f2f4f6;
      font-family: "Helvetica Neue", Arial, sans-serif; }
    main { max-width: 32rem; }
    h1 { font-size: 1.5rem; font-weight: 600; }
    p { line-height: 1.45; }
    button { margin-top: 1rem; font: inherit; padding: 0.75rem 1rem; }
    .code { font-size: 2rem; letter-spacing: 0.08em; margin: 0.4rem 0; }
    .phrase { font-size: 1.6rem; margin: 0.2rem 0 0.8rem; }
    #error { color: #ffb86b; min-height: 1.4em; }
    #wait { display: none; }
`;

/** Unauthenticated gate. Contains no notes and no write token. Works without script. */
export function renderLoginGate(sessionId: string): string {
  const paths = pairPaths(sessionId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
  <title>Drivr · Pair</title>
  <style>${PAIR_STYLE}</style>
</head>
<body>
  <main>
    <h1>Drivr notes are private</h1>
    <p>Parked setup only. Do not type this while driving. This page never asks for the write token. Do not put a token in the URL or in chat.</p>
    <p>In-car direct fetch is unsupported. Pair this browser, then tell Drivr the request id and phrase. Drivr approves that exact request from your computer. The phrase and id are not a password.</p>
    <p id="error" role="alert"></p>
    <form id="pair-form" method="post" action="${esc(paths.start)}">
      <button type="submit" id="start">Pair this browser</button>
    </form>
    <div id="wait">
      <p>Tell Drivr these two lines, then wait. This screen stops checking when pairing finishes or expires.</p>
      <p class="code" id="request-id"></p>
      <p class="phrase" id="phrase"></p>
      <p id="status">Waiting for Drivr.</p>
    </div>
  </main>
  <script>
  (function () {
    var form = document.getElementById("pair-form");
    var startBtn = document.getElementById("start");
    var waitEl = document.getElementById("wait");
    var statusEl = document.getElementById("status");
    var errorEl = document.getElementById("error");
    var pairUrl = form.getAttribute("action");
    var waitUrl = pairUrl + "/wait";
    var timer = null;
    var polls = 0;
    var maxPolls = 36;
    function fail(text) {
      if (timer) clearTimeout(timer);
      timer = null;
      startBtn.disabled = false;
      errorEl.textContent = text;
    }
    function poll() {
      if (polls >= maxPolls) { fail("Pairing expired. Pair again if you are still parked."); return; }
      polls += 1;
      fetch(waitUrl, { headers: { "Accept": "application/json" }, cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); })
        .then(function (res) {
          if (res.body && res.body.state === "ready") {
            errorEl.textContent = "";
            statusEl.textContent = "Paired. Opening notes.";
            window.location.assign(pairUrl.replace(/\\/pair$/, ""));
            return;
          }
          if (res.status !== 200 || !res.body || res.body.state !== "pending") {
            fail("Pairing ended (" + res.status + "). Pair again if you are still parked.");
            return;
          }
          timer = setTimeout(poll, 5000);
        })
        .catch(function () { fail("Could not check pairing. The button below still sends the request."); });
    }
    form.addEventListener("submit", function (ev) {
      if (!window.fetch || !window.Promise) return;
      ev.preventDefault();
      startBtn.disabled = true;
      errorEl.textContent = "";
      fetch(pairUrl, { method: "POST", headers: { "Accept": "application/json" }, credentials: "same-origin" })
        .then(function (r) { return r.text().then(function (text) { return { status: r.status, text: text }; }); })
        .then(function (res) {
          var body = null;
          try { body = JSON.parse(res.text); } catch (e) { body = null; }
          if (res.status !== 201 || !body || !body.requestId || !body.phrase) {
            fail(body && body.error ? String(body.error) : ("Pairing did not start (HTTP " + res.status + ")."));
            return;
          }
          document.getElementById("request-id").textContent = body.requestId;
          document.getElementById("phrase").textContent = body.phrase;
          waitEl.style.display = "block";
          polls = 0;
          poll();
        })
        .catch(function () { fail("Could not start pairing. Submit the button again."); });
    });
  })();
  </script>
</body>
</html>`;
}

/** Shown after a no-script form POST, and while that browser is still waiting. */
export function renderPairPending(sessionId: string, requestId: string, phrase: string, refresh: boolean): string {
  const paths = pairPaths(sessionId);
  const refreshTag = refresh
    ? `<meta http-equiv="refresh" content="5;url=${esc(paths.wait)}" />`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
  ${refreshTag}
  <title>Drivr · Pair</title>
  <style>${PAIR_STYLE}</style>
</head>
<body>
  <main>
    <h1>Tell Drivr these two lines</h1>
    <p>Parked setup only. These are not a password and they do not open notes by themselves. Drivr must approve this exact request. This page checks for about 3 minutes, then stops.</p>
    <p class="code">${esc(requestId)}</p>
    <p class="phrase">${esc(phrase)}</p>
    <p id="error" role="alert">Waiting for Drivr.</p>
    <form method="get" action="${esc(paths.wait)}">
      <button type="submit">Check approval</button>
    </form>
  </main>
</body>
</html>`;
}

export function renderPairMessage(sessionId: string, message: string): string {
  const paths = pairPaths(sessionId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
  <title>Drivr · Pair</title>
  <style>${PAIR_STYLE}</style>
</head>
<body>
  <main>
    <h1>Drivr notes are private</h1>
    <p id="error" role="alert">${esc(message)}</p>
    <form method="post" action="${esc(paths.start)}">
      <button type="submit">Pair this browser</button>
    </form>
  </main>
</body>
</html>`;
}

export function renderPage(): string {
  return `<!DOCTYPE html>
<html lang="en" data-ui-ver="${GLASS_UI_VER}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="color-scheme" content="dark" />
  <meta name="theme-color" content="#050607" />
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <title>Drivr · Cabin</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #050607;
      --fg: #f2f4f6;
      --muted: #9aa3ad;
      --soft: #c5ced6;
      --line: #1c2228;
      --card: #0c1014;
      --accent: #7dffa3;
      --warn: #ffb86b;
      --done: #8fa3b5;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      background: var(--bg); color: var(--fg);
      font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    body {
      min-height: 100vh;
      padding: 1.25rem 1.5rem 2.5rem;
      max-width: 56rem;
      margin: 0 auto;
    }

    header {
      display: flex; align-items: center; justify-content: space-between;
      gap: 1rem; margin-bottom: 1.35rem;
      border-bottom: 1px solid var(--line); padding-bottom: 0.85rem;
    }
    .brand {
      font-size: clamp(0.792rem, 1.76vw, 0.924rem);
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--muted); font-weight: 500;
    }
    .header-meta {
      display: inline-flex; align-items: center; gap: 0.85rem; flex-wrap: wrap;
      justify-content: flex-end;
    }
    .glass-mode {
      font-size: clamp(0.748rem, 1.76vw, 0.88rem);
      font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--muted);
    }
    .glass-mode.on { color: var(--accent); }
    .status {
      display: inline-flex; align-items: center; gap: 0.45rem;
      font-size: clamp(0.792rem, 1.76vw, 0.88rem); color: var(--muted); font-weight: 500;
    }
    .status.live { color: var(--accent); }
    .status.err { color: var(--warn); }
    .live-dot {
      width: 0.55rem; height: 0.55rem; border-radius: 50%;
      background: currentColor; flex-shrink: 0; opacity: 0.45;
    }
    .status.live .live-dot {
      opacity: 1;
      box-shadow: 0 0 0 0 rgba(125, 255, 163, 0.55);
      animation: live-pulse 1.6s ease-out infinite;
    }
    @keyframes live-pulse {
      0% { box-shadow: 0 0 0 0 rgba(125, 255, 163, 0.55); }
      70% { box-shadow: 0 0 0 0.55rem rgba(125, 255, 163, 0); }
      100% { box-shadow: 0 0 0 0 rgba(125, 255, 163, 0); }
    }
    @keyframes bot-dot {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.55); opacity: 0.4; }
    }
    @keyframes card-glow {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-bot, var(--accent)) 50%, transparent); }
      50% { box-shadow: 0 0 22px 4px color-mix(in srgb, var(--accent-bot, var(--accent)) 40%, transparent); }
    }

    .section-label {
      font-size: 0.748rem; letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--muted); font-weight: 500; margin: 0 0 0.95rem;
    }
    .section-label.below { margin-top: 1.75rem; }

    #bots {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 1rem;
    }

    /* —— pinned card —— */
    #bots li.screenr-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-left: 4px solid var(--accent);
      border-radius: 0.95rem;
      padding: 1rem 1.25rem 1.1rem;
      order: -1;
    }
    #bots li.screenr-card.mode-on {
      animation: card-glow 2.4s ease-in-out infinite;
      --accent-bot: var(--accent);
    }
    .screenr-row {
      display: flex; align-items: center; justify-content: space-between;
      gap: 1rem; width: 100%;
    }
    .screenr-left {
      display: flex; align-items: center; gap: 0.55rem; min-width: 0;
    }
    .screenr-pulse {
      display: inline-block; width: 0.55em; height: 0.55em;
      border-radius: 50%; background: var(--accent); flex-shrink: 0; opacity: 0.35;
    }
    #bots li.screenr-card.mode-on .screenr-pulse {
      opacity: 1; animation: bot-dot 1.35s ease-in-out infinite;
    }
    .screenr-mode {
      margin: 0; text-align: right; margin-left: auto;
      font-size: clamp(0.88rem, 2.29vw, 1.1rem);
      font-weight: 600; color: var(--muted); letter-spacing: 0.02em;
      white-space: nowrap;
    }
    #bots li.screenr-card.mode-on .screenr-mode { color: var(--accent); }

    .screenr-actions {
      display: flex; align-items: center; gap: 0.5rem;
      margin-top: 0.75rem; flex-wrap: wrap;
    }
    .done-btn {
      appearance: none; border: 1px solid var(--line);
      background: rgba(255,255,255,0.04); color: var(--soft);
      font: inherit; font-size: clamp(0.792rem, 1.94vw, 0.924rem);
      font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase;
      padding: 0.55rem 1rem; min-height: 2.75rem; border-radius: 999px;
      cursor: pointer; -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .done-btn[aria-pressed="true"] {
      border-color: color-mix(in srgb, var(--done) 55%, var(--line));
      color: var(--fg);
      background: color-mix(in srgb, var(--done) 18%, transparent);
    }
    .done-count {
      font-size: clamp(0.748rem, 1.76vw, 0.88rem); color: var(--muted); font-weight: 500;
    }

    .screenr-panel {
      display: none; margin-top: 0.85rem;
      border-top: 1px solid var(--line); padding-top: 0.85rem;
    }
    #bots li.screenr-card.done-open .screenr-panel { display: block; }

    .done-list {
      list-style: none; margin: 0; padding: 0;
      max-height: 40vh; overflow-y: auto;
      -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
      display: flex; flex-direction: column; gap: 0.45rem;
    }
    .done-row {
      display: block; width: 100%; text-align: left;
      background: rgba(255,255,255,0.03); border: 1px solid var(--line);
      border-radius: 0.55rem; padding: 0.7rem 0.85rem;
      color: inherit; font: inherit; cursor: pointer;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
      min-height: 2.75rem;
    }
    .done-row[aria-selected="true"] {
      border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
      background: rgba(125, 255, 163, 0.06);
    }
    .done-row-title {
      margin: 0; font-size: clamp(0.88rem, 2.2vw, 1.056rem);
      font-weight: 600; color: var(--fg); line-height: 1.25;
    }
    .done-row-meta {
      margin: 0.25rem 0 0; font-size: clamp(0.748rem, 1.76vw, 0.88rem);
      color: var(--muted);
    }
    .done-empty {
      margin: 0; color: var(--muted);
      font-size: clamp(0.836rem, 1.94vw, 0.968rem); padding: 0.5rem 0.15rem;
    }

    .done-detail-wrap { margin-top: 0.75rem; }
    .done-back {
      appearance: none; border: 0; background: transparent;
      color: var(--accent); font: inherit;
      font-size: clamp(0.792rem, 1.94vw, 0.924rem); font-weight: 650;
      letter-spacing: 0.04em; text-transform: uppercase;
      padding: 0.4rem 0; min-height: 2.5rem; cursor: pointer;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
      margin-bottom: 0.35rem;
    }

    .view-toggle {
      display: inline-flex; gap: 0.35rem; margin-bottom: 0.65rem;
      padding: 0.2rem; border-radius: 999px;
      border: 1px solid var(--line); background: rgba(0, 0, 0, 0.25);
    }
    .view-toggle button {
      appearance: none; border: 0; background: transparent;
      color: var(--muted); font: inherit;
      font-size: clamp(0.792rem, 1.94vw, 0.924rem); font-weight: 650;
      letter-spacing: 0.04em; text-transform: uppercase;
      padding: 0.55rem 0.95rem; min-height: 2.75rem;
      border-radius: 999px; cursor: pointer;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .view-toggle button[aria-pressed="true"] {
      background: color-mix(in srgb, var(--accent-bot, var(--accent)) 22%, transparent);
      color: var(--fg);
    }
    .result-scroll {
      max-height: 60vh; overflow-y: auto;
      -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
      padding: 0.85rem 0.95rem;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 0.55rem; border: 1px solid var(--line);
    }
    .result-summary {
      margin: 0; font-size: clamp(0.924rem, 2.29vw, 1.188rem);
      line-height: 1.4; color: var(--fg); font-weight: 500;
      white-space: pre-wrap;
    }
    .result-detail {
      margin: 0; font-size: clamp(0.88rem, 2.11vw, 1.056rem);
      color: var(--soft); line-height: 1.45; white-space: pre-wrap;
    }
    .result-scroll a, .cap-detail a, .cap-dense-body a, .rail-body a {
      color: var(--accent-bot, var(--accent));
      text-decoration: underline;
      text-underline-offset: 0.12em;
      word-break: break-word;
      -webkit-tap-highlight-color: transparent;
    }
    .result-empty {
      margin: 0; color: var(--muted);
      font-size: clamp(0.836rem, 1.94vw, 0.968rem);
    }



    /* —— Capture mirror: split To-dos / Ideas / Notes cards —— */
    #capture-section {
      margin-bottom: 0.5rem;
    }
    .capture-head {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 0.75rem; margin-bottom: 0.35rem;
    }
    .section-label.capture-label { margin-bottom: 0; color: var(--accent); }
    .capture-count {
      font-size: clamp(0.748rem, 1.76vw, 0.88rem);
      font-weight: 500; color: var(--accent); letter-spacing: 0.04em;
    }
    #capture-list {
      list-style: none; margin: 0; padding: 0;
      display: block;
    }
    #capture-list > li.cap-shell {
      display: block;
      width: 100%;
      height: auto;
      min-height: auto;
      margin: 0 0 0.85rem 0;
      background: var(--card);
      border: 1px solid var(--line);
      border-left: 5px solid var(--cap-accent, var(--accent));
      border-radius: 1rem;
      padding: 0.95rem 1.1rem 1rem;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      transition: border-color 0.2s ease, background 0.2s ease;
      animation: card-glow 2.8s ease-in-out infinite;
      position: relative;
      overflow: visible;
      box-sizing: border-box;
    }
    #capture-list > li.cap-shell:last-child { margin-bottom: 0; }
    #capture-list > li.cap-shell.expanded {
      animation: none !important;
      box-shadow: none !important;
      background: #10161c;
      border-color: color-mix(in srgb, var(--cap-accent, var(--accent)) 45%, var(--line));
    }
    .cap-shell-label {
      margin: 0 0 0.3rem;
      font-size: clamp(0.66rem, 1.58vw, 0.792rem);
      font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--cap-accent, var(--accent));
    }
    .cap-face {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }
    .cap-face-top {
      display: flex; align-items: center; gap: 0.5rem; flex-wrap: nowrap;
      margin-bottom: 0.4rem;
    }
    .cap-face-top .cap-pill {
      display: inline-flex; align-items: center; justify-content: center;
      margin: 0; box-sizing: border-box; height: 1.7rem; min-width: 3.6rem;
      padding: 0 0.7rem; border-radius: 999px; border: 1px solid var(--cap-accent, var(--accent));
      font-size: clamp(0.66rem, 1.5vw, 0.76rem); font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; line-height: 1; white-space: nowrap;
    }
    .cap-face-top { justify-content: space-between; }
    .cap-open-chip {
      display: inline-block;
      font-size: clamp(0.836rem, 2.11vw, 1.012rem);
      font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
      color: #04110a; background: var(--cap-accent, var(--accent));
      border-radius: 999px; padding: 0.28rem 0.75rem;
    }
    .cap-kind {
      display: inline-block;
      margin: 0 0.55rem 0.2rem 0;
      vertical-align: top;
      font-size: clamp(0.616rem, 1.41vw, 0.722rem);
      font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--cap-accent, var(--accent));
      border: 1px solid currentColor; border-radius: 999px;
      padding: 0.15rem 0.5rem; min-width: 3.2rem; text-align: center;
    }
    .cap-main {
      display: block;
      width: auto;
      height: auto;
      overflow: visible;
      min-width: 0;
    }
    .cap-title {
      margin: 0;
      font-size: clamp(1.75rem, 5.2vw, 2.8rem);
      font-weight: 500; line-height: 1.25; letter-spacing: -0.015em;
      color: var(--fg);
      white-space: normal; overflow: visible; word-break: break-word;
    }
    .cap-meta {
      margin: 0.35rem 0 0;
      font-size: clamp(0.748rem, 1.76vw, 0.924rem);
      color: var(--muted); font-weight: 450;
      white-space: normal; overflow: visible;
    }
    .cap-session { display: none !important; }
    .cap-shell .expand-panel {
      display: none; margin-top: 0.7rem;
      border-top: 1px solid var(--line); padding-top: 0.65rem;
      overflow: visible; height: auto;
    }
    .cap-shell.expandable.expanded .expand-panel { display: block; }
    /* Tesla-safe dense list: block flow, content-sized rows, opaque, no nested ul */
    .cap-dense-list {
      display: block;
      margin: 0; padding: 0;
      max-height: 52vh;
      overflow-x: hidden;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
      position: relative;
      height: auto;
    }
    .cap-dense-row {
      display: block;
      position: relative;
      width: 100%;
      height: auto !important;
      min-height: 0;
      max-height: none;
      flex: none;
      flex-shrink: 0;
      box-sizing: border-box;
      margin: 0 0 0.65rem 0;
      padding: 0.7rem 0.75rem 0.75rem;
      text-align: left;
      background: #121820;
      border: 1px solid #243040;
      border-left: 3px solid var(--cap-accent, var(--accent));
      border-radius: 0.55rem;
      color: inherit; font: inherit; cursor: pointer;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
      overflow: visible;
      float: none;
      clear: both;
    }
    .cap-dense-row:last-child { margin-bottom: 0; }
    .cap-dense-row[aria-selected="true"] {
      border-color: color-mix(in srgb, var(--cap-accent, var(--accent)) 55%, #243040);
      background: #182028;
    }
    .cap-dense-top {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }
    .cap-dense-row .cap-kind {
      margin: 0 0.5rem 0.25rem 0;
      font-size: 0.598rem; font-weight: 600; padding: 0.1rem 0.4rem; min-width: 2.8rem;
    }
    .cap-dense-title {
      display: block;
      margin: 0;
      font-size: clamp(1.35rem, 3.6vw, 2rem);
      font-weight: 500; line-height: 1.3; color: var(--fg);
      white-space: normal !important;
      overflow: visible !important;
      text-overflow: clip !important;
      word-break: break-word;
      height: auto;
      max-height: none;
    }
    .cap-dense-body {
      display: block;
      margin: 0.35rem 0 0;
      font-size: clamp(0.748rem, 1.76vw, 0.88rem);
      line-height: 1.4; color: var(--soft);
      white-space: pre-wrap !important;
      overflow: visible !important;
      word-break: break-word;
      height: auto;
      max-height: none;
    }
    .cap-dense-meta {
      display: block;
      margin: 0.3rem 0 0;
      font-size: clamp(0.66rem, 1.58vw, 0.792rem);
      color: var(--muted); font-weight: 450;
      white-space: normal; overflow: visible; word-break: break-word;
      height: auto;
    }
    .cap-dense-related {
      display: block;
      margin: 0.35rem 0 0;
      font-size: clamp(0.704rem, 1.67vw, 0.836rem);
      color: var(--muted); line-height: 1.35;
      white-space: normal; overflow: visible; word-break: break-word;
      height: auto;
    }
    .cap-detail {
      display: block;
      margin: 0.45rem 0 0; padding-top: 0.45rem;
      border-top: 1px dashed var(--line);
      font-size: clamp(0.792rem, 1.85vw, 0.924rem);
      line-height: 1.4; color: var(--soft); white-space: pre-wrap;
      overflow: visible; word-break: break-word; height: auto;
    }
    .capture-empty {
      margin: 0.5rem 0 1rem;
      font-size: clamp(0.968rem, 2.46vw, 1.276rem);
      color: var(--muted); padding: 0.5rem 0.1rem; font-weight: 400;
    }
    .capture-done-wrap {
      margin-top: 0.85rem;
      border: 1px solid var(--line); border-radius: 0.75rem;
      padding: 0.25rem 0.75rem 0.55rem;
      background: rgba(255,255,255,0.02);
    }
    .capture-done-summary {
      cursor: pointer; list-style: none;
      font-size: clamp(0.748rem, 1.76vw, 0.88rem);
      font-weight: 550; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--done); padding: 0.45rem 0; min-height: 2.4rem;
      display: flex; align-items: center;
    }
    .capture-done-summary::-webkit-details-marker { display: none; }
    #capture-done-list {
      list-style: none; margin: 0.2rem 0 0; padding: 0;
      display: flex; flex-direction: column; gap: 0.3rem;
      max-height: 28vh; overflow-y: auto;
      -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
    }
    #capture-done-list li {
      padding: 0.45rem 0.3rem;
      border-top: 1px solid var(--line);
      opacity: 0.7;
    }
    #capture-done-list .cap-title {
      font-size: clamp(0.836rem, 2.02vw, 1.012rem);
      text-decoration: line-through; color: var(--muted); font-weight: 400;
    }
    #capture-done-list .cap-dense-body {
      font-size: clamp(0.704rem, 1.67vw, 0.836rem);
      text-decoration: none; opacity: 0.9;
    }
    /* —— Research / news digests (above Fleet) —— */
    #research-section {
      margin: 1.25rem 0 0.25rem;
    }
    .section-label.research-label {
      margin-bottom: 0.75rem;
      color: #9fd4ff;
    }
    #research-list {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 1rem;
    }
    #research-list > li.research-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-left: 4px solid #7ec8ff;
      border-radius: 0.95rem;
      padding: 1.2rem 1.4rem 1.3rem;
      --accent-bot: #7ec8ff;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    #research-list > li.research-card.expanded {
      background: rgba(126, 200, 255, 0.06);
      border-color: color-mix(in srgb, #7ec8ff 45%, var(--line));
    }
    #research-list > li.research-card .bot-name { color: #cfe9ff; }
    #research-empty {
      margin: 0.35rem 0 0;
      font-size: clamp(0.792rem, 1.94vw, 0.968rem);
      color: var(--muted);
    }
    #research-empty[hidden], #research-section[hidden] { display: none; }
    .research-pill {
      display: inline-block; margin: 0 0 0.35em; padding: 0.1em 0.6em;
      border-radius: 999px; font-size: clamp(0.66rem, 1.76vw, 0.792rem);
      font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase;
      color: #7ec8ff; border: 1px solid currentColor;
    }

    .fleet-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 0.75rem; margin-top: 0.5rem; flex-wrap: wrap;
    }
    .fleet-head .section-label { margin: 0; }
    .fleet-actions {
      display: inline-flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    }
    #done-panel {
      margin: 0.75rem 0 0.25rem;
      border: 1px solid var(--line); border-radius: 0.75rem;
      padding: 0.75rem 0.95rem 0.95rem;
      background: rgba(255,255,255,0.02);
    }
    #done-panel[hidden] { display: none; }
    .fleet-toggle {
      appearance: none; border: 1px solid var(--line);
      background: rgba(255,255,255,0.04); color: var(--muted);
      font: inherit; font-size: clamp(0.748rem, 1.76vw, 0.88rem);
      font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase;
      padding: 0.45rem 0.85rem; min-height: 2.5rem; border-radius: 999px;
      cursor: pointer; -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .fleet-toggle[aria-pressed="false"] { opacity: 0.7; }
    #fleet-panel[hidden] { display: none; }

    /* —— Fleet cards —— */
    #bots li.bot-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-left: 4px solid var(--accent-bot, var(--accent));
      border-radius: 0.95rem;
      padding: 1.2rem 1.4rem 1.3rem;
      transition: opacity 0.25s ease, border-color 0.25s ease;
    }
    #bots li.bot-card.working {
      border-color: var(--accent-bot, var(--accent));
      animation: card-glow 2s ease-in-out infinite;
    }
    #bots li.bot-card.idle,
    #bots li.bot-card.done {
      opacity: 0.78; animation: none; box-shadow: none;
    }
    #bots li.bot-card.done { border-left-color: var(--done); }

    #bots li.status-card {
      background: transparent;
      border: 1px dashed var(--line);
      border-radius: 0.6rem;
      padding: 0.75rem 1rem 0.85rem;
      margin-left: 1.25rem; opacity: 0.9;
      cursor: pointer; -webkit-tap-highlight-color: transparent;
      min-height: 4.5rem; touch-action: manipulation;
    }
    #bots li.status-card.working {
      border-color: color-mix(in srgb, var(--accent-bot, var(--accent)) 45%, var(--line));
    }
    #bots li.status-card.done,
    #bots li.status-card.idle { animation: none; }
    #bots li.status-card.done {
      border-style: solid;
      border-color: color-mix(in srgb, var(--done) 55%, var(--line));
      background: rgba(255, 255, 255, 0.02);
    }
    #bots li.status-card.expandable.expanded {
      background: rgba(255, 255, 255, 0.04);
      border-style: solid; opacity: 1;
    }
    .status-card .bot-name { font-size: clamp(0.924rem, 2.64vw, 1.232rem); font-weight: 550; color: var(--muted); }
    .status-card .bot-pulse { width: 0.4em; height: 0.4em; background: var(--muted); opacity: 0.5; animation: none; }
    .status-card.working .bot-pulse { animation: bot-dot 3s ease-in-out infinite; opacity: 0.7; background: var(--accent-bot, var(--accent)); }
    .status-card.done .bot-pulse { opacity: 0.35; animation: none; background: var(--done); }
    .status-card .bot-summary { font-size: clamp(0.88rem, 2.29vw, 1.188rem); }
    .from-chip {
      display: inline-block; margin: 0.15em 0 0.35em; padding: 0.1em 0.6em;
      border-radius: 999px; font-size: clamp(0.748rem, 1.94vw, 0.924rem);
      font-weight: 600; color: var(--accent-bot, var(--accent));
      border: 1px solid currentColor; opacity: 0.9;
    }
    .from-chip.unknown { color: var(--muted); border-style: dashed; font-weight: 500; }
    .kind-chip {
      font-size: 0.66rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0.1rem 0.55rem;
    }
    .kind-chip.done {
      color: var(--done);
      border-color: color-mix(in srgb, var(--done) 50%, var(--line));
    }

    .bot-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.55rem;
    }
    .bot-name {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: clamp(1.364rem, 3.96vw, 2.068rem);
      font-weight: 650; line-height: 1.1; letter-spacing: -0.025em; margin: 0;
    }
    .bot-pulse {
      display: inline-block; width: 0.5em; height: 0.5em;
      border-radius: 50%; background: var(--accent-bot, var(--accent)); flex-shrink: 0;
    }
    .bot-card.working .bot-pulse { animation: bot-dot 1.35s ease-in-out infinite; }
    .bot-card.idle .bot-pulse,
    .bot-card.done .bot-pulse { opacity: 0.35; animation: none; }
    .bot-state {
      font-size: clamp(0.748rem, 1.76vw, 0.88rem); font-weight: 600;
      letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--accent-bot, var(--accent)); white-space: nowrap;
    }
    .bot-card.idle .bot-state,
    .bot-card.done .bot-state,
    .status-card.done .bot-state { color: var(--muted); }
    .bot-card.done .bot-state { color: var(--done); }

    .bot-summary {
      font-size: clamp(1.012rem, 2.64vw, 1.496rem);
      line-height: 1.3; margin: 0; color: var(--fg); font-weight: 450;
    }
    .bot-summary.one-line {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .card-hit {
      display: block; width: 100%; text-align: left;
      background: transparent; border: 0; padding: 0; margin: 0;
      color: inherit; font: inherit; cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      min-height: 2.75rem; touch-action: manipulation;
    }
    .card-hit:focus-visible {
      outline: 2px solid var(--accent-bot, var(--accent));
      outline-offset: 4px; border-radius: 0.4rem;
    }
    .expand-panel { display: none; margin-top: 0.75rem; }
    .expandable.expanded .expand-panel { display: block; }
    /* —— Bullet toggle (card-23): the dot left of the title is the ONLY expand/collapse control —— */
    .card-toggle {
      display: inline-flex; align-items: center; justify-content: center;
      box-sizing: border-box; flex: none;
      width: 44px; height: 44px; min-width: 44px; min-height: 44px;
      margin: -10px 0 -10px -12px; padding: 0;
      background: transparent; border: 0; border-radius: 50%;
      color: inherit; font: inherit; cursor: pointer;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .card-toggle:focus-visible { outline: 2px solid var(--accent-bot, var(--cap-accent, var(--accent))); outline-offset: -4px; }
    .card-toggle > * { pointer-events: none; }
    .card-toggle[aria-expanded="false"] .bot-pulse {
      background: transparent;
      box-shadow: inset 0 0 0 2px var(--accent-bot, var(--accent));
      opacity: 0.9;
    }
    .card-toggle[aria-expanded="true"] .bot-pulse { opacity: 1; }
    .cap-dot {
      display: inline-block; box-sizing: border-box;
      width: 0.7rem; height: 0.7rem; border-radius: 50%;
      border: 2px solid var(--cap-accent, var(--accent)); background: transparent;
    }
    .card-toggle[aria-expanded="true"] .cap-dot { background: var(--cap-accent, var(--accent)); }
    .cap-title-row { display: flex; align-items: flex-start; gap: 0.3rem; min-width: 0; }
    .cap-title-row > .cap-title-text { flex: 1 1 auto; min-width: 0; }
    .cap-title-row > .card-toggle { margin-top: -8px; }
    .card-hit, .cap-dense-row, li.cap-shell, #bots li.expandable, li.research-card { cursor: default; }

    .bot-when {
      display: block; margin-top: 0.7rem;
      font-size: clamp(0.792rem, 1.76vw, 0.924rem); color: var(--muted);
    }
    .empty {
      font-size: clamp(1.144rem, 2.82vw, 1.628rem);
      color: var(--muted); padding: 2rem 0.25rem; margin: 0;
    }

    #details-rail {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 0.65rem;
    }
    #details-rail li {
      border: 1px solid var(--line); border-radius: 0.55rem;
      padding: 0.75rem 0.95rem; background: rgba(255,255,255,0.02);
    }
    #details-rail .rail-title {
      margin: 0 0 0.25rem; font-size: clamp(0.836rem, 1.94vw, 0.968rem);
      font-weight: 650; color: var(--soft);
    }
    #details-rail .rail-body {
      margin: 0; font-size: clamp(0.792rem, 1.85vw, 0.924rem);
      color: var(--muted); line-height: 1.4; white-space: pre-wrap;
      max-height: 70vh; overflow-y: auto; -webkit-overflow-scrolling: touch;
    }
    #details-rail .rail-from {
      display: inline-block; margin-left: 0.45rem; margin-bottom: 0.3rem;
      font-size: 0.704rem; font-weight: 600; color: var(--accent);
      letter-spacing: 0.04em; text-transform: uppercase;
    }

    .fleet-head, #done-panel, #fleet-panel, #research-section, #details-label, #details-rail { display: none !important; }
    footer { margin-top: 2.25rem; font-size: 0.704rem; color: var(--muted); }
  </style>
</head>
<body>
  <!-- ${GLASS_UI_VER} -->
  <header>
    <div class="brand">Drivr · Notes</div>
    <div class="header-meta">
      <span class="glass-mode" id="glass-mode">Glass idle</span>
      <div class="status" id="status"><span class="live-dot" aria-hidden="true"></span><span id="status-text">Connecting</span></div>
    </div>
  </header>

  <section id="capture-section" aria-label="Capture mirror">
    <div class="capture-head">
      <p class="section-label capture-label">Capture</p>
      <span class="capture-count" id="capture-count" hidden></span>
    </div>
    <ul id="capture-list" aria-live="polite" aria-label="Open to-dos, ideas, and notes"></ul>
    <p class="capture-empty" id="capture-empty">No open notes yet — start a Drivr capture.</p>
    <details class="capture-done-wrap" id="capture-done-wrap" hidden>
      <summary class="capture-done-summary" id="capture-done-summary">Done this drive</summary>
      <ul id="capture-done-list" aria-label="Completed capture items"></ul>
    </details>
  </section>

  <section id="research-section" aria-label="Research and news digests" hidden>
    <p class="section-label research-label">Research</p>
    <ul id="research-list" aria-live="polite" aria-label="Research digests"></ul>
    <p class="research-empty" id="research-empty" hidden>No research digests yet.</p>
  </section>

  <div class="fleet-head">
    <p class="section-label below">Fleet</p>
    <div class="fleet-actions">
      <button type="button" class="done-btn" id="done-toggle" data-done-toggle aria-pressed="false">Done</button>
      <span class="done-count" id="done-count">0 items</span>
      <button type="button" class="fleet-toggle" id="fleet-toggle" aria-pressed="true">Hide</button>
    </div>
  </div>
  <div id="done-panel" hidden aria-label="Done items"></div>
  <div id="fleet-panel">
    <ul id="bots" aria-live="polite" aria-label="Bot cards"></ul>
    <p class="empty" id="empty">No bots tracked yet.</p>
  </div>

  <p class="section-label below" id="details-label" hidden>Activity</p>
  <ul id="details-rail" aria-label="Stored activity" hidden></ul>

  <footer>Drivr notes, to-dos, and ideas. Parked display only — do not tap this screen while driving. Connected means this browser is attached. It does not make in-car Grok aware. Open URL is /s/&lt;session&gt;. No secrets in the URL. <span class="ver">${GLASS_UI_VER}</span></footer>

  <script>
  (function () {
    var GLASS_UI_VER = "${GLASS_UI_VER}";
    var traces = [];
    var botsEl = document.getElementById("bots");
    var emptyEl = document.getElementById("empty");
    var statusEl = document.getElementById("status");
    var statusText = document.getElementById("status-text");
    var detailsRail = document.getElementById("details-rail");
    var detailsLabel = document.getElementById("details-label");
    var captureList = document.getElementById("capture-list");
    var captureEmpty = document.getElementById("capture-empty");
    var captureCount = document.getElementById("capture-count");
    var captureDoneWrap = document.getElementById("capture-done-wrap");
    var captureDoneSummary = document.getElementById("capture-done-summary");
    var captureDoneList = document.getElementById("capture-done-list");
    var researchSection = document.getElementById("research-section");
    var researchList = document.getElementById("research-list");
    var researchEmpty = document.getElementById("research-empty");
    var expandedResearchKeys = {};
    var fleetPanel = document.getElementById("fleet-panel");
    var fleetToggle = document.getElementById("fleet-toggle");
    var glassModeEl = document.getElementById("glass-mode");
    var donePanel = document.getElementById("done-panel");
    var doneCountEl = document.getElementById("done-count");
    var selectedCaptureKey = null;
    var selectedCaptureShell = null;
    var captureShellExpandedBy = { todo: true, idea: true, note: true };
    var glassSessionId = (function () {
      var parts = String(location.pathname || "").split("/");
      for (var gi = 0; gi < parts.length - 1; gi++) {
        if (parts[gi] === "s" && parts[gi + 1]) return parts[gi + 1];
      }
      return "";
    })();
    var SESSION_PREFIX = glassSessionId ? ("/s/" + glassSessionId) : "";
    function glassApi(path) {
      return SESSION_PREFIX + path;
    }
    var fleetOpen = true;
    var ACTIVE_MS = 5 * 60 * 1000;
    var RICH_MIN = 200;
    var expandedKeys = {};
    var viewByKey = {};
    var donePanelOpen = false;
    var selectedDoneId = null;
    var doneView = "details";
    var lastTouchToggle = 0;
    var es = null;
    var retryTimer = null;
    var lastContentSig = "";
    var lastUiSig = "";

    var BOT_PALETTE = [
      "#7dffa3", "#7ec8ff", "#ffb86b", "#d4a1ff",
      "#ff8fab", "#9ae66e", "#6ee7e0", "#ffd166"
    ];

    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function plain(s) {
      var t = String(s == null ? "" : s);
      t = t.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/gi, "$1");
      t = t.replace(/<a\\b[^>]*>(.*?)<\\/a>/gi, "$1");
      t = t.replace(/https?:\\/\\/([^\\s<>"')\\]]+)/gi, function (_m, rest) {
        var host = String(rest || "").split("/")[0].replace(/^www\\./i, "");
        return host || "site";
      });
      return t;
    }

    function linkLabelFromUrl(url) {
      try {
        var u = String(url || "");
        var m = /^https?:\\/\\/([^\\/\\?#]+)(\\/[^\\s]*)?/i.exec(u);
        if (!m) return u.slice(0, 48);
        var host = m[1].replace(/^www\\./i, "");
        var path = m[2] || "";
        if (!path || path === "/") return host;
        var segs = path.split("/").filter(Boolean);
        var last = segs.length ? segs[segs.length - 1] : "";
        last = last.replace(/[-_]+/g, " ").replace(/\\.[a-z0-9]{1,5}$/i, "");
        if (last && last.length <= 40) return host + " · " + last;
        if (last) return host + " · " + last.slice(0, 36) + "…";
        return host;
      } catch (e) {
        return "site";
      }
    }

    function linkifyHtml(s) {
      var raw = String(s == null ? "" : s);
      var parts = [];
      var re = /\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)|https?:\\/\\/[^\\s<>"')\\]]+/gi;
      var last = 0;
      var m;
      while ((m = re.exec(raw))) {
        if (m.index > last) parts.push({ t: "text", v: raw.slice(last, m.index) });
        if (m[1] != null && m[2] != null) {
          parts.push({ t: "a", href: m[2], label: m[1] });
        } else {
          parts.push({ t: "a", href: m[0], label: linkLabelFromUrl(m[0]) });
        }
        last = m.index + m[0].length;
      }
      if (last < raw.length) parts.push({ t: "text", v: raw.slice(last) });
      return parts.map(function (p) {
        if (p.t === "a") {
          return '<a href="' + esc(p.href) + '" target="_blank" rel="noopener noreferrer">' + esc(p.label) + "</a>";
        }
        return esc(p.v).replace(/\\n/g, "<br>");
      }).join("");
    }

    function botColor(name) {
      var s = String(name || "");
      var h = 0;
      for (var i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
      }
      return BOT_PALETTE[Math.abs(h) % BOT_PALETTE.length];
    }

    function isFresh(t) {
      var ts = Date.parse(t && t.ts);
      return !!ts && (Date.now() - ts) <= ACTIVE_MS;
    }

    function rel(iso) {
      try {
        var t = Date.parse(iso);
        if (!t) return "";
        var m = Math.round((Date.now() - t) / 60000);
        if (m < 1) return "just now";
        if (m < 60) return m + " min ago";
        var h = Math.round(m / 60);
        if (h < 48) return h + " hr ago";
        return Math.round(h / 24) + " day ago";
      } catch (e) { return ""; }
    }

    function denver(iso) {
      try {
        return new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Denver",
          month: "short", day: "numeric",
          hour: "numeric", minute: "2-digit"
        }).format(new Date(iso));
      } catch (e) { return iso || ""; }
    }

    function setStatus(text, kind) {
      statusText.textContent = text;
      statusEl.className = "status" + (kind ? " " + kind : "");
    }

    var BOT_NAMES = {"drivr":1}; // Add your own fleet bot names (lowercase) so their pushes render as named-bot cards.
    function isBot(n) {
      var k = String(n || "").toLowerCase().split(" · ")[0].trim();
      return BOT_NAMES[k] === 1;
    }
    function creatorOf(c) {
      var ts = [c.show, c.latest, c.richest];
      for (var i = 0; i < ts.length; i++) {
        if (ts[i] && ts[i].from) return String(ts[i].from);
      }
      if (c.all && c.all.length) {
        for (var a = 0; a < c.all.length; a++) {
          if (c.all[a] && c.all[a].from) return String(c.all[a].from);
        }
      }
      for (var j = 0; j < ts.length; j++) {
        var d = ts[j] ? String(ts[j].detail || "") + " " + String(ts[j].summary || "") : "";
        var m = /\\bfrom\\s+([A-Z][\\w-]*(?: [A-Z][\\w-]*)?)/.exec(d);
        if (m && isBot(m[1])) return m[1];
      }
      return "";
    }

    var HB_RE = /^Watching named bots/i;

    function looksDone(summary, detail, status, result) {
      if (String(status || "").toLowerCase() === "done") return true;
      var blob = [summary, detail, result].map(function (x) { return String(x || ""); }).join("\\n");
      if (/^done\\b/i.test(String(summary || ""))) return true;
      if (/memo ready/i.test(blob)) return true;
      if (/\\bready\\b/i.test(String(summary || ""))) return true;
      if (/complete(d)?/i.test(blob)) return true;
      if (/finished/i.test(blob)) return true;
      return false;
    }

    /** Richest body for DETAILS: prefer result, merge unique detail for cabin Grok depth. */
    function bodyText(t) {
      if (!t) return "";
      var r = String(t.result || "").trim();
      var d = String(t.detail || "").trim();
      if (r && d) {
        if (r === d) return r;
        if (r.indexOf(d) >= 0) return r;
        if (d.indexOf(r) >= 0) return d;
        // Both carry unique context — surface both so in-car Grok need not ask.
        return r + "\\n\\n" + d;
      }
      return r || d || "";
    }

    function bodyLen(t) {
      return bodyText(t).length;
    }

    function screenrModeOn(sorted) {
      for (var i = 0; i < sorted.length; i++) {
        var t = sorted[i];
        var bot = String(t.bot || "").toLowerCase();
        if (bot !== "screenr" && bot !== "drivr") continue;
        var blob = String(t.summary || "") + " " + String(t.detail || "");
        if (/mode\\s+off/i.test(blob)) return false;
        if (/mode\\s+on/i.test(blob) || /screenr mode\\b/i.test(blob) || /cabin glass\\b/i.test(blob) || /drivr mode\\b/i.test(blob)) return true;
      }
      return false;
    }

    var CAPTURE_KINDS = { note: 1, todo: 1, idea: 1, capture: 1 };
    var KIND_COLOR = { todo: "#7ec8ff", note: "#7dffa3", idea: "#d4a1ff", capture: "#ffb86b" };

    function captureKindOf(t) {
      var kind = String(t.kind || "").toLowerCase();
      if (CAPTURE_KINDS[kind]) return kind === "capture" ? "note" : kind;
      return "note";
    }

    function isCaptureItem(t) {
      if (!t) return false;
      // Capture section ONLY when kind is explicit note|todo|idea|capture.
      // Never treat status (open/done/working) as a capture kind — fleet status
      // pushes must stay under Fleet (locked v-capture-card-11 / card-12).
      var kind = String(t.kind || "").toLowerCase();
      return !!CAPTURE_KINDS[kind];
    }

    /** Research / news digest lane (v-capture-card-15). Durable field: kind=research. */
    function isResearchItem(t) {
      if (!t) return false;
      return String(t.kind || "").toLowerCase() === "research";
    }

    function captureIsDone(t) {
      var status = String(t.status || "").toLowerCase();
      return status === "done" || status === "closed";
    }

    /** Dedupe capture rows by normalized summary; newest status wins (sorted newest-first). */
    function collectCaptureItems(sorted) {
      var map = {};
      var order = [];
      for (var i = 0; i < sorted.length; i++) {
        var t = sorted[i];
        var kind = String(t.kind || "").toLowerCase();
        var status = String(t.status || "").toLowerCase();
        var isCap = isCaptureItem(t) || !!CAPTURE_KINDS[kind];
        if (!isCap) continue;
        var summary = String(t.summary || "").trim();
        if (!summary || HB_RE.test(summary)) continue;
        var key = summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 240);
        if (!key) continue;
        if (!map[key]) {
          map[key] = t;
          order.push(key);
        }
      }
      var open = [];
      var done = [];
      order.forEach(function (key) {
        var t = map[key];
        var item = {
          key: key,
          id: t.id,
          summary: String(t.summary || ""),
          kind: captureKindOf(t),
          done: captureIsDone(t),
          detail: bodyText(t),
          ts: t.ts,
          bot: t.bot || "Drivr"
        };
        if (item.done) done.push(item);
        else open.push(item);
      });
      open.sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); });
      done.sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); });
      return { open: open, done: done };
    }

    /** Latest item in a same-kind open list (already newest-first). */
    function pickFaceItem(open) {
      if (!open || !open.length) return null;
      return open[0];
    }

    function clipDense(s, n) {
      var t = String(s || "").replace(/\\s+/g, " ").trim();
      if (t.length > n) t = t.slice(0, n - 1).trimEnd() + "…";
      return t;
    }

    function relatedRefsHtml(current, open) {
      if (!open || open.length < 2) return "";
      var bits = [];
      for (var i = 0; i < open.length && bits.length < 4; i++) {
        if (open[i].key === current.key) continue;
        bits.push(clipDense(plain(open[i].summary), 48));
      }
      if (!bits.length) return "";
      return '<p class="cap-dense-related">Also open · ' + esc(bits.join(" · ")) + "</p>";
    }

    function partitionOpenByKind(open) {
      var todos = [];
      var ideas = [];
      var notes = [];
      for (var i = 0; i < open.length; i++) {
        var it = open[i];
        if (it.kind === "todo") todos.push(it);
        else if (it.kind === "idea") ideas.push(it);
        else notes.push(it);
      }
      return { todos: todos, ideas: ideas, notes: notes };
    }

    function buildDenseRowsHtml(items, groupKind) {
      var dense = "";
      items.forEach(function (it) {
        var selected = selectedCaptureKey === it.key && selectedCaptureShell === groupKind;
        var rowAccent = KIND_COLOR[it.kind] || KIND_COLOR.note;
        var body = plain(it.detail || "");
        var bodyHtml = "";
        var fullDetail = "";
        // Always show a short body under the title so cabin Grok has context;
        // selected row expands to the full detail + related refs.
        if (body && body !== plain(it.summary)) {
          bodyHtml = selected
            ? '<p class="cap-dense-body">' + linkifyHtml(it.detail || "") + "</p>"
            : '<p class="cap-dense-body">' + esc(clipDense(body, 280)) + "</p>";
        }
        if (selected) {
          var deepRaw = String(it.detail || "").trim() || "Stored on this glass. In-car Grok is not automatically aware of it.";
          fullDetail =
            '<p class="cap-detail">' + linkifyHtml(deepRaw) + "</p>" +
            relatedRefsHtml(it, items);
        }
        dense +=
          '<div class="cap-dense-row" role="option" tabindex="-1" data-cap-key="' + esc(it.key) + '"' +
            ' data-cap-group="' + esc(groupKind) + '"' +
            ' aria-selected="' + (selected ? "true" : "false") + '"' +
            ' style="--cap-accent:' + esc(rowAccent) + '">' +
            '<div class="cap-dense-top">' +
              '<span class="cap-kind">' + esc(it.kind) + "</span>" +
              '<div class="cap-main">' +
                '<div class="cap-title-row">' +
                  '<button type="button" class="card-toggle" data-cap-toggle="row"' +
                    ' data-cap-key="' + esc(it.key) + '" data-cap-group="' + esc(groupKind) + '"' +
                    ' aria-expanded="' + (selected ? "true" : "false") + '"' +
                    ' aria-label="' + (selected ? "Collapse " : "Expand ") + esc(plain(it.summary)) + '">' +
                    '<span class="cap-dot" aria-hidden="true"></span>' +
                  "</button>" +
                  '<p class="cap-dense-title cap-title-text">' + esc(plain(it.summary)) + "</p>" +
                "</div>" +
                bodyHtml +
                '<p class="cap-dense-meta" data-cap-ts="' + esc(it.ts) + '" data-when-ts="' + esc(it.ts) + '">' +
                  esc(rel(it.ts)) + " · " + esc(denver(it.ts)) + " Denver" +
                "</p>" +
                fullDetail +
              "</div>" +
            "</div>" +
          "</div>";
      });
      return dense;
    }

    function buildCaptureShell(groupKind, label, items) {
      if (!items || !items.length) return null;
      var face = pickFaceItem(items);
      var accent = KIND_COLOR[groupKind] || KIND_COLOR.note;
      var isExpanded = !!captureShellExpandedBy[groupKind];
      var openLabel = items.length + " open";
      var li = document.createElement("li");
      li.className = "cap-shell expandable" + (isExpanded ? " expanded" : "");
      li.style.setProperty("--cap-accent", accent);
      li.setAttribute("data-cap-shell", "1");
      li.setAttribute("data-cap-group", groupKind);
      li.setAttribute("aria-label", label + ", " + openLabel + ". " + plain(face.summary));

      var faceNarr = plain(face.summary);
      var faceMeta =
        '<p class="cap-meta" data-cap-ts="' + esc(face.ts) + '" data-when-ts="' + esc(face.ts) + '">' +
          esc(rel(face.ts)) + " · " + esc(denver(face.ts)) + " Denver" +
        "</p>";
      var dense = buildDenseRowsHtml(items, groupKind);
      li.innerHTML =
        '<div class="card-hit" data-cap-hit>' +
          '<div class="cap-face">' +
            '<div class="cap-face-top">' +
              '<span class="cap-pill cap-kind">' + esc(face.kind) + "</span>" +
            "</div>" +
            '<div class="cap-main">' +
              '<div class="cap-title-row">' +
                '<button type="button" class="card-toggle" data-cap-toggle="shell" data-cap-group="' + esc(groupKind) + '"' +
                  ' aria-expanded="' + (isExpanded ? "true" : "false") + '"' +
                  ' aria-label="' + (isExpanded ? "Collapse " : "Expand ") + esc(label) + '">' +
                  '<span class="cap-dot" aria-hidden="true"></span>' +
                "</button>" +
                '<div class="cap-title-text">' +
                  '<p class="cap-title">' + esc(faceNarr) + "</p>" +
                  faceMeta +
                "</div>" +
              "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="expand-panel" data-expand-panel data-cap-panel>' +
          '<div class="cap-dense-list" role="listbox" aria-label="' + esc(label) + ' open items" data-cap-dense data-cap-group="' + esc(groupKind) + '">' +
            dense +
          "</div>" +
        "</div>";
      return li;
    }


    function renderCapture(sorted) {
      var bag = collectCaptureItems(sorted);
      if (!captureList || !captureDoneList) return bag;
      captureList.innerHTML = "";
      captureDoneList.innerHTML = "";
      var parts = partitionOpenByKind(bag.open);
      var totalOpen = bag.open.length;
      if (!totalOpen) {
        captureEmpty.hidden = false;
        captureCount.hidden = true;
        captureShellExpandedBy = { todo: true, idea: true, note: true };
        selectedCaptureKey = null;
        selectedCaptureShell = null;
      } else {
        captureEmpty.hidden = true;
        captureCount.hidden = false;
        var bits = [];
        if (parts.todos.length) bits.push(parts.todos.length + " todo" + (parts.todos.length === 1 ? "" : "s"));
        if (parts.ideas.length) bits.push(parts.ideas.length + " idea" + (parts.ideas.length === 1 ? "" : "s"));
        if (parts.notes.length) bits.push(parts.notes.length + " note" + (parts.notes.length === 1 ? "" : "s"));
        captureCount.textContent = bits.join(" · ");

        var shells = [
          buildCaptureShell("todo", "To-dos", parts.todos),
          buildCaptureShell("idea", "Ideas", parts.ideas),
          buildCaptureShell("note", "Notes", parts.notes)
        ];
        for (var si = 0; si < shells.length; si++) {
          if (shells[si]) captureList.appendChild(shells[si]);
        }
      }
      if (bag.done.length) {
        captureDoneWrap.hidden = false;
        captureDoneSummary.textContent = "Done this drive · " + bag.done.length;
        bag.done.forEach(function (it) {
          var li = document.createElement("li");
          var body = plain(it.detail || "");
          var bodyHtml = body && body !== plain(it.summary)
            ? '<p class="cap-dense-body">' + esc(clipDense(body, 160)) + "</p>"
            : "";
          li.innerHTML =
            '<span class="cap-kind">' + esc(it.kind) + "</span> " +
            '<span class="cap-title">' + esc(plain(it.summary)) + "</span>" +
            bodyHtml +
            '<p class="cap-meta" data-when-ts="' + esc(it.ts) + '">' + esc(rel(it.ts)) + " · " + esc(denver(it.ts)) + " Denver</p>";
          captureDoneList.appendChild(li);
        });
      } else {
        captureDoneWrap.hidden = true;
      }
      return bag;
    }

    /**
     * For each bot key:
     * - latest = newest trace (for working pulse / timestamp)
     * - richest = longest result||detail among non-heartbeat (min RICH_MIN preferred)
     * - show = richest if body >= RICH_MIN, else first non-heartbeat, else latest
     * Never let a newer short in-progress push hide a rich done body.
     */
    function latestByBot(sorted) {
      var map = {};
      var order = [];
      for (var i = 0; i < sorted.length; i++) {
        var t = sorted[i];
        var key = String(t.bot || "").toLowerCase();
        if (!key) continue;
        if (!map[key]) {
          map[key] = { latest: t, show: null, richest: null, all: [] };
          order.push(key);
        }
        map[key].all.push(t);
        if (HB_RE.test(String(t.summary || ""))) continue;
        var len = bodyLen(t);
        if (!map[key].richest || len > bodyLen(map[key].richest)) {
          map[key].richest = t;
        }
      }
      order.forEach(function (key) {
        var c = map[key];
        if (c.richest && bodyLen(c.richest) >= RICH_MIN) {
          c.show = c.richest;
        } else if (c.richest) {
          c.show = c.richest;
        } else {
          // fallback: first non-HB already skipped; use latest
          c.show = c.latest;
        }
      });
      return { map: map, order: order };
    }

    function normWords(s) {
      // Word tokens of length >= 4 (avoids whitespace-split escape issues in the HTML template).
      var m = String(s || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [];
      var set = {};
      m.forEach(function (w) { set[w] = 1; });
      return set;
    }
    function overlap(a, b) {
      var A = normWords(a), B = normWords(b);
      var ka = Object.keys(A), kb = Object.keys(B);
      if (!ka.length || !kb.length) return 0;
      var n = 0;
      ka.forEach(function (w) { if (B[w]) n++; });
      return n / Math.min(ka.length, kb.length);
    }
    function nearDup(a, b) {
      var sa = String(a.summary || "").trim().toLowerCase();
      var sb = String(b.summary || "").trim().toLowerCase();
      if (sa && sa === sb) return true;
      var ba = String(a.body || "").slice(0, 4000), bb = String(b.body || "").slice(0, 4000);
      if (ba.length > 200 && bb.length > 200 && overlap(ba, bb) >= 0.6) return true;
      if (overlap(sa, sb) >= 0.7) return true;
      return false;
    }

    /** Research digests: kind=research → above-fold Research lane (not Fleet). */
    function collectResearchCards(sorted) {
      var by = {};
      var order = [];
      for (var i = 0; i < sorted.length; i++) {
        var t = sorted[i];
        if (!isResearchItem(t)) continue;
        var key = String(t.bot || "").toLowerCase();
        if (!key || key === "screenr") continue;
        var summary = String(t.summary || "");
        if (!summary || HB_RE.test(summary)) continue;
        if (!by[key]) {
          by[key] = { latest: t, richest: t, all: [t] };
          order.push(key);
        } else {
          by[key].all.push(t);
          if (Date.parse(t.ts) > Date.parse(by[key].latest.ts)) by[key].latest = t;
          if (bodyLen(t) > bodyLen(by[key].richest)) by[key].richest = t;
        }
      }
      var cards = [];
      order.forEach(function (key) {
        var c = by[key];
        var shown = c.richest && bodyLen(c.richest) >= bodyLen(c.latest) ? c.richest : c.latest;
        // Prefer freshest for face summary, richest for expand body
        var face = c.latest;
        var full = bodyText(shown);
        if (bodyLen(c.richest) > full.length) full = bodyText(c.richest);
        cards.push({
          key: key,
          botName: face.bot,
          summary: String(face.summary || face.bot),
          detail: full,
          result: String(shown.result || c.richest.result || "").trim() || full,
          status: face.status || shown.status || "",
          done: looksDone(face.summary, shown.detail, face.status || shown.status, shown.result),
          ts: face.ts,
          from: face.from || shown.from || "",
          raw: c
        });
      });
      return cards;
    }

    function renderResearch(sorted) {
      if (!researchList || !researchSection) return [];
      var cards = collectResearchCards(sorted);
      researchList.innerHTML = "";
      if (!cards.length) {
        researchSection.hidden = true;
        if (researchEmpty) researchEmpty.hidden = true;
        return cards;
      }
      researchSection.hidden = false;
      if (researchEmpty) researchEmpty.hidden = true;
      cards.forEach(function (c) {
        var fullBody = "";
        var candBodies = [
          String(c.result || ""),
          String(c.detail || ""),
          bodyText(c.raw && c.raw.richest),
          bodyText(c.raw && c.raw.latest)
        ];
        for (var bi = 0; bi < candBodies.length; bi++) {
          if (candBodies[bi].length > fullBody.length) fullBody = candBodies[bi];
        }
        var expandable = !!fullBody || c.done;
        var isExpanded = !!expandedResearchKeys[c.key];
        var view;
        if (viewByKey["research:" + c.key] === "details" || viewByKey["research:" + c.key] === "summary") {
          view = viewByKey["research:" + c.key];
        } else {
          view = fullBody.length >= 40 ? "details" : "summary";
        }
        var li = document.createElement("li");
        li.className = "research-card bot-card " + (c.done ? "done" : "idle") +
          (expandable ? " expandable" : "") + (isExpanded ? " expanded" : "");
        li.setAttribute("data-research", c.key);
        li.setAttribute("data-latest-ts", c.ts || "");
        var fromHtml = c.from
          ? '<span class="from-chip">from ' + esc(c.from) + "</span>"
          : "";
        var narrFace = narrativeForSummary(c.summary, c.result, c.detail, fullBody);
        var collapsedSummary = esc(plain(narrFace || c.summary));
        var when = '<span class="bot-when" data-when-ts="' + esc(c.ts) + '">' + esc(rel(c.ts)) + " · " + esc(denver(c.ts)) + " Denver</span>";
        var researchDot = expandable
          ? '<button type="button" class="card-toggle" data-research-toggle="' + esc(c.key) + '"' +
              ' aria-expanded="' + (isExpanded ? "true" : "false") + '"' +
              ' aria-label="' + (isExpanded ? "Collapse " : "Expand ") + esc(c.botName) + '">' +
              '<span class="bot-pulse" aria-hidden="true"></span></button>'
          : '<span class="bot-pulse" aria-hidden="true"></span>';
        var head =
          '<div class="bot-head">' +
            '<p class="bot-name">' + researchDot + esc(c.botName) + "</p>" +
            '<span class="kind-chip' + (c.done ? " done" : "") + '">research</span>' +
          "</div>" +
          '<span class="research-pill">News · digest</span>' +
          fromHtml;
        if (expandable) {
          var panel =
            '<div class="expand-panel" data-expand-panel>' +
              '<div class="view-toggle" role="group" aria-label="Summary or details">' +
                '<button type="button" data-view="summary" data-research-view="' + esc(c.key) + '" aria-pressed="' + (view === "summary" ? "true" : "false") + '">Summary</button>' +
                '<button type="button" data-view="details" data-research-view="' + esc(c.key) + '" aria-pressed="' + (view === "details" ? "true" : "false") + '">Details</button>' +
              "</div>" +
              '<div class="result-scroll" data-result-scroll>' +
                renderExpandBody(c.summary, fullBody, view, c.result, c.detail) +
              "</div>" +
            "</div>";
          li.innerHTML =
            '<div class="card-hit" data-research-hit="' + esc(c.key) + '">' +
              head +
              '<p class="bot-summary one-line">' + collapsedSummary + "</p>" +
            "</div>" +
            panel +
            when;
        } else {
          li.innerHTML = head + '<p class="bot-summary">' + collapsedSummary + "</p>" + when;
        }
        researchList.appendChild(li);
      });
      return cards;
    }

    /** Collect all done traces (status cards + done bots), preferring rich bodies in list. */
    function collectDoneItems(sorted) {
      var items = [];
      var seen = {};
      for (var i = 0; i < sorted.length; i++) {
        var t = sorted[i];
        var key = String(t.bot || "").toLowerCase();
        if (key === "screenr") continue;
        if (HB_RE.test(String(t.summary || ""))) continue;
        if (isCaptureItem(t) || CAPTURE_KINDS[String(t.kind || "").toLowerCase()]) continue;
        if (isResearchItem(t)) continue;
        var summary = String(t.summary || t.bot || "");
        var done = looksDone(summary, t.detail, t.status, t.result);
        if (!done) continue;
        // Dedupe by bot+summary prefix so we keep the richest per logical item
        var dedupe = key + "|" + summary.slice(0, 48).toLowerCase();
        var body = bodyText(t);
        if (seen[dedupe]) {
          if (body.length > seen[dedupe].bodyLen) {
            seen[dedupe].trace = t;
            seen[dedupe].bodyLen = body.length;
            seen[dedupe].body = body;
          }
          continue;
        }
        seen[dedupe] = {
          id: t.id,
          botName: t.bot,
          summary: summary,
          from: t.from || "",
          ts: t.ts,
          body: body,
          bodyLen: body.length,
          result: String(t.result || ""),
          detail: String(t.detail || ""),
          status: t.status || "",
          trace: t,
          isBot: isBot(t.bot)
        };
      }
      var cand = [];
      Object.keys(seen).forEach(function (k) { cand.push(seen[k]); });
      cand.sort(function (a, b) {
        // Richer first, then newer
        if (b.bodyLen !== a.bodyLen) return b.bodyLen - a.bodyLen;
        return Date.parse(b.ts) - Date.parse(a.ts);
      });
      // Cross-bot dedupe (e.g. Research + Ria same findings): keep richest
      cand.forEach(function (it) {
        if (!items.some(function (k) { return nearDup(k, it); })) items.push(it);
      });
      return items;
    }

    function normCompact(s) {
      return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    }

    /** Brief narrative for SUMMARY tab: findings prose, never title/metadata openers. */
    function narrativeForSummary(summary, result, detail, fullBody) {
      var title = String(summary || "").trim();
      var r = String(result || "").trim();
      var d = String(detail || "").trim();
      var body = r || d || String(fullBody || "").trim();

      function looksLikeMeta(s) {
        var t = String(s || "").trim();
        if (!t) return true;
        if (/^(fleet-relevant|sources?|memo|post)\\s*:?\\s*$/i.test(t)) return true;
        if (/^(fleet-relevant|sources?|memo)\\s*:/i.test(t) && t.length < 48) return true;
        // Date + watched / walkthrough / ~Nm / "approximately N" metadata openers
        if (/\\b(watched|walkthrough)\\b/i.test(t) &&
            (/\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+\\d{1,2}\\b/i.test(t) ||
             /\\b~?\\d+\\s*m\\b/i.test(t) ||
             /\\bapproximately\\s+\\d/i.test(t))) return true;
        // Colon keyword dump / title slug: "Label: A, B, C, …"
        if (/^.{1,70}:\\s*[^.]*,[^.]*,/.test(t) && t.length < 220) return true;
        // Short headline slug without sentence punctuation
        if (t.length < 50 && !/[.!?]/.test(t)) return true;
        return false;
      }

      function isNarrativeProse(s) {
        var t = String(s || "").trim();
        if (t.length < 40) return false;
        if (!/[.!?]/.test(t)) return false;
        if (looksLikeMeta(t)) return false;
        return true;
      }

      function cleanLine(line) {
        return String(line || "")
          .replace(/^#+\\s*/, "")
          .replace(/^[•\\-\\*]\\s+/, "")
          .replace(/^\\d+\\.\\s+/, "")
          .trim();
      }

      function clip(s) {
        var t = String(s || "").replace(/\\s+/g, " ").trim();
        if (t.length > 420) t = t.slice(0, 419).trimEnd() + "…";
        return t;
      }

      // Prefer summary when it is already real narrative prose
      if (isNarrativeProse(title)) return clip(title);

      if (body) {
        var chunk = body;
        var m = body.match(/##\\s*Summary[^\\n]*\\n+([\\s\\S]*?)(?=\\n##\\s|$)/i);
        if (m && m[1].trim()) chunk = m[1].trim();

        var paras = chunk.split(/\\n\\n+/);
        var bullets = [];
        for (var i = 0; i < paras.length; i++) {
          var para = paras[i].trim();
          if (!para) continue;
          if (looksLikeMeta(para) && para.indexOf("\\n") < 0 && !/^[•\\-\\*]/.test(para)) continue;

          var lines = para.split(/\\n+/);
          var proseBits = [];
          for (var j = 0; j < lines.length; j++) {
            var raw = lines[j].trim();
            if (!raw) continue;
            if (/^(fleet-relevant|sources?|memo|post)\\s*:?\\s*$/i.test(raw)) continue;
            if (/^(fleet-relevant|sources?|memo)\\s*:/i.test(raw) && raw.length < 48) continue;
            var line = cleanLine(raw);
            if (!line) continue;
            if (looksLikeMeta(line)) continue;
            if (/^[•\\-\\*]|^\\d+\\./.test(raw)) {
              bullets.push(line);
              continue;
            }
            if (isNarrativeProse(line) || (line.length >= 40 && /[.!?]/.test(line))) {
              proseBits.push(line);
            }
          }
          if (proseBits.length) {
            var joined = clip(proseBits.join(" "));
            if (joined && !looksLikeMeta(joined)) return joined;
          }
        }

        if (bullets.length < 2) {
          var allLines = chunk.split(/\\n+/);
          bullets = [];
          for (var k = 0; k < allLines.length; k++) {
            var rl = allLines[k].trim();
            if (!/^[•\\-\\*]|^\\d+\\./.test(rl)) continue;
            var cl = cleanLine(rl);
            if (cl && !looksLikeMeta(cl)) bullets.push(cl);
          }
        }

        if (bullets.length) {
          var take = bullets.slice(0, 3).map(function (b) {
            var s = String(b).replace(/\\s+/g, " ").trim();
            var cut = s.split(/[.;]/)[0].trim();
            if (cut.length >= 12 && cut.length <= 100) s = cut;
            else if (s.length > 100) s = s.slice(0, 99).trimEnd() + "…";
            return s;
          });
          var findings;
          if (take.length === 1) findings = take[0];
          else if (take.length === 2) findings = take[0] + ", and " + take[1];
          else findings = take.slice(0, -1).join(", ") + ", and " + take[take.length - 1];
          if (!/[.!?]$/.test(findings)) findings += ".";
          return clip("Key findings: " + findings);
        }
      }

      if (title.length >= 50 && /[.!?]/.test(title) && !looksLikeMeta(title)) return clip(title);
      return "";
    }

    function renderExpandBody(summary, fullBody, view, result, detail) {
      var rawBody = String(fullBody || "").trim();
      var rawSumm = String(summary || "").trim();
      var d = plain(rawBody).trim();
      var summ = plain(rawSumm).trim();
      if (view === "details") {
        if (rawBody) {
          return '<p class="result-detail">' + linkifyHtml(rawBody) + "</p>";
        }
        if (rawSumm) {
          return '<p class="result-detail">' + linkifyHtml(rawSumm) + "</p>" +
            '<p class="result-empty">No deeper detail pushed — bots should put context in detail/result.</p>';
        }
        return '<p class="result-empty">No details yet.</p>';
      }
      var narr = narrativeForSummary(summary, result, detail, fullBody);
      if (narr) return '<p class="result-summary">' + linkifyHtml(narr) + "</p>";
      if (rawSumm) return '<p class="result-summary">' + linkifyHtml(rawSumm) + "</p>";
      return '<p class="result-empty">No summary yet.</p>';
    }

    function stateLabel(done, working) {
      if (done) return "done";
      if (working) return "working";
      return "idle";
    }

    function toggleExpand(key) {
      if (expandedKeys[key]) delete expandedKeys[key];
      else expandedKeys[key] = 1;
      render();
    }

    function setView(key, view) {
      viewByKey[key] = view === "details" ? "details" : "summary";
      expandedKeys[key] = 1;
      render();
    }

    function setGlassMode(modeOn) {
      if (!glassModeEl) return;
      glassModeEl.textContent = modeOn ? "Glass on" : "Glass idle";
      glassModeEl.className = "glass-mode" + (modeOn ? " on" : "");
    }


    function tracesContentSig(list) {
      if (!list || !list.length) return "empty";
      var parts = [];
      for (var i = 0; i < list.length; i++) {
        var t = list[i] || {};
        parts.push([
          t.id || "",
          t.ts || "",
          t.bot || "",
          t.status || "",
          t.kind || "",
          String(t.summary || "").length,
          String(t.detail || "").length,
          String(t.result || "").length,
          String(t.from || "")
        ].join(":"));
      }
      return parts.join("|");
    }

    function uiStateSig() {
      var ek = Object.keys(expandedKeys).sort().map(function (k) {
        return k + "=" + (expandedKeys[k] ? "1" : "0");
      }).join(",");
      var vk = Object.keys(viewByKey).sort().map(function (k) {
        return k + "=" + viewByKey[k];
      }).join(",");
      var rk = Object.keys(expandedResearchKeys).sort().map(function (k) {
        return k + "=" + (expandedResearchKeys[k] ? "1" : "0");
      }).join(",");
      return [
        ek, vk, rk,
        selectedCaptureKey || "",
        selectedCaptureShell || "",
        (captureShellExpandedBy.todo ? "1" : "0") +
          (captureShellExpandedBy.idea ? "1" : "0") +
          (captureShellExpandedBy.note ? "1" : "0"),
        fleetOpen ? "1" : "0",
        donePanelOpen ? "1" : "0",
        selectedDoneId || "",
        doneView || ""
      ].join("#");
    }

    function captureScrollMap() {
      var map = {};
      try {
        var nodes = document.querySelectorAll("[data-result-scroll]");
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          var card = el.closest("li[data-bot]");
          var key = card ? ("bot:" + card.getAttribute("data-bot")) : "done:panel";
          map[key] = el.scrollTop || 0;
        }
        if (detailsRail) map["rail"] = detailsRail.scrollTop || 0;
        if (donePanel) map["done"] = donePanel.scrollTop || 0;
        if (captureList) map["capture"] = captureList.scrollTop || 0;
        var denseNodes = document.querySelectorAll(".cap-dense-list");
        for (var di = 0; di < denseNodes.length; di++) {
          var dEl = denseNodes[di];
          var dg = dEl.getAttribute("data-cap-group") || String(di);
          map["cap-dense:" + dg] = dEl.scrollTop || 0;
        }
        map["win"] = window.scrollY || window.pageYOffset || 0;
      } catch (e) {}
      return map;
    }

    function restoreScrollMap(map) {
      if (!map) return;
      try {
        var nodes = document.querySelectorAll("[data-result-scroll]");
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          var card = el.closest("li[data-bot]");
          var key = card ? ("bot:" + card.getAttribute("data-bot")) : "done:panel";
          if (map[key] != null) el.scrollTop = map[key];
        }
        if (detailsRail && map["rail"] != null) detailsRail.scrollTop = map["rail"];
        if (donePanel && map["done"] != null) donePanel.scrollTop = map["done"];
        if (captureList && map["capture"] != null) captureList.scrollTop = map["capture"];
        var denseR = document.querySelectorAll(".cap-dense-list");
        for (var dri = 0; dri < denseR.length; dri++) {
          var dRe = denseR[dri];
          var dRg = dRe.getAttribute("data-cap-group") || String(dri);
          if (map["cap-dense:" + dRg] != null) dRe.scrollTop = map["cap-dense:" + dRg];
        }
        if (map["win"] != null) {
          try { window.scrollTo(0, map["win"]); } catch (e2) {}
        }
      } catch (e) {}
    }

    function refreshRelTimes() {
      try {
        var whenNodes = document.querySelectorAll("[data-when-ts]");
        for (var i = 0; i < whenNodes.length; i++) {
          var el = whenNodes[i];
          var ts = el.getAttribute("data-when-ts");
          if (!ts) continue;
          el.textContent = rel(ts) + " · " + denver(ts) + " Denver";
        }
        var capNodes = document.querySelectorAll("[data-cap-ts]");
        for (var j = 0; j < capNodes.length; j++) {
          var c = capNodes[j];
          var cts = c.getAttribute("data-cap-ts");
          if (!cts) continue;
          c.textContent = rel(cts) + " · " + denver(cts) + " Denver";
        }
        // Refresh working pulse classes without DOM wipe
        var cards = document.querySelectorAll("li[data-bot][data-latest-ts]");
        for (var k = 0; k < cards.length; k++) {
          var li = cards[k];
          var lts = li.getAttribute("data-latest-ts");
          var isDone = li.classList.contains("done");
          var working = !isDone && isFresh({ ts: lts });
          if (working) li.classList.add("working");
          else li.classList.remove("working");
          var stateEl = li.querySelector(".bot-state");
          if (stateEl && li.classList.contains("bot-card")) {
            stateEl.textContent = stateLabel(isDone, working);
          }
        }
      } catch (e) {}
    }

    function renderDonePanel(doneItems) {
      if (doneCountEl) {
        var count = doneItems.length;
        doneCountEl.textContent = count + (count === 1 ? " item" : " items");
      }
      if (!donePanel) return;
      if (!donePanelOpen) {
        donePanel.hidden = true;
        donePanel.innerHTML = "";
        return;
      }
      donePanel.hidden = false;
      if (selectedDoneId) {
        var sel = null;
        for (var i = 0; i < doneItems.length; i++) {
          if (doneItems[i].id === selectedDoneId) { sel = doneItems[i]; break; }
        }
        if (!sel && doneItems.length) sel = doneItems[0];
        if (sel) {
          var full = sel.result || sel.body || sel.detail || "";
          if (sel.result && sel.result.length >= (sel.body || "").length) full = sel.result;
          else if (sel.body) full = sel.body;
          else full = sel.detail || "";
          donePanel.innerHTML =
            '<button type="button" class="done-back" data-done-back>← Done list</button>' +
            '<p class="done-row-title">' + esc(sel.botName) + "</p>" +
            (sel.from ? '<span class="from-chip">from ' + esc(sel.from) + "</span>" : "") +
            '<div class="done-detail-wrap">' +
              '<div class="view-toggle" role="group" aria-label="Summary or details">' +
                '<button type="button" data-done-view="summary" aria-pressed="' + (doneView === "summary" ? "true" : "false") + '">Summary</button>' +
                '<button type="button" data-done-view="details" aria-pressed="' + (doneView === "details" ? "true" : "false") + '">Details</button>' +
              "</div>" +
              '<div class="result-scroll" data-result-scroll>' +
                renderExpandBody(sel.summary, full, doneView, sel.result, sel.detail) +
              "</div>" +
            "</div>";
          return;
        }
        selectedDoneId = null;
      }
      var rows = "";
      if (!doneItems.length) {
        rows = '<p class="done-empty">No done items yet.</p>';
      } else {
        rows = '<ul class="done-list" data-done-list>';
        doneItems.forEach(function (it) {
          rows +=
            '<li><button type="button" class="done-row" data-done-id="' + esc(it.id) + '" aria-selected="false">' +
              '<p class="done-row-title">' + esc(it.botName) + " · " + esc(plain(it.summary)) + "</p>" +
              '<p class="done-row-meta">' +
                (it.from ? "from " + esc(it.from) + " · " : "") +
                esc(rel(it.ts)) +
                (it.bodyLen ? " · " + it.bodyLen + " chars" : "") +
              "</p>" +
            "</button></li>";
        });
        rows += "</ul>";
      }
      donePanel.innerHTML = rows;
    }

    function render() {
      try {
        var contentSig = tracesContentSig(traces);
        var uiSig = uiStateSig();
        if (contentSig === lastContentSig && uiSig === lastUiSig) {
          refreshRelTimes();
          return;
        }
        var scrollMap = captureScrollMap();
        var sorted = traces.slice().sort(function (a, b) {
          return Date.parse(b.ts) - Date.parse(a.ts);
        });
        var modeOn = screenrModeOn(sorted);
        setGlassMode(modeOn);
        var by = latestByBot(sorted);
        var doneItems = collectDoneItems(sorted);
        renderDonePanel(doneItems);
        var captureBag = renderCapture(sorted);
        var captureKeys = {};
        (captureBag.open || []).concat(captureBag.done || []).forEach(function (it) {
          captureKeys[it.key] = 1;
        });
        // Research lane must paint before Fleet; also builds keys so digests never dual-home in Fleet.
        var researchCards = renderResearch(sorted);
        var researchKeys = {};
        (researchCards || []).forEach(function (c) {
          if (c && c.key) researchKeys[c.key] = 1;
        });
        // Also mark any research-kind bot keys from the raw sorted feed (belt-and-suspenders).
        sorted.forEach(function (t) {
          if (isResearchItem(t)) {
            var rk = String(t.bot || "").toLowerCase();
            if (rk) researchKeys[rk] = 1;
          }
        });
        // Hide fleet panel content noise when capture is the focus? keep fleet; just filter dupes
        if (fleetPanel) fleetPanel.hidden = !fleetOpen;
        if (fleetToggle) {
          fleetToggle.setAttribute("aria-pressed", fleetOpen ? "true" : "false");
          fleetToggle.textContent = fleetOpen ? "Hide" : "Show";
        }
        var cards = [];

        by.order.forEach(function (key) {
          if (key === "screenr") return;
          // Research digests live in Research lane — never dual-home in Fleet
          // (even if older pushes for the same bot omitted kind).
          if (researchKeys[key]) return;
          // Skip pure capture-only rows from fleet cards (they live in the mirror)
          var latest = by.map[key] && by.map[key].latest;
          if (latest && isCaptureItem(latest)) {
            // If this bot key is only capture traffic, skip; drivr may also push fleet wrap-ups
            var allCap = true;
            var all = (by.map[key].all || []);
            for (var ai = 0; ai < all.length; ai++) {
              if (!isCaptureItem(all[ai]) && !CAPTURE_KINDS[String(all[ai].kind || "").toLowerCase()]) {
                // non-capture traffic exists — keep a fleet card from non-capture show
                allCap = false;
                break;
              }
            }
            if (allCap) return;
          }
          var c = by.map[key];
          var t = c.latest;
          // Prefer non-capture traces for fleet card when mixed with capture mirror items
          var nonCap = null;
          if (c.all && c.all.length) {
            for (var ni = 0; ni < c.all.length; ni++) {
              if (!isCaptureItem(c.all[ni]) && !isResearchItem(c.all[ni]) && !CAPTURE_KINDS[String(c.all[ni].kind || "").toLowerCase()]) {
                if (!nonCap || bodyLen(c.all[ni]) > bodyLen(nonCap)) nonCap = c.all[ni];
              }
            }
            // Prefer freshest non-capture / non-research for working pulse source
            for (var nj = 0; nj < c.all.length; nj++) {
              if (!isCaptureItem(c.all[nj]) && !isResearchItem(c.all[nj]) && !CAPTURE_KINDS[String(c.all[nj].kind || "").toLowerCase()]) {
                t = c.all[nj];
                break; // all is newest-first
              }
            }
          }
          // Glanceable = latest non-capture (real-time). Details body = richest available.
          var shown = nonCap || t || c.show || c.richest;
          if (!shown || isResearchItem(shown) || isCaptureItem(shown) || CAPTURE_KINDS[String(shown.kind || "").toLowerCase()]) {
            // Nothing left for Fleet — digests/captures have their own lanes
            if (!nonCap) return;
            shown = nonCap;
          }
          var summary = String(shown.summary || t.bot);
          var detail = bodyText(shown);
          var resultStr = String(shown.result || "").trim();
          var richSrc = c.richest || shown;
          if (richSrc && bodyLen(richSrc) > detail.length) {
            detail = bodyText(richSrc);
            resultStr = String(richSrc.result || resultStr).trim() || detail;
          }
          // Heartbeat / mode-only pushes stay in header state, never as a fleet card
          if (HB_RE.test(summary)) return;
          if (/^glass mode\\b/i.test(summary) || /^screenr mode\\b/i.test(summary) || /^drivr mode\\b/i.test(summary)) return;
          var status = shown.status || t.status || "";
          var done = looksDone(summary, shown.detail, status, shown.result || t.result);
          // Working pulse uses latest freshness, but only if not done via rich show
          var working = !done && isFresh(t);
          cards.push({
            key: key,
            botName: t.bot,
            isBot: isBot(t.bot),
            pinned: false,
            summary: summary,
            detail: detail,
            result: resultStr || detail,
            status: status,
            done: done,
            working: working,
            ts: (done ? shown.ts : t.ts),
            from: creatorOf(c),
            raw: c
          });
        });

        // Hide non-bot status cards that duplicate any fleet bot card.
        // Keep only when content is distinct (specialist fan-out not already covered).
        cards = cards.filter(function (c) {
          if (c.isBot) return true;
          var fleet = [];
          for (var i = 0; i < cards.length; i++) {
            if (cards[i].isBot) fleet.push(cards[i]);
          }
          if (!fleet.length) return true;
          var cb = (c.result || c.detail || "");
          var cs = String(c.summary || "").trim().toLowerCase();

          // (a) from is a fleet bot AND near-duplicate summary/body with that bot
          var fromKey = String(c.from || "").toLowerCase();
          if (fromKey && isBot(c.from)) {
            var owner = null;
            for (var j = 0; j < fleet.length; j++) {
              if (String(fleet[j].botName || "").toLowerCase() === fromKey) { owner = fleet[j]; break; }
            }
            if (owner) {
              var ob = (owner.result || owner.detail || "");
              if (nearDup({ summary: owner.summary, body: ob }, { summary: c.summary, body: cb })) return false;
            }
          }

          // (b) normalized summary equals any fleet bot card summary
          if (cs) {
            for (var k = 0; k < fleet.length; k++) {
              if (String(fleet[k].summary || "").trim().toLowerCase() === cs) return false;
            }
          }

          // (c) body (≥200 chars) overlaps ≥0.55 with any fleet bot body
          if (cb.length >= 200) {
            for (var m = 0; m < fleet.length; m++) {
              var fb = (fleet[m].result || fleet[m].detail || "");
              if (fb.length >= 200 && overlap(cb, fb) >= 0.55) return false;
            }
          }

          return true;
        });

        botsEl.innerHTML = "";

        var railItems = [];

        cards.forEach(function (c) {
          var color = botColor(c.botName);
          // Longest body across result/detail/richest so DETAILS is never the one-line summary
          var fullBody = "";
          var candBodies = [
            String(c.result || ""),
            String(c.detail || ""),
            bodyText(c.raw && c.raw.richest),
            bodyText(c.raw && c.raw.show)
          ];
          for (var bi = 0; bi < candBodies.length; bi++) {
            if (candBodies[bi].length > fullBody.length) fullBody = candBodies[bi];
          }
          var expandable = !c.isBot || !!fullBody || c.done;
          var isExpanded = !!expandedKeys[c.key];
          var view;
          if (viewByKey[c.key] === "details" || viewByKey[c.key] === "summary") {
            view = viewByKey[c.key];
          } else {
            view = fullBody.length >= 40 ? "details" : "summary";
          }
          var state = stateLabel(c.done, c.working);

          var li = document.createElement("li");
          var kindClass = c.isBot ? "bot-card" : "status-card";
          li.className = kindClass + " " + state + (expandable ? " expandable" : "") + (isExpanded ? " expanded" : "");
          li.style.setProperty("--accent-bot", color);
          li.setAttribute("data-bot", c.key);
          li.setAttribute("data-latest-ts", c.ts || "");

          var fromHtml = "";
          if (!c.isBot) {
            fromHtml = c.from
              ? '<span class="from-chip">from ' + esc(c.from) + "</span>"
              : '<span class="from-chip unknown">from unknown</span>';
          }

          var stateChip = c.isBot
            ? '<span class="bot-state">' + esc(state) + "</span>"
            : '<span class="kind-chip' + (c.done ? " done" : "") + '">' + esc(c.done ? "done" : "status") + "</span>";

          var botDot = expandable
            ? '<button type="button" class="card-toggle" data-bot-toggle="' + esc(c.key) + '"' +
                ' aria-expanded="' + (isExpanded ? "true" : "false") + '"' +
                ' aria-label="' + (isExpanded ? "Collapse " : "Expand ") + esc(c.botName) + '">' +
                '<span class="bot-pulse" aria-hidden="true"></span></button>'
            : '<span class="bot-pulse" aria-hidden="true"></span>';
          var head =
            '<div class="bot-head">' +
              '<p class="bot-name">' + botDot + esc(c.botName) + "</p>" +
              stateChip +
            "</div>" +
            fromHtml;

          var when = '<span class="bot-when" data-when-ts="' + esc(c.ts) + '">' + esc(rel(c.ts)) + " · " + esc(denver(c.ts)) + " Denver</span>";
          var narrFace = narrativeForSummary(c.summary, c.result, c.detail, fullBody);
          var collapsedSummary = esc(plain(narrFace || c.summary));

          if (expandable) {
            var panel =
              '<div class="expand-panel" data-expand-panel>' +
                '<div class="view-toggle" role="group" aria-label="Summary or details">' +
                  '<button type="button" data-view="summary" aria-pressed="' + (view === "summary" ? "true" : "false") + '">Summary</button>' +
                  '<button type="button" data-view="details" aria-pressed="' + (view === "details" ? "true" : "false") + '">Details</button>' +
                "</div>" +
                '<div class="result-scroll" data-result-scroll>' +
                  renderExpandBody(c.summary, fullBody, view, c.result, c.detail) +
                "</div>" +
              "</div>";

            li.innerHTML =
              '<div class="card-hit" data-card-hit>' +
                head +
                '<p class="bot-summary one-line">' + collapsedSummary + "</p>" +
              "</div>" +
              panel +
              when;
          } else {
            li.innerHTML =
              head +
              '<p class="bot-summary">' + collapsedSummary + "</p>" +
              when;
          }
          botsEl.appendChild(li);

          // Activity history filled after cards from every trace (real-time log).
        });

        emptyEl.hidden = botsEl.children.length > 0;

        // Live activity stream = every push as nerves fire (cabin Grok read-without-asking).
        // Mid-task states (started/working/found/blocked/retrying/open) must show — not only done outcomes.
        railItems = [];
        sorted.forEach(function (t) {
          if (!t) return;
          // Captures belong in split To-dos / Ideas / Notes cards — never as Live Activity rows.
          if (isCaptureItem(t) || CAPTURE_KINDS[String(t.kind || "").toLowerCase()]) return;
          // Research digests belong in Research lane — not Live Activity dupes.
          if (isResearchItem(t)) return;
          var summary = String(t.summary || "").trim();
          if (!summary) return;
          var capKey = summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
          if (capKey && captureKeys[capKey]) return;
          if (HB_RE.test(summary)) return;
          if (/^glass mode\\b/i.test(summary) || /^screenr mode\\b/i.test(summary) || /^drivr mode\\b/i.test(summary)) return;
          var st = String(t.status || "").toLowerCase().trim();
          var phase = st || "";
          if (!phase) {
            if (looksDone(summary, t.detail, t.status, t.result)) phase = "done";
            else if (/\\b(looking up|scanning|starting|started|searching|working|checking)\\b/i.test(summary)) phase = "working";
            else if (/\\b(blocked|stuck|waiting)\\b/i.test(summary)) phase = "blocked";
            else if (/\\b(retry|retrying)\\b/i.test(summary)) phase = "retrying";
            else phase = "open";
          }
          var body = bodyText(t);
          if (!body) {
            if (phase === "done") body = "";
            else body = "In progress — mid-task update for cabin Grok.";
          }
          railItems.push({
            id: t.id,
            botName: t.bot || "?",
            summary: summary,
            from: t.from || "",
            body: body,
            kind: t.kind || "",
            status: st,
            phase: phase,
            ts: t.ts || ""
          });
        });

        detailsRail.innerHTML = "";
        if (railItems.length) {
          detailsLabel.hidden = false;
          detailsRail.hidden = false;
          railItems.forEach(function (c) {
            var li = document.createElement("li");
            var isDone = c.phase === "done";
            li.className = "rail-item " + (isDone ? "done-item" : "in-progress");
            var rawBody = String(c.body || "");
            var meta = [];
            if (c.kind) meta.push(String(c.kind));
            if (c.ts) meta.push(rel(c.ts) + " · " + denver(c.ts) + " Denver");
            
            li.innerHTML =
              '<span class="rail-phase ' + esc(c.phase) + '">' + esc(c.phase) + "</span>" +
              (c.from ? ' <span class="rail-from">from ' + esc(c.from) + "</span>" : "") +
              '<p class="rail-title">' + esc(c.botName) + " · " + esc(plain(c.summary)) + "</p>" +
              (meta.length ? '<p class="rail-meta">' + esc(meta.join(" · ")) + "</p>" : "") +
              '<p class="rail-body">' + (rawBody ? linkifyHtml(rawBody) : esc(isDone ? "Done." : "In progress — mid-task update for cabin Grok.")) + "</p>";
            detailsRail.appendChild(li);
          });
        } else {
          detailsLabel.hidden = true;
          detailsRail.hidden = true;
        }
        lastContentSig = contentSig;
        lastUiSig = uiSig;
        restoreScrollMap(scrollMap);
      } catch (err) {
        try { console.error("screenr render", err); } catch (e) {}
        try {
          setGlassMode(false);
          if (emptyEl && botsEl && !botsEl.children.length) emptyEl.hidden = false;
        } catch (e2) {}
      }
    }

    function eventTargetEl(ev) {
      var t = ev.target;
      if (!t) return null;
      if (t.nodeType === 3) return t.parentElement;
      return t;
    }

    // Bullet-only lock (card-23): only [data-*-toggle] bullets change expand state.
    // A drag/scroll that starts on a card never toggles (Tesla scroll fix).
    var touchStartXY = null;
    var touchMoved = false;
    var lastSwipeAt = 0;
    document.addEventListener("touchstart", function (ev) {
      var p = ev.touches && ev.touches[0];
      touchStartXY = p ? { x: p.clientX, y: p.clientY } : null;
      touchMoved = false;
    }, { passive: true, capture: true });
    document.addEventListener("touchmove", function (ev) {
      var p = ev.touches && ev.touches[0];
      if (!p || !touchStartXY) return;
      if (Math.abs(p.clientX - touchStartXY.x) > 10 || Math.abs(p.clientY - touchStartXY.y) > 10) touchMoved = true;
    }, { passive: true, capture: true });
    document.addEventListener("touchend", function () {
      if (touchMoved) lastSwipeAt = Date.now();
    }, { passive: true, capture: true });
    function isSwipe(ev) {
      if (touchMoved) return true;
      if (!touchStartXY || !ev || !ev.changedTouches || !ev.changedTouches[0]) return false;
      var p = ev.changedTouches[0];
      return Math.abs(p.clientX - touchStartXY.x) > 10 || Math.abs(p.clientY - touchStartXY.y) > 10;
    }
    function recentSwipe() { return Date.now() - lastSwipeAt < 500; }

    function handleActivate(ev) {
      var t = eventTargetEl(ev);
      if (!t || !t.closest) return;

      // Done panel controls
      var doneToggle = t.closest("[data-done-toggle]");
      if (doneToggle) {
        ev.preventDefault();
        ev.stopPropagation();
        donePanelOpen = !donePanelOpen;
        if (!donePanelOpen) selectedDoneId = null;
        render();
        return;
      }
      var doneBack = t.closest("[data-done-back]");
      if (doneBack) {
        ev.preventDefault();
        ev.stopPropagation();
        selectedDoneId = null;
        donePanelOpen = true;
        render();
        return;
      }
      var doneViewBtn = t.closest("[data-done-view]");
      if (doneViewBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        doneView = doneViewBtn.getAttribute("data-done-view") === "summary" ? "summary" : "details";
        render();
        return;
      }
      var doneRow = t.closest("[data-done-id]");
      if (doneRow) {
        ev.preventDefault();
        ev.stopPropagation();
        selectedDoneId = doneRow.getAttribute("data-done-id");
        doneView = "details";
        donePanelOpen = true;
        render();
        return;
      }
      if (t.closest("#done-panel")) {
        if (t.closest("[data-result-scroll]") && !t.closest("[data-done-view]")) return;
        // done-panel controls handled above
        if (!t.closest("[data-done-toggle], [data-done-id], [data-done-back], [data-done-view]")) return;
      }

      if (t.closest("a[href]")) {
        ev.stopPropagation();
        return;
      }
      var viewBtn = t.closest("[data-view]");
      if (viewBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        var card = viewBtn.closest("li[data-bot]");
        if (!card) return;
        setView(card.getAttribute("data-bot"), viewBtn.getAttribute("data-view"));
        return;
      }
      // Only the bullet toggles a Fleet card; title, meta, pills and body are inert.
      var botToggle = t.closest("[data-bot-toggle]");
      if (!botToggle) return;
      if (recentSwipe()) return;
      ev.preventDefault();
      ev.stopPropagation();
      toggleExpand(botToggle.getAttribute("data-bot-toggle"));
    }

    if (fleetToggle) {
      fleetToggle.addEventListener("click", function (ev) {
        ev.preventDefault();
        fleetOpen = !fleetOpen;
        render();
      });
    }

    function activateCapture(ev) {
      var t = eventTargetEl(ev);
      if (!t || !t.closest) return;
      // Only the bullet toggles; title, meta, pill, body and links never change expand state.
      var btn = t.closest("[data-cap-toggle]");
      if (!btn) return;
      if (recentSwipe()) return;
      ev.preventDefault();
      ev.stopPropagation();
      var mode = btn.getAttribute("data-cap-toggle");
      if (mode === "row") {
        var key = btn.getAttribute("data-cap-key");
        var group = btn.getAttribute("data-cap-group") || "todo";
        if (selectedCaptureKey === key && selectedCaptureShell === group) {
          selectedCaptureKey = null;
          selectedCaptureShell = null;
        } else {
          selectedCaptureKey = key;
          selectedCaptureShell = group;
        }
        captureShellExpandedBy[group] = true;
        render();
        return;
      }
      if (mode === "item") {
        var itemCard = btn.closest("li[data-cap-item]");
        if (!itemCard) return;
        var ik = itemCard.getAttribute("data-cap-item");
        if (expandedCaptureKeys[ik]) delete expandedCaptureKeys[ik];
        else expandedCaptureKeys[ik] = 1;
        render();
        return;
      }
      var shellGroup = btn.getAttribute("data-cap-group") || "todo";
      captureShellExpandedBy[shellGroup] = !captureShellExpandedBy[shellGroup];
      if (!captureShellExpandedBy[shellGroup] && selectedCaptureShell === shellGroup) {
        selectedCaptureKey = null;
        selectedCaptureShell = null;
      }
      render();
    }
    if (captureList) {
      captureList.addEventListener("click", activateCapture);
    }

    function toggleResearchExpand(key) {
      if (expandedResearchKeys[key]) delete expandedResearchKeys[key];
      else expandedResearchKeys[key] = 1;
      render();
    }
    function setResearchView(key, view) {
      viewByKey["research:" + key] = view === "details" ? "details" : "summary";
      expandedResearchKeys[key] = 1;
      render();
    }
    function activateResearch(ev) {
      var t = eventTargetEl(ev);
      if (!t || !t.closest) return;
      if (t.closest("a[href]")) return;
      var viewBtn = t.closest("[data-research-view]");
      if (viewBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        setResearchView(viewBtn.getAttribute("data-research-view"), viewBtn.getAttribute("data-view"));
        return;
      }
      // Only the bullet toggles a Research card.
      var rToggle = t.closest("[data-research-toggle]");
      if (!rToggle) return;
      if (recentSwipe()) return;
      ev.preventDefault();
      ev.stopPropagation();
      toggleResearchExpand(rToggle.getAttribute("data-research-toggle"));
    }
    if (researchList) {
      researchList.addEventListener("click", activateResearch);
    }


    function bindDoneSurface(el) {
      if (!el) return;
      el.addEventListener("click", function (ev) {
        if (Date.now() - lastTouchToggle < 450) {
          ev.preventDefault();
          return;
        }
        handleActivate(ev);
      });
      el.addEventListener("touchend", function (ev) {
        var t = eventTargetEl(ev);
        if (!t || !t.closest) return;
        if (isSwipe(ev)) return;
        if (t.closest("[data-result-scroll]") || t.closest(".view-toggle")) {
          if (!t.closest("[data-done-view]")) return;
        }
        var interesting = t.closest("[data-done-toggle], [data-done-id], [data-done-back], [data-done-view]");
        if (!interesting) return;
        lastTouchToggle = Date.now();
        ev.preventDefault();
        handleActivate(ev);
      }, { passive: false });
    }
    bindDoneSurface(donePanel);
    bindDoneSurface(document.getElementById("done-toggle") && document.getElementById("done-toggle").parentElement);

    botsEl.addEventListener("click", function (ev) {
      if (Date.now() - lastTouchToggle < 450) {
        ev.preventDefault();
        return;
      }
      handleActivate(ev);
    });
    botsEl.addEventListener("touchend", function (ev) {
      var t = eventTargetEl(ev);
      if (!t || !t.closest) return;
      if (isSwipe(ev)) return;
      if (t.closest("a[href]")) return;
      if (t.closest("[data-result-scroll]") || t.closest(".view-toggle")) return;
      // Done-panel controls only; card expand is the bullet button's native click.
      var interesting = t.closest("[data-done-toggle], [data-done-id], [data-done-back], [data-done-view]");
      if (!interesting) return;
      lastTouchToggle = Date.now();
      ev.preventDefault();
      handleActivate(ev);
    }, { passive: false });

    function upsert(batch) {
      if (!Array.isArray(batch)) batch = [batch];
      var map = {};
      traces.forEach(function (t) { map[t.id] = t; });
      batch.forEach(function (t) {
        if (t && t.id) map[t.id] = t;
      });
      traces = Object.keys(map).map(function (k) { return map[k]; });
      traces.sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); });
      if (traces.length > 50) traces = traces.slice(0, 50);
      render();
    }


    /** Stale Tesla WebViews keep old JS over SSE; reload once when server UI version differs. */
    function maybeReloadForUi(serverUi) {
      if (!serverUi || String(serverUi) === GLASS_UI_VER) return false;
      var key = "glass-ui-reload:" + String(serverUi);
      try {
        if (sessionStorage.getItem(key) === "1") return false;
        sessionStorage.setItem(key, "1");
      } catch (e) {}
      try { location.reload(); } catch (e2) {}
      return true;
    }

    /** Apply /list or snapshot payload. Returns true if a UI reload was triggered. */
    function applyServerPayload(data) {
      if (!data) return false;
      if (maybeReloadForUi(data.ui)) return true;
      var next = Array.isArray(data.traces) ? data.traces : (Array.isArray(data) ? data : null);
      if (!next) return false;
      if (tracesContentSig(next) === tracesContentSig(traces) && lastContentSig) {
        refreshRelTimes();
        return false;
      }
      traces = next;
      render();
      return false;
    }

    function pullList(thenConnect) {
      fetch(glassApi("/list"), { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("list " + r.status);
          return r.json();
        })
        .then(function (data) {
          if (applyServerPayload(data)) return;
          setStatus("Connected", "live");
          if (thenConnect) connect();
        })
        .catch(function (err) {
          try { console.error("screenr list pull", err); } catch (e) {}
          setStatus("Reconnecting", "err");
          if (thenConnect) connect();
        });
    }

    function connect() {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (es) {
        try { es.close(); } catch (e) {}
        es = null;
      }
      var url = glassApi("/events");
      try {
        es = new EventSource(url);
      } catch (e) {
        setStatus("Reconnecting", "err");
        retryTimer = setTimeout(connect, 3000);
        return;
      }
      es.addEventListener("snapshot", function (ev) {
        try {
          var data = JSON.parse(ev.data);
          if (applyServerPayload(data)) return;
          setStatus("Connected", "live");
        } catch (e) {}
      });
      es.addEventListener("trace", function (ev) {
        try {
          upsert(JSON.parse(ev.data));
          setStatus("Connected", "live");
        } catch (e) {}
      });
      es.onerror = function () {
        setStatus("Reconnecting", "err");
        try { if (es) es.close(); } catch (e) {}
        es = null;
        // Pull list immediately — Tesla WebViews often drop SSE without delivering the missed traces.
        pullList(false);
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 2500);
      };
    }

    function bootstrap() {
      setStatus("Connecting", "");
      render();
      pullList(true);
    }

    bootstrap();
    // Content poll: UI-version auto-reload alone does NOT refresh todos when SSE dies silently.
    setInterval(function () {
      render();
      pullList(false);
      // If EventSource looks dead, force reconnect.
      try {
        if (!es || es.readyState === 2) connect();
      } catch (e) {}
    }, 5000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        pullList(false);
        try { if (!es || es.readyState !== 1) connect(); } catch (e) {}
      }
    });
    window.addEventListener("pageshow", function () {
      pullList(false);
      try { if (!es || es.readyState !== 1) connect(); } catch (e) {}
    });
  })();
  </script>
</body>
</html>`;
}

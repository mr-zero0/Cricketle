// Cricketle v2 client.
//
// Views: Play (#play), Leaderboard (#leaderboard), Profile (#profile).
// Two stores share one interface: LocalStore keeps a guest's day in localStorage and
// runs the shared engine in the browser; RemoteStore talks to the server, which runs
// the same engine for signed-in players so leaderboard results are verified.

(function () {
  "use strict";

  const core = window.CricketleCore;
  const { COUNTRIES } = core.data;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const MESSAGES = {
    locked: "That puzzle is still locked.",
    not_ready: "That puzzle has already been started.",
    not_active: "That puzzle is not in play.",
    unknown_player: "Pick a player from the list.",
    already_guessed: "You already guessed that player.",
    no_hints_left: "No hints left for this puzzle.",
    network: "Could not reach the server. Check your connection and try again.",
  };

  const STARTERS = ["Virat Kohli", "Ricky Ponting", "AB de Villiers", "Babar Azam", "Chris Gayle"];
  const GUEST_KEY = "cricketle:v2:guest";
  const MODE_KEY = "cricketle:v2:mode";

  // ---------- Errors + API ----------

  class ApiError extends Error {
    constructor(code, message, status) {
      super(message || MESSAGES[code] || code);
      this.code = code;
      this.status = status;
    }
  }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
      });
    } catch (_) {
      throw new ApiError("network", MESSAGES.network, 0);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    if (!res.ok) throw new ApiError((json && json.error) || "http_" + res.status, json && json.message, res.status);
    return json;
  }

  // ---------- Stores ----------

  function presentLocal(raw, now) {
    const hints = {};
    const answers = {};
    for (const mode of core.MODES) {
      hints[mode] = raw.modes[mode].puzzles.map((_, i) => core.revealedHints(raw, mode, i));
      answers[mode] = raw.modes[mode].puzzles.map((p, i) => (core.isFinished(p) ? core.describe(core.answerFor(raw.day, mode, i)) : null));
    }
    return { day: raw.day, now, state: Object.assign({}, raw, { hints, answers }) };
  }

  class LocalStore {
    constructor() { this.kind = "local"; }
    now() { return Date.now(); }
    read() {
      try {
        const s = JSON.parse(localStorage.getItem(GUEST_KEY));
        if (s && s.day === core.todayKey(this.now()) && s.modes) return s;
      } catch (_) { /* ignore */ }
      return null;
    }
    write(s) {
      try { localStorage.setItem(GUEST_KEY, JSON.stringify(s)); } catch (_) { /* ignore */ }
    }
    raw() {
      let s = this.read();
      if (!s) { s = core.newDayState(core.todayKey(this.now())); this.write(s); }
      return s;
    }
    async load() { return presentLocal(this.raw(), this.now()); }
    run(fn, extras) {
      const now = this.now();
      const r = fn(this.raw(), now);
      if (!r.ok) throw new ApiError(r.error);
      this.write(r.state);
      return Object.assign(presentLocal(r.state, now), extras ? extras(r) : null);
    }
    async start(mode, idx) {
      return this.run((s, now) => core.startPuzzle(s, mode, idx, now));
    }
    async guess(mode, idx, name) {
      return this.run((s, now) => core.applyGuess(s, mode, idx, name, now), (r) => {
        const p = r.state.modes[mode].puzzles[idx];
        return { rank: r.rank, solved: r.solved, guess: p.guesses[p.guesses.length - 1], answer: r.solved ? core.describe(core.answerFor(r.state.day, mode, idx)) : undefined };
      });
    }
    async hint(mode, idx) {
      return this.run((s, now) => core.useHint(s, mode, idx, now), (r) => ({ hint: r.hint }));
    }
    async giveUp(mode, idx) {
      return this.run((s, now) => core.giveUp(s, mode, idx, now), (r) => ({ answer: core.describe(core.answerFor(r.state.day, mode, idx)) }));
    }
  }

  class RemoteStore {
    constructor() { this.kind = "remote"; this.offset = 0; }
    now() { return Date.now() + this.offset; }
    sync(data) {
      if (data && typeof data.now === "number") this.offset = data.now - Date.now();
      return data;
    }
    async load() { return this.sync(await api("GET", "/api/state")); }
    async start(mode, idx) { return this.sync(await api("POST", "/api/puzzle/start", { mode, idx })); }
    async guess(mode, idx, name) { return this.sync(await api("POST", "/api/puzzle/guess", { mode, idx, name })); }
    async hint(mode, idx) { return this.sync(await api("POST", "/api/puzzle/hint", { mode, idx })); }
    async giveUp(mode, idx) { return this.sync(await api("POST", "/api/puzzle/giveup", { mode, idx })); }
  }

  // ---------- App state ----------

  const app = {
    store: null,
    user: null,
    stats: null,
    offline: false,
    day: null,
    state: null,
    mode: "easy",
    current: { easy: 0, hard: 0 },
    view: "play",
    board: { tab: "today", data: {}, loading: false },
    authTab: "signin",
    lastGuess: null,
    busy: false,
  };

  try { if (core.MODES.includes(localStorage.getItem(MODE_KEY))) app.mode = localStorage.getItem(MODE_KEY); } catch (_) { /* ignore */ }

  const puzzles = () => app.state.modes[app.mode].puzzles;
  const idx = () => app.current[app.mode];
  const puzzle = () => puzzles()[idx()];
  const isHard = () => app.mode === "hard";
  const poolSize = () => core.poolFor(app.mode).length;
  const modeLabel = (m) => (m === "hard" ? "Hard" : "Easy");

  function applyPresentation(p) {
    app.day = p.day;
    app.state = p.state;
  }

  // Default to the first unfinished puzzle of each mode.
  function pickCurrent() {
    for (const m of core.MODES) {
      const ps = app.state.modes[m].puzzles;
      let i = ps.findIndex((p) => !core.isFinished(p) && p.status !== "locked");
      if (i < 0) i = ps.length - 1;
      if (!Number.isInteger(app.current[m]) || ps[app.current[m]] == null || ps[app.current[m]].status === "locked") app.current[m] = i;
    }
  }

  // ---------- DOM refs ----------

  const input = $("guess-input");
  const suggestions = $("suggestions");
  const message = $("message");
  const guessList = $("guess-list");
  const lastGuess = $("last-guess");
  const win = $("win");
  const empty = $("empty");
  const starters = $("starters");
  const guessCount = $("guess-count");
  const closest = $("closest");
  const worth = $("worth");
  const timerEl = $("timer");
  const giveUpBtn = $("give-up");
  const dots = $("dots");
  const trackerLabel = $("tracker-label");
  const resetEl = $("reset");
  const hintList = $("hint-list");
  const startPanel = $("start-panel");
  const guessBox = $("guess-box");
  const toasts = $("toasts");

  // ---------- Utilities ----------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function setMessage(text, warn) {
    message.textContent = text || "";
    message.classList.toggle("warn", Boolean(warn));
  }

  function toast(text, kind) {
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = text;
    toasts.appendChild(el);
    while (toasts.children.length > 3) toasts.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), reduceMotion.matches ? 0 : 260);
    }, 3600);
  }

  function bump(el) {
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }

  function countUp(el, target) {
    if (reduceMotion.matches || target <= 1) return;
    const start = performance.now();
    const dur = 600;
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.max(1, Math.round(1 + (target - 1) * eased));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function confirmDialog() {
    const dlg = $("confirm");
    return new Promise((resolve) => {
      const done = () => { dlg.removeEventListener("close", done); resolve(dlg.returnValue === "ok"); };
      dlg.addEventListener("close", done);
      dlg.returnValue = "cancel";
      dlg.showModal();
    });
  }

  function setBusy(flag) {
    app.busy = flag;
    document.body.classList.toggle("busy", flag);
  }

  function setSegmented(el, right) {
    el.classList.toggle("right", right);
  }

  function handleError(err) {
    if (err instanceof ApiError && err.status === 401 && app.store && app.store.kind === "remote") {
      toast("Your session ended. Sign in again to keep playing for the leaderboard.", "error");
      becomeGuest();
      return;
    }
    const text = err instanceof ApiError ? err.message : "Something went wrong.";
    setMessage(text, true);
    if (!(err instanceof ApiError)) console.error(err);
    // Another device may have moved this account's puzzle on: pull the server's view.
    if (err instanceof ApiError && app.store && app.store.kind === "remote" && ["not_active", "not_ready", "locked"].includes(err.code)) {
      reload().catch(() => {});
    }
  }

  // ---------- Rendering: play ----------

  function rowHtml(g, opts) {
    const pl = core.byName(g.name);
    const t = core.tier(g.rank, poolSize());
    const n = poolSize();
    const width = Math.max(6, Math.round(100 * (1 - (g.rank - 1) / Math.max(1, n - 1))));
    const tags = g.rank === 1 ? [] : g.tags || [];
    const classes = ["row", "tier-" + t.key, opts.flash ? "flash" : "", opts.enter ? "enter" : ""].filter(Boolean).join(" ");
    return `
      <li class="${classes}" data-name="${escapeHtml(g.name)}">
        <div class="bar" style="width:${width}%"></div>
        <div class="who">
          <span class="name">${escapeHtml(g.name)}</span>
          <span class="meta">${escapeHtml(COUNTRIES[pl.country])} · ${escapeHtml(pl.role)}</span>
        </div>
        <div class="rank-wrap">
          <span class="rank" aria-label="Rank ${g.rank}">${g.rank}</span>
          <span class="tier-label">${t.label}</span>
        </div>
        ${tags.length ? `<div class="tags">${tags.map((x, i) => `<span class="tag" style="--i:${i}">${escapeHtml(x)}</span>`).join("")}</div>` : ""}
      </li>`;
  }

  let celebrateDot = false;

  function renderTracker() {
    const ps = puzzles();
    $("mode-easy").classList.toggle("active", !isHard());
    $("mode-easy").setAttribute("aria-pressed", String(!isHard()));
    $("mode-hard").classList.toggle("active", isHard());
    $("mode-hard").setAttribute("aria-pressed", String(isHard()));
    setSegmented($("mode-easy").parentElement, isHard());
    document.body.classList.toggle("hard", isHard());

    const parts = ps.map((p, i) => {
      const labels = { locked: "locked", ready: "ready to start", active: "in progress", solved: "solved", gaveUp: "given up" };
      let cls = "dot " + p.status;
      if (i === idx()) cls += " current";
      if (i === idx() && celebrateDot) cls += " pop";
      let inner;
      if (p.status === "solved") inner = `<svg aria-hidden="true"><use href="#i-check"/></svg><span class="dot-pts">${p.points}</span>`;
      else if (p.status === "gaveUp") inner = `<svg aria-hidden="true"><use href="#i-flag"/></svg><span class="dot-pts">0</span>`;
      else if (p.status === "locked") inner = `<svg aria-hidden="true"><use href="#i-lock"/></svg>`;
      else inner = `<span>${i + 1}</span>`;
      return `<button type="button" class="${cls}" data-i="${i}" aria-label="Puzzle ${i + 1}: ${labels[p.status]}" ${p.status === "locked" ? "disabled" : ""} aria-current="${i === idx() ? "true" : "false"}">${inner}</button>`;
    });
    dots.innerHTML = parts.join("");
    celebrateDot = false;
    trackerLabel.textContent = `${modeLabel(app.mode)} · Puzzle ${idx() + 1} of ${core.PUZZLES_PER_DAY}`;

    const pts = core.dayPoints(app.state);
    $("today-points").innerHTML = `Today: <strong>${pts.total} pts</strong> <span class="muted">(${modeLabel(app.mode)} ${pts[app.mode]})</span>`;
    const rankEl = $("today-rank");
    if (app.user && app.stats) {
      rankEl.innerHTML = app.stats.todayRank
        ? `<a href="#leaderboard">Rank <strong>#${app.stats.todayRank}</strong> of ${app.stats.todayTotal}</a>`
        : `<a href="#leaderboard">Finish a puzzle to be ranked</a>`;
    } else if (!app.offline) {
      rankEl.innerHTML = `<a href="#profile">Sign in to be ranked</a>`;
    } else {
      rankEl.textContent = "";
    }
  }

  function renderHints() {
    const p = puzzle();
    const revealed = (app.state.hints && app.state.hints[app.mode] && app.state.hints[app.mode][idx()]) || [];
    const items = [];
    for (let n = 1; n <= core.HINTS_PER_PUZZLE; n++) {
      const label = core.HINT_LABELS[n - 1];
      if (n <= p.hints) {
        const h = revealed[n - 1];
        items.push(`<li class="hint revealed"><span class="hint-num" aria-hidden="true"><svg><use href="#i-bulb"/></svg></span>
          <div class="hint-body"><span class="hint-label">Hint ${n} · ${label}</span><span class="hint-text">${escapeHtml(h ? h.text : "")}</span></div><span></span></li>`);
      } else if (n === p.hints + 1 && p.status === "active") {
        items.push(`<li class="hint next"><span class="hint-num" aria-hidden="true">${n}</span>
          <div class="hint-body"><span class="hint-label">Hint ${n}</span><span class="hint-text">${label}</span></div>
          <button type="button" class="btn small reveal-btn" data-n="${n}" aria-label="Reveal hint ${n}, ${label}, costs ${core.HINT_COST} points">Reveal · −${core.HINT_COST}</button></li>`);
      } else {
        items.push(`<li class="hint locked"><span class="hint-num" aria-hidden="true"><svg><use href="#i-lock"/></svg></span>
          <div class="hint-body"><span class="hint-label">Hint ${n}</span><span class="hint-text">${label}</span></div><span class="muted small-text">After hint ${n - 1}</span></li>`);
      }
    }
    hintList.innerHTML = items.join("");
  }

  function renderStart() {
    const p = puzzle();
    const show = p.status === "ready";
    startPanel.hidden = !show;
    if (!show) return;
    const n = idx() + 1;
    $("start-eyebrow").textContent = `Puzzle ${n} of ${core.PUZZLES_PER_DAY} · ${modeLabel(app.mode)}`;
    $("start-title").textContent = n === 1 ? "Ready when you are" : "Next one up";
    $("start-copy").textContent = isHard()
      ? `Hard mode: ${poolSize()} players, rank only, no clue tags. The clock starts when you press Start. A Hard solve counts 1.5×.`
      : `Easy mode: ${poolSize()} well-known players, with tags for what each guess shares with the answer. The clock starts when you press Start.`;
  }

  function renderWin() {
    const p = puzzle();
    if (!core.isFinished(p)) { win.hidden = true; return; }
    const a = app.state.answers && app.state.answers[app.mode] ? app.state.answers[app.mode][idx()] : null;
    const n = p.guesses.length;
    const lost = p.status === "gaveUp";
    win.hidden = false;
    win.classList.toggle("lost", lost);
    const time = core.formatTime(core.elapsedMs(p, app.store.now()));
    const title = a ? a.name : "Unknown";
    const sub = a ? `${a.countryName} · ${a.role} · debut ${a.debut}` : "";
    const nextReady = puzzles()[idx() + 1] && puzzles()[idx() + 1].status === "ready";
    const allDone = core.modeDone(app.state, app.mode);
    const otherMode = isHard() ? "easy" : "hard";
    const otherDone = core.modeDone(app.state, otherMode);

    let actions = `<button id="share-btn" class="btn" type="button"><svg aria-hidden="true"><use href="#i-copy"/></svg> Copy result</button>`;
    let note = "";
    if (nextReady) {
      actions += `<button id="next-btn" class="btn primary" type="button">Next puzzle <svg aria-hidden="true"><use href="#i-arrow"/></svg></button>`;
    } else if (allDone) {
      if (!otherDone) {
        actions += `<button id="other-mode-btn" class="btn primary" type="button">Try ${modeLabel(otherMode)} mode <svg aria-hidden="true"><use href="#i-arrow"/></svg></button>`;
        note = `<p class="done-note">All ${core.PUZZLES_PER_DAY} ${modeLabel(app.mode)} puzzles done for today.</p>`;
      } else {
        actions += `<a href="#leaderboard" class="btn primary">Leaderboard <svg aria-hidden="true"><use href="#i-trophy"/></svg></a>`;
        note = `<p class="done-note">That's all six for today. New puzzles at midnight IST.</p>`;
      }
    }
    win.innerHTML = `
      <p class="eyebrow">${modeLabel(app.mode)} · Puzzle ${idx() + 1} · ${lost ? "the answer was" : "you got it"}</p>
      <h2 tabindex="-1" id="win-title">${escapeHtml(title)}</h2>
      <p>${escapeHtml(sub)}</p>
      <div class="win-stats" role="list">
        <div class="win-stat" role="listitem"><span class="v">${n}</span><span class="k">guess${n === 1 ? "" : "es"}</span></div>
        <div class="win-stat" role="listitem"><span class="v">${time}</span><span class="k">time</span></div>
        <div class="win-stat" role="listitem"><span class="v">${p.hints}</span><span class="k">hint${p.hints === 1 ? "" : "s"}</span></div>
        <div class="win-stat points" role="listitem"><span class="v">${lost ? 0 : "+" + p.points}</span><span class="k">points</span></div>
      </div>
      ${note}
      <div class="actions">${actions}</div>`;
    $("share-btn").addEventListener("click", share);
    const next = $("next-btn");
    if (next) next.addEventListener("click", () => { app.current[app.mode] = idx() + 1; render(); $("start-btn").focus(); });
    const other = $("other-mode-btn");
    if (other) other.addEventListener("click", () => setMode(otherMode));
  }

  function render(opts = {}) {
    if (!app.state) return;
    const p = puzzle();
    renderTracker();

    const active = p.status === "active";
    const finished = core.isFinished(p);

    guessCount.textContent = p.guesses.length;
    const best = p.guesses.length ? Math.min(...p.guesses.map((g) => g.rank)) : null;
    closest.textContent = best ? "#" + best : "–";
    updateTimer(true);

    $("guest-banner").hidden = Boolean(app.user) || app.offline;
    giveUpBtn.hidden = !active;
    guessBox.hidden = !active;
    renderStart();
    empty.hidden = !(active && p.guesses.length === 0);
    if (!empty.hidden) {
      const picks = STARTERS.filter((nm) => core.inPool(app.mode, nm) && !p.guesses.some((g) => g.name === nm));
      starters.innerHTML = picks.map((nm) => `<button type="button" class="starter">${escapeHtml(nm)}</button>`).join("");
    }
    if (active) renderHints();

    const sorted = [...p.guesses].sort((a, b) => a.rank - b.rank);
    guessList.innerHTML = sorted.length
      ? `<p class="label">All guesses, closest first</p>` + sorted.map((g) => rowHtml(g, {})).join("")
      : "";

    const last = p.guesses[p.guesses.length - 1];
    if (last && !finished) {
      lastGuess.hidden = false;
      lastGuess.innerHTML = `<p class="label">Latest guess</p><ol class="guess-list">${rowHtml(last, { flash: true, enter: opts.animateLast })}</ol>`;
      if (opts.animateLast) {
        countUp(lastGuess.querySelector(".rank"), last.rank);
        bump(guessCount);
        if (best === last.rank) bump(closest);
      }
    } else {
      lastGuess.hidden = true;
    }

    input.disabled = !active;
    input.placeholder = isHard() ? "Type any cricketer's name" : "Type a well-known cricketer";
    renderWin();
    renderNav();
  }

  // ---------- Timer + countdown ----------

  let lastTimerText = "";
  let lastWorth = "";

  function updateTimer(force) {
    if (!app.state) return;
    const p = puzzle();
    const wrap = timerEl.parentElement;
    const text = core.formatTime(core.elapsedMs(p, app.store.now()));
    if (force || text !== lastTimerText) { timerEl.textContent = text; lastTimerText = text; }
    wrap.classList.toggle("running", p.status === "active");
    wrap.classList.toggle("done", core.isFinished(p));
    let w;
    if (p.status === "active") {
      w = core.scorePuzzle({ mode: app.mode, guesses: p.guesses.length + 1, hints: p.hints, seconds: core.elapsedMs(p, app.store.now()) / 1000, solved: true });
    } else if (core.isFinished(p)) {
      w = p.points;
    } else {
      w = core.scorePuzzle({ mode: app.mode, guesses: 1, hints: 0, seconds: 0, solved: true });
    }
    if (force || String(w) !== lastWorth) { worth.textContent = w; lastWorth = String(w); }
    $("worth").parentElement.querySelector(".stat-label").textContent = core.isFinished(p) ? "Scored" : "Worth";
  }

  let rolling = false;

  async function tick() {
    if (!app.store || !app.state) return;
    const now = app.store.now();
    if (core.todayKey(now) !== app.day && !rolling) {
      rolling = true;
      try {
        await reload();
        toast("A new day in IST. Fresh puzzles unlocked.", "success");
      } catch (err) { handleError(err); } finally { rolling = false; }
      return;
    }
    const ms = Math.max(0, core.msUntilReset(now));
    resetEl.textContent = "Resets in " + core.formatTime(ms);
    updateTimer(false);
  }

  // ---------- Actions ----------

  async function startPuzzle() {
    if (app.busy) return;
    const i = idx();
    try {
      setBusy(true);
      $("start-btn").classList.add("loading");
      applyPresentation(await app.store.start(app.mode, i));
      setMessage("");
      render();
      input.focus();
    } catch (err) { handleError(err); } finally { setBusy(false); $("start-btn").classList.remove("loading"); }
  }

  async function submitGuess(name) {
    const p = puzzle();
    if (!p || p.status !== "active" || app.busy) return;
    const pl = core.byName(name);
    if (!pl || !core.inPool(app.mode, name)) {
      setMessage(pl ? `${name} is not in the ${modeLabel(app.mode)} pool.` : "Pick a player from the list.", true);
      return;
    }
    const dup = p.guesses.find((g) => g.name === name);
    if (dup) {
      setMessage(`Already guessed: ${name} is rank ${dup.rank}.`, true);
      const row = guessList.querySelector(`[data-name="${CSS.escape(name)}"]`);
      if (row) {
        row.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
        row.classList.remove("shake");
        void row.offsetWidth;
        row.classList.add("shake");
      }
      input.value = "";
      hideSuggestions();
      return;
    }
    input.value = "";
    hideSuggestions();
    const i = idx();
    try {
      setBusy(true);
      const res = await app.store.guess(app.mode, i, name);
      applyPresentation(res);
      setMessage("");
      if (res.solved) {
        celebrateDot = true;
        window.CricketleFX?.burst(isHard() ? ["#f59e0b", "#fbbf24", "#f8fafc", "#22c55e"] : ["#22c55e", "#86efac", "#f8fafc", "#f59e0b"]);
      }
      render({ animateLast: true });
      if (res.solved) {
        const pts = app.state.modes[app.mode].puzzles[i].points;
        toast(`Solved in ${res.state.modes[app.mode].puzzles[i].guesses.length} guess${res.state.modes[app.mode].puzzles[i].guesses.length === 1 ? "" : "es"}. +${pts} points.`, "success");
        win.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "nearest" });
        $("win-title")?.focus({ preventScroll: true });
        refreshStats();
      } else {
        input.focus();
      }
    } catch (err) { handleError(err); input.focus(); } finally { setBusy(false); }
  }

  async function revealHint(btn) {
    if (app.busy) return;
    const i = idx();
    try {
      setBusy(true);
      btn.classList.add("loading");
      const res = await app.store.hint(app.mode, i);
      applyPresentation(res);
      render();
      setMessage(`Hint ${res.hint.n}: ${res.hint.text}`);
      const nextBtn = hintList.querySelector(".reveal-btn");
      (nextBtn || input).focus();
    } catch (err) { handleError(err); } finally { setBusy(false); btn.classList.remove("loading"); }
  }

  async function doGiveUp() {
    const p = puzzle();
    if (!p || p.status !== "active" || app.busy) return;
    if (!(await confirmDialog())) return;
    const i = idx();
    try {
      setBusy(true);
      applyPresentation(await app.store.giveUp(app.mode, i));
      render();
      $("win-title")?.focus({ preventScroll: true });
      refreshStats();
    } catch (err) { handleError(err); } finally { setBusy(false); }
  }

  function setMode(mode) {
    if (!core.MODES.includes(mode) || mode === app.mode) return;
    app.mode = mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch (_) { /* ignore */ }
    setMessage("");
    hideSuggestions();
    render();
  }

  function viewPuzzle(i) {
    const ps = puzzles();
    if (!ps[i] || ps[i].status === "locked" || i === idx()) return;
    app.current[app.mode] = i;
    setMessage("");
    render();
  }

  function share() {
    const p = puzzle();
    const ps = puzzles();
    const n = p.guesses.length;
    const time = core.formatTime(core.elapsedMs(p, app.store.now()));
    const summary = ps.map((q) => (core.isFinished(q) ? (q.status === "gaveUp" ? "✕" : String(q.points)) : "·")).join(" · ");
    const head = `Cricketle ${app.day} · ${modeLabel(app.mode)} ${idx() + 1}/${core.PUZZLES_PER_DAY}`;
    const line = p.status === "gaveUp"
      ? `🏳️ Gave up after ${n} guess${n === 1 ? "" : "es"} · ${time}`
      : `✅ ${n} guess${n === 1 ? "" : "es"} · ${time} · ${p.hints} hint${p.hints === 1 ? "" : "s"} · ${p.points} pts`;
    const text = `${head}\n${line}\nToday: ${summary}`;
    const btn = $("share-btn");
    const ok = () => {
      btn.innerHTML = `<svg aria-hidden="true"><use href="#i-check"/></svg> Copied`;
      setTimeout(() => { btn.innerHTML = `<svg aria-hidden="true"><use href="#i-copy"/></svg> Copy result`; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, () => toast("Could not copy. " + text.replace(/\n/g, " "), "error"));
    } else {
      toast(text.replace(/\n/g, " "));
    }
  }

  // ---------- Autocomplete ----------

  let highlighted = -1;
  let currentMatches = [];

  function hideSuggestions() {
    suggestions.hidden = true;
    suggestions.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    highlighted = -1;
    currentMatches = [];
  }

  function highlightMatch(name, q) {
    const i = name.toLowerCase().indexOf(q);
    if (i < 0) return escapeHtml(name);
    return escapeHtml(name.slice(0, i)) + "<mark>" + escapeHtml(name.slice(i, i + q.length)) + "</mark>" + escapeHtml(name.slice(i + q.length));
  }

  function showSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) { hideSuggestions(); return; }
    const guessed = new Set(puzzle().guesses.map((g) => g.name));
    const starts = (pl) => pl.name.toLowerCase().startsWith(q);
    currentMatches = core.poolFor(app.mode)
      .filter((pl) => pl.name.toLowerCase().includes(q))
      .sort((a, b) => (starts(a) === starts(b) ? a.name.localeCompare(b.name) : starts(a) ? -1 : 1))
      .slice(0, 8);
    if (!currentMatches.length) { hideSuggestions(); return; }
    highlighted = 0;
    suggestions.hidden = false;
    input.setAttribute("aria-expanded", "true");
    suggestions.innerHTML = currentMatches.map((pl, i) => {
      const done = guessed.has(pl.name);
      return `
      <li role="option" id="opt-${i}" aria-selected="${i === highlighted}" data-name="${escapeHtml(pl.name)}"
          class="${i === highlighted ? "highlight" : ""}${done ? " guessed" : ""}">
        <span>${highlightMatch(pl.name, q)}</span>
        <span class="sub">${COUNTRIES[pl.country]} · ${pl.role}${done ? " · guessed" : ""}</span>
      </li>`;
    }).join("");
    input.setAttribute("aria-activedescendant", "opt-0");
  }

  function moveHighlight(delta) {
    if (!currentMatches.length) return;
    highlighted = (highlighted + delta + currentMatches.length) % currentMatches.length;
    [...suggestions.children].forEach((li, i) => {
      li.classList.toggle("highlight", i === highlighted);
      li.setAttribute("aria-selected", String(i === highlighted));
    });
    input.setAttribute("aria-activedescendant", `opt-${highlighted}`);
    suggestions.children[highlighted]?.scrollIntoView({ block: "nearest" });
  }

  // ---------- Views + navigation ----------

  const VIEWS = ["play", "leaderboard", "profile"];

  function currentView() {
    const h = location.hash.replace("#", "");
    return VIEWS.includes(h) ? h : "play";
  }

  function renderNav() {
    const label = app.user ? app.user.username : "Sign in";
    $("nav-profile-label").textContent = label;
    $("tab-profile-label").textContent = app.user ? "Profile" : "Sign in";
    document.querySelectorAll("[data-view]").forEach((el) => {
      if (el.dataset.view === app.view) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
  }

  function showView() {
    app.view = currentView();
    for (const v of VIEWS) $("view-" + v).hidden = v !== app.view;
    renderNav();
    hideSuggestions();
    if (app.view === "leaderboard") loadBoard(false);
    if (app.view === "profile") renderProfile();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // ---------- Leaderboard ----------

  function formatSeconds(s) {
    return core.formatTime(s * 1000);
  }

  function renderBoard() {
    const tab = app.board.tab;
    const data = app.board.data[tab];
    const list = $("board-list");
    const emptyEl = $("board-empty");
    const me = $("board-me");
    $("tab-today").classList.toggle("active", tab === "today");
    $("tab-today").setAttribute("aria-selected", String(tab === "today"));
    $("tab-alltime").classList.toggle("active", tab === "alltime");
    $("tab-alltime").setAttribute("aria-selected", String(tab === "alltime"));
    setSegmented($("tab-today").parentElement, tab === "alltime");

    if (app.offline) {
      me.hidden = true;
      list.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent = "Leaderboards need the Cricketle server. Start it with npm start and open the server address.";
      $("board-updated").textContent = "";
      return;
    }

    if (!data) {
      me.hidden = true;
      list.innerHTML = Array.from({ length: 5 }, () => `<li class="skeleton" aria-hidden="true"></li>`).join("");
      list.setAttribute("aria-busy", "true");
      emptyEl.hidden = true;
      return;
    }
    list.removeAttribute("aria-busy");

    // The viewer's own standing.
    if (app.user) {
      me.hidden = false;
      me.classList.remove("guest");
      if (data.me) {
        const extra = tab === "today"
          ? `<div><span class="k">Solved</span><span class="v">${data.me.solved} / ${core.PUZZLES_PER_DAY * 2}</span></div><div><span class="k">Time</span><span class="v">${formatSeconds(data.me.seconds)}</span></div>`
          : `<div><span class="k">Title</span><span class="v">${escapeHtml(data.me.title)}</span></div><div><span class="k">Days</span><span class="v">${data.me.days}</span></div>`;
        me.innerHTML = `<div><span class="k">Your rank</span><span class="big">#${data.me.rank}</span></div>
          <div class="me-mid"><div><span class="k">Points</span><span class="v">${data.me.points}</span></div>${extra}</div>
          <div class="muted small-text">of ${data.total}</div>`;
      } else {
        me.innerHTML = `<div><span class="k">Your rank</span><span class="big">–</span></div>
          <div class="me-mid"><p class="muted" style="margin:0">${tab === "today" ? "Finish a puzzle today to be ranked." : "Finish a puzzle to join the all-time table."}</p></div>
          <a href="#play" class="btn small">Play</a>`;
      }
    } else {
      me.hidden = false;
      me.classList.add("guest");
      me.innerHTML = `<p><strong>Playing as a guest.</strong> Sign in to be ranked and keep a streak.</p><a href="#profile" class="btn small primary">Sign in</a>`;
    }

    if (!data.rows.length) {
      list.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent = tab === "today" ? "No one has finished a puzzle yet today. Be the first." : "No results yet. Solve a puzzle to open the table.";
    } else {
      emptyEl.hidden = true;
      list.innerHTML = data.rows.map((r, i) => {
        const sub = tab === "today"
          ? `${r.solved} solved · ${r.guesses} guess${r.guesses === 1 ? "" : "es"} · ${formatSeconds(r.seconds)}`
          : `<span class="title-chip">${escapeHtml(r.title)}</span> ${r.solved} solved · ${r.days} day${r.days === 1 ? "" : "s"}`;
        return `<li class="board-row${r.me ? " me" : ""}" style="--i:${i}">
          <span class="rank-badge r${r.rank}" aria-label="Rank ${r.rank}">${r.rank}</span>
          <div class="board-who"><span class="board-name">${escapeHtml(r.username)}${r.me ? ' <span class="muted small-text">(you)</span>' : ""}</span><span class="board-sub">${sub}</span></div>
          <div class="board-pts"><span class="v">${r.points}</span><span class="k">pts</span></div>
        </li>`;
      }).join("");
    }
    const when = new Date(data.loadedAt);
    $("board-updated").textContent = `${tab === "today" ? "IST day " + data.day + " · " : ""}Updated ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  async function loadBoard(force) {
    if (app.offline) { renderBoard(); return; }
    const tab = app.board.tab;
    const cached = app.board.data[tab];
    if (cached && !force && Date.now() - cached.loadedAt < 30 * 1000) { renderBoard(); return; }
    if (!cached) renderBoard();
    if (app.board.loading) return;
    app.board.loading = true;
    $("board-refresh").classList.add("loading");
    try {
      const data = await api("GET", tab === "today" ? "/api/leaderboard/today" : "/api/leaderboard/alltime");
      data.loadedAt = Date.now();
      app.board.data[tab] = data;
    } catch (err) {
      toast(err.message, "error");
    } finally {
      app.board.loading = false;
      $("board-refresh").classList.remove("loading");
      renderBoard();
    }
  }

  function setBoardTab(tab) {
    if (app.board.tab === tab) return;
    app.board.tab = tab;
    loadBoard(false);
  }

  // ---------- Profile + auth ----------

  function renderProfile() {
    $("offline-card").hidden = !app.offline;
    $("auth-card").hidden = app.offline || Boolean(app.user);
    $("profile-card").hidden = app.offline || !app.user;
    if (app.offline) return;
    if (!app.user) { renderAuthTab(); return; }
    const s = app.stats || {};
    const title = core.rankTitle(s.allTimePoints || 0);
    const progressPct = Math.round((title.progress || 0) * 100);
    const initial = app.user.username.slice(0, 1).toUpperCase();
    $("profile-card").innerHTML = `
      <div class="profile-head card">
        <div class="avatar" aria-hidden="true">${escapeHtml(initial)}</div>
        <div>
          <h3>${escapeHtml(app.user.username)}</h3>
          <div class="title-line"><span class="title-badge"><svg aria-hidden="true"><use href="#i-trophy"/></svg>${escapeHtml(title.title)}</span>
            <span>${s.allTimeRank ? `All-time rank #${s.allTimeRank} of ${s.allTimeTotal}` : "Not ranked yet"}</span></div>
        </div>
        <div class="progress">
          <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPct}" aria-label="Progress to next title"><span style="width:${progressPct}%"></span></div>
          <div class="progress-text"><span>${s.allTimePoints || 0} pts</span><span>${title.next ? `${title.next.min - (s.allTimePoints || 0)} to ${title.next.title}` : "Top of the ladder"}</span></div>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat-tile card hi"><span class="v">${s.todayPoints || 0}</span><span class="k">Today's points</span></div>
        <div class="stat-tile card hi"><span class="v">${s.todayRank ? "#" + s.todayRank : "–"}</span><span class="k">Today's rank</span></div>
        <div class="stat-tile card"><span class="v">${s.allTimePoints || 0}</span><span class="k">All-time points</span></div>
        <div class="stat-tile card"><span class="v">${s.allTimeRank ? "#" + s.allTimeRank : "–"}</span><span class="k">All-time rank</span></div>
        <div class="stat-tile card"><span class="v">${s.currentStreak || 0}</span><span class="k">Current streak</span></div>
        <div class="stat-tile card"><span class="v">${s.bestStreak || 0}</span><span class="k">Best streak</span></div>
        <div class="stat-tile card"><span class="v">${s.solved || 0}</span><span class="k">Puzzles solved</span></div>
        <div class="stat-tile card"><span class="v">${s.daysPlayed || 0}</span><span class="k">Days played</span></div>
      </div>
      <div class="profile-actions">
        <a href="#leaderboard" class="btn"><svg aria-hidden="true"><use href="#i-trophy"/></svg> Leaderboard</a>
        <button id="help-link" class="btn" type="button"><svg aria-hidden="true"><use href="#i-help"/></svg> How points work</button>
        <button id="signout-btn" class="btn" type="button"><svg aria-hidden="true"><use href="#i-logout"/></svg> Sign out</button>
      </div>`;
    $("signout-btn").addEventListener("click", signOut);
    $("help-link").addEventListener("click", () => $("help").showModal());
  }

  function renderAuthTab() {
    const signup = app.authTab === "signup";
    $("tab-signin").classList.toggle("active", !signup);
    $("tab-signin").setAttribute("aria-selected", String(!signup));
    $("tab-signup").classList.toggle("active", signup);
    $("tab-signup").setAttribute("aria-selected", String(signup));
    setSegmented($("tab-signin").parentElement, signup);
    $("confirm-field").hidden = !signup;
    $("auth-password").setAttribute("autocomplete", signup ? "new-password" : "current-password");
    $("auth-submit").textContent = signup ? "Create account" : "Sign in";
    clearAuthErrors();
  }

  function fieldError(id, text) {
    const field = $(id).closest(".field");
    field.classList.toggle("invalid", Boolean(text));
    $(id + "-error").textContent = text || "";
    $(id).setAttribute("aria-invalid", text ? "true" : "false");
  }

  function clearAuthErrors() {
    for (const id of ["auth-username", "auth-password", "auth-confirm"]) fieldError(id, "");
    $("auth-summary").hidden = true;
    $("auth-summary").innerHTML = "";
  }

  function validateAuth(onlyId) {
    const signup = app.authTab === "signup";
    const errors = [];
    const u = $("auth-username").value.trim();
    const p = $("auth-password").value;
    const c = $("auth-confirm").value;
    const check = (id, text) => { if (!onlyId || onlyId === id) fieldError(id, text); if (text) errors.push({ id, text }); };
    check("auth-username", !u ? "Enter a username." : !/^[A-Za-z0-9_]{3,20}$/.test(u) ? "Use 3–20 letters, numbers or underscores." : "");
    check("auth-password", !p ? "Enter a password." : p.length < 6 ? "Use at least 6 characters." : "");
    if (signup) check("auth-confirm", c !== p ? "Passwords do not match." : "");
    return errors;
  }

  async function submitAuth(ev) {
    ev.preventDefault();
    const errors = validateAuth();
    const summary = $("auth-summary");
    if (errors.length) {
      summary.hidden = false;
      summary.innerHTML = `<h3>There is a problem</h3><ul>${errors.map((e) => `<li><a href="#${e.id}">${escapeHtml(e.text)}</a></li>`).join("")}</ul>`;
      summary.focus();
      return;
    }
    summary.hidden = true;
    const btn = $("auth-submit");
    btn.classList.add("loading");
    btn.disabled = true;
    const signup = app.authTab === "signup";
    try {
      const res = await api("POST", signup ? "/api/auth/register" : "/api/auth/login", {
        username: $("auth-username").value.trim(),
        password: $("auth-password").value,
      });
      $("auth-form").reset();
      await becomeUser(res.user);
      toast(signup ? `Welcome, ${res.user.username}. Your results now count for the leaderboard.` : `Welcome back, ${res.user.username}.`, "success");
      location.hash = "#play";
    } catch (err) {
      if (err.code === "username_taken") fieldError("auth-username", "That username is taken.");
      else if (err.code === "invalid_username") fieldError("auth-username", err.message);
      else if (err.code === "invalid_password") fieldError("auth-password", err.message);
      else if (err.code === "bad_credentials") fieldError("auth-password", "Wrong username or password.");
      summary.hidden = false;
      summary.innerHTML = `<h3>${escapeHtml(err.message)}</h3>`;
      summary.focus();
    } finally {
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  }

  async function signOut() {
    try { await api("POST", "/api/auth/logout", {}); } catch (_) { /* ignore */ }
    becomeGuest();
    toast("Signed out. Playing as a guest on this device.");
    location.hash = "#play";
  }

  async function becomeUser(user) {
    app.user = user;
    app.store = new RemoteStore();
    app.board.data = {};
    await refreshStats();
    await reload();
    renderProfile();
  }

  async function becomeGuest() {
    app.user = null;
    app.stats = null;
    app.store = new LocalStore();
    app.board.data = {};
    try { await reload(); } catch (err) { handleError(err); }
    renderProfile();
  }

  async function refreshStats() {
    if (!app.user) return;
    try {
      const me = await api("GET", "/api/me");
      if (me.user) { app.stats = me.stats; if (app.store && app.store.sync) app.store.sync(me); }
      else { becomeGuest(); return; }
      app.board.data = {};
      renderTracker();
      if (app.view === "profile") renderProfile();
      if (app.view === "leaderboard") loadBoard(true);
    } catch (_) { /* leave the old numbers */ }
  }

  async function reload() {
    applyPresentation(await app.store.load());
    pickCurrent();
    render();
  }

  // ---------- Help dialog copy ----------

  function fillHelp() {
    const easy = core.tiers(core.poolFor("easy").length);
    const hard = core.tiers(core.poolFor("hard").length);
    $("legend-hot").textContent = `Hot: rank 2–${easy.hot}`;
    $("legend-warm").textContent = `Warm: to ${easy.warm} (Easy) / ${hard.warm} (Hard)`;
    $("legend-cool").textContent = `Cool: to ${easy.cool} (Easy) / ${hard.cool} (Hard)`;
    $("legend-cold").textContent = "Cold: beyond that";
    $("pool-easy").textContent = core.poolFor("easy").length;
    $("pool-hard").textContent = core.poolFor("hard").length;
    $("ladder").textContent = core.RANK_LADDER.map((r) => `${r.title} (${r.min.toLocaleString()})`).join(" → ");
  }

  // ---------- Events ----------

  input.addEventListener("input", () => showSuggestions(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveHighlight(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveHighlight(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (currentMatches.length) submitGuess(currentMatches[highlighted].name);
      else submitGuess(input.value.trim());
    } else if (e.key === "Escape") hideSuggestions();
  });
  suggestions.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (li) { e.preventDefault(); submitGuess(li.dataset.name); }
  });
  input.addEventListener("blur", () => setTimeout(hideSuggestions, 120));

  starters.addEventListener("click", (e) => {
    const btn = e.target.closest(".starter");
    if (btn) submitGuess(btn.textContent);
  });
  dots.addEventListener("click", (e) => {
    const btn = e.target.closest(".dot");
    if (btn && !btn.disabled) viewPuzzle(Number(btn.dataset.i));
  });
  hintList.addEventListener("click", (e) => {
    const btn = e.target.closest(".reveal-btn");
    if (btn) revealHint(btn);
  });
  $("start-btn").addEventListener("click", startPuzzle);
  giveUpBtn.addEventListener("click", doGiveUp);
  $("mode-easy").addEventListener("click", () => setMode("easy"));
  $("mode-hard").addEventListener("click", () => setMode("hard"));
  $("help-btn").addEventListener("click", () => $("help").showModal());
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  $("tab-today").addEventListener("click", () => setBoardTab("today"));
  $("tab-alltime").addEventListener("click", () => setBoardTab("alltime"));
  $("board-refresh").addEventListener("click", () => loadBoard(true));

  $("tab-signin").addEventListener("click", () => { app.authTab = "signin"; renderAuthTab(); });
  $("tab-signup").addEventListener("click", () => { app.authTab = "signup"; renderAuthTab(); });
  $("auth-form").addEventListener("submit", submitAuth);
  for (const id of ["auth-username", "auth-password", "auth-confirm"]) {
    $(id).addEventListener("blur", () => { if ($(id).value) validateAuth(id); });
    $(id).addEventListener("input", () => { if ($(id).closest(".field").classList.contains("invalid")) validateAuth(id); });
  }

  window.addEventListener("hashchange", showView);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  setInterval(() => { if (app.view === "leaderboard" && !document.hidden) loadBoard(true); }, 60 * 1000);

  // ---------- Boot ----------

  async function bootstrap() {
    fillHelp();
    try {
      const me = await api("GET", "/api/me");
      app.offline = false;
      if (me.user) {
        app.user = me.user;
        app.stats = me.stats;
        app.store = new RemoteStore();
        app.store.sync(me);
      } else {
        app.store = new LocalStore();
      }
    } catch (err) {
      // No server behind this page (file:// or a static host): play as a guest.
      app.offline = true;
      app.store = new LocalStore();
      if (!(err instanceof ApiError && (err.status === 0 || err.status === 404 || err.status === 405))) console.warn("Cricketle: server unavailable", err);
    }
    try {
      await reload();
    } catch (err) {
      if (app.store.kind === "remote") { app.offline = false; await becomeGuest(); } else throw err;
    }
    showView();
    tick();
    setInterval(tick, 250);
  }

  // Exposed for tests and debugging.
  window.Cricketle = {
    core,
    get state() { return app.state; },
    get mode() { return app.mode; },
    get storeKind() { return app.store && app.store.kind; },
    get user() { return app.user; },
  };

  bootstrap().catch((err) => {
    console.error(err);
    setMessage("Cricketle could not start. Reload the page.", true);
  });
})();

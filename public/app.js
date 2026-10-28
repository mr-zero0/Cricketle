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

  const PROFILE_KEY = "cricketle:v2:profile";
  const HISTORY_KEY = "cricketle:v2:history";

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
    getProfile() {
      try {
        const p = JSON.parse(localStorage.getItem(PROFILE_KEY));
        if (p && typeof p === "object") return p;
      } catch (_) { /* ignore */ }
      return {
        displayName: "Guest Player",
        avatar: "batter",
        bio: "Playing in guest mode",
        favTeam: "India",
        favPlayer: "Virat Kohli",
      };
    }
    saveProfile(p) {
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (_) { /* ignore */ }
    }
    setOtp(phone, code) {
      this._otp = { phone, code, expires: Date.now() + 5 * 60 * 1000 };
      return code;
    }
    verifyOtp(phone, code) {
      return Boolean(this._otp && this._otp.phone === phone && this._otp.code === code && Date.now() < this._otp.expires);
    }
    getHistory() {
      try {
        const h = JSON.parse(localStorage.getItem(HISTORY_KEY));
        if (Array.isArray(h)) return h;
      } catch (_) { /* ignore */ }
      return [];
    }
    recordHistory(item) {
      try {
        const h = this.getHistory();
        const exists = h.some((x) => x.day === item.day && x.mode === item.mode && x.idx === item.idx);
        if (!exists) {
          h.push(item);
          localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
        }
      } catch (_) { /* ignore */ }
    }
    getStats() {
      const h = this.getHistory();
      const day = core.todayKey(this.now());
      let solved = 0;
      let points = 0;
      const daysSet = new Set();
      const guessDist = { 1: 0, 2: 0, "3-5": 0, "6-10": 0, "10+": 0 };

      for (const p of h) {
        if (p.day) daysSet.add(p.day);
        points += p.points || 0;
        if (p.status === "solved") {
          solved++;
          let count = 0;
          if (Array.isArray(p.guesses)) count = p.guesses.length;
          else if (typeof p.guesses === "string") {
            try { count = JSON.parse(p.guesses).length; } catch (_) { count = 0; }
          }
          if (count === 1) guessDist[1]++;
          else if (count === 2) guessDist[2]++;
          else if (count >= 3 && count <= 5) guessDist["3-5"]++;
          else if (count >= 6 && count <= 10) guessDist["6-10"]++;
          else if (count > 10) guessDist["10+"]++;
        }
      }

      const s = core.streakDetails(Array.from(daysSet), day);
      const title = core.rankTitle(points);
      const baseStats = { allTimePoints: points, solved, daysPlayed: daysSet.size, currentStreak: s.current, bestStreak: s.best };
      const achievements = core.evaluateAchievements(baseStats, h);
      const winRate = h.length > 0 ? Math.round((solved / h.length) * 100) : 100;

      return {
        allTimePoints: points,
        solved,
        daysPlayed: daysSet.size,
        currentStreak: s.current,
        bestStreak: s.best,
        streak: s,
        todayPoints: 0,
        todayRank: null,
        todayTotal: 0,
        allTimeRank: null,
        allTimeTotal: 0,
        title: title.title,
        nextTitle: title.next ? title.next.title : null,
        nextTitleAt: title.next ? title.next.min : null,
        progress: title.progress,
        guessDist,
        winRate,
        achievements,
        totalAttempts: h.length,
      };
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
        if (r.solved) {
          this.recordHistory({
            day: r.state.day,
            mode,
            idx,
            status: "solved",
            guesses: p.guesses,
            hints: p.hints,
            started_at: p.startedAt,
            finished_at: p.finishedAt,
            points: p.points,
          });
        }
        return { rank: r.rank, solved: r.solved, guess: p.guesses[p.guesses.length - 1], answer: r.solved ? core.describe(core.answerFor(r.state.day, mode, idx)) : undefined };
      });
    }
    async hint(mode, idx) {
      return this.run((s, now) => core.useHint(s, mode, idx, now), (r) => ({ hint: r.hint }));
    }
    async giveUp(mode, idx) {
      return this.run((s, now) => core.giveUp(s, mode, idx, now), (r) => {
        const p = r.state.modes[mode].puzzles[idx];
        this.recordHistory({
          day: r.state.day,
          mode,
          idx,
          status: "gaveUp",
          guesses: p.guesses,
          hints: p.hints,
          started_at: p.startedAt,
          finished_at: p.finishedAt,
          points: 0,
        });
        return { answer: core.describe(core.answerFor(r.state.day, mode, idx)) };
      });
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
    profileTab: "stats",
    badgeFilter: "all",
    selectedAvatar: "batter",
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
    const allDone = core.modeDone(app.state, app.mode);
    const waTracker = allDone
      ? ` <button type="button" class="tracker-wa-btn" id="tracker-wa-btn" title="Share total score & time to WhatsApp"><svg class="whatsapp-icon" aria-hidden="true"><use href="#i-whatsapp"/></svg> Share</button>`
      : "";
    $("today-points").innerHTML = `Today: <strong>${pts.total} pts</strong> <span class="muted">(${modeLabel(app.mode)} ${pts[app.mode]})</span>${waTracker}`;
    const twa = $("tracker-wa-btn");
    if (twa) {
      twa.addEventListener("click", () => openWhatsApp(buildShareText()));
    }
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
    const now = app.store.now();
    const ps = puzzles();
    const totalMs = ps.reduce((s, q) => s + core.elapsedMs(q, now), 0);
    const totalTime = core.formatTime(totalMs);
    const puzzleMs = core.elapsedMs(p, now);
    const puzzleTime = core.formatTime(puzzleMs);
    const title = a ? a.name : "Unknown";
    const sub = a ? `${a.countryName} · ${a.role} · debut ${a.debut}` : "";
    const nextReady = ps[idx() + 1] && ps[idx() + 1].status === "ready";
    const allDone = core.modeDone(app.state, app.mode);
    const otherMode = isHard() ? "easy" : "hard";
    const otherDone = core.modeDone(app.state, otherMode);

    let actions = `
      <button id="whatsapp-share-btn" class="btn whatsapp-btn" type="button">
        <svg class="whatsapp-icon" aria-hidden="true"><use href="#i-whatsapp"/></svg> Share on WhatsApp
      </button>
      <button id="share-btn" class="btn" type="button"><svg aria-hidden="true"><use href="#i-copy"/></svg> Copy result</button>`;
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
        <div class="win-stat" role="listitem" title="Puzzle: ${puzzleTime} · Total across 3: ${totalTime}"><span class="v">${totalTime}</span><span class="k">total time</span></div>
        <div class="win-stat" role="listitem"><span class="v">${p.hints}</span><span class="k">hint${p.hints === 1 ? "" : "s"}</span></div>
        <div class="win-stat points" role="listitem"><span class="v">${lost ? 0 : "+" + p.points}</span><span class="k">points</span></div>
      </div>
      ${note}
      <div class="actions">${actions}</div>`;
    $("share-btn").addEventListener("click", share);
    const wa = $("whatsapp-share-btn");
    if (wa) {
      wa.addEventListener("click", () => {
        openWhatsApp(buildShareText());
      });
    }
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
    const ps = puzzles();
    const wrap = timerEl.parentElement;
    const now = app.store.now();
    const totalMs = ps.reduce((s, q) => s + core.elapsedMs(q, now), 0);
    const text = core.formatTime(totalMs);
    if (force || text !== lastTimerText) { timerEl.textContent = text; lastTimerText = text; }
    wrap.classList.toggle("running", p.status === "active");
    wrap.classList.toggle("done", core.isFinished(p));
    let w;
    if (p.status === "active") {
      w = core.scorePuzzle({ mode: app.mode, guesses: p.guesses.length + 1, hints: p.hints, seconds: core.elapsedMs(p, now) / 1000, solved: true });
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

  function formatDayDDMMMYY(dayStr) {
    if (!dayStr) return "";
    const parts = String(dayStr).split("-").map(Number);
    if (parts.length !== 3) return dayStr;
    const [y, m, d] = parts;
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dd = String(d).padStart(2, "0");
    const mmm = MONTHS[m - 1] || "";
    const yy = String(y).slice(-2);
    return `${dd}-${mmm}-${yy}`;
  }

  function buildShareText() {
    const ps = puzzles();
    const now = app.store.now();
    const totalMs = ps.reduce((s, q) => s + core.elapsedMs(q, now), 0);
    const totalTime = core.formatTime(totalMs);
    const mode = modeLabel(app.mode);
    const allDone = core.modeDone(app.state, app.mode);
    const totalPts = ps.reduce((s, q) => s + (q.points || 0), 0);
    const solvedCount = ps.filter((q) => q.status === "solved").length;

    // Dot-separated guess sequence: e.g. (# 1.2.3) or (# 1.2.4)
    const guessSeq = ps.map((q) => {
      if (!core.isFinished(q)) return "·";
      if (q.status === "gaveUp") return "X";
      return String(q.guesses.length);
    }).join(".");

    const icons = ["1️⃣", "2️⃣", "3️⃣"];
    const puzzleLines = ps.map((q, i) => {
      if (!core.isFinished(q)) return `${icons[i]} ⏳ In progress / Not started`;
      if (q.status === "gaveUp") return `${icons[i]} ❌ Gave up (${q.guesses.length} guesses)`;
      return `${icons[i]} ✅ ${q.points} pts (${q.guesses.length} guess${q.guesses.length === 1 ? "" : "es"}, ${q.hints || 0} hints)`;
    });

    const streak = (app.stats && app.stats.currentStreak) ? ` · 🔥 ${app.stats.currentStreak}-day streak` : "";
    const siteUrl = "https://mr-zero0.github.io/Cricketle";
    const dateFormatted = formatDayDDMMMYY(app.day);

    const lines = [
      `🏏 Cricketle · ${dateFormatted} (# ${guessSeq})`,
      `${mode} Mode · ${allDone ? `Finished (${solvedCount}/${core.PUZZLES_PER_DAY} Solved)` : `Puzzle ${idx() + 1} of 3`}`,
      `⏱️ Total Time (3 puzzles): ${totalTime}`,
      `🏆 Points: ${totalPts} pts${streak}`,
      ``,
      ...puzzleLines,
      ``,
      `Play now: ${siteUrl}`
    ];
    return lines.join("\n");
  }

  function openWhatsApp(text) {
    const encoded = encodeURIComponent(text);
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) {
      // Use direct whatsapp:// scheme on mobile to pass the entire message into chat compose
      window.location.href = `whatsapp://send?text=${encoded}`;
      setTimeout(() => {
        window.open(`https://wa.me/?text=${encoded}`, "_blank");
      }, 700);
    } else {
      // Use wa.me on desktop to open WhatsApp Web/Desktop with entire message intact
      window.open(`https://wa.me/?text=${encoded}`, "_blank");
    }
  }

  function copyToClipboard(text, btn) {
    const ok = () => {
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = `<svg aria-hidden="true"><use href="#i-check"/></svg> Copied`;
        setTimeout(() => { btn.innerHTML = orig; }, 1600);
      }
      toast("Result copied to clipboard!", "success");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, () => toast("Could not copy automatically."));
    } else {
      toast("Could not access clipboard.");
    }
  }

  async function share() {
    const text = buildShareText();
    const btn = $("share-btn");
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (navigator.share && isMobile) {
      try {
        // Crucial: Only pass 'text' without 'url' property, so WhatsApp does not drop the message
        await navigator.share({ text });
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
      }
    }

    copyToClipboard(text, btn);
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

  // ---------- Profile, Customization & Auth ----------

  const CRICKET_TEAMS = [
    "India", "Australia", "England", "South Africa", "New Zealand", "Pakistan", "West Indies", "Sri Lanka", "Afghanistan", "Bangladesh",
    "Chennai Super Kings", "Mumbai Indians", "Royal Challengers Bengaluru", "Kolkata Knight Riders",
    "Rajasthan Royals", "Sunrisers Hyderabad", "Delhi Capitals", "Gujarat Titans", "Lucknow Super Giants", "Punjab Kings"
  ];

  function getAvatar(id) {
    return (core.AVATARS && core.AVATARS.find((a) => a.id === id)) || (core.AVATARS && core.AVATARS[0]) || { id: "batter", name: "Master Blaster", role: "Batter", icon: "🏏", bg: "linear-gradient(135deg, #15803d, #22c55e)" };
  }

  function renderProfile() {
    $("offline-card").hidden = true;
    $("auth-card").hidden = Boolean(app.user);
    $("profile-card").hidden = false;

    if (!app.user && app.profileTab !== "edit" && app.profileTab !== "badges" && app.profileTab !== "stats") {
      // If guest and not on a guest tab, show auth card
      $("auth-card").hidden = false;
      renderAuthTab();
    }

    // Determine current profile & stats (whether signed in or guest)
    let pUser;
    let s;
    if (app.user) {
      pUser = {
        username: app.user.username,
        displayName: app.user.displayName || app.user.username,
        avatar: app.user.avatar || "batter",
        bio: app.user.bio || "",
        favTeam: app.user.favTeam || "",
        favPlayer: app.user.favPlayer || "",
        googleConnected: Boolean(app.user.googleConnected),
        isGuest: false,
      };
      s = app.stats || {};
    } else {
      const gProfile = (app.store && app.store.getProfile) ? app.store.getProfile() : {};
      pUser = {
        username: "guest",
        displayName: gProfile.displayName || "Guest Player",
        avatar: gProfile.avatar || "batter",
        bio: gProfile.bio || "Playing in guest mode on this device.",
        favTeam: gProfile.favTeam || "India",
        favPlayer: gProfile.favPlayer || "Virat Kohli",
        googleConnected: false,
        isGuest: true,
      };
      s = (app.store && app.store.getStats) ? app.store.getStats() : {};
    }

    const title = core.rankTitle(s.allTimePoints || 0);
    const progressPct = Math.round((title.progress || 0) * 100);
    const av = getAvatar(pUser.avatar);
    const achievements = s.achievements || core.evaluateAchievements(s, []);
    const unlockedCount = achievements.filter((a) => a.unlocked).length;

    let subViewHtml = "";

    // 1. Career Stats & Streaks Tab
    if (app.profileTab === "stats") {
      const streakInfo = s.streak || core.streakDetails([], core.todayKey(app.store ? app.store.now() : Date.now()));
      const weekDotsHtml = (streakInfo.week || []).map((d) => `
        <div class="streak-day-dot${d.active ? " active" : ""}${d.isToday ? " today" : ""}">
          <span class="day-circle">${d.active ? "✓" : escapeHtml(d.label.slice(0, 1))}</span>
          <span class="day-name">${escapeHtml(d.label)}</span>
        </div>
      `).join("");

      const guessDist = s.guessDist || { 1: 0, 2: 0, "3-5": 0, "6-10": 0, "10+": 0 };
      const maxGuesses = Math.max(1, ...Object.values(guessDist));
      const distRowsHtml = Object.keys(guessDist).map((k) => {
        const val = guessDist[k];
        const pct = Math.round((val / maxGuesses) * 100);
        return `
          <div class="dist-row">
            <span class="dist-label">${k}</span>
            <div class="dist-track"><span class="dist-fill" style="width:${pct}%"></span></div>
            <span class="dist-val">${val}</span>
          </div>`;
      }).join("");

      subViewHtml = `
        <div class="streak-card card">
          <div class="streak-flame-box" aria-hidden="true">
            <svg><use href="#i-flame"/></svg>
          </div>
          <div class="streak-details">
            <h4>${s.currentStreak || 0} Day${s.currentStreak === 1 ? "" : "s"} Streak</h4>
            <p class="streak-subtitle">Best streak: <strong>${s.bestStreak || 0} days</strong> ${s.currentStreak > 0 ? "· Keep the flame alive tomorrow!" : "· Solve a puzzle to start a streak!"}</p>
          </div>
          <div class="streak-week" aria-label="7-day activity">
            ${weekDotsHtml}
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat-tile card hi"><span class="v">${s.todayPoints || 0}</span><span class="k">Today's points</span></div>
          <div class="stat-tile card hi"><span class="v">${s.todayRank ? "#" + s.todayRank : "–"}</span><span class="k">Today's rank</span></div>
          <div class="stat-tile card"><span class="v">${s.allTimePoints || 0}</span><span class="k">All-time points</span></div>
          <div class="stat-tile card"><span class="v">${s.allTimeRank ? "#" + s.allTimeRank : "–"}</span><span class="k">All-time rank</span></div>
          <div class="stat-tile card"><span class="v">${s.solved || 0}</span><span class="k">Puzzles solved</span></div>
          <div class="stat-tile card"><span class="v">${s.winRate || (s.solved ? 100 : 0)}%</span><span class="k">Win rate</span></div>
          <div class="stat-tile card"><span class="v">${unlockedCount} / ${achievements.length}</span><span class="k">Badges</span></div>
          <div class="stat-tile card"><span class="v">${s.daysPlayed || 0}</span><span class="k">Days active</span></div>
        </div>

        <div class="dist-card card">
          <h4>Guess Distribution</h4>
          <div class="dist-bars">
            ${distRowsHtml}
          </div>
        </div>
      `;
    }

    // 2. Badges & Achievements Tab
    else if (app.profileTab === "badges") {
      const filter = app.badgeFilter || "all";
      const filtered = achievements.filter((a) => {
        if (filter === "unlocked") return a.unlocked;
        if (filter === "locked") return !a.unlocked;
        return true;
      });

      const badgesHtml = filtered.map((b) => {
        const iconId = "#i-" + (b.icon || "medal");
        const prog = b.progress || { current: 0, max: 1, pct: 0 };
        return `
          <div class="badge-card card ${b.tier}${b.unlocked ? "" : " locked"}">
            <div class="badge-icon-box" aria-hidden="true">
              <svg><use href="${iconId}"/></svg>
            </div>
            <div class="badge-body">
              <h5><span>${escapeHtml(b.title)}</span> <span class="badge-tier-tag">${b.tier}</span></h5>
              <p class="badge-desc">${escapeHtml(b.desc)}</p>
              <div class="badge-progress-wrap">
                <div class="badge-track"><span class="badge-fill" style="width:${prog.pct}%"></span></div>
                <div class="badge-status">
                  <span>${b.unlocked ? '<span class="badge-unlocked-tag">✓ Unlocked</span>' : `${prog.current} / ${prog.max}`}</span>
                  <span>${prog.pct}%</span>
                </div>
              </div>
            </div>
          </div>`;
      }).join("");

      subViewHtml = `
        <div class="badges-header">
          <span class="badges-summary"><strong>${unlockedCount}</strong> of <strong>${achievements.length}</strong> unlocked (${Math.round((unlockedCount / Math.max(1, achievements.length)) * 100)}%)</span>
          <div class="badge-filter-pills" role="tablist" aria-label="Filter badges">
            <button class="badge-pill${filter === "all" ? " active" : ""}" data-filter="all" type="button">All (${achievements.length})</button>
            <button class="badge-pill${filter === "unlocked" ? " active" : ""}" data-filter="unlocked" type="button">Unlocked (${unlockedCount})</button>
            <button class="badge-pill${filter === "locked" ? " active" : ""}" data-filter="locked" type="button">Locked (${achievements.length - unlockedCount})</button>
          </div>
        </div>
        <div class="badge-grid">
          ${badgesHtml || '<p class="muted center">No achievements in this category yet.</p>'}
        </div>
      `;
    }

    // 3. Edit Profile & Customization Tab
    else if (app.profileTab === "edit") {
      const selectedAv = app.selectedAvatar || pUser.avatar || "batter";
      const avatarsGridHtml = (core.AVATARS || []).map((a) => `
        <div class="avatar-choice${a.id === selectedAv ? " active" : ""}" data-avatar-id="${a.id}">
          <div class="avatar-choice-icon" style="background:${a.bg}">${a.icon}</div>
          <span class="avatar-choice-name">${escapeHtml(a.name)}</span>
          <span class="avatar-choice-role">${escapeHtml(a.role)}</span>
        </div>
      `).join("");

      const teamOptionsHtml = CRICKET_TEAMS.map((t) => `
        <option value="${escapeHtml(t)}"${pUser.favTeam === t ? " selected" : ""}>${escapeHtml(t)}</option>
      `).join("");

      subViewHtml = `
        <form id="profile-edit-form" class="card" style="padding:var(--space-5);">
          <h4 style="margin:0 0 var(--space-2);font-family:var(--font-display);font-size:1.6rem;letter-spacing:0.04em;">Customize Your Cricketer</h4>
          <p class="muted small-text" style="margin-bottom:var(--space-4);">Choose your match avatar, favorite team and nickname.</p>

          <div class="field">
            <label>Select Match Avatar</label>
            <div class="avatar-grid" id="avatar-grid">
              ${avatarsGridHtml}
            </div>
          </div>

          <div class="field" style="margin-top:var(--space-4);">
            <label for="edit-display-name">Display Name</label>
            <input id="edit-display-name" type="text" maxlength="30" value="${escapeHtml(pUser.displayName)}" required placeholder="e.g. Virat Fan 18" />
            <p class="help-text">Shown on today's and all-time leaderboards.</p>
          </div>

          <div class="field">
            <label for="edit-bio">Cricket Bio / Motto</label>
            <textarea id="edit-bio" rows="2" maxlength="160" class="field input" style="width:100%;min-height:70px;padding:10px 14px;border-radius:12px;background:var(--card-2);color:var(--fg);border:1px solid var(--border-strong);font:inherit;" placeholder="e.g. Test match purist. Cover drive enthusiast.">${escapeHtml(pUser.bio)}</textarea>
            <p class="help-text">A short tagline for your profile.</p>
          </div>

          <div class="field">
            <label for="edit-fav-team">Favorite Team</label>
            <select id="edit-fav-team" class="select-styled">
              <option value="">-- Pick a Favorite Team --</option>
              ${teamOptionsHtml}
            </select>
          </div>

          <div class="field">
            <label for="edit-fav-player">Favorite Player</label>
            <input id="edit-fav-player" type="text" maxlength="50" value="${escapeHtml(pUser.favPlayer)}" placeholder="e.g. Virat Kohli" />
            <div class="quick-chips" id="player-chips">
              <button type="button" class="chip-btn" data-player="Virat Kohli">Virat Kohli</button>
              <button type="button" class="chip-btn" data-player="MS Dhoni">MS Dhoni</button>
              <button type="button" class="chip-btn" data-player="Rohit Sharma">Rohit Sharma</button>
              <button type="button" class="chip-btn" data-player="Sachin Tendulkar">Sachin Tendulkar</button>
              <button type="button" class="chip-btn" data-player="Jasprit Bumrah">Jasprit Bumrah</button>
              <button type="button" class="chip-btn" data-player="AB de Villiers">AB de Villiers</button>
              <button type="button" class="chip-btn" data-player="Pat Cummins">Pat Cummins</button>
            </div>
          </div>

          <div style="margin-top:var(--space-5);display:flex;gap:var(--space-2);">
            <button id="save-profile-btn" class="btn primary big" type="submit">Save Changes</button>
          </div>
        </form>
      `;
    }

    // 4. Account & Security Tab
    else if (app.profileTab === "account") {
      subViewHtml = `
        <div class="card" style="padding:var(--space-5);">
          <h4 style="margin:0 0 var(--space-4);font-family:var(--font-display);font-size:1.6rem;letter-spacing:0.04em;">Account & Security</h4>
          ${pUser.isGuest ? `
            <div class="guest-callout-banner">
              <div class="guest-callout-text">
                <h4>Save your progress</h4>
                <p>Create an account or continue with Google to join global leaderboards and sync across devices.</p>
              </div>
              <button id="guest-to-auth-btn" class="btn primary small" type="button">Sign In / Sign Up</button>
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-5);">
              <div style="display:flex;justify-content:space-between;padding-bottom:var(--space-2);border-bottom:1px solid var(--border);">
                <span class="muted">Username</span>
                <strong>@${escapeHtml(pUser.username)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding-bottom:var(--space-2);border-bottom:1px solid var(--border);">
                <span class="muted">Google Account</span>
                <span>${pUser.googleConnected ? '<span class="pill-google"><svg class="google-icon-sm" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg> Connected</span>' : '<span class="muted">Not linked</span>'}</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding-bottom:var(--space-2);border-bottom:1px solid var(--border);">
                <span class="muted">Mobile Phone</span>
                <span>${pUser.phone ? `<span class="pill-phone"><svg aria-hidden="true" style="width:12px;height:12px;vertical-align:-1px;"><use href="#i-phone"/></svg> ${escapeHtml(pUser.phone)}</span>` : '<span class="muted">Not linked</span>'}</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding-bottom:var(--space-2);border-bottom:1px solid var(--border);">
                <span class="muted">Security</span>
                <span>Password encrypted with scrypt · Mobile OTP ready</span>
              </div>
            </div>
            <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
              <button id="signout-btn" class="btn danger" type="button"><svg aria-hidden="true"><use href="#i-logout"/></svg> Sign out</button>
            </div>
          `}
        </div>
      `;
    }

    const heroHtml = `
      ${pUser.isGuest ? `
        <div class="guest-callout-banner">
          <div class="guest-callout-text">
            <h4>🏆 Playing as a Guest</h4>
            <p>Your results & badges are saved locally. Sign in with Google to appear on global leaderboards!</p>
          </div>
          <button id="guest-signin-btn" class="btn primary small" type="button">Sign In / Join</button>
        </div>
      ` : ""}
      <div class="profile-hero card">
        <div class="profile-avatar-wrap">
          <div class="avatar-badge" style="background:${av.bg};" aria-hidden="true">${av.icon}</div>
          <button class="avatar-edit-trigger" id="avatar-edit-btn" type="button" title="Change Avatar" aria-label="Change Avatar"><svg aria-hidden="true"><use href="#i-edit"/></svg></button>
        </div>
        <div class="profile-hero-meta">
          <div class="profile-name-row">
            <h3 class="profile-display-name">${escapeHtml(pUser.displayName)}</h3>
            <span class="profile-username">${pUser.isGuest ? "· Guest" : `@${escapeHtml(pUser.username)}`}</span>
            ${pUser.googleConnected ? `<span class="pill-google"><svg class="google-icon-sm" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg> Google</span>` : ""}
            ${pUser.phone ? `<span class="pill-phone"><svg aria-hidden="true" style="width:12px;height:12px;vertical-align:-1px;"><use href="#i-phone"/></svg> Phone</span>` : ""}
          </div>
          <div class="profile-tag-row">
            <span class="title-badge"><svg aria-hidden="true"><use href="#i-trophy"/></svg> ${escapeHtml(title.title)}</span>
            ${pUser.favTeam ? `<span class="profile-chip team">🏏 ${escapeHtml(pUser.favTeam)}</span>` : ""}
            ${pUser.favPlayer ? `<span class="profile-chip">⭐ ${escapeHtml(pUser.favPlayer)}</span>` : ""}
          </div>
          ${pUser.bio ? `<p class="profile-bio">${escapeHtml(pUser.bio)}</p>` : ""}
        </div>
        <div class="progress">
          <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPct}" aria-label="Progress to next title"><span style="width:${progressPct}%"></span></div>
          <div class="progress-text"><span>${s.allTimePoints || 0} pts</span><span>${title.next ? `${title.next.min - (s.allTimePoints || 0)} pts to ${title.next.title}` : "Top of the ladder"}</span></div>
        </div>
      </div>

      <div class="profile-subnav" role="tablist" aria-label="Profile navigation">
        <button class="subnav-btn${app.profileTab === "stats" ? " active" : ""}" data-subtab="stats" type="button"><svg aria-hidden="true"><use href="#i-ball"/></svg> Career & Streaks</button>
        <button class="subnav-btn${app.profileTab === "badges" ? " active" : ""}" data-subtab="badges" type="button"><svg aria-hidden="true"><use href="#i-medal"/></svg> Badges (${unlockedCount}/${achievements.length})</button>
        <button class="subnav-btn${app.profileTab === "edit" ? " active" : ""}" data-subtab="edit" type="button"><svg aria-hidden="true"><use href="#i-edit"/></svg> Edit Profile</button>
        <button class="subnav-btn${app.profileTab === "account" ? " active" : ""}" data-subtab="account" type="button"><svg aria-hidden="true"><use href="#i-lock"/></svg> Account</button>
      </div>

      <div class="profile-tab-content">
        ${subViewHtml}
      </div>
    `;

    $("profile-card").innerHTML = heroHtml;

    // Attach listeners
    document.querySelectorAll(".subnav-btn").forEach((b) => {
      b.addEventListener("click", () => {
        app.profileTab = b.dataset.subtab;
        renderProfile();
      });
    });

    const editBtn = $("avatar-edit-btn");
    if (editBtn) editBtn.addEventListener("click", () => { app.profileTab = "edit"; renderProfile(); });

    const guestSignin = $("guest-signin-btn") || $("guest-to-auth-btn");
    if (guestSignin) guestSignin.addEventListener("click", () => { $("auth-card").hidden = false; renderAuthTab(); window.scrollTo({ top: $("auth-card").offsetTop - 20, behavior: "smooth" }); });

    const signoutBtn = $("signout-btn");
    if (signoutBtn) signoutBtn.addEventListener("click", signOut);

    // Badges filter buttons
    document.querySelectorAll(".badge-pill").forEach((p) => {
      p.addEventListener("click", () => {
        app.badgeFilter = p.dataset.filter;
        renderProfile();
      });
    });

    // Avatar selector grid
    document.querySelectorAll(".avatar-choice").forEach((ac) => {
      ac.addEventListener("click", () => {
        app.selectedAvatar = ac.dataset.avatarId;
        document.querySelectorAll(".avatar-choice").forEach((x) => x.classList.remove("active"));
        ac.classList.add("active");
      });
    });

    // Quick player chips
    document.querySelectorAll(".chip-btn").forEach((cb) => {
      cb.addEventListener("click", () => {
        const inp = $("edit-fav-player");
        if (inp) inp.value = cb.dataset.player;
      });
    });

    // Edit profile submit
    const editForm = $("profile-edit-form");
    if (editForm) {
      editForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const displayName = $("edit-display-name").value.trim();
        const bio = $("edit-bio").value.trim();
        const favTeam = $("edit-fav-team").value;
        const favPlayer = $("edit-fav-player").value.trim();
        const avatar = app.selectedAvatar || pUser.avatar || "batter";

        if (app.user) {
          try {
            const res = await api("POST", "/api/profile/update", { displayName, bio, avatar, favTeam, favPlayer });
            app.user = res.user;
            app.stats = res.stats;
            toast("Profile updated successfully!", "success");
            app.profileTab = "stats";
            renderProfile();
          } catch (err) {
            toast(err.message || "Failed to update profile", "error");
          }
        } else {
          // Guest mode
          if (app.store && app.store.saveProfile) {
            app.store.saveProfile({ displayName, bio, avatar, favTeam, favPlayer });
            toast("Guest profile updated on this device!", "success");
            app.profileTab = "stats";
            renderProfile();
          }
        }
      });
    }
  }

  function renderAuthTab() {
    const tab = app.authTab || "signin";
    const parent = $("tab-signin").parentElement;
    parent.classList.remove("pos-0", "pos-1", "pos-2");

    const isSignin = tab === "signin";
    const isSignup = tab === "signup";
    const isOtp = tab === "otp";

    if (isSignin) parent.classList.add("pos-0");
    else if (isSignup) parent.classList.add("pos-1");
    else if (isOtp) parent.classList.add("pos-2");

    $("tab-signin").classList.toggle("active", isSignin);
    $("tab-signin").setAttribute("aria-selected", String(isSignin));
    $("tab-signup").classList.toggle("active", isSignup);
    $("tab-signup").setAttribute("aria-selected", String(isSignup));
    if ($("tab-otp")) {
      $("tab-otp").classList.toggle("active", isOtp);
      $("tab-otp").setAttribute("aria-selected", String(isOtp));
    }

    if (isOtp) {
      $("auth-form").hidden = true;
      $("otp-form").hidden = false;
      clearOtpErrors();
    } else {
      $("auth-form").hidden = false;
      $("otp-form").hidden = true;
      $("confirm-field").hidden = !isSignup;
      if ($("display-name-field")) $("display-name-field").hidden = !isSignup;
      $("auth-password").setAttribute("autocomplete", isSignup ? "new-password" : "current-password");
      $("auth-submit").textContent = isSignup ? "Create account" : "Sign in";
      clearAuthErrors();
    }
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
      const payload = {
        username: $("auth-username").value.trim(),
        password: $("auth-password").value,
      };
      if (signup && $("auth-display-name") && $("auth-display-name").value.trim()) {
        payload.displayName = $("auth-display-name").value.trim();
      }
      const res = await api("POST", signup ? "/api/auth/register" : "/api/auth/login", payload);
      $("auth-form").reset();
      await becomeUser(res.user);
      toast(signup ? `Welcome, ${res.user.displayName || res.user.username}. Your results now count for the leaderboard.` : `Welcome back, ${res.user.displayName || res.user.username}.`, "success");
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

  // Google Sign-In handler
  async function handleGoogleLogin(payload) {
    try {
      const modal = $("google-modal");
      if (modal && modal.close) modal.close();
      const res = await api("POST", "/api/auth/google", payload);
      await becomeUser(res.user);
      toast(`Signed in as ${res.user.displayName || res.user.username}!`, "success");
      location.hash = "#play";
    } catch (err) {
      toast(err.message || "Google sign in failed.", "error");
    }
  }

  function initGoogleAuth() {
    const btn = $("google-btn");
    const modal = $("google-modal");
    if (btn) {
      btn.addEventListener("click", () => {
        if (app.offline) {
          toast("Google sign-in connects when running the Cricketle server (npm start).", "error");
          return;
        }
        if (modal && modal.showModal) modal.showModal();
      });
    }

    // Modal quick account buttons
    document.querySelectorAll(".google-account-btn").forEach((ab) => {
      ab.addEventListener("click", () => {
        handleGoogleLogin({
          sub: "google_" + ab.dataset.googleEmail,
          email: ab.dataset.googleEmail,
          name: ab.dataset.googleName,
        });
      });
    });

    // Custom Google form in modal
    const customForm = $("custom-google-form");
    if (customForm) {
      customForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = $("custom-google-name").value.trim();
        const email = $("custom-google-email").value.trim();
        if (!name || !email) return;
        handleGoogleLogin({
          sub: "google_" + email,
          email,
          name,
        });
      });
    }
  }

  // ---------- Mobile Phone OTP Auth ----------

  let otpCountdownTimer = null;

  function clearOtpErrors() {
    const summary = $("otp-summary");
    if (summary) {
      summary.hidden = true;
      summary.innerHTML = "";
    }
  }

  function showOtpError(msg) {
    const summary = $("otp-summary");
    if (summary) {
      summary.hidden = false;
      summary.innerHTML = `<h3>${escapeHtml(msg)}</h3>`;
      summary.focus();
    }
  }

  function startOtpTimer(expiresAt) {
    if (otpCountdownTimer) clearInterval(otpCountdownTimer);
    const update = () => {
      const exp = typeof expiresAt === "number" ? expiresAt : new Date(expiresAt).getTime();
      const remainingMs = Math.max(0, exp - Date.now());
      const totalSec = Math.floor(remainingMs / 1000);
      const mins = String(Math.floor(totalSec / 60)).padStart(2, "0");
      const secs = String(totalSec % 60).padStart(2, "0");
      if ($("otp-timer")) $("otp-timer").textContent = `${mins}:${secs}`;
      if (totalSec <= 0) {
        clearInterval(otpCountdownTimer);
        if ($("otp-resend-btn")) $("otp-resend-btn").disabled = false;
      }
    };
    update();
    otpCountdownTimer = setInterval(update, 1000);
    if ($("otp-resend-btn")) $("otp-resend-btn").disabled = true;
  }

  function initOtpAuth() {
    const tabOtp = $("tab-otp");
    if (tabOtp) {
      tabOtp.addEventListener("click", () => {
        app.authTab = "otp";
        renderAuthTab();
      });
    }

    const sendBtn = $("otp-send-btn");
    if (sendBtn) {
      sendBtn.addEventListener("click", async () => {
        clearOtpErrors();
        const countryCode = ($("otp-country-code") && $("otp-country-code").value) || "+91";
        let rawPhone = ($("otp-phone").value || "").trim().replace(/[\s\-()]/g, "");
        if (!rawPhone) {
          showOtpError("Please enter your mobile phone number.");
          $("otp-phone").focus();
          return;
        }
        let fullPhone = rawPhone.startsWith("+") ? rawPhone : countryCode + rawPhone.replace(/^0+/, "");

        sendBtn.classList.add("loading");
        sendBtn.disabled = true;

        try {
          let res;
          if (app.offline) {
            const devCode = String(Math.floor(100000 + Math.random() * 900000));
            if (app.store && app.store.setOtp) app.store.setOtp(fullPhone, devCode);
            res = { ok: true, phone: fullPhone, devOtp: devCode, expiresAt: Date.now() + 5 * 60 * 1000 };
          } else {
            res = await api("POST", "/api/auth/otp/send", { phone: fullPhone });
          }

          app.otpPhone = res.phone;
          app.latestDevOtp = res.devOtp;

          const bannerIcon = $("otp-banner-icon");
          const bannerTitle = $("otp-banner-title");
          const bannerText = $("otp-banner-text");
          const autofillBtn = $("otp-autofill-btn");

          if (res.realSms) {
            if (bannerIcon) bannerIcon.textContent = "📱";
            if (bannerTitle) bannerTitle.textContent = "Real SMS Sent (OTP.dev)";
            if (bannerText) bannerText.innerHTML = `We sent a 6-digit code via SMS to <strong>${escapeHtml(res.phone)}</strong>. Check your phone's SMS inbox!`;
            if (autofillBtn) autofillBtn.hidden = true;
            toast(`Real SMS sent to ${res.phone} via OTP.dev! Check your phone.`, "success");
          } else {
            if (bannerIcon) bannerIcon.textContent = "⚡";
            if (bannerTitle) bannerTitle.textContent = "Free OTP Sandbox";
            if (bannerText) bannerText.innerHTML = `Your code is: <strong id="otp-delivered-code" class="otp-code-highlight">${res.devOtp || "------"}</strong>`;
            if (autofillBtn) autofillBtn.hidden = !res.devOtp;
            toast(res.devOtp ? "Test OTP code ready! Tap auto-fill to verify." : "OTP code sent!", "info");
          }

          $("otp-step-phone").hidden = true;
          $("otp-step-verify").hidden = false;
          startOtpTimer(res.expiresAt || (Date.now() + 5 * 60 * 1000));
          if ($("otp-code")) {
            $("otp-code").value = "";
            $("otp-code").focus();
          }
        } catch (err) {
          showOtpError(err.message || "Could not send OTP code. Try again.");
        } finally {
          sendBtn.classList.remove("loading");
          sendBtn.disabled = false;
        }
      });
    }

    const autofillBtn = $("otp-autofill-btn");
    if (autofillBtn) {
      autofillBtn.addEventListener("click", () => {
        if (app.latestDevOtp && $("otp-code")) {
          $("otp-code").value = app.latestDevOtp;
          $("otp-code").focus();
          toast("Auto-filled code: " + app.latestDevOtp, "info");
        }
      });
    }

    const changePhoneBtn = $("otp-change-phone");
    if (changePhoneBtn) {
      changePhoneBtn.addEventListener("click", () => {
        if (otpCountdownTimer) clearInterval(otpCountdownTimer);
        $("otp-step-verify").hidden = true;
        $("otp-step-phone").hidden = false;
        clearOtpErrors();
        $("otp-phone").focus();
      });
    }

    const resendBtn = $("otp-resend-btn");
    if (resendBtn) {
      resendBtn.addEventListener("click", () => {
        if (sendBtn) sendBtn.click();
      });
    }

    const otpForm = $("otp-form");
    if (otpForm) {
      otpForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearOtpErrors();
        const code = ($("otp-code").value || "").trim().replace(/\D/g, "");
        if (code.length !== 6) {
          showOtpError("Enter the 6-digit code.");
          $("otp-code").focus();
          return;
        }

        const verifyBtn = $("otp-verify-btn");
        verifyBtn.classList.add("loading");
        verifyBtn.disabled = true;

        try {
          const displayName = ($("otp-display-name") ? $("otp-display-name").value.trim() : "") || undefined;
          let user;

          if (app.offline) {
            const valid = app.store && app.store.verifyOtp ? app.store.verifyOtp(app.otpPhone, code) : (code === app.latestDevOtp);
            if (!valid) throw new Error("Invalid or expired OTP code.");
            const p = app.store.getProfile();
            p.phone = app.otpPhone;
            p.username = p.username || ("player_" + app.otpPhone.slice(-4));
            if (displayName) p.displayName = displayName;
            app.store.saveProfile(p);
            user = {
              username: p.username,
              displayName: p.displayName || p.username,
              phone: app.otpPhone,
              avatar: p.avatar || "allrounder",
              bio: p.bio || "",
              favTeam: p.favTeam || "",
              favPlayer: p.favPlayer || "",
              phoneConnected: true,
              isOffline: true,
            };
            app.user = user;
            renderNav();
            renderProfile();
          } else {
            const res = await api("POST", "/api/auth/otp/verify", {
              phone: app.otpPhone,
              code,
              displayName,
            });
            user = res.user;
            await becomeUser(user);
          }

          if (otpCountdownTimer) clearInterval(otpCountdownTimer);
          $("otp-form").reset();
          $("otp-step-verify").hidden = true;
          $("otp-step-phone").hidden = false;
          toast(`Welcome, ${user.displayName || user.username}! Mobile OTP verified.`, "success");
          location.hash = "#play";
          showView();
        } catch (err) {
          showOtpError(err.message || "Failed to verify code.");
        } finally {
          verifyBtn.classList.remove("loading");
          verifyBtn.disabled = false;
        }
      });
    }
  }

  async function signOut() {
    try { await api("POST", "/api/auth/logout", {}); } catch (_) { /* ignore */ }
    becomeGuest();
    toast("Signed out. Playing as a guest on this device.");
    location.hash = "#play";
    showView();
  }

  async function becomeUser(user) {
    app.user = user;
    app.store = new RemoteStore();
    app.board.data = {};
    await refreshStats();
    await reload();
    renderNav();
    renderProfile();
  }

  async function becomeGuest() {
    app.user = null;
    app.stats = null;
    app.store = new LocalStore();
    if (app.store && app.store.saveProfile) {
      const p = app.store.getProfile();
      if (p.phone) {
        delete p.phone;
        app.store.saveProfile(p);
      }
    }
    app.board.data = {};
    try { await reload(); } catch (err) { handleError(err); }
    renderNav();
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
    initGoogleAuth();
    initOtpAuth();
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
      const p = app.store.getProfile();
      if (p && p.phone) {
        app.user = {
          username: p.username || ("player_" + p.phone.slice(-4)),
          displayName: p.displayName || ("Cricketer " + p.phone.slice(-4)),
          phone: p.phone,
          avatar: p.avatar || "allrounder",
          bio: p.bio || "",
          favTeam: p.favTeam || "",
          favPlayer: p.favPlayer || "",
          phoneConnected: true,
          isOffline: true,
        };
      }
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

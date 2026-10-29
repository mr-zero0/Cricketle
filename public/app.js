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
    sign_in_required: "Sign up or sign in to play the next puzzle.",
    network: "Could not reach the server. Check your connection and try again.",
    offline: "Accounts and leaderboards need the Cricketle server. Open the hosted game to sign in.",
  };

  const STARTERS = ["Virat Kohli", "Ricky Ponting", "AB de Villiers", "Babar Azam", "Chris Gayle"];
  const GUEST_KEY = "cricketle:v2:guest";
  const MODE_KEY = "cricketle:v2:mode";
  const SEEN_HELP_KEY = "cricketle:v3:seen-help";

  // localStorage can be missing, full or throwing (private mode, blocked
  // storage). Nothing in the game may depend on it working.
  function safeGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function safeSet(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* ignore */ } }
  function safeRemove(key) { try { localStorage.removeItem(key); } catch (_) { /* ignore */ } }

  // ---------- Client Structured Logger ----------

  const CricketleLog = {
    _badge(tag, color) {
      return [
        `%cCricketle%c %c${tag}%c`,
        "background:#059669;color:#fff;font-weight:bold;padding:1px 5px;border-radius:3px 0 0 3px;",
        "",
        `background:${color};color:#fff;font-weight:bold;padding:1px 5px;border-radius:0 3px 3px 0;`,
        "",
      ];
    },
    info(tag, msg, ...args) {
      console.log(...this._badge(tag, "#0284c7"), msg, ...args);
    },
    success(tag, msg, ...args) {
      console.log(...this._badge(tag, "#16a34a"), msg, ...args);
    },
    warn(tag, msg, ...args) {
      console.warn(...this._badge(tag, "#eab308"), msg, ...args);
    },
    error(tag, msg, ...args) {
      console.error(...this._badge(tag, "#ef4444"), msg, ...args);
    },
    auth(action, msg, ...args) {
      console.log(...this._badge("AUTH", "#06b6d4"), `${action}: ${msg}`, ...args);
    },
    game(action, msg, ...args) {
      console.log(...this._badge("GAME", "#8b5cf6"), `${action}: ${msg}`, ...args);
    },
  };
  window.CricketleLog = CricketleLog;

  // ---------- Errors + API ----------

  class ApiError extends Error {
    constructor(code, message, status) {
      super(message || MESSAGES[code] || code);
      this.code = code;
      this.status = status;
    }
  }

  async function api(method, path, body) {
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
      });
    } catch (err) {
      CricketleLog.error("API", `${method} ${path} -> Network error`, err);
      throw new ApiError("network", MESSAGES.network, 0);
    }
    const ms = Math.round(performance.now() - t0);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    if (!res.ok) {
      const errCode = (json && json.error) || "http_" + res.status;
      CricketleLog.warn("API", `${method} ${path} -> ${res.status} (${ms}ms) [${errCode}]`, json && json.message ? json.message : "");
      throw new ApiError(errCode, json && json.message, res.status);
    }
    CricketleLog.info("API", `${method} ${path} -> ${res.status} (${ms}ms)`);
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
      return this.run((s, now) => core.startPuzzle(s, mode, idx, now, { guest: true }));
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
    // Guest gate per mode: "open" (tapped a locked puzzle), "closed" (dismissed) or unset (auto).
    gate: { easy: null, hard: null },
  };

  if (core.MODES.includes(safeGet(MODE_KEY))) app.mode = safeGet(MODE_KEY);

  const puzzles = () => app.state.modes[app.mode].puzzles;
  const idx = () => app.current[app.mode];
  const puzzle = () => puzzles()[idx()];
  const isHard = () => app.mode === "hard";
  const poolSize = () => core.poolFor(app.mode).length;
  const modeLabel = (m) => (m === "hard" ? "Hard" : "Easy");
  const isGuest = () => !app.user;
  // A puzzle a guest may look at but not play.
  const isGated = (i) => isGuest() && !core.guestCanPlay(i);

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

  const TOAST_MAX = 80;

  function toast(text, kind) {
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    const t = String(text);
    el.textContent = t.length > TOAST_MAX ? t.slice(0, TOAST_MAX - 1).trimEnd() + "…" : t;
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
    if (err instanceof ApiError && err.code === "sign_in_required") { showGate(); return; }
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
    const classes = ["row", "tier-" + t.key, opts.flash ? "flash" : "", opts.enter ? "enter heat-fade" : ""].filter(Boolean).join(" ");
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
      const gated = isGated(i) && !core.isFinished(p);
      let cls = "dot " + (gated ? "gated" : p.status);
      if (i === idx()) cls += " current";
      if (i === idx() && celebrateDot) cls += " pop";
      let inner;
      if (p.status === "solved") inner = `<svg aria-hidden="true"><use href="#i-check"/></svg><span class="dot-pts">${p.points}</span>`;
      else if (p.status === "gaveUp") inner = `<svg aria-hidden="true"><use href="#i-flag"/></svg><span class="dot-pts">0</span>`;
      else if (gated || p.status === "locked") inner = `<svg aria-hidden="true"><use href="#i-lock"/></svg>`;
      else inner = `<span>${i + 1}</span>`;
      const label = gated ? "sign in to play" : labels[p.status];
      const disabled = !gated && p.status === "locked";
      return `<button type="button" class="${cls}" data-i="${i}" aria-label="Puzzle ${i + 1}: ${label}" ${disabled ? "disabled" : ""} aria-current="${i === idx() ? "true" : "false"}">${inner}</button>`;
    });
    dots.innerHTML = parts.join("");
    celebrateDot = false;
    // The pop is one-shot: drop the class when the animation ends (or straight
    // away under reduced motion, where no animationend ever fires).
    const popped = dots.querySelector(".dot.pop");
    if (popped) {
      const done = () => popped.classList.remove("pop");
      popped.addEventListener("animationend", done, { once: true });
      setTimeout(done, reduceMotion.matches ? 0 : 400);
    }
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
    } else if (app.user) {
      rankEl.innerHTML = `<a href="#leaderboard">Finish a puzzle to be ranked</a>`;
    } else {
      rankEl.innerHTML = `<a href="#profile">Sign in to be ranked</a>`;
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
    const otherFreeOpen = isGuest() && !core.isFinished(app.state.modes[otherMode].puzzles[0]);
    if (nextReady && isGated(idx() + 1)) {
      // Guest: the next puzzle needs an account; offer the other mode's free one.
      if (otherFreeOpen) {
        actions += `<button id="other-mode-btn" class="btn primary" type="button">Try ${modeLabel(otherMode)} mode, also free <svg aria-hidden="true"><use href="#i-arrow"/></svg></button>`;
      }
    } else if (nextReady) {
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
    const puzzleTiles = guessTiles(p.guesses, poolSize());
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
      ${puzzleTiles ? `<div class="win-tiles" aria-label="Guess heat progression: ${puzzleTiles}" title="Your guess heat progression">${puzzleTiles}</div>` : ""}
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
    renderGate();
    renderNav();
  }

  // ---------- Guest gate ----------
  //
  // Guests play puzzle 1 of each mode. The card appears when they finish it
  // (auto), when they tap a locked puzzle (open), and goes away when dismissed
  // (closed) until the next explicit tap.

  function gateShouldShow() {
    if (!isGuest() || !app.state) return false;
    const st = app.gate[app.mode];
    if (st === "open") return true;
    if (st === "closed") return false;
    const ps = puzzles();
    const next = ps[idx() + 1];
    return core.isFinished(puzzle()) && Boolean(next) && isGated(idx() + 1);
  }

  function showGate() {
    app.gate[app.mode] = "open";
    renderGate();
    const g = $("gate");
    if (g && !g.hidden) g.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "nearest" });
  }

  function hideGate() {
    app.gate[app.mode] = "closed";
    renderGate();
  }

  function openAuth(view) {
    hideGate();
    location.hash = "#profile";
    showView();
    const card = $("auth-card");
    if (card) card.hidden = false;
    switchAuthView(view);
  }

  function renderGate() {
    const g = $("gate");
    if (!g) return;
    const show = gateShouldShow();
    g.hidden = !show;
    if (!show) { g.innerHTML = ""; return; }
    const played = core.isFinished(puzzle()) || puzzles().some(core.isFinished);
    const lead = played
      ? `You've played today's free puzzle in ${modeLabel(app.mode)}.`
      : `Puzzle 1 is free for guests.`;
    g.innerHTML = `
      <button id="gate-close" class="icon-btn gate-close" type="button" aria-label="Dismiss"><svg aria-hidden="true"><use href="#i-x"/></svg></button>
      <span class="gate-icon" aria-hidden="true"><svg><use href="#i-lock"/></svg></span>
      <h3>${lead}</h3>
      <p>Sign up or sign in for all three, hints, streaks and the leaderboard.</p>
      <div class="actions">
        <button id="gate-signup" class="btn primary" type="button">Sign up</button>
        <button id="gate-signin" class="btn" type="button">Sign in</button>
      </div>`;
    $("gate-close").addEventListener("click", hideGate);
    $("gate-signup").addEventListener("click", () => openAuth("register"));
    $("gate-signin").addEventListener("click", () => openAuth("signin"));
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
        app.gate[app.mode] = null; // a finished puzzle shows the gate again even if it was dismissed earlier
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
      app.gate[app.mode] = null;
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
    if (ps[i] && isGated(i) && !core.isFinished(ps[i])) { showGate(); return; }
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

  function guessTiles(guesses, pSize) {
    if (!guesses || !guesses.length) return "";
    const tiles = guesses.map((g) => {
      const t = core.tier(g.rank, pSize);
      if (t.key === "answer") return "🟩";
      if (t.key === "hot") return "🟧";
      if (t.key === "warm") return "🟨";
      if (t.key === "cool") return "🟦";
      return "⬜";
    });
    if (tiles.length > 15) {
      return tiles.slice(0, 7).join("") + "…" + tiles.slice(-6).join("");
    }
    return tiles.join("");
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
    const pSize = poolSize();

    // Dot-separated guess sequence: e.g. (# 1.2.3) or (# 1.2.4)
    const guessSeq = ps.map((q) => {
      if (!core.isFinished(q)) return "·";
      if (q.status === "gaveUp") return "X";
      return String(q.guesses.length);
    }).join(".");

    const puzzleLines = ps.map((q, i) => {
      const label = `P${i + 1}`;
      if (!core.isFinished(q)) {
        if (q.status === "active" && q.guesses.length > 0) {
          const tiles = guessTiles(q.guesses, pSize);
          return `${label}: ${tiles} ⏳ In progress (${q.guesses.length} guesses)`;
        }
        return `${label}: ⏳ Not started`;
      }
      const tiles = guessTiles(q.guesses, pSize);
      if (q.status === "gaveUp") {
        return `${label}: ${tiles} ❌ Gave up (${q.guesses.length} guesses)`;
      }
      const hintsText = q.hints > 0 ? `, ${q.hints} hint${q.hints === 1 ? "" : "s"}` : "";
      return `${label}: ${tiles} · ${q.points} pts (${q.guesses.length} guess${q.guesses.length === 1 ? "" : "es"}${hintsText})`;
    });

    const streak = (app.stats && app.stats.currentStreak) ? ` · 🔥 ${app.stats.currentStreak}-day streak` : "";
    const siteUrl = "https://cricketle-sy03.onrender.com";
    const dateFormatted = formatDayDDMMMYY(app.day);

    const modeHeadline = allDone
      ? `${mode} Mode · Finished (3/3 Solved)`
      : `${mode} Mode · Puzzle ${idx() + 1} of 3 (${solvedCount}/3 Solved)`;
    const timeLabel = allDone ? "Total Time (3 puzzles)" : "Total Time";

    const lines = [
      `🏏 Cricketle · ${dateFormatted} (# ${guessSeq})`,
      `${modeHeadline}`,
      `⏱️ ${timeLabel}: ${totalTime}`,
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
    // WhatsApp's official, universal web and mobile gateway is https://api.whatsapp.com/send?text=
    // 1. Android: Opened directly by WhatsApp app via Verified App Links with full UTF-8 emoji support
    // 2. iOS: Opened directly by WhatsApp app via Universal Links with full UTF-8 emoji support
    // 3. Desktop: Opens WhatsApp Web or prompts WhatsApp Desktop with full UTF-8 emoji support
    // Note: Never use whatsapp://send?text= which corrupts UTF-8 emojis into replacement characters (diamonds with ?) on Android and Windows.
    const url = `https://api.whatsapp.com/send?text=${encoded}`;
    const win = window.open(url, "_blank");
    if (!win || win.closed || typeof win.closed === "undefined") {
      window.location.href = url;
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
      navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text, ok));
    } else {
      fallbackCopy(text, ok);
    }
  }

  function fallbackCopy(text, cb) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      cb();
    } catch (_) {
      toast("Could not access clipboard.");
    }
  }

  async function share() {
    const text = buildShareText();
    const btn = $("share-btn");
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (navigator.share && isMobile) {
      try {
        await navigator.share({ title: "Cricketle", text });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
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
    const navAdmin = $("nav-admin");
    if (navAdmin) {
      navAdmin.style.display = (app.user && app.user.isAdmin) ? "inline-flex" : "none";
    }
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

    if (app.offline && !data) {
      me.hidden = true;
      list.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent = "Connecting to live leaderboard...";
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
        const av = getAvatar(r.avatar);
        let sub = "";
        if (r.me) {
          sub = tab === "today"
            ? `<span class="board-time">${formatSeconds(r.seconds)}</span> · ${r.guesses} guess${r.guesses === 1 ? "" : "es"}`
            : `<span class="title-chip">${escapeHtml(r.title)}</span> ${r.days} day${r.days === 1 ? "" : "s"}`;
        }
        return `<li class="board-row${r.me ? " me" : ""}" style="--i:${i}">
          <span class="rank-badge r${r.rank}" aria-label="Rank ${r.rank}">${r.rank}</span>
          <span class="board-avatar" style="background:${av.bg}" aria-hidden="true">${avatarIcon(av)}</span>
          <div class="board-who"><span class="board-name">${escapeHtml(r.username)}${r.me ? ' <span class="muted small-text">(you)</span>' : ""}</span>${sub ? `<span class="board-sub">${sub}</span>` : ""}</div>
          <div class="board-pts"><span class="v">${r.points}</span><span class="k">pts</span></div>
        </li>`;
      }).join("");
    }
    const when = new Date(data.loadedAt);
    $("board-updated").textContent = `Updated ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  async function loadBoard(force) {
    const tab = app.board.tab;
    const cached = app.board.data[tab];
    if (cached && !force && Date.now() - cached.loadedAt < 30 * 1000) { renderBoard(); return; }
    if (!cached) renderBoard();
    if (app.board.loading) return;
    app.board.loading = true;
    $("board-refresh").classList.add("loading");
    try {
      let data = null;
      if (!app.offline) {
        data = await api("GET", tab === "today" ? "/api/leaderboard/today" : "/api/leaderboard/alltime");
      } else {
        throw new ApiError("offline", "Leaderboards need the Cricketle server. Open the hosted game to be ranked.", 0);
      }
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
    const norm = core.normalizeAvatarId(id);
    return core.AVATARS.find((a) => a.id === norm) || core.AVATARS[0];
  }

  const avatarIcon = (a) => `<svg aria-hidden="true"><use href="${a.icon}"/></svg>`;

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
        phone: app.user.phone || null,
        isAdmin: Boolean(app.user.isAdmin),
        pinNeedsUpdate: Boolean(app.user.pinNeedsUpdate),
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
        phone: null,
        isAdmin: false,
        pinNeedsUpdate: false,
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
        <div class="stat-grid">
          <div class="stat-tile card hi"><span class="v">${s.todayPoints || 0}</span><span class="k">Today's points</span></div>
          <div class="stat-tile card hi"><span class="v">${s.todayRank ? "#" + s.todayRank : "–"}</span><span class="k">Today's rank</span></div>
          <div class="stat-tile card"><span class="v">${s.currentStreak || 0}</span><span class="k">Streak</span></div>
          <div class="stat-tile card"><span class="v">${s.allTimePoints || 0}</span><span class="k">All-time points</span></div>
        </div>

        <details id="more-stats" class="more-stats">
          <summary>More</summary>
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
        </details>
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
          <div class="avatar-choice-icon" style="background:${a.bg}">${avatarIcon(a)}</div>
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
                <p>Create an account to join the leaderboards and keep your streak across devices.</p>
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
                <span class="muted">Mobile</span>
                <span>${pUser.phone ? `<span class="pill-phone"><svg aria-hidden="true" style="width:12px;height:12px;vertical-align:-1px;"><use href="#i-phone"/></svg> ${escapeHtml(pUser.phone)}</span>` : '<span class="muted">Not linked</span>'}</span>
              </div>
              ${pUser.pinNeedsUpdate ? '<p class="pin-nudge" style="margin:0;">Your PIN is not 6 digits. Ask the admin to reset it.</p>' : ""}
            </div>
            <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;">
              ${pUser.isAdmin ? `<a href="admin.html" target="_blank" class="btn primary" style="background:linear-gradient(135deg, #f59e0b, #d97706);color:#000;font-weight:700;display:inline-flex;align-items:center;gap:6px;text-decoration:none;">👑 Open Admin Portal</a>` : ""}
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
            <h4>Playing as a guest</h4>
            <p>Create an account to be ranked.</p>
          </div>
          <button id="guest-signin-btn" class="btn primary small" type="button">Sign in</button>
        </div>
      ` : ""}
      <div class="profile-hero card">
        <div class="profile-avatar-wrap">
          <div class="avatar-badge" style="background:${av.bg};" aria-hidden="true">${avatarIcon(av)}</div>
          <button class="avatar-edit-trigger" id="avatar-edit-btn" type="button" title="Change Avatar" aria-label="Change Avatar"><svg aria-hidden="true"><use href="#i-edit"/></svg></button>
        </div>
        <div class="profile-hero-meta">
          <div class="profile-name-row">
            <h3 class="profile-display-name">${escapeHtml(pUser.displayName)}</h3>
            <span class="profile-username">${pUser.isGuest ? "· Guest" : `@${escapeHtml(pUser.username)}`}</span>
            ${pUser.isAdmin ? `<span class="pill-admin" style="background:rgba(245, 158, 11, 0.2);color:#fbbf24;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:1px solid rgba(245, 158, 11, 0.4);display:inline-flex;align-items:center;gap:4px;">👑 Admin</span>` : ""}
            
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

    const guestSignin = $("guest-signin-btn");
    const guestToAuth = $("guest-to-auth-btn");
    if (guestSignin) guestSignin.addEventListener("click", () => { $("auth-card").hidden = false; renderAuthTab(); window.scrollTo({ top: $("auth-card").offsetTop - 20, behavior: "smooth" }); });
    if (guestToAuth) guestToAuth.addEventListener("click", () => { $("auth-card").hidden = false; renderAuthTab(); window.scrollTo({ top: $("auth-card").offsetTop - 20, behavior: "smooth" }); });

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
    if ($("auth-card")) $("auth-card").hidden = false;
    clearAuthErrors();
    switchAuthView("signin");
  }

  function fieldError(id, text) {
    const el = $(id);
    if (!el) return;
    const field = el.closest(".field");
    if (field) field.classList.toggle("invalid", Boolean(text));
    const errEl = $(id + "-error");
    if (errEl) errEl.textContent = text || "";
    el.setAttribute("aria-invalid", text ? "true" : "false");
  }

  // ---------- Player authentication (username or phone + PIN) ----------

  const COUNTRY_CODES = [
    ["+91", "IN"], ["+1", "US"], ["+44", "GB"], ["+61", "AU"], ["+64", "NZ"],
    ["+27", "ZA"], ["+92", "PK"], ["+880", "BD"], ["+94", "LK"], ["+971", "AE"],
  ];
  const DEFAULT_COUNTRY = "+91";
  const AUTH_FIELDS = ["signin-identifier", "signin-pin", "register-username", "register-phone", "register-pin", "register-pin-confirm"];

  function flagEmoji(cc) {
    return String.fromCodePoint(...Array.from(cc, (c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  }

  function fillCountrySelect(sel) {
    if (!sel || sel.options.length) return;
    for (const [code, cc] of COUNTRY_CODES) {
      const o = document.createElement("option");
      o.value = code;
      o.textContent = `${flagEmoji(cc)} ${code}`;
      sel.appendChild(o);
    }
    sel.value = DEFAULT_COUNTRY;
  }

  function clearAuthErrors() {
    for (const id of AUTH_FIELDS) fieldError(id, "");
    const summary = $("auth-summary");
    if (summary) {
      summary.hidden = true;
      summary.innerHTML = "";
    }
  }

  // Server-side failures only; input mistakes go inline under their field.
  function showAuthSummary(msg) {
    const summary = $("auth-summary");
    if (!summary) return;
    summary.hidden = false;
    summary.innerHTML = `
      <div class="auth-error-wrap">
        <svg class="auth-error-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
        </svg>
        <span class="auth-error-text">${escapeHtml(msg)}</span>
      </div>`;
    summary.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "nearest" });
    summary.focus();
  }

  // Digits (spaces, dashes and brackets allowed) mean a phone number; anything
  // else is a username. Returns the bare digits or null.
  function phoneDigits(raw) {
    const d = String(raw || "").replace(/[\s\-().]/g, "");
    return /^\d+$/.test(d) ? d : null;
  }

  function toE164(country, digits) {
    return (country || DEFAULT_COUNTRY) + digits.replace(/^0+/, "");
  }

  // The country picker slides in beside the identifier once it looks numeric.
  function setCountryVisible(sel, show) {
    if (!sel || sel.hidden === !show) return;
    sel.hidden = !show;
    sel.classList.remove("slide-in");
    if (show) {
      void sel.offsetWidth; // restart the animation
      sel.classList.add("slide-in");
    }
  }

  function switchAuthView(view) {
    clearAuthErrors();
    const tabSignin = $("tab-auth-signin");
    const tabRegister = $("tab-auth-register");
    const viewSignin = $("auth-view-signin");
    const viewRegister = $("auth-view-register");

    if (tabSignin) {
      tabSignin.classList.toggle("active", view === "signin");
      tabSignin.setAttribute("aria-selected", String(view === "signin"));
    }
    if (tabRegister) {
      tabRegister.classList.toggle("active", view === "register");
      tabRegister.setAttribute("aria-selected", String(view === "register"));
    }
    if (viewSignin) viewSignin.hidden = view !== "signin";
    if (viewRegister) viewRegister.hidden = view !== "register";

    const first = $(view === "signin" ? "signin-identifier" : "register-username");
    if (first) first.focus();
  }

  function setAuthBusy(btn, busy) {
    if (!btn) return;
    btn.classList.toggle("loading", busy);
    btn.disabled = busy;
  }

  function initPhoneAuth() {
    const form = $("auth-form");
    if (!form) return;

    fillCountrySelect($("signin-country"));
    fillCountrySelect($("register-country"));

    $("tab-auth-signin").addEventListener("click", () => switchAuthView("signin"));
    $("tab-auth-register").addEventListener("click", () => switchAuthView("register"));
    $("auth-switch-to-register").addEventListener("click", () => switchAuthView("register"));
    $("auth-switch-to-signin").addEventListener("click", () => switchAuthView("signin"));

    // An edited field drops its own error straight away.
    for (const id of AUTH_FIELDS) $(id).addEventListener("input", () => fieldError(id, ""));

    const idInput = $("signin-identifier");
    const sCountry = $("signin-country");
    const sPin = $("signin-pin");
    const signinBtn = $("auth-signin-btn");
    idInput.addEventListener("input", () => {
      const d = phoneDigits(idInput.value);
      setCountryVisible(sCountry, d !== null && !d.startsWith("00")); // 00… already names its country
    });

    async function handleSignin() {
      clearAuthErrors();
      let identifier = idInput.value.trim();
      const pin = sPin.value.trim();
      if (!identifier) {
        fieldError("signin-identifier", "Enter your username or mobile number.");
        idInput.focus();
        return;
      }
      if (!/^\d{4,8}$/.test(pin)) {
        fieldError("signin-pin", "Enter your PIN (4 to 8 digits).");
        sPin.focus();
        return;
      }
      const digits = phoneDigits(identifier);
      if (digits) identifier = digits.startsWith("00") ? "+" + digits.slice(2) : toE164(sCountry.value, digits);

      setAuthBusy(signinBtn, true);
      try {
        if (app.offline) throw new ApiError("offline", MESSAGES.offline, 0);
        const res = await api("POST", "/api/auth/login", { identifier, pin });
        await becomeUser(res.user);
        toast(`Welcome back, @${res.user.username}!`, "success");
        location.hash = "#play";
        showView();
      } catch (err) {
        const msg = err.code === "bad_credentials"
          ? "Incorrect username or PIN."
          : (err.code === "network" ? MESSAGES.network : (err.message || "Could not sign in. Try again."));
        showAuthSummary(msg);
        sPin.value = "";
        sPin.focus();
      } finally {
        setAuthBusy(signinBtn, false);
      }
    }

    const regUsername = $("register-username");
    const regCountry = $("register-country");
    const regPhone = $("register-phone");
    const regPin = $("register-pin");
    const regConfirm = $("register-pin-confirm");
    const registerBtn = $("auth-register-btn");

    async function handleRegister() {
      clearAuthErrors();
      const username = regUsername.value.trim();
      const digits = phoneDigits(regPhone.value);
      const pin = regPin.value.trim();
      const confirmPin = regConfirm.value.trim();

      // Report every field at once so one tap shows everything to fix.
      let firstBad = null;
      const bad = (id, text) => { fieldError(id, text); firstBad = firstBad || $(id); };
      if (!username) bad("register-username", "Choose a username.");
      else if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) bad("register-username", "3-20 letters, numbers or underscores.");
      else if (/^\d+$/.test(username)) bad("register-username", "Add a letter: all-digit names read as phone numbers.");
      const phone = digits ? (digits.startsWith("00") ? "+" + digits.slice(2) : toE164(regCountry.value, digits)) : null;
      if (!digits) bad("register-phone", "Enter your mobile number.");
      else if (!/^\+[1-9]\d{7,14}$/.test(phone)) bad("register-phone", "That doesn't look like a valid mobile number.");
      if (!/^\d{6}$/.test(pin)) bad("register-pin", "PIN must be exactly 6 digits.");
      else if (pin !== confirmPin) bad("register-pin-confirm", "PINs don't match.");
      if (firstBad) { firstBad.focus(); return; }

      setAuthBusy(registerBtn, true);
      try {
        if (app.offline) throw new ApiError("offline", MESSAGES.offline, 0);
        const res = await api("POST", "/api/auth/phone/register", { phone, username, pin });
        await becomeUser(res.user);
        toast(`Welcome to Cricketle, @${res.user.username}!`, "success");
        location.hash = "#play";
        showView();
      } catch (err) {
        if (err.code === "username_taken") {
          fieldError("register-username", "That username is taken. Try another.");
          regUsername.focus();
          regUsername.select();
        } else if (err.code === "phone_exists") {
          fieldError("register-phone", "This number already has an account. Sign in instead.");
          regPhone.focus();
        } else if (err.code === "invalid_pin") {
          fieldError("register-pin", err.message || "PIN must be exactly 6 digits.");
          regPin.focus();
        } else {
          showAuthSummary(err.code === "network" ? MESSAGES.network : (err.message || "Could not create the account. Try again."));
        }
      } finally {
        setAuthBusy(registerBtn, false);
      }
    }

    // Enter anywhere in the form submits the visible view.
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if ($("auth-view-signin").hidden) handleRegister();
      else handleSignin();
    });
  }

  async function signOut() {
    if (!app.offline) {
      try { await api("POST", "/api/auth/logout", {}); } catch (_) { /* ignore */ }
    }
    becomeGuest();
    toast("Signed out. Playing as a guest on this device.");
    location.hash = "#play";
    showView();
  }

  async function becomeUser(user) {
    app.user = user;
    app.store = new RemoteStore();
    app.board.data = {};
    CricketleLog.auth("SIGN_IN", `Authenticated as @${user.username} (${user.displayName || user.username})`);
    await refreshStats();
    await reload();
    renderNav();
    renderProfile();
  }

  async function becomeGuest() {
    app.user = null;
    app.stats = null;
    app.store = new LocalStore();
    CricketleLog.auth("GUEST", "Session cleared · Operating in guest mode");
    if (app.store && app.store.saveProfile) {
      const p = app.store.getProfile();
      if (p.phone) {
        delete p.phone;
        delete p.pin;
        delete p.loginTime;
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
    if (app.offline) {
      if (app.store && app.store.getStats) app.stats = app.store.getStats();
      renderTracker();
      if (app.view === "profile") renderProfile();
      if (app.view === "leaderboard") loadBoard(true);
      return;
    }
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

  // ---------- Onboarding sheet ----------
  //
  // First visit: shown over the live game; "Play" closes it and starts the
  // current puzzle. Later: the help button reopens it and "Play" only closes.

  let onboardFirstVisit = false;

  function openOnboard(opts) {
    const dlg = $("onboard");
    if (!dlg || dlg.open) return;
    onboardFirstVisit = Boolean(opts && opts.firstVisit);
    dlg.showModal();
  }

  function closeOnboard() {
    const dlg = $("onboard");
    safeSet(SEEN_HELP_KEY, "1");
    if (dlg && dlg.open) dlg.close();
  }

  function initOnboard() {
    const play = $("onboard-play");
    const signin = $("onboard-signin");
    if (play) {
      play.addEventListener("click", () => {
        const first = onboardFirstVisit;
        onboardFirstVisit = false;
        closeOnboard();
        if (first && app.state && puzzle().status === "ready") startPuzzle();
        else input.focus();
      });
    }
    if (signin) signin.addEventListener("click", () => { onboardFirstVisit = false; closeOnboard(); });
    const dlg = $("onboard");
    if (dlg) dlg.addEventListener("close", () => { onboardFirstVisit = false; safeSet(SEEN_HELP_KEY, "1"); });
  }

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

  // Blur hides the list after a short delay so a tap on a suggestion still
  // lands. Typing or refocusing within that delay cancels the hide, otherwise
  // tapping a hint and typing straight away lost the dropdown.
  let blurTimer = 0;
  input.addEventListener("input", () => { clearTimeout(blurTimer); showSuggestions(input.value); });
  input.addEventListener("focus", () => clearTimeout(blurTimer));
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
  input.addEventListener("blur", () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { if (document.activeElement !== input) hideSuggestions(); }, 120);
  });

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
  $("help-btn").addEventListener("click", () => openOnboard({ firstVisit: false }));
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

  $("tab-today").addEventListener("click", () => setBoardTab("today"));
  $("tab-alltime").addEventListener("click", () => setBoardTab("alltime"));
  $("board-refresh").addEventListener("click", () => loadBoard(true));

  window.addEventListener("hashchange", showView);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  setInterval(() => { if (app.view === "leaderboard" && !document.hidden) loadBoard(true); }, 60 * 1000);

  // ---------- Boot ----------

  async function bootstrap() {
    fillHelp();
    initOnboard();
    initPhoneAuth();
    // A static host (GitHub Pages, file://) has no API: play as a guest only.
    // Accounts, leaderboards and ranks live on the server, which is the only
    // place that can verify them.
    const isStaticHost = Boolean(location.hostname.endsWith("github.io") || location.protocol === "file:");
    if (isStaticHost) {
      app.offline = true;
      app.store = new LocalStore();
    } else {
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
        app.offline = true;
        app.store = new LocalStore();
        if (!(err instanceof ApiError && (err.status === 0 || err.status === 404 || err.status === 405))) console.warn("Cricketle: server unavailable", err);
      }
    }
    safeRemove("cricketle:v2:session");

    // Clear any legacy mock credentials from earlier builds
    try {
      const p = app.store.getProfile();
      if (p && p.phone) {
        delete p.phone;
        delete p.pin;
        delete p.loginTime;
        app.store.saveProfile(p);
      }
    } catch (_) {}

    try {
      await reload();
    } catch (err) {
      if (app.store && app.store.kind === "remote") { app.offline = false; await becomeGuest(); } else throw err;
    }
    showView();
    if (safeGet(SEEN_HELP_KEY) !== "1") openOnboard({ firstVisit: true });
    CricketleLog.info("READY", `Cricketle ready · Day: ${core.todayKey()} · Mode: ${app.mode} · Storage: ${app.store.kind}`);
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

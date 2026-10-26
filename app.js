// Cricketle - Contexto-style cricketer guessing game.
// Depends on players.js (PLAYERS, COUNTRIES, IPL_TEAMS, BOWL_STYLES, PACE, SPIN).
//
// Daily rules: 5 puzzles per day, same 5 for everyone, reset at 00:00 IST.
// Puzzles unlock one at a time and a finished puzzle can be reviewed but not replayed.
// Enforcement is per browser via localStorage.

(function () {
  "use strict";

  const PUZZLES_PER_DAY = 5;
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

  // ---------- Similarity ----------

  function logGap(a, b) {
    return Math.abs(Math.log10(a + 1) - Math.log10(b + 1));
  }

  function statScore(a, b) {
    // Full marks when numbers are the same order of magnitude; fades out at ~30x apart.
    return 5 * Math.max(0, 1 - logGap(a, b) / 1.5);
  }

  function bowlFamily(code) {
    if (PACE.has(code)) return "pace";
    if (SPIN.has(code)) return "spin";
    return "none";
  }

  function sharedTeams(a, b) {
    return a.ipl.filter((t) => b.ipl.includes(t));
  }

  // Returns a similarity score (higher = closer) between two players.
  function similarity(a, b) {
    let s = 0;
    if (a.country === b.country) s += 30;
    if (a.role === b.role) s += 15;
    if (a.bat === b.bat) s += 5;

    if (a.bowl === b.bowl) s += 10;
    else if (bowlFamily(a.bowl) === bowlFamily(b.bowl)) s += 5;

    s += 12 * Math.max(0, 1 - Math.abs(a.debut - b.debut) / 25);
    if (a.active === b.active) s += 4;

    const shared = sharedTeams(a, b).length;
    const union = new Set([...a.ipl, ...b.ipl]).size;
    if (union === 0) s += 6;
    else s += 15 * (shared / union);

    s += 5 * Math.max(0, 1 - Math.abs(a.titles - b.titles) / 4);

    s += statScore(a.matches, b.matches);
    s += statScore(a.runs, b.runs);
    s += statScore(a.wkts, b.wkts);
    return s;
  }

  // Human-readable reasons a guess is close to the answer. Never reveals the answer's values
  // directly; only confirms what the guess shares with it.
  function reasons(guess, answer) {
    const out = [];
    if (guess.country === answer.country) out.push("Same nation");
    if (guess.role === answer.role) out.push("Same role");
    const teams = sharedTeams(guess, answer);
    if (teams.length) out.push("IPL: " + teams.join(", "));
    if (guess.bowl === answer.bowl && guess.bowl !== "-") out.push("Same bowling style");
    else if (bowlFamily(guess.bowl) === bowlFamily(answer.bowl) && guess.bowl !== "-") out.push("Both " + bowlFamily(guess.bowl));
    if (guess.bat === answer.bat) out.push(guess.bat === "L" ? "Both left-handed" : "Both right-handed");
    if (Math.abs(guess.debut - answer.debut) <= 5) out.push("Same era");
    if (guess.active === answer.active) out.push(guess.active ? "Both active" : "Both retired");
    if (guess.titles > 0 && guess.titles === answer.titles) out.push(`Both won ${guess.titles} ICC title${guess.titles > 1 ? "s" : ""}`);
    if (logGap(guess.runs, answer.runs) < 0.12) out.push("Similar runs");
    if (logGap(guess.wkts, answer.wkts) < 0.12 && answer.wkts > 20) out.push("Similar wickets");
    return out.slice(0, 5);
  }

  // Rank table: every player ordered by closeness to the answer. Rank 1 is the answer.
  function buildRanks(answer) {
    const scored = PLAYERS.map((pl) => ({
      name: pl.name,
      score: pl === answer ? Infinity : similarity(pl, answer),
    }));
    scored.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
    const ranks = new Map();
    scored.forEach((e, i) => ranks.set(e.name, i + 1));
    return ranks;
  }

  // Heat tiers scale with the size of the player pool.
  const TIERS = {
    hot: 10,
    warm: Math.round(PLAYERS.length * 0.15),
    cool: Math.round(PLAYERS.length * 0.4),
  };

  function tier(rank) {
    if (rank === 1) return { key: "answer", label: "Answer" };
    if (rank <= TIERS.hot) return { key: "hot", label: "Hot" };
    if (rank <= TIERS.warm) return { key: "warm", label: "Warm" };
    if (rank <= TIERS.cool) return { key: "cool", label: "Cool" };
    return { key: "cold", label: "Cold" };
  }

  // ---------- IST day + seeded answers ----------

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A Date whose UTC fields read as IST wall-clock time.
  function istNow() {
    return new Date(Date.now() + IST_OFFSET_MS);
  }

  const pad = (n) => String(n).padStart(2, "0");

  function todayKey() {
    const d = istNow();
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  function msUntilReset() {
    const d = istNow();
    const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return nextMidnight - d.getTime();
  }

  // Ten distinct player indexes for the day, identical for everyone:
  // the first five are Easy mode, the last five Hard mode.
  function dailyAnswers(key) {
    const rnd = mulberry32(hashString("cricketle:" + key));
    const idx = PLAYERS.map((_, i) => i);
    const out = [];
    for (let i = 0; i < PUZZLES_PER_DAY * 2; i++) {
      const j = i + Math.floor(rnd() * (idx.length - i));
      [idx[i], idx[j]] = [idx[j], idx[i]];
      out.push(idx[i]);
    }
    return { easy: out.slice(0, PUZZLES_PER_DAY), hard: out.slice(PUZZLES_PER_DAY) };
  }

  // ---------- State ----------

  const STORAGE = "cricketle:day";
  const MODES = ["easy", "hard"];
  // state = { day, mode, answers: { easy: [idx x5], hard: [idx x5] },
  //           modes: { easy: { puzzles: [{ guesses, done, gaveUp }], current }, hard: {...} } }
  // puzzles.length = how many have been unlocked so far in that mode.
  let state = null;
  let ranks = null;

  function saveState() {
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch (_) { /* ignore */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE);
      const s = raw ? JSON.parse(raw) : null;
      return s && s.day === todayKey() && s.modes && s.modes.easy && s.modes.hard ? s : null;
    } catch (_) {
      return null;
    }
  }

  function freshMode() {
    return { puzzles: [{ guesses: [], done: false, gaveUp: false }], current: 0 };
  }

  function newDay() {
    const day = todayKey();
    state = {
      day,
      mode: state?.mode || "easy",
      answers: dailyAnswers(day),
      modes: { easy: freshMode(), hard: freshMode() },
    };
    saveState();
    loadPuzzle();
  }

  const isHard = () => state.mode === "hard";
  const modeState = () => state.modes[state.mode];

  function puzzle() {
    const m = modeState();
    return m.puzzles[m.current];
  }

  function answer() {
    return PLAYERS[state.answers[state.mode][modeState().current]];
  }

  function allDone() {
    const m = modeState();
    return m.puzzles.length === PUZZLES_PER_DAY && m.puzzles.every((pz) => pz.done);
  }

  function canUnlockNext() {
    const m = modeState();
    const last = m.puzzles[m.puzzles.length - 1];
    return last.done && m.puzzles.length < PUZZLES_PER_DAY;
  }

  function unlockNext() {
    if (!canUnlockNext()) return;
    const m = modeState();
    m.puzzles.push({ guesses: [], done: false, gaveUp: false });
    m.current = m.puzzles.length - 1;
    saveState();
    loadPuzzle();
    input.focus();
  }

  function viewPuzzle(i) {
    const m = modeState();
    if (i < 0 || i >= m.puzzles.length || i === m.current) return;
    m.current = i;
    saveState();
    loadPuzzle();
  }

  function setMode(mode) {
    if (!MODES.includes(mode) || mode === state.mode) return;
    state.mode = mode;
    saveState();
    setMessage("");
    hideSuggestions();
    loadPuzzle();
  }

  function loadPuzzle() {
    ranks = buildRanks(answer());
    render({ animateLast: false });
  }

  function byName(name) {
    return PLAYERS.find((pl) => pl.name === name);
  }

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
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
  const giveUp = $("give-up");
  const dots = $("dots");
  const trackerLabel = $("tracker-label");
  const resetEl = $("reset");

  const STARTERS = ["Virat Kohli", "Ricky Ponting", "AB de Villiers", "Babar Azam", "Chris Gayle"];

  let highlighted = -1;
  let currentMatches = [];

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function setMessage(text, warn) {
    message.textContent = text || "";
    message.classList.toggle("warn", Boolean(warn));
  }

  function rowHtml(name, opts) {
    const pl = byName(name);
    const rank = ranks.get(name);
    const t = tier(rank);
    const width = Math.max(6, Math.round(100 * (1 - (rank - 1) / (PLAYERS.length - 1))));
    // Hard mode: colour and rank only, no clues about what matched.
    const tags = rank === 1 || isHard() ? [] : reasons(pl, answer());
    const classes = ["row", `tier-${t.key}`, opts.flash ? "flash" : "", opts.enter ? "enter" : ""].filter(Boolean).join(" ");
    return `
      <li class="${classes}" data-name="${escapeHtml(name)}">
        <div class="bar" style="width:${width}%"></div>
        <div class="who">
          <span class="name">${escapeHtml(name)}</span>
          ${isHard() ? "" : `<span class="meta">${COUNTRIES[pl.country]} · ${pl.role}</span>`}
        </div>
        <div class="rank-wrap">
          <span class="rank" aria-label="Rank ${rank}">${rank}</span>
        </div>
        ${tags.length ? `<div class="tags">${tags.map((x, i) => `<span class="tag" style="--i:${i}">${escapeHtml(x)}</span>`).join("")}</div>` : ""}
      </li>`;
  }

  function renderTracker() {
    const m = modeState();
    $("mode-easy").classList.toggle("active", !isHard());
    $("mode-easy").setAttribute("aria-pressed", String(!isHard()));
    $("mode-hard").classList.toggle("active", isHard());
    $("mode-hard").setAttribute("aria-pressed", String(isHard()));
    document.body.classList.toggle("hard", isHard());

    const parts = [];
    for (let i = 0; i < PUZZLES_PER_DAY; i++) {
      const pz = m.puzzles[i];
      let cls = "dot locked";
      let label = `Puzzle ${i + 1}: locked`;
      if (pz && pz.done) { cls = pz.gaveUp ? "dot lost" : "dot done"; label = `Puzzle ${i + 1}: ${pz.gaveUp ? "given up" : "solved"}`; }
      else if (pz) { cls = "dot open"; label = `Puzzle ${i + 1}: in progress`; }
      if (i === m.current) cls += " current";
      if (i === m.current && celebrateDot) cls += " pop";
      const icon = pz && pz.done && !pz.gaveUp ? `<svg aria-hidden="true"><use href="#i-check"/></svg>` : `<span>${i + 1}</span>`;
      parts.push(`<button type="button" class="${cls}" data-i="${i}" aria-label="${label}" ${pz ? "" : "disabled"} aria-current="${i === m.current ? "true" : "false"}">${icon}</button>`);
    }
    dots.innerHTML = parts.join("");
    celebrateDot = false;
    trackerLabel.textContent = `${isHard() ? "Hard" : "Easy"} · Puzzle ${m.current + 1} of ${PUZZLES_PER_DAY}`;
  }

  let celebrateDot = false;

  // Counts the latest rank up from 1 over ~600ms so the number lands with the bar.
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

  function bump(el) {
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  function render(opts = {}) {
    const pz = puzzle();
    renderTracker();

    guessCount.textContent = pz.guesses.length;
    const best = pz.guesses.length ? Math.min(...pz.guesses.map((n) => ranks.get(n))) : null;
    closest.textContent = best ? `#${best}` : "–";

    empty.hidden = pz.guesses.length > 0 || pz.done;
    if (!empty.hidden && !starters.childElementCount) {
      starters.innerHTML = STARTERS.map((n) => `<button type="button" class="starter">${escapeHtml(n)}</button>`).join("");
    }

    const sorted = [...pz.guesses].sort((a, b) => ranks.get(a) - ranks.get(b));
    guessList.innerHTML = sorted.length
      ? `<p class="label">All guesses, closest first</p>` + sorted.map((n) => rowHtml(n, {})).join("")
      : "";

    const last = pz.guesses[pz.guesses.length - 1];
    if (last && !pz.done) {
      lastGuess.hidden = false;
      lastGuess.innerHTML = `<p class="label">Latest guess</p><ol class="guess-list">${rowHtml(last, { flash: true, enter: opts.animateLast })}</ol>`;
      if (opts.animateLast) {
        countUp(lastGuess.querySelector(".rank"), ranks.get(last));
        bump(guessCount);
        if (best === ranks.get(last)) bump(closest);
      }
    } else {
      lastGuess.hidden = true;
    }

    input.disabled = pz.done;
    input.placeholder = pz.done ? "This puzzle is finished" : "Type a cricketer's name";
    giveUp.hidden = pz.done;
    renderWin();
  }

  function renderWin() {
    const pz = puzzle();
    if (!pz.done) { win.hidden = true; return; }
    const a = answer();
    const n = pz.guesses.length;
    win.hidden = false;
    win.classList.toggle("lost", pz.gaveUp);

    const m = modeState();
    const modeLabel = isHard() ? "Hard" : "Easy";
    let body = pz.gaveUp
      ? `<p class="eyebrow">${modeLabel} · Puzzle ${m.current + 1} · the answer was</p>
         <h2>${escapeHtml(a.name)}</h2>
         <p>${COUNTRIES[a.country]} · ${a.role} · debut ${a.debut}</p>`
      : `<p class="eyebrow">${modeLabel} · Puzzle ${m.current + 1} · you got it</p>
         <h2>${escapeHtml(a.name)}</h2>
         <p>Found in ${n} guess${n === 1 ? "" : "es"}.</p>`;

    const isLatest = m.current === m.puzzles.length - 1;
    let actions = `<button id="share-btn" class="btn" type="button"><svg aria-hidden="true"><use href="#i-copy"/></svg> Copy result</button>`;
    if (isLatest && canUnlockNext()) {
      actions += `<button id="next-btn" class="btn primary" type="button">Next puzzle <svg aria-hidden="true"><use href="#i-arrow"/></svg></button>`;
    } else if (allDone()) {
      body += `<p class="done-note">All ${PUZZLES_PER_DAY} ${modeLabel} puzzles done for today. New set at midnight IST.</p>`;
    }
    win.innerHTML = body + `<div class="actions">${actions}</div>`;
    $("share-btn").addEventListener("click", share);
    $("next-btn")?.addEventListener("click", unlockNext);
  }

  function share() {
    const pz = puzzle();
    const m = modeState();
    const n = pz.guesses.length;
    const summary = m.puzzles
      .map((q) => (q.done ? (q.gaveUp ? "✕" : String(q.guesses.length)) : "·"))
      .join(" ");
    const head = `Cricketle ${state.day} · ${isHard() ? "Hard" : "Easy"} · Puzzle ${m.current + 1}/${PUZZLES_PER_DAY}`;
    const text = (pz.gaveUp
      ? `${head}\nGave up after ${n} guesses.\nToday: ${summary}`
      : `${head}\nGot it in ${n} guess${n === 1 ? "" : "es"}!\nToday: ${summary}`)
      + `\nhttps://mr-zero0.github.io/Cricketle/`;
    const btn = $("share-btn");

    if (navigator.share) {
      navigator.share({ title: "Cricketle", text }).catch(() => copyToClipboard(text, btn));
    } else {
      copyToClipboard(text, btn);
    }
  }

  function copyToClipboard(text, btn) {
    navigator.clipboard?.writeText(text).then(
      () => {
        btn.innerHTML = `<svg aria-hidden="true"><use href="#i-check"/></svg> Copied`;
        setTimeout(() => { btn.innerHTML = `<svg aria-hidden="true"><use href="#i-copy"/></svg> Copy result`; }, 1600);
      },
      () => setMessage("Could not copy. Result: " + text.replace(/\n/g, " "), true)
    );
  }

  // ---------- Countdown ----------

  function tick() {
    if (state.day !== todayKey()) {
      newDay();
      setMessage("A new day in IST. Fresh puzzles unlocked.");
      return;
    }
    const ms = Math.max(0, msUntilReset());
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    resetEl.textContent = `Resets in ${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  // ---------- Guessing ----------

  function submitGuess(name) {
    const pz = puzzle();
    if (pz.done) return;
    const pl = byName(name);
    if (!pl) { setMessage("Pick a player from the list.", true); return; }
    if (pz.guesses.includes(name)) {
      setMessage(`Already guessed: ${name} is rank ${ranks.get(name)}.`, true);
      const row = guessList.querySelector(`[data-name="${CSS.escape(name)}"]`);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.classList.remove("shake");
        void row.offsetWidth; // restart animation
        row.classList.add("shake");
      }
      input.value = "";
      hideSuggestions();
      return;
    }
    pz.guesses.push(name);
    if (ranks.get(name) === 1) {
      pz.done = true;
      celebrateDot = true;
      window.CricketleFX?.burst(isHard()
        ? ["#f59e0b", "#fbbf24", "#f8fafc", "#22c55e"]
        : ["#22c55e", "#86efac", "#f8fafc", "#f59e0b"]);
    }
    saveState();
    setMessage("");
    input.value = "";
    hideSuggestions();
    render({ animateLast: true });
    if (!pz.done) input.focus();
    else win.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "nearest" });
  }

  function doGiveUp() {
    const pz = puzzle();
    if (pz.done) return;
    if (!confirm("Give up on this puzzle? You cannot replay it today.")) return;
    pz.done = true;
    pz.gaveUp = true;
    saveState();
    render();
  }

  // ---------- Autocomplete ----------

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
    const guessed = puzzle().guesses;
    const starts = (pl) => pl.name.toLowerCase().startsWith(q);
    currentMatches = PLAYERS
      .filter((pl) => pl.name.toLowerCase().includes(q))
      .sort((a, b) => (starts(a) === starts(b) ? a.name.localeCompare(b.name) : starts(a) ? -1 : 1))
      .slice(0, 8);
    if (!currentMatches.length) { hideSuggestions(); return; }
    highlighted = 0;
    suggestions.hidden = false;
    input.setAttribute("aria-expanded", "true");
    suggestions.innerHTML = currentMatches.map((pl, i) => {
      const done = guessed.includes(pl.name);
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

  giveUp.addEventListener("click", doGiveUp);
  $("mode-easy").addEventListener("click", () => setMode("easy"));
  $("mode-hard").addEventListener("click", () => setMode("hard"));
  $("help-btn").addEventListener("click", () => $("help").showModal());
  $("legend-hot").textContent = `rank 2–${TIERS.hot}`;
  $("legend-warm").textContent = `rank ${TIERS.hot + 1}–${TIERS.warm}`;
  $("legend-cool").textContent = `rank ${TIERS.warm + 1}–${TIERS.cool}`;
  $("legend-cold").textContent = `rank ${TIERS.cool + 1}+`;
  $("pool-size").textContent = PLAYERS.length;

  // Exposed for debugging and tests.
  globalThis.Cricketle = { similarity, buildRanks, reasons, dailyAnswers, todayKey };

  // ---------- Boot ----------

  // Names are the lookup key for guesses, so they must be unique.
  {
    const seen = new Set();
    for (const pl of PLAYERS) {
      if (seen.has(pl.name)) console.error(`Cricketle: duplicate player name "${pl.name}" in players.js`);
      seen.add(pl.name);
    }
  }

  state = loadState();
  if (state) loadPuzzle(); else newDay();
  tick();
  setInterval(tick, 1000);
})();

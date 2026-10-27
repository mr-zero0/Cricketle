// Cricketle shared game core.
//
// One copy of the rules for both sides: the browser loads this as a classic script
// (after players.js) and gets window.CricketleCore; the Node server requires it.
// Everything here is pure: no DOM, no storage, no clocks (callers pass `now`).
//
// Contents: player pools (Easy = curated well-known names, Hard = everyone),
// similarity + rank tables, the IST game day, seeded daily answers, hints,
// scoring, the rank ladder and the puzzle state machine.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./players.js"));
  } else {
    /* global PLAYERS, COUNTRIES, IPL_TEAMS, BOWL_STYLES, PACE, SPIN */
    root.CricketleCore = factory({ PLAYERS, COUNTRIES, IPL_TEAMS, BOWL_STYLES, PACE, SPIN });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (data) {
  "use strict";

  const { PLAYERS, COUNTRIES, BOWL_STYLES, PACE, SPIN } = data;

  // ---------- Constants ----------

  const PUZZLES_PER_DAY = 3;
  const HINTS_PER_PUZZLE = 3;
  const HINT_COST = 10;
  const MODES = ["easy", "hard"];
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ---------- Pools ----------

  // Easy mode uses household names only. Curated by hand rather than by a stats
  // threshold: match counts alone promote long-serving journeymen from small
  // nations and demote stars with short careers.
  const EASY_NAMES = [
    // India
    "Virat Kohli", "Rohit Sharma", "MS Dhoni", "Sachin Tendulkar", "Jasprit Bumrah", "Ravindra Jadeja",
    "Ravichandran Ashwin", "Hardik Pandya", "KL Rahul", "Shubman Gill", "Yuvraj Singh", "Virender Sehwag",
    "Rahul Dravid", "Zaheer Khan", "Harbhajan Singh", "Mohammed Shami", "Rishabh Pant", "Suryakumar Yadav",
    "Gautam Gambhir", "Shikhar Dhawan", "Kuldeep Yadav", "Yuzvendra Chahal", "Bhuvneshwar Kumar",
    "Mohammed Siraj", "Ajinkya Rahane", "Irfan Pathan", "Ishant Sharma", "Dinesh Karthik", "Suresh Raina",
    "Shreyas Iyer", "Axar Patel", "Yashasvi Jaiswal",
    // Pakistan
    "Babar Azam", "Shaheen Afridi", "Shahid Afridi", "Shoaib Akhtar", "Inzamam-ul-Haq", "Younis Khan",
    "Misbah-ul-Haq", "Mohammad Rizwan", "Shadab Khan", "Mohammad Amir", "Fakhar Zaman", "Mohammad Hafeez",
    "Shoaib Malik", "Saeed Ajmal", "Mohammad Yousuf", "Abdul Razzaq", "Sarfaraz Ahmed", "Haris Rauf",
    // Australia
    "Ricky Ponting", "Steve Smith", "David Warner", "Glenn McGrath", "Adam Gilchrist", "Pat Cummins",
    "Mitchell Starc", "Glenn Maxwell", "Travis Head", "Michael Clarke", "Brett Lee", "Matthew Hayden",
    "Mitchell Johnson", "Aaron Finch", "Josh Hazlewood", "Marnus Labuschagne", "Shane Watson",
    "Michael Hussey", "Andrew Symonds", "Mitchell Marsh", "Nathan Lyon",
    // England
    "Ben Stokes", "Joe Root", "Jos Buttler", "James Anderson", "Stuart Broad", "Kevin Pietersen",
    "Andrew Flintoff", "Alastair Cook", "Eoin Morgan", "Jofra Archer", "Moeen Ali", "Harry Brook",
    "Graeme Swann", "Adil Rashid", "Jonny Bairstow", "Sam Curran", "Chris Woakes",
    // South Africa
    "AB de Villiers", "Jacques Kallis", "Dale Steyn", "Kagiso Rabada", "Quinton de Kock", "Faf du Plessis",
    "Hashim Amla", "Graeme Smith", "Shaun Pollock", "Aiden Markram", "Heinrich Klaasen", "Imran Tahir",
    "Morne Morkel", "JP Duminy", "Herschelle Gibbs", "Mark Boucher", "Makhaya Ntini",
    // New Zealand
    "Kane Williamson", "Brendon McCullum", "Trent Boult", "Daniel Vettori", "Ross Taylor", "Tim Southee",
    "Martin Guptill", "Rachin Ravindra", "Mitchell Santner", "Devon Conway", "Stephen Fleming", "Shane Bond",
    "Glenn Phillips", "James Neesham", "Tom Latham", "Daryl Mitchell", "Chris Cairns", "Nathan Astle",
    // Sri Lanka
    "Kumar Sangakkara", "Mahela Jayawardene", "Muttiah Muralitharan", "Lasith Malinga", "Sanath Jayasuriya",
    "Chaminda Vaas", "Tillakaratne Dilshan", "Angelo Mathews", "Wanindu Hasaranga", "Rangana Herath",
    "Thisara Perera", "Kusal Mendis", "Ajantha Mendis",
    // West Indies
    "Chris Gayle", "Dwayne Bravo", "Andre Russell", "Sunil Narine", "Shai Hope", "Shivnarine Chanderpaul",
    "Marlon Samuels", "Darren Sammy", "Kemar Roach", "Jason Holder", "Carlos Brathwaite",
    // Bangladesh
    "Shakib Al Hasan", "Tamim Iqbal", "Mushfiqur Rahim", "Mustafizur Rahman", "Mashrafe Mortaza",
    "Mahmudullah", "Litton Das", "Mehidy Hasan Miraz",
    // Afghanistan
    "Rashid Khan", "Mohammad Nabi", "Mujeeb Ur Rahman", "Rahmanullah Gurbaz", "Ibrahim Zadran",
    "Mohammad Shahzad",
    // Zimbabwe
    "Sikandar Raza", "Heath Streak", "Brendan Taylor", "Hamilton Masakadza", "Sean Williams", "Tatenda Taibu",
    // Ireland
    "Paul Stirling", "Kevin O'Brien", "William Porterfield", "Andrew Balbirnie",
  ];

  const PLAYER_BY_NAME = new Map(PLAYERS.map((p) => [p.name, p]));
  const EASY_SET = new Set(EASY_NAMES);
  const POOLS = {
    easy: PLAYERS.filter((p) => EASY_SET.has(p.name)),
    hard: PLAYERS.slice(),
  };
  const POOL_SETS = {
    easy: new Set(POOLS.easy.map((p) => p.name)),
    hard: new Set(POOLS.hard.map((p) => p.name)),
  };

  function poolFor(mode) {
    if (!POOLS[mode]) throw new Error("Unknown mode: " + mode);
    return POOLS[mode];
  }

  function inPool(mode, name) {
    return Boolean(POOL_SETS[mode] && POOL_SETS[mode].has(name));
  }

  function byName(name) {
    return PLAYER_BY_NAME.get(name);
  }

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

  // Higher = closer. Symmetric.
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

  // Human-readable reasons a guess is close. Only confirms what the guess shares
  // with the answer; never states the answer's own values.
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
    if (guess.titles > 0 && guess.titles === answer.titles) out.push("Both won " + guess.titles + " ICC title" + (guess.titles > 1 ? "s" : ""));
    if (logGap(guess.runs, answer.runs) < 0.12) out.push("Similar runs");
    if (logGap(guess.wkts, answer.wkts) < 0.12 && answer.wkts > 20) out.push("Similar wickets");
    return out.slice(0, 5);
  }

  // Rank table over a pool: every member ordered by closeness. Rank 1 is the answer.
  function buildRanks(answer, pool) {
    const scored = pool.map((pl) => ({
      name: pl.name,
      score: pl.name === answer.name ? Infinity : similarity(pl, answer),
    }));
    scored.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
    const ranks = new Map();
    scored.forEach((e, i) => ranks.set(e.name, i + 1));
    return ranks;
  }

  // Heat tiers scale with the size of the pool.
  function tiers(poolSize) {
    return { hot: 10, warm: Math.round(poolSize * 0.15), cool: Math.round(poolSize * 0.4) };
  }

  function tier(rank, poolSize) {
    const t = tiers(poolSize);
    if (rank === 1) return { key: "answer", label: "Answer" };
    if (rank <= t.hot) return { key: "hot", label: "Hot" };
    if (rank <= t.warm) return { key: "warm", label: "Warm" };
    if (rank <= t.cool) return { key: "cool", label: "Cool" };
    return { key: "cold", label: "Cold" };
  }

  // ---------- IST day ----------

  const pad = (n) => String(n).padStart(2, "0");

  function todayKey(now) {
    const d = new Date((now === undefined ? Date.now() : now) + IST_OFFSET_MS);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function msUntilReset(now) {
    const t = (now === undefined ? Date.now() : now) + IST_OFFSET_MS;
    const d = new Date(t);
    const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return nextMidnight - t;
  }

  // ---------- Seeded daily answers ----------

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

  // Partial Fisher-Yates driven by a seeded generator; skips excluded names.
  function pickFrom(pool, seedStr, n, exclude) {
    const rnd = mulberry32(hashString(seedStr));
    const idx = pool.map((_, i) => i);
    const out = [];
    for (let i = 0; i < idx.length && out.length < n; i++) {
      const j = i + Math.floor(rnd() * (idx.length - i));
      const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
      const name = pool[idx[i]].name;
      if (!exclude.has(name)) out.push(name);
    }
    return out;
  }

  const answerCache = new Map();

  // Three Easy answers from the easy pool and three Hard answers from everyone,
  // identical for every player on the same IST day, six different cricketers.
  // `secret` is empty for guest play (public seed) and a per-server secret for
  // signed-in play, so leaderboard answers cannot be read out of the client.
  function dailyAnswers(day, secret) {
    const salt = secret || "";
    const key = salt + "|" + day;
    if (answerCache.has(key)) return answerCache.get(key);
    const easy = pickFrom(POOLS.easy, "cricketle:v2:easy:" + salt + ":" + day, PUZZLES_PER_DAY, new Set());
    const hard = pickFrom(POOLS.hard, "cricketle:v2:hard:" + salt + ":" + day, PUZZLES_PER_DAY, new Set(easy));
    const out = { easy, hard };
    if (answerCache.size > 64) answerCache.clear();
    answerCache.set(key, out);
    return out;
  }

  function answerFor(day, mode, idx, secret) {
    return byName(dailyAnswers(day, secret)[mode][idx]);
  }

  const rankCache = new Map();

  function ranksFor(day, mode, idx, secret) {
    const key = (secret || "") + "|" + day + "|" + mode + "|" + idx;
    if (rankCache.has(key)) return rankCache.get(key);
    const table = buildRanks(answerFor(day, mode, idx, secret), poolFor(mode));
    if (rankCache.size > 64) rankCache.clear();
    rankCache.set(key, table);
    return table;
  }

  // Moves a YYYY-MM-DD key by whole days.
  function shiftDay(day, n) {
    const [y, m, d] = day.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate());
  }

  // The facts about a player that may be shown once a puzzle is over.
  function describe(p) {
    return { name: p.name, country: p.country, countryName: COUNTRIES[p.country], role: p.role, debut: p.debut, active: p.active };
  }

  // ---------- Hints ----------

  const HINT_LABELS = ["Nation", "Role", "Era"];

  function initials(name) {
    return name.split(/\s+/).map((w) => w[0].toUpperCase()).join(".") + ".";
  }

  function hintFor(player, n, mode) {
    if (!Number.isInteger(n) || n < 1 || n > HINTS_PER_PUZZLE) throw new RangeError("Hint number out of range: " + n);
    let text;
    if (n === 1) {
      text = "Represents " + COUNTRIES[player.country];
    } else if (n === 2) {
      text = (player.bat === "L" ? "Left-handed " : "Right-handed ") + player.role.toLowerCase();
      if (player.bowl !== "-") text += ", bowls " + BOWL_STYLES[player.bowl].toLowerCase();
    } else {
      text = "Debuted in " + player.debut + " · " + (player.active ? "still playing" : "retired");
      if (mode === "easy") text += " · initials " + initials(player.name);
    }
    return { n, label: HINT_LABELS[n - 1], text, cost: HINT_COST };
  }

  // ---------- Scoring ----------

  // 100 a solve, minus 3 per guess after the first (max 60), 10 per hint and
  // 1 per 20 seconds (max 25); never below 5 once solved. Hard counts 1.5x.
  function scorePuzzle(o) {
    if (!o.solved) return 0;
    const guessPen = Math.min(60, 3 * Math.max(0, (o.guesses || 0) - 1));
    const hintPen = HINT_COST * (o.hints || 0);
    const timePen = Math.min(25, Math.floor(Math.max(0, o.seconds || 0) / 20));
    let pts = Math.max(5, 100 - guessPen - hintPen - timePen);
    if (o.mode === "hard") pts = Math.round(pts * 1.5);
    return pts;
  }

  const RANK_LADDER = [
    { title: "Net Bowler", min: 0 },
    { title: "Club Pro", min: 300 },
    { title: "Domestic Star", min: 1000 },
    { title: "International", min: 2500 },
    { title: "World Class", min: 6000 },
    { title: "Legend", min: 12000 },
  ];

  function rankTitle(points) {
    const pts = Math.max(0, points || 0);
    let i = 0;
    while (i + 1 < RANK_LADDER.length && pts >= RANK_LADDER[i + 1].min) i++;
    const cur = RANK_LADDER[i];
    const next = RANK_LADDER[i + 1] || null;
    const progress = next ? (pts - cur.min) / (next.min - cur.min) : 1;
    return { title: cur.title, min: cur.min, next, progress };
  }

  // ---------- Puzzle state machine ----------
  //
  // state = { day, modes: { easy: { puzzles: [P x3] }, hard: { puzzles: [P x3] } } }
  // P = { status: locked|ready|active|solved|gaveUp, guesses: [{ name, rank, tags }],
  //       hints: n, startedAt: ms|null, finishedAt: ms|null, points: n }
  // Mutating functions take an optional `opts.secret` (see dailyAnswers).

  function clone(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function newPuzzle(i) {
    return { status: i === 0 ? "ready" : "locked", guesses: [], hints: 0, startedAt: null, finishedAt: null, points: 0 };
  }

  function newDayState(day) {
    const modes = {};
    for (const m of MODES) modes[m] = { puzzles: Array.from({ length: PUZZLES_PER_DAY }, (_, i) => newPuzzle(i)) };
    return { day, modes };
  }

  function locate(state, mode, idx) {
    if (!MODES.includes(mode)) return { error: "bad_mode" };
    if (!Number.isInteger(idx) || idx < 0 || idx >= PUZZLES_PER_DAY) return { error: "bad_index" };
    const puzzle = state && state.modes && state.modes[mode] && state.modes[mode].puzzles[idx];
    if (!puzzle) return { error: "bad_state" };
    return { puzzle };
  }

  function fail(state, error) {
    return { ok: false, error, state };
  }

  function isFinished(p) {
    return p.status === "solved" || p.status === "gaveUp";
  }

  function finish(next, mode, idx, status, now) {
    const p = next.modes[mode].puzzles[idx];
    p.status = status;
    p.finishedAt = now;
    p.points = scorePuzzle({
      mode,
      guesses: p.guesses.length,
      hints: p.hints,
      seconds: (now - p.startedAt) / 1000,
      solved: status === "solved",
    });
    const following = next.modes[mode].puzzles[idx + 1];
    if (following && following.status === "locked") following.status = "ready";
  }

  function startPuzzle(state, mode, idx, now) {
    const loc = locate(state, mode, idx);
    if (loc.error) return fail(state, loc.error);
    if (loc.puzzle.status === "locked") return fail(state, "locked");
    if (loc.puzzle.status !== "ready") return fail(state, "not_ready");
    const next = clone(state);
    const p = next.modes[mode].puzzles[idx];
    p.status = "active";
    p.startedAt = now === undefined ? Date.now() : now;
    return { ok: true, state: next };
  }

  function applyGuess(state, mode, idx, name, now, opts) {
    const secret = opts && opts.secret;
    const loc = locate(state, mode, idx);
    if (loc.error) return fail(state, loc.error);
    if (loc.puzzle.status !== "active") return fail(state, "not_active");
    const player = typeof name === "string" ? byName(name) : null;
    if (!player || !inPool(mode, name)) return fail(state, "unknown_player");
    if (loc.puzzle.guesses.some((g) => g.name === name)) return fail(state, "already_guessed");
    const rank = ranksFor(state.day, mode, idx, secret).get(name);
    const solved = rank === 1;
    // Easy mode explains what the guess shares with the answer; Hard gives rank only.
    const tags = mode === "easy" && !solved ? reasons(player, answerFor(state.day, mode, idx, secret)) : [];
    const next = clone(state);
    const p = next.modes[mode].puzzles[idx];
    p.guesses.push({ name, rank, tags });
    if (solved) finish(next, mode, idx, "solved", now === undefined ? Date.now() : now);
    return { ok: true, state: next, rank, solved };
  }

  function useHint(state, mode, idx, now, opts) {
    const secret = opts && opts.secret;
    const loc = locate(state, mode, idx);
    if (loc.error) return fail(state, loc.error);
    if (loc.puzzle.status !== "active") return fail(state, "not_active");
    if (loc.puzzle.hints >= HINTS_PER_PUZZLE) return fail(state, "no_hints_left");
    const next = clone(state);
    const p = next.modes[mode].puzzles[idx];
    p.hints += 1;
    const hint = hintFor(answerFor(state.day, mode, idx, secret), p.hints, mode);
    void now;
    return { ok: true, state: next, hint };
  }

  function giveUp(state, mode, idx, now) {
    const loc = locate(state, mode, idx);
    if (loc.error) return fail(state, loc.error);
    if (loc.puzzle.status !== "active") return fail(state, "not_active");
    const next = clone(state);
    finish(next, mode, idx, "gaveUp", now === undefined ? Date.now() : now);
    return { ok: true, state: next };
  }

  function revealedHints(state, mode, idx, opts) {
    const loc = locate(state, mode, idx);
    if (loc.error) return [];
    const answer = answerFor(state.day, mode, idx, opts && opts.secret);
    const out = [];
    for (let n = 1; n <= loc.puzzle.hints; n++) out.push(hintFor(answer, n, mode));
    return out;
  }

  function modeDone(state, mode) {
    return state.modes[mode].puzzles.every(isFinished);
  }

  function dayPoints(state) {
    const out = { total: 0 };
    for (const m of MODES) {
      out[m] = state.modes[m].puzzles.reduce((s, p) => s + (p.points || 0), 0);
      out.total += out[m];
    }
    return out;
  }

  function elapsedMs(p, now) {
    if (!p || !p.startedAt) return 0;
    const end = p.finishedAt != null ? p.finishedAt : (now === undefined ? Date.now() : now);
    return Math.max(0, end - p.startedAt);
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? h + ":" + pad(m) + ":" + pad(sec) : pad(m) + ":" + pad(sec);
  }

  return {
    PUZZLES_PER_DAY, HINTS_PER_PUZZLE, HINT_COST, MODES, IST_OFFSET_MS, DAY_MS,
    EASY_NAMES, RANK_LADDER, HINT_LABELS,
    data: { COUNTRIES: data.COUNTRIES, IPL_TEAMS: data.IPL_TEAMS, BOWL_STYLES: data.BOWL_STYLES },
    poolFor, inPool, byName, describe,
    similarity, reasons, buildRanks, tiers, tier,
    todayKey, msUntilReset, shiftDay, hashString, mulberry32,
    dailyAnswers, answerFor, ranksFor,
    hintFor, scorePuzzle, rankTitle,
    newDayState, startPuzzle, applyGuess, useHint, giveUp, revealedHints,
    modeDone, dayPoints, elapsedMs, formatTime, isFinished,
  };
});

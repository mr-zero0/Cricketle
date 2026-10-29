"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const data = require("../public/players.js");
const core = require("../public/game-core.js");

const IST = 5.5 * 3600 * 1000;
// 2026-10-27 00:00 IST expressed as a UTC timestamp.
const DAY_START = Date.UTC(2026, 9, 27) - IST;

// ---------- data ----------

test("players.js exports the player list and lookup tables", () => {
  assert.ok(Array.isArray(data.PLAYERS));
  assert.equal(data.PLAYERS.length, 425);
  assert.equal(data.COUNTRIES.IND, "India");
  assert.equal(data.BOWL_STYLES.SLA, "Left-arm orthodox");
  assert.ok(data.PACE.has("RF"));
  assert.ok(data.SPIN.has("OB"));
});

test("player names are unique", () => {
  const names = data.PLAYERS.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
});

// ---------- constants ----------

test("game constants: 3 puzzles per day, 3 hints per puzzle, two modes", () => {
  assert.equal(core.PUZZLES_PER_DAY, 3);
  assert.equal(core.HINTS_PER_PUZZLE, 3);
  assert.deepEqual(core.MODES, ["easy", "hard"]);
});

// ---------- pools ----------

test("easy pool is a curated subset of well-known players", () => {
  const easy = core.poolFor("easy");
  const hard = core.poolFor("hard");
  assert.equal(hard.length, data.PLAYERS.length);
  assert.ok(easy.length >= 120 && easy.length <= 220, "easy pool size " + easy.length);
  for (const name of ["Virat Kohli", "MS Dhoni", "Ricky Ponting", "AB de Villiers", "Babar Azam", "Chris Gayle"]) {
    assert.ok(easy.some((p) => p.name === name), name + " should be in the easy pool");
  }
  for (const name of ["Munaf Patel", "Peter Chase", "Rory Kleinveldt"]) {
    assert.ok(!easy.some((p) => p.name === name), name + " should not be in the easy pool");
  }
});

test("every curated easy name exists in the player list", () => {
  const all = new Set(data.PLAYERS.map((p) => p.name));
  for (const name of core.EASY_NAMES) assert.ok(all.has(name), "unknown easy name: " + name);
  assert.equal(new Set(core.EASY_NAMES).size, core.EASY_NAMES.length, "easy names must be unique");
});

test("poolFor rejects an unknown mode", () => {
  assert.throws(() => core.poolFor("medium"));
});

test("byName finds players and returns undefined for strangers", () => {
  assert.equal(core.byName("Virat Kohli").country, "IND");
  assert.equal(core.byName("Nobody"), undefined);
});

// ---------- similarity + ranks ----------

test("similarity is symmetric and highest for identical players", () => {
  const a = core.byName("Virat Kohli");
  const b = core.byName("Rohit Sharma");
  const c = core.byName("Peter Chase");
  assert.equal(core.similarity(a, b), core.similarity(b, a));
  assert.ok(core.similarity(a, a) >= core.similarity(a, b));
  assert.ok(core.similarity(a, b) > core.similarity(a, c));
});

test("buildRanks ranks the answer first and gives every pool member a distinct rank", () => {
  const pool = core.poolFor("hard");
  const answer = core.byName("Jasprit Bumrah");
  const ranks = core.buildRanks(answer, pool);
  assert.equal(ranks.size, pool.length);
  assert.equal(ranks.get("Jasprit Bumrah"), 1);
  const values = [...ranks.values()].sort((x, y) => x - y);
  assert.deepEqual(values, pool.map((_, i) => i + 1));
});

test("buildRanks over the easy pool only ranks easy players", () => {
  const pool = core.poolFor("easy");
  const ranks = core.buildRanks(core.byName("Virat Kohli"), pool);
  assert.equal(ranks.size, pool.length);
  assert.equal(ranks.get("Munaf Patel"), undefined);
});

test("tiers scale with the pool size and rank 1 is the answer", () => {
  assert.equal(core.tier(1, 425).key, "answer");
  assert.equal(core.tier(5, 425).key, "hot");
  assert.equal(core.tier(11, 425).key, "warm");
  assert.equal(core.tier(100, 425).key, "cool");
  assert.equal(core.tier(400, 425).key, "cold");
  const t = core.tiers(100);
  assert.deepEqual(t, { hot: 10, warm: 15, cool: 40 });
});

test("reasons only confirms what the guess shares with the answer", () => {
  const r = core.reasons(core.byName("Rohit Sharma"), core.byName("Virat Kohli"));
  assert.ok(r.includes("Same nation"));
  assert.ok(r.includes("Same role"));
  assert.ok(r.length <= 5);
  const none = core.reasons(core.byName("Peter Chase"), core.byName("Virat Kohli"));
  assert.ok(!none.includes("Same nation"));
});

// ---------- IST day ----------

test("todayKey uses the IST calendar day", () => {
  assert.equal(core.todayKey(DAY_START), "2026-10-27");
  assert.equal(core.todayKey(DAY_START - 1), "2026-10-26");
  assert.equal(core.todayKey(DAY_START + 24 * 3600 * 1000 - 1), "2026-10-27");
});

test("msUntilReset counts down to the next IST midnight", () => {
  assert.equal(core.msUntilReset(DAY_START), 24 * 3600 * 1000);
  assert.equal(core.msUntilReset(DAY_START + 1000), 24 * 3600 * 1000 - 1000);
});

// ---------- daily answers ----------

test("dailyAnswers is deterministic, draws easy from the easy pool and never repeats a player", () => {
  const a = core.dailyAnswers("2026-10-27");
  const b = core.dailyAnswers("2026-10-27");
  assert.deepEqual(a, b);
  assert.equal(a.easy.length, 3);
  assert.equal(a.hard.length, 3);
  const easyNames = new Set(core.poolFor("easy").map((p) => p.name));
  for (const n of a.easy) assert.ok(easyNames.has(n), n + " is not an easy player");
  for (const n of a.hard) assert.ok(core.byName(n), n + " is not a player");
  assert.equal(new Set([...a.easy, ...a.hard]).size, 6);
});

test("dailyAnswers changes from day to day", () => {
  const days = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  const firsts = days.map((d) => core.dailyAnswers(d).easy[0]);
  assert.ok(new Set(firsts).size >= 3);
});

test("answerFor returns the player object for a day, mode and index", () => {
  const a = core.dailyAnswers("2026-10-27");
  assert.equal(core.answerFor("2026-10-27", "easy", 0).name, a.easy[0]);
  assert.equal(core.answerFor("2026-10-27", "hard", 2).name, a.hard[2]);
});

// ---------- hints ----------

test("hints reveal nation, then role, then era, in that order", () => {
  const kohli = core.byName("Virat Kohli");
  const h1 = core.hintFor(kohli, 1, "easy");
  const h2 = core.hintFor(kohli, 2, "easy");
  const h3 = core.hintFor(kohli, 3, "easy");
  assert.equal(h1.label, "Nation");
  assert.match(h1.text, /India/);
  assert.equal(h2.label, "Role");
  assert.match(h2.text, /Right-handed batter/);
  assert.match(h2.text, /right-arm medium/i);
  assert.equal(h3.label, "Era");
  assert.match(h3.text, /2008/);
  assert.match(h3.text, /still playing/);
});

test("the era hint adds initials in easy mode only", () => {
  const dhoni = core.byName("MS Dhoni");
  assert.match(core.hintFor(dhoni, 3, "easy").text, /M\.D\./);
  assert.doesNotMatch(core.hintFor(dhoni, 3, "hard").text, /M\.D\./);
  assert.match(core.hintFor(dhoni, 3, "hard").text, /retired/);
});

test("hints never contain the player's full name", () => {
  for (const p of core.poolFor("hard")) {
    for (let n = 1; n <= 3; n++) {
      for (const mode of core.MODES) {
        assert.ok(!core.hintFor(p, n, mode).text.includes(p.name), p.name + " leaked in hint " + n);
      }
    }
  }
});

test("hintFor rejects hint numbers outside 1..3", () => {
  assert.throws(() => core.hintFor(core.byName("Virat Kohli"), 0, "easy"));
  assert.throws(() => core.hintFor(core.byName("Virat Kohli"), 4, "easy"));
});

// ---------- scoring ----------

test("a first-guess solve with no hints is worth 100 in easy and 150 in hard", () => {
  assert.equal(core.scorePuzzle({ mode: "easy", guesses: 1, hints: 0, seconds: 5, solved: true }), 100);
  assert.equal(core.scorePuzzle({ mode: "hard", guesses: 1, hints: 0, seconds: 5, solved: true }), 150);
});

test("points fall with extra guesses, hints and time, but never below 5 when solved", () => {
  const base = { mode: "easy", hints: 0, seconds: 0, solved: true };
  assert.equal(core.scorePuzzle({ ...base, guesses: 2 }), 97);
  assert.equal(core.scorePuzzle({ ...base, guesses: 11 }), 70);
  assert.equal(core.scorePuzzle({ ...base, guesses: 1, hints: 2 }), 80);
  assert.equal(core.scorePuzzle({ ...base, guesses: 1, seconds: 60 }), 97);
  assert.equal(core.scorePuzzle({ ...base, guesses: 1, seconds: 99999 }), 75);
  assert.equal(core.scorePuzzle({ ...base, guesses: 500, hints: 3, seconds: 99999 }), 5);
});

test("a given-up puzzle scores zero", () => {
  assert.equal(core.scorePuzzle({ mode: "hard", guesses: 1, hints: 0, seconds: 1, solved: false }), 0);
});

test("rank titles climb the ladder with all-time points", () => {
  assert.equal(core.rankTitle(0).title, "Net Bowler");
  assert.equal(core.rankTitle(299).title, "Net Bowler");
  assert.equal(core.rankTitle(300).title, "Club Pro");
  assert.equal(core.rankTitle(12000).title, "Legend");
  const t = core.rankTitle(150);
  assert.equal(t.next.title, "Club Pro");
  assert.equal(t.progress, 0.5);
  assert.equal(core.rankTitle(99999).next, null);
});

// ---------- engine ----------

const NOW = DAY_START + 3600 * 1000;
const DAY = "2026-10-27";

function fresh() {
  return core.newDayState(DAY);
}

test("a new day has 3 puzzles per mode, with only the first one ready", () => {
  const s = fresh();
  assert.equal(s.day, DAY);
  for (const mode of core.MODES) {
    const ps = s.modes[mode].puzzles;
    assert.equal(ps.length, 3);
    assert.deepEqual(ps.map((p) => p.status), ["ready", "locked", "locked"]);
    assert.deepEqual(ps[0].guesses, []);
    assert.equal(ps[0].hints, 0);
    assert.equal(ps[0].points, 0);
  }
});

test("startPuzzle activates a ready puzzle and stamps the start time", () => {
  const r = core.startPuzzle(fresh(), "easy", 0, NOW);
  assert.equal(r.ok, true);
  const p = r.state.modes.easy.puzzles[0];
  assert.equal(p.status, "active");
  assert.equal(p.startedAt, NOW);
});

test("startPuzzle refuses locked puzzles and bad arguments", () => {
  assert.equal(core.startPuzzle(fresh(), "easy", 1, NOW).error, "locked");
  assert.equal(core.startPuzzle(fresh(), "medium", 0, NOW).error, "bad_mode");
  assert.equal(core.startPuzzle(fresh(), "easy", 7, NOW).error, "bad_index");
});

test("engine functions do not mutate the state they are given", () => {
  const s = fresh();
  const snapshot = JSON.stringify(s);
  core.startPuzzle(s, "easy", 0, NOW);
  assert.equal(JSON.stringify(s), snapshot);
});

test("guessing is only allowed on an active puzzle", () => {
  const r = core.applyGuess(fresh(), "easy", 0, "Virat Kohli", NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error, "not_active");
});

test("a wrong guess records the name and returns its rank", () => {
  const answer = core.answerFor(DAY, "easy", 0).name;
  const pool = core.poolFor("easy");
  const other = pool.find((p) => p.name !== answer).name;
  const s = core.startPuzzle(fresh(), "easy", 0, NOW).state;
  const r = core.applyGuess(s, "easy", 0, other, NOW + 1000);
  assert.equal(r.ok, true);
  assert.equal(r.solved, false);
  assert.ok(r.rank > 1);
  const g = r.state.modes.easy.puzzles[0].guesses;
  assert.equal(g.length, 1);
  assert.equal(g[0].name, other);
  assert.equal(g[0].rank, r.rank);
  assert.ok(Array.isArray(g[0].tags));
  assert.equal(r.state.modes.easy.puzzles[0].status, "active");
});

test("easy-mode guesses carry clue tags, hard-mode guesses do not", () => {
  const easyAnswer = core.answerFor(DAY, "easy", 0);
  const twin = core.poolFor("easy").find((p) => p.name !== easyAnswer.name && p.country === easyAnswer.country);
  let s = core.startPuzzle(fresh(), "easy", 0, NOW).state;
  const easy = core.applyGuess(s, "easy", 0, twin.name, NOW);
  assert.ok(easy.state.modes.easy.puzzles[0].guesses[0].tags.includes("Same nation"));
  const hardAnswer = core.answerFor(DAY, "hard", 0);
  const hardTwin = core.poolFor("hard").find((p) => p.name !== hardAnswer.name && p.country === hardAnswer.country);
  s = core.startPuzzle(fresh(), "hard", 0, NOW).state;
  const hard = core.applyGuess(s, "hard", 0, hardTwin.name, NOW);
  assert.deepEqual(hard.state.modes.hard.puzzles[0].guesses[0].tags, []);
});

test("a secret seed changes the daily answers but not the rules", () => {
  const pub = core.dailyAnswers(DAY);
  const sec = core.dailyAnswers(DAY, "server-secret");
  assert.notDeepEqual(pub, sec);
  assert.equal(core.answerFor(DAY, "easy", 0, "server-secret").name, sec.easy[0]);
  const s = core.startPuzzle(fresh(), "easy", 0, NOW).state;
  const r = core.applyGuess(s, "easy", 0, sec.easy[0], NOW, { secret: "server-secret" });
  assert.equal(r.solved, true);
  assert.equal(core.applyGuess(s, "easy", 0, pub.easy[0], NOW, { secret: "server-secret" }).solved, false);
  const h = core.useHint(s, "easy", 0, NOW, { secret: "server-secret" });
  assert.equal(h.hint.text, core.hintFor(core.byName(sec.easy[0]), 1, "easy").text);
  assert.equal(core.revealedHints(h.state, "easy", 0, { secret: "server-secret" })[0].text, h.hint.text);
});

test("shiftDay moves a day key by whole days across month ends", () => {
  assert.equal(core.shiftDay("2026-10-31", 1), "2026-11-01");
  assert.equal(core.shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(core.shiftDay("2026-10-27", 0), "2026-10-27");
});

test("describe exposes only public facts about a player", () => {
  assert.deepEqual(core.describe(core.byName("Virat Kohli")), {
    name: "Virat Kohli", country: "IND", countryName: "India", role: "Batter", debut: 2008, active: true,
  });
});

test("guessing a player outside the mode's pool or twice is rejected", () => {
  let s = core.startPuzzle(fresh(), "easy", 0, NOW).state;
  assert.equal(core.applyGuess(s, "easy", 0, "Munaf Patel", NOW).error, "unknown_player");
  assert.equal(core.applyGuess(s, "easy", 0, "Not A Player", NOW).error, "unknown_player");
  const answer = core.answerFor(DAY, "easy", 0).name;
  const other = core.poolFor("easy").find((p) => p.name !== answer).name;
  s = core.applyGuess(s, "easy", 0, other, NOW).state;
  assert.equal(core.applyGuess(s, "easy", 0, other, NOW).error, "already_guessed");
});

test("guessing the answer solves the puzzle, scores it and unlocks the next one", () => {
  const answer = core.answerFor(DAY, "easy", 0).name;
  const s = core.startPuzzle(fresh(), "easy", 0, NOW).state;
  const r = core.applyGuess(s, "easy", 0, answer, NOW + 30 * 1000);
  assert.equal(r.ok, true);
  assert.equal(r.solved, true);
  assert.equal(r.rank, 1);
  const p = r.state.modes.easy.puzzles[0];
  assert.equal(p.status, "solved");
  assert.equal(p.finishedAt, NOW + 30 * 1000);
  assert.equal(p.points, 99);
  assert.deepEqual(p.guesses[0], { name: answer, rank: 1, tags: [] });
  assert.equal(r.state.modes.easy.puzzles[1].status, "ready");
  assert.equal(r.state.modes.hard.puzzles[0].status, "ready");
  assert.equal(core.applyGuess(r.state, "easy", 0, answer, NOW).error, "not_active");
});

test("hints are capped at 3, cost points and need an active puzzle", () => {
  assert.equal(core.useHint(fresh(), "easy", 0, NOW).error, "not_active");
  let s = core.startPuzzle(fresh(), "hard", 0, NOW).state;
  const h1 = core.useHint(s, "hard", 0, NOW);
  assert.equal(h1.ok, true);
  assert.equal(h1.hint.label, "Nation");
  assert.equal(h1.state.modes.hard.puzzles[0].hints, 1);
  s = core.useHint(core.useHint(h1.state, "hard", 0, NOW).state, "hard", 0, NOW).state;
  assert.equal(s.modes.hard.puzzles[0].hints, 3);
  assert.equal(core.useHint(s, "hard", 0, NOW).error, "no_hints_left");
  const answer = core.answerFor(DAY, "hard", 0).name;
  const solved = core.applyGuess(s, "hard", 0, answer, NOW + 1000).state;
  assert.equal(solved.modes.hard.puzzles[0].points, 105);
});

test("giving up finishes the puzzle with zero points and unlocks the next", () => {
  const s = core.startPuzzle(fresh(), "easy", 0, NOW).state;
  const r = core.giveUp(s, "easy", 0, NOW + 5000);
  assert.equal(r.ok, true);
  const p = r.state.modes.easy.puzzles[0];
  assert.equal(p.status, "gaveUp");
  assert.equal(p.points, 0);
  assert.equal(p.finishedAt, NOW + 5000);
  assert.equal(r.state.modes.easy.puzzles[1].status, "ready");
  assert.equal(core.giveUp(fresh(), "easy", 0, NOW).error, "not_active");
});

test("after three finished puzzles a mode is done for the day", () => {
  let s = fresh();
  for (let i = 0; i < 3; i++) {
    s = core.startPuzzle(s, "easy", i, NOW).state;
    s = core.applyGuess(s, "easy", i, core.answerFor(DAY, "easy", i).name, NOW + 1000).state;
  }
  assert.equal(core.modeDone(s, "easy"), true);
  assert.equal(core.modeDone(s, "hard"), false);
  assert.equal(core.dayPoints(s).easy, 300);
  assert.equal(core.dayPoints(s).total, 300);
});

test("elapsedMs runs while active and freezes when finished", () => {
  const s = core.startPuzzle(fresh(), "easy", 0, NOW).state;
  assert.equal(core.elapsedMs(s.modes.easy.puzzles[0], NOW + 2500), 2500);
  const done = core.giveUp(s, "easy", 0, NOW + 4000).state;
  assert.equal(core.elapsedMs(done.modes.easy.puzzles[0], NOW + 99999), 4000);
  assert.equal(core.elapsedMs(fresh().modes.easy.puzzles[0], NOW), 0);
});

test("formatTime renders mm:ss and grows to h:mm:ss", () => {
  assert.equal(core.formatTime(0), "00:00");
  assert.equal(core.formatTime(61 * 1000), "01:01");
  assert.equal(core.formatTime(3600 * 1000 + 5000), "1:00:05");
});

test("ranksFor memoises the rank table per day, mode and index", () => {
  const a = core.ranksFor(DAY, "easy", 0);
  const b = core.ranksFor(DAY, "easy", 0);
  assert.equal(a, b);
  assert.equal(a.get(core.answerFor(DAY, "easy", 0).name), 1);
  assert.equal(a.size, core.poolFor("easy").length);
});

test("AVATARS list provides distinct presets with roles and icons", () => {
  assert.ok(Array.isArray(core.AVATARS) && core.AVATARS.length >= 8);
  const ids = new Set();
  for (const a of core.AVATARS) {
    assert.ok(a.id && a.name && a.icon && a.color && a.role);
    assert.ok(!ids.has(a.id), "Duplicate avatar ID: " + a.id);
    ids.add(a.id);
  }
});

test("ACHIEVEMENTS list covers tiers and progress evaluation", () => {
  assert.ok(Array.isArray(core.ACHIEVEMENTS) && core.ACHIEVEMENTS.length >= 10);
  const tiers = new Set(core.ACHIEVEMENTS.map((a) => a.tier));
  assert.ok(tiers.has("bronze"));
  assert.ok(tiers.has("silver"));
  assert.ok(tiers.has("gold"));
  assert.ok(tiers.has("diamond"));

  // Empty stats -> first ball locked
  const empty = core.evaluateAchievements({}, []);
  const firstBall = empty.find((a) => a.id === "first_ball");
  assert.ok(firstBall && !firstBall.unlocked);

  // Solve 1 puzzle -> first ball unlocked
  const solvedOne = core.evaluateAchievements({ solvedPuzzles: 1, totalPoints: 100 }, [
    { status: "solved", guesses: ["Virat Kohli"], started_at: 1000, finished_at: 15000, hints: 0 }
  ]);
  const solvedBall = solvedOne.find((a) => a.id === "first_ball");
  assert.ok(solvedBall && solvedBall.unlocked);

  // Golden arm: solved with 1 guess
  const goldenArm = solvedOne.find((a) => a.id === "golden_arm");
  assert.ok(goldenArm && goldenArm.unlocked);
});

test("streakDetails calculates current streak, best streak, and week calendar", () => {
  const today = "2026-10-28";
  const daysDesc = ["2026-10-28", "2026-10-27", "2026-10-26", "2026-10-24", "2026-10-23"];
  const res = core.streakDetails(daysDesc, today);
  assert.equal(res.current, 3);
  assert.equal(res.best, 3);
  assert.equal(res.week.length, 7);
  assert.equal(res.week[6].day, today);
  assert.equal(res.week[6].active, true);
  assert.equal(res.week[5].active, true);
  assert.equal(res.week[4].active, true);
  assert.equal(res.week[3].active, false); // 2026-10-25 was skipped
});

test("totalElapsedMs sums elapsed time across all 3 puzzles in a mode", () => {
  let s = fresh();
  s = core.startPuzzle(s, "easy", 0, NOW).state;
  // Puzzle 0 finishes in 30s
  s = core.giveUp(s, "easy", 0, NOW + 30000).state;
  // Puzzle 1 starts at NOW + 30000 and is active for 20s
  s = core.startPuzzle(s, "easy", 1, NOW + 30000).state;

  const total = core.totalElapsedMs(s, "easy", NOW + 50000);
  assert.equal(total, 50000);
  assert.equal(core.formatTime(total), "00:50");
});

// ---------- guest gate ----------

test("guests may play only the first puzzle of each mode", () => {
  assert.equal(core.GUEST_PUZZLES_PER_MODE, 1);
  assert.equal(core.guestCanPlay(0), true);
  assert.equal(core.guestCanPlay(1), false);
  assert.equal(core.guestCanPlay(2), false);
});

test("a guest who finished puzzle 1 gets sign_in_required on puzzle 2; a member does not", () => {
  const day = core.todayKey(DAY_START + 9 * 3600 * 1000);
  const now = DAY_START + 9 * 3600 * 1000;
  let state = core.newDayState(day);
  state = core.startPuzzle(state, "easy", 0, now, { guest: true }).state;
  const answer = core.answerFor(day, "easy", 0).name;
  state = core.applyGuess(state, "easy", 0, answer, now + 1000).state;
  assert.equal(state.modes.easy.puzzles[1].status, "ready", "engine still unlocks puzzle 2");

  const guest = core.startPuzzle(state, "easy", 1, now + 2000, { guest: true });
  assert.equal(guest.ok, false);
  assert.equal(guest.error, "sign_in_required");
  assert.deepEqual(guest.state, state, "state unchanged");

  const member = core.startPuzzle(state, "easy", 1, now + 2000);
  assert.equal(member.ok, true);
  assert.equal(member.state.modes.easy.puzzles[1].status, "active");
});

test("the guest allowance resets with the IST day, not the local day", () => {
  // 23:30 IST on day D is still day D; 00:30 IST is D+1 even though UTC has not rolled over.
  const lateD = DAY_START + 23.5 * 3600 * 1000;
  const earlyD1 = DAY_START + 24.5 * 3600 * 1000;
  assert.equal(core.todayKey(lateD), "2026-10-27");
  assert.equal(core.todayKey(earlyD1), "2026-10-28");
  const fresh = core.newDayState(core.todayKey(earlyD1));
  assert.equal(core.startPuzzle(fresh, "easy", 0, earlyD1, { guest: true }).ok, true);
});

test("sceneForHour: day is 06:00 to 17:59 IST, night otherwise", () => {
  assert.equal(core.sceneForHour(5), "night");
  assert.equal(core.sceneForHour(6), "day");
  assert.equal(core.sceneForHour(17), "day");
  assert.equal(core.sceneForHour(18), "night");
  assert.equal(core.sceneForHour(0), "night");
});

test("istHour converts a UTC instant to the IST hour of day", () => {
  assert.equal(core.istHour(Date.UTC(2026, 9, 27, 0, 30)), 6); // 00:30 UTC = 06:00 IST
  assert.equal(core.istHour(Date.UTC(2026, 9, 27, 12, 29)), 17); // 17:59 IST
  assert.equal(core.istHour(Date.UTC(2026, 9, 27, 20, 0)), 1); // 01:30 IST next day
});

test("AVATARS are the nine cricket presets with symbol icons", () => {
  assert.deepEqual(core.AVATARS.map((a) => a.id), ["batter", "bowler", "spinner", "keeper", "captain", "allrounder", "legend", "stumps", "pads"]);
  for (const a of core.AVATARS) {
    assert.match(a.icon, /^#i-[a-z-]+$/, a.id + " icon is a symbol reference");
    assert.ok(a.bg && a.color && a.name && a.role, a.id);
  }
});

test("normalizeAvatarId maps retired mascots and unknown ids to a cricket avatar", () => {
  assert.equal(core.normalizeAvatarId("lion"), "captain");
  assert.equal(core.normalizeAvatarId("eagle"), "allrounder");
  assert.equal(core.normalizeAvatarId("nope"), "batter");
  assert.equal(core.normalizeAvatarId(undefined), "batter");
  assert.equal(core.normalizeAvatarId("keeper"), "keeper");
});

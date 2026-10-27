"use strict";
// Server-side game service: loads a player's day from the database, runs the
// shared engine against it, saves the result, and shapes what the client sees.

const core = require("../public/game-core.js");

const LEADERBOARD_LIMIT = 50;

function streaks(daysDesc, today) {
  const set = new Set(daysDesc);
  let current = 0;
  let d = set.has(today) ? today : core.shiftDay(today, -1);
  while (set.has(d)) {
    current++;
    d = core.shiftDay(d, -1);
  }
  const asc = [...daysDesc].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of asc) {
    run = prev && core.shiftDay(prev, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }
  return { current, best };
}

class GameService {
  constructor(db, opts) {
    this.db = db;
    this.now = opts.now || Date.now;
    this.secret = opts.secret || "";
  }

  day() {
    return core.todayKey(this.now());
  }

  loadState(userId) {
    const day = this.day();
    const state = core.newDayState(day);
    for (const row of this.db.puzzlesFor(userId, day)) {
      const slot = state.modes[row.mode] && state.modes[row.mode].puzzles[row.idx];
      if (!slot) continue;
      slot.status = row.status;
      slot.guesses = JSON.parse(row.guesses);
      slot.hints = row.hints;
      slot.startedAt = row.started_at;
      slot.finishedAt = row.finished_at;
      slot.points = row.points;
    }
    return state;
  }

  // What a client is allowed to know: the state, the hints it has unlocked and the
  // answers of puzzles it has finished. Open puzzles never leak their answer.
  present(state) {
    const hints = {};
    const answers = {};
    for (const mode of core.MODES) {
      hints[mode] = state.modes[mode].puzzles.map((_, idx) => core.revealedHints(state, mode, idx, { secret: this.secret }));
      answers[mode] = state.modes[mode].puzzles.map((p, idx) => (core.isFinished(p) ? core.describe(core.answerFor(state.day, mode, idx, this.secret)) : null));
    }
    return { day: state.day, now: this.now(), state: Object.assign({}, state, { hints, answers }) };
  }

  act(userId, fn) {
    const state = this.loadState(userId);
    const result = fn(state, this.now());
    if (result.ok) this.db.savePuzzles(userId, result.state);
    return result;
  }

  start(userId, mode, idx) {
    return this.act(userId, (state, now) => core.startPuzzle(state, mode, idx, now));
  }

  guess(userId, mode, idx, name) {
    return this.act(userId, (state, now) => core.applyGuess(state, mode, idx, name, now, { secret: this.secret }));
  }

  hint(userId, mode, idx) {
    return this.act(userId, (state, now) => core.useHint(state, mode, idx, now, { secret: this.secret }));
  }

  giveUp(userId, mode, idx) {
    return this.act(userId, (state, now) => core.giveUp(state, mode, idx, now));
  }

  answerOf(state, mode, idx) {
    return core.describe(core.answerFor(state.day, mode, idx, this.secret));
  }

  stats(userId) {
    const day = this.day();
    const totals = this.db.totals(userId);
    const today = this.db.leaderboardToday(day, 1, userId).me;
    const all = this.db.leaderboardAllTime(1, userId).me;
    const s = streaks(this.db.solvedDays(userId), day);
    const title = core.rankTitle(totals.points);
    return {
      allTimePoints: totals.points,
      solved: totals.solved,
      daysPlayed: totals.days,
      currentStreak: s.current,
      bestStreak: s.best,
      todayPoints: today ? today.points : 0,
      todayRank: today ? today.rank : null,
      todayTotal: today ? today.total : 0,
      allTimeRank: all ? all.rank : null,
      allTimeTotal: all ? all.total : 0,
      title: title.title,
      nextTitle: title.next ? title.next.title : null,
      nextTitleAt: title.next ? title.next.min : null,
      progress: title.progress,
    };
  }

  leaderboardToday(userId, limit) {
    const day = this.day();
    const lb = this.db.leaderboardToday(day, Math.min(LEADERBOARD_LIMIT, limit || LEADERBOARD_LIMIT), userId);
    const row = (r) => ({ rank: r.rank, username: r.username, points: r.points, solved: r.solved, guesses: r.guesses, seconds: Math.round(r.ms / 1000), me: r.user_id === userId });
    return { day, total: lb.total, rows: lb.rows.map(row), me: lb.me ? row(lb.me) : null };
  }

  leaderboardAllTime(userId, limit) {
    const lb = this.db.leaderboardAllTime(Math.min(LEADERBOARD_LIMIT, limit || LEADERBOARD_LIMIT), userId);
    const row = (r) => ({ rank: r.rank, username: r.username, points: r.points, solved: r.solved, days: r.days, title: core.rankTitle(r.points).title, me: r.user_id === userId });
    return { total: lb.total, rows: lb.rows.map(row), me: lb.me ? row(lb.me) : null };
  }
}

module.exports = { GameService, streaks };

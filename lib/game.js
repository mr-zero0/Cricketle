"use strict";
// Server-side game service: loads a player's day from the database, runs the
// shared engine against it, saves the result, and shapes what the client sees.

const core = require("../public/game-core.js");

const LEADERBOARD_LIMIT = 50;

function streaks(daysDesc, today) {
  return core.streakDetails(daysDesc, today);
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

  async loadState(userId) {
    const day = this.day();
    const state = core.newDayState(day);
    const rows = await this.db.puzzlesFor(userId, day);
    for (const row of rows) {
      const slot = state.modes[row.mode] && state.modes[row.mode].puzzles[row.idx];
      if (!slot) continue;
      slot.status = row.status;
      slot.guesses = typeof row.guesses === "string" ? JSON.parse(row.guesses) : (row.guesses || []);
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

  async act(userId, fn) {
    const state = await this.loadState(userId);
    const result = fn(state, this.now());
    if (result.ok) await this.db.savePuzzles(userId, result.state);
    return result;
  }

  async start(userId, mode, idx) {
    return this.act(userId, (state, now) => core.startPuzzle(state, mode, idx, now));
  }

  async guess(userId, mode, idx, name) {
    return this.act(userId, (state, now) => core.applyGuess(state, mode, idx, name, now, { secret: this.secret }));
  }

  async hint(userId, mode, idx) {
    return this.act(userId, (state, now) => core.useHint(state, mode, idx, now, { secret: this.secret }));
  }

  async giveUp(userId, mode, idx) {
    return this.act(userId, (state, now) => core.giveUp(state, mode, idx, now));
  }

  answerOf(state, mode, idx) {
    return core.describe(core.answerFor(state.day, mode, idx, this.secret));
  }

  async stats(userId) {
    const day = this.day();
    const totals = await this.db.totals(userId);
    const todayLb = await this.db.leaderboardToday(day, 1, userId);
    const today = todayLb ? todayLb.me : null;
    const allLb = await this.db.leaderboardAllTime(1, userId);
    const all = allLb ? allLb.me : null;
    const s = core.streakDetails(await this.db.solvedDays(userId), day);
    const title = core.rankTitle(totals.points);
    const history = await this.db.puzzleHistory(userId);

    // Calculate guess distribution & win rate
    const guessDist = { 1: 0, 2: 0, "3-5": 0, "6-10": 0, "10+": 0 };
    let totalAttempts = 0;
    for (const p of history) {
      totalAttempts++;
      if (p.status === "solved") {
        let count = 0;
        try { count = (typeof p.guesses === "string" ? JSON.parse(p.guesses) : p.guesses).length; } catch (_) { count = 0; }
        if (count === 1) guessDist[1]++;
        else if (count === 2) guessDist[2]++;
        else if (count >= 3 && count <= 5) guessDist["3-5"]++;
        else if (count >= 6 && count <= 10) guessDist["6-10"]++;
        else if (count > 10) guessDist["10+"]++;
      }
    }

    const winRate = totalAttempts > 0 ? Math.round((totals.solved / totalAttempts) * 100) : 0;

    const baseStats = {
      allTimePoints: totals.points,
      solved: totals.solved,
      daysPlayed: totals.days,
      currentStreak: s.current,
      bestStreak: s.best,
    };

    const achievements = core.evaluateAchievements(baseStats, history);

    return {
      allTimePoints: totals.points,
      solved: totals.solved,
      daysPlayed: totals.days,
      currentStreak: s.current,
      bestStreak: s.best,
      streak: s,
      todayPoints: today ? today.points : 0,
      todayRank: today ? today.rank : null,
      todayTotal: today ? today.total : 0,
      allTimeRank: all ? all.rank : null,
      allTimeTotal: all ? all.total : 0,
      title: title.title,
      nextTitle: title.next ? title.next.title : null,
      nextTitleAt: title.next ? title.next.min : null,
      progress: title.progress,
      guessDist,
      winRate,
      achievements,
      totalAttempts,
    };
  }

  async leaderboardToday(userId, limit) {
    const day = this.day();
    const lb = await this.db.leaderboardToday(day, Math.min(LEADERBOARD_LIMIT, limit || LEADERBOARD_LIMIT), userId);
    const row = (r) => ({
      rank: r.rank,
      username: r.username,
      displayName: r.display_name || r.username,
      avatar: core.normalizeAvatarId(r.avatar),
      points: r.points,
      solved: r.solved,
      guesses: r.guesses,
      seconds: Math.round(r.ms / 1000),
      me: r.user_id === userId,
    });
    return { day, total: lb.total, rows: lb.rows.map(row), me: lb.me ? row(lb.me) : null };
  }

  async leaderboardAllTime(userId, limit) {
    const lb = await this.db.leaderboardAllTime(Math.min(LEADERBOARD_LIMIT, limit || LEADERBOARD_LIMIT), userId);
    const row = (r) => ({
      rank: r.rank,
      username: r.username,
      displayName: r.display_name || r.username,
      avatar: core.normalizeAvatarId(r.avatar),
      points: r.points,
      solved: r.solved,
      days: r.days,
      title: core.rankTitle(r.points).title,
      me: r.user_id === userId,
    });
    return { total: lb.total, rows: lb.rows.map(row), me: lb.me ? row(lb.me) : null };
  }
}

module.exports = { GameService, streaks };

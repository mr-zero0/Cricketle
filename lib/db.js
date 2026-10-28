"use strict";
// SQLite persistence for Cricketle (node:sqlite, no npm dependencies).

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT,
  display_name TEXT,
  email TEXT,
  google_id TEXT UNIQUE,
  phone TEXT UNIQUE,
  avatar TEXT,
  bio TEXT,
  fav_team TEXT,
  fav_player TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS puzzles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  mode TEXT NOT NULL,
  idx INTEGER NOT NULL,
  status TEXT NOT NULL,
  guesses TEXT NOT NULL DEFAULT '[]',
  hints INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, mode, idx)
);
`;

const TODAY_SQL = `
WITH agg AS (
  SELECT p.user_id, u.username, u.display_name, u.avatar,
         SUM(p.points) AS points,
         SUM(CASE WHEN p.status = 'solved' THEN 1 ELSE 0 END) AS solved,
         SUM(json_array_length(p.guesses)) AS guesses,
         SUM(COALESCE(p.finished_at - p.started_at, 0)) AS ms
  FROM puzzles p JOIN users u ON u.id = p.user_id
  WHERE p.day = ? AND p.status IN ('solved', 'gaveUp')
  GROUP BY p.user_id
),
ranked AS (
  SELECT *, RANK() OVER (ORDER BY points DESC, ms ASC, username ASC) AS rank,
         COUNT(*) OVER () AS total
  FROM agg
)`;

const ALLTIME_SQL = `
WITH agg AS (
  SELECT p.user_id, u.username, u.display_name, u.avatar,
         SUM(p.points) AS points,
         SUM(CASE WHEN p.status = 'solved' THEN 1 ELSE 0 END) AS solved,
         COUNT(DISTINCT p.day) AS days
  FROM puzzles p JOIN users u ON u.id = p.user_id
  WHERE p.status IN ('solved', 'gaveUp')
  GROUP BY p.user_id
),
ranked AS (
  SELECT *, RANK() OVER (ORDER BY points DESC, solved DESC, username ASC) AS rank,
         COUNT(*) OVER () AS total
  FROM agg
)`;

class Db {
  constructor(file) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA foreign_keys = ON");
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);

    // Dynamic schema migrations for existing databases
    try { this.db.exec("ALTER TABLE users ADD COLUMN display_name TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN email TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN google_id TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN avatar TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN bio TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN fav_team TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN fav_player TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN phone TEXT"); } catch (_) {}
    try { this.db.exec("CREATE TABLE IF NOT EXISTS otp_codes (phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)"); } catch (_) {}

    // Indexes (created after migrations in case columns were just added)
    try { this.db.exec("CREATE INDEX IF NOT EXISTS users_google ON users(google_id)"); } catch (_) {}
    try { this.db.exec("CREATE INDEX IF NOT EXISTS users_phone ON users(phone)"); } catch (_) {}
    try { this.db.exec("CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)"); } catch (_) {}
    try { this.db.exec("CREATE INDEX IF NOT EXISTS puzzles_day ON puzzles(day, status)"); } catch (_) {}

    const q = (sql) => this.db.prepare(sql);
    this.q = {
      getSetting: q("SELECT value FROM settings WHERE key = ?"),
      setSetting: q("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"),
      createUser: q("INSERT INTO users (username, pass_hash, display_name, email, google_id, avatar, bio, fav_team, fav_player, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      userByName: q("SELECT id, username, pass_hash, display_name, email, google_id, avatar, bio, fav_team, fav_player, phone, created_at FROM users WHERE username = ?"),
      userById: q("SELECT id, username, pass_hash, display_name, email, google_id, avatar, bio, fav_team, fav_player, phone, created_at FROM users WHERE id = ?"),
      userByGoogleId: q("SELECT id, username, pass_hash, display_name, email, google_id, avatar, bio, fav_team, fav_player, phone, created_at FROM users WHERE google_id = ?"),
      userByEmail: q("SELECT id, username, pass_hash, display_name, email, google_id, avatar, bio, fav_team, fav_player, phone, created_at FROM users WHERE email = ? COLLATE NOCASE"),
      userByPhone: q("SELECT id, username, pass_hash, display_name, email, google_id, avatar, bio, fav_team, fav_player, phone, created_at FROM users WHERE phone = ?"),
      updateProfile: q("UPDATE users SET display_name = ?, bio = ?, avatar = ?, fav_team = ?, fav_player = ? WHERE id = ?"),
      linkGoogle: q("UPDATE users SET google_id = ?, email = COALESCE(email, ?), avatar = COALESCE(avatar, ?) WHERE id = ?"),
      linkPhone: q("UPDATE users SET phone = ? WHERE id = ?"),
      createSession: q("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
      sessionUser: q("SELECT u.id, u.username, u.display_name, u.email, u.google_id, u.avatar, u.bio, u.fav_team, u.fav_player, u.phone, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"),
      deleteSession: q("DELETE FROM sessions WHERE token_hash = ?"),
      purgeSessions: q("DELETE FROM sessions WHERE expires_at <= ?"),
      setOtp: q("INSERT OR REPLACE INTO otp_codes (phone, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)"),
      getOtp: q("SELECT phone, code_hash, expires_at, attempts, created_at FROM otp_codes WHERE phone = ?"),
      deleteOtp: q("DELETE FROM otp_codes WHERE phone = ?"),
      incrementOtpAttempts: q("UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?"),
      cleanExpiredOtps: q("DELETE FROM otp_codes WHERE expires_at < ?"),
      puzzlesFor: q("SELECT mode, idx, status, guesses, hints, started_at, finished_at, points FROM puzzles WHERE user_id = ? AND day = ?"),
      puzzleHistory: q("SELECT day, mode, idx, status, guesses, hints, started_at, finished_at, points FROM puzzles WHERE user_id = ? AND status IN ('solved', 'gaveUp') ORDER BY day DESC, idx ASC"),
      upsertPuzzle: q(`INSERT INTO puzzles (user_id, day, mode, idx, status, guesses, hints, started_at, finished_at, points)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, day, mode, idx) DO UPDATE SET
          status = excluded.status, guesses = excluded.guesses, hints = excluded.hints,
          started_at = excluded.started_at, finished_at = excluded.finished_at, points = excluded.points`),
      todayRows: q(TODAY_SQL + " SELECT * FROM ranked ORDER BY rank, username LIMIT ?"),
      todayMe: q(TODAY_SQL + " SELECT * FROM ranked WHERE user_id = ?"),
      alltimeRows: q(ALLTIME_SQL + " SELECT * FROM ranked ORDER BY rank, username LIMIT ?"),
      alltimeMe: q(ALLTIME_SQL + " SELECT * FROM ranked WHERE user_id = ?"),
      solvedDays: q("SELECT DISTINCT day FROM puzzles WHERE user_id = ? AND status = 'solved' ORDER BY day DESC"),
      totals: q(`SELECT COALESCE(SUM(points), 0) AS points,
                        COALESCE(SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END), 0) AS solved,
                        COUNT(DISTINCT day) AS days
                 FROM puzzles WHERE user_id = ? AND status IN ('solved', 'gaveUp')`),
    };
  }

  getOrCreateSecret() {
    this.q.setSetting.run("secret", crypto.randomBytes(32).toString("hex"));
    return this.q.getSetting.get("secret").value;
  }

  createUser(username, passHash, now, profile = {}) {
    try {
      const displayName = profile.displayName || username;
      const email = profile.email || null;
      const googleId = profile.googleId || null;
      const avatar = profile.avatar || "batter";
      const bio = profile.bio || "";
      const favTeam = profile.favTeam || "";
      const favPlayer = profile.favPlayer || "";
      const phone = profile.phone || null;

      const info = this.q.createUser.run(username, passHash, displayName, email, googleId, avatar, bio, favTeam, favPlayer, phone, now);
      return {
        id: Number(info.lastInsertRowid),
        username,
        displayName,
        email,
        googleId,
        avatar,
        bio,
        favTeam,
        favPlayer,
        phone,
        createdAt: now,
      };
    } catch (err) {
      if (/UNIQUE/.test(String(err.message))) {
        const e = new Error("username taken");
        e.code = "username_taken";
        throw e;
      }
      throw err;
    }
  }

  userByName(username) {
    return this.q.userByName.get(username) || null;
  }

  userById(id) {
    return this.q.userById.get(id) || null;
  }

  userByGoogleId(googleId) {
    return this.q.userByGoogleId.get(googleId) || null;
  }

  userByEmail(email) {
    return this.q.userByEmail.get(email) || null;
  }

  userByPhone(phone) {
    return this.q.userByPhone.get(phone) || null;
  }

  setOtp(phone, codeHash, expiresAt, now) {
    this.q.setOtp.run(phone, codeHash, expiresAt, now);
  }

  getOtp(phone) {
    return this.q.getOtp.get(phone) || null;
  }

  deleteOtp(phone) {
    this.q.deleteOtp.run(phone);
  }

  incrementOtpAttempts(phone) {
    this.q.incrementOtpAttempts.run(phone);
  }

  linkPhone(userId, phone) {
    this.q.linkPhone.run(phone, userId);
    return this.userById(userId);
  }

  updateProfile(userId, profile) {
    const user = this.userById(userId);
    if (!user) return null;
    const displayName = profile.displayName !== undefined ? profile.displayName : (user.display_name || user.username);
    const bio = profile.bio !== undefined ? profile.bio : (user.bio || "");
    const avatar = profile.avatar !== undefined ? profile.avatar : (user.avatar || "batter");
    const favTeam = profile.favTeam !== undefined ? profile.favTeam : (user.fav_team || "");
    const favPlayer = profile.favPlayer !== undefined ? profile.favPlayer : (user.fav_player || "");

    this.q.updateProfile.run(displayName, bio, avatar, favTeam, favPlayer, userId);
    return this.userById(userId);
  }

  linkGoogle(userId, googleId, email, avatar) {
    this.q.linkGoogle.run(googleId, email || null, avatar || null, userId);
    return this.userById(userId);
  }

  createSession(tokenHash, userId, now, ttlMs) {
    this.q.createSession.run(tokenHash, userId, now, now + ttlMs);
    if (Math.random() < 0.05) this.q.purgeSessions.run(now);
  }

  sessionUser(tokenHash, now) {
    return this.q.sessionUser.get(tokenHash, now) || null;
  }

  deleteSession(tokenHash) {
    this.q.deleteSession.run(tokenHash);
  }

  puzzlesFor(userId, day) {
    return this.q.puzzlesFor.all(userId, day);
  }

  puzzleHistory(userId) {
    return this.q.puzzleHistory.all(userId);
  }

  savePuzzles(userId, state) {
    this.db.exec("BEGIN");
    try {
      for (const mode of Object.keys(state.modes)) {
        state.modes[mode].puzzles.forEach((p, idx) => {
          this.q.upsertPuzzle.run(userId, state.day, mode, idx, p.status, JSON.stringify(p.guesses), p.hints, p.startedAt, p.finishedAt, p.points);
        });
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  leaderboardToday(day, limit, userId) {
    const rows = this.q.todayRows.all(day, limit);
    const me = userId ? this.q.todayMe.get(day, userId) || null : null;
    return { rows, me, total: rows.length ? rows[0].total : (me ? me.total : 0) };
  }

  leaderboardAllTime(limit, userId) {
    const rows = this.q.alltimeRows.all(limit);
    const me = userId ? this.q.alltimeMe.get(userId) || null : null;
    return { rows, me, total: rows.length ? rows[0].total : (me ? me.total : 0) };
  }

  solvedDays(userId) {
    return this.q.solvedDays.all(userId).map((r) => r.day);
  }

  totals(userId) {
    return this.q.totals.get(userId);
  }

  close() {
    this.db.close();
  }
}

module.exports = { Db };

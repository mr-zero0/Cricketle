"use strict";
// SQLite persistence for Cricketle (node:sqlite, no npm dependencies).

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { toE164, legacyToE164 } = require("./phone.js");

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
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  day TEXT NOT NULL,
  variant TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  duration_ms INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  ip TEXT,
  created_at INTEGER NOT NULL
);
`;

const TODAY_SQL = `
WITH agg AS (
  SELECT u.id AS user_id, u.username, u.display_name, u.avatar,
         COALESCE(SUM(p.points), 0) AS points,
         COALESCE(SUM(CASE WHEN p.status = 'solved' THEN 1 ELSE 0 END), 0) AS solved,
         COALESCE(SUM(json_array_length(p.guesses)), 0) AS guesses,
         COALESCE(SUM(COALESCE(p.finished_at - p.started_at, 0)), 0) AS ms
  FROM users u
  LEFT JOIN puzzles p ON p.user_id = u.id AND p.day = ?
  GROUP BY u.id
),
ranked AS (
  SELECT *, RANK() OVER (ORDER BY points DESC, solved DESC, ms ASC, username ASC) AS rank,
         COUNT(*) OVER () AS total
  FROM agg
)`;

const ALLTIME_SQL = `
WITH agg AS (
  SELECT u.id AS user_id, u.username, u.display_name, u.avatar,
         COALESCE(SUM(p.points), 0) AS points,
         COALESCE(SUM(CASE WHEN p.status = 'solved' THEN 1 ELSE 0 END), 0) AS solved,
         COUNT(DISTINCT p.day) AS days
  FROM users u
  LEFT JOIN puzzles p ON p.user_id = u.id
  GROUP BY u.id
),
ranked AS (
  SELECT *, RANK() OVER (ORDER BY points DESC, solved DESC, days DESC, username ASC) AS rank,
         COUNT(*) OVER () AS total
  FROM agg
)`;

class Db {
  constructor(file, logger = null) {
    this.logger = logger;
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA foreign_keys = ON");
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
    if (this.logger) {
      this.logger.db("sqlite_ready", "SQLite database connected and tables verified", { file });
    }

    // Dynamic schema migrations for existing databases
    try { this.db.exec("ALTER TABLE users ADD COLUMN display_name TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN email TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN google_id TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN avatar TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN bio TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN fav_team TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN fav_player TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN phone TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"); } catch (_) {}
    try { this.db.exec("DROP TABLE IF EXISTS otp_codes"); } catch (_) {}

    // Indexes (created after migrations in case columns were just added)
    try { this.db.exec("CREATE INDEX IF NOT EXISTS users_google ON users(google_id)"); } catch (_) {}
    try { this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_phone ON users(phone)"); } catch (_) {}
    try { this.db.exec("CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)"); } catch (_) {}
    try { this.db.exec("CREATE INDEX IF NOT EXISTS puzzles_day ON puzzles(day, status)"); } catch (_) {}

    const q = (sql) => this.db.prepare(sql);
    this.q = {
      getSetting: q("SELECT value FROM settings WHERE key = ?"),
      setSetting: q("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"),
      createUser: q("INSERT INTO users (username, pass_hash, display_name, email, google_id, avatar, bio, fav_team, fav_player, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      userByName: q("SELECT id, username, pass_hash, display_name, email, google_id, avatar, bio, fav_team, fav_player, phone, is_admin, created_at FROM users WHERE username = ? COLLATE NOCASE"),
      userById: q("SELECT id, username, pass_hash, display_name, email, google_id, avatar, bio, fav_team, fav_player, phone, is_admin, created_at FROM users WHERE id = ?"),
      userByPhone: q("SELECT id, username, pass_hash, display_name, email, google_id, avatar, bio, fav_team, fav_player, phone, is_admin, created_at FROM users WHERE phone = ?"),
      listUsers: q("SELECT id, username, display_name, email, phone, avatar, bio, fav_team, fav_player, is_admin, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?"),
      searchUsers: q("SELECT id, username, display_name, email, phone, avatar, bio, fav_team, fav_player, is_admin, created_at FROM users WHERE username LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?"),
      countUsers: q("SELECT COUNT(*) AS total FROM users"),
      deleteUser: q("DELETE FROM users WHERE id = ?"),
      updateProfile: q("UPDATE users SET display_name = ?, bio = ?, avatar = ?, fav_team = ?, fav_player = ? WHERE id = ?"),
      updatePassHash: q("UPDATE users SET pass_hash = ? WHERE id = ?"),
      createSession: q("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
      sessionUser: q("SELECT u.id, u.username, u.display_name, u.email, u.google_id, u.avatar, u.bio, u.fav_team, u.fav_player, u.phone, u.is_admin, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"),
      deleteSession: q("DELETE FROM sessions WHERE token_hash = ?"),
      deleteUserSessions: q("DELETE FROM sessions WHERE user_id = ?"),
      purgeSessions: q("DELETE FROM sessions WHERE expires_at <= ?"),
      puzzlesFor: q("SELECT mode, idx, status, guesses, hints, started_at, finished_at, points FROM puzzles WHERE user_id = ? AND day = ?"),
      puzzleHistory: q("SELECT day, mode, idx, status, guesses, hints, started_at, finished_at, points FROM puzzles WHERE user_id = ? AND (status IN ('solved', 'gaveUp', 'active') OR started_at IS NOT NULL OR json_array_length(guesses) > 0 OR points > 0) ORDER BY day DESC, idx ASC"),
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
      insertActivity: q("INSERT INTO activity_log (user_id, day, variant, action, details, duration_ms, score, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      totals: q(`SELECT COALESCE(SUM(points), 0) AS points,
                        COALESCE(SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END), 0) AS solved,
                        COUNT(DISTINCT day) AS days
                 FROM puzzles WHERE user_id = ? AND status IN ('solved', 'gaveUp')`),
    };

    this.lastPhoneMigration = this.migratePhones();
  }

  // One-time: rewrite phones stored before the strict E.164 rule. Rows that
  // cannot be normalised are left untouched and reported once.
  migratePhones() {
    const rows = this.db.prepare("SELECT id, phone FROM users WHERE phone IS NOT NULL AND phone != ''").all();
    const update = this.db.prepare("UPDATE users SET phone = ? WHERE id = ?");
    let changed = 0;
    const skipped = [];
    for (const row of rows) {
      if (toE164(row.phone) === row.phone) continue;
      const fixed = legacyToE164(row.phone);
      if (!fixed) { skipped.push(row.phone); continue; }
      try { update.run(fixed, row.id); changed++; } catch (_) { skipped.push(row.phone); }
    }
    if (this.logger && (changed || skipped.length)) {
      this.logger.db("phone_migration", `Normalised ${changed} phone number(s); ${skipped.length} left as-is`, { changed, skipped: skipped.length });
    }
    return { changed, skipped };
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
      const msg = String(err.message || "");
      if (/phone/i.test(msg)) {
        const e = new Error("phone taken");
        e.code = "phone_taken";
        throw e;
      }
      if (/username/i.test(msg) || /UNIQUE/i.test(msg)) {
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

  userByPhone(phone) {
    const e164 = toE164(phone);
    if (!e164) return null;
    return this.q.userByPhone.get(e164) || null;
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

  logActivity(userId, day, variant, action, details, durationMs, score, ip) {
    try {
      this.q.insertActivity.run(
        userId || null,
        day,
        variant,
        action,
        typeof details === "string" ? details : JSON.stringify(details || {}),
        Number(durationMs) || 0,
        Number(score) || 0,
        ip || null,
        Date.now()
      );
    } catch (_) {}
  }

  saveVariantResult(userId, day, variant, score, status, durationMs, guesses) {
    const now = Date.now();
    const duration = Math.max(0, Number(durationMs) || 0);
    const startedAt = now - duration;
    const finishedAt = now;
    const pts = Math.max(0, Number(score) || 0);
    const guessStr = typeof guesses === "string" ? guesses : JSON.stringify(guesses || []);
    return this.q.upsertPuzzle.run(
      userId,
      day,
      variant,
      0,
      status || "solved",
      guessStr,
      0,
      startedAt,
      finishedAt,
      pts
    );
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

  listUsers(limit = 100, offset = 0, search = "") {
    if (search && search.trim()) {
      const pattern = "%" + search.trim().replace(/[\\%_]/g, (m) => "\\" + m) + "%";
      const rows = this.q.searchUsers.all(pattern, pattern, pattern, limit);
      return { rows, total: rows.length };
    }
    const rows = this.q.listUsers.all(limit, offset);
    const total = this.q.countUsers.get().total;
    return { rows, total };
  }

  adminResetPin(userId, newPinHash) {
    this.q.updatePassHash.run(newPinHash, userId);
    this.q.deleteUserSessions.run(userId); // a reset signs the player out everywhere
    return this.userById(userId);
  }

  adminDeleteUser(userId) {
    this.q.deleteUser.run(userId);
    return true;
  }

  close() {
    this.db.close();
  }
}

module.exports = { Db };

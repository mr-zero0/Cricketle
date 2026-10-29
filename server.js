"use strict";
// Cricketle server: static client + JSON API. Node 22.5+ only, no npm dependencies.
//
//   npm start              -> http://localhost:3000
//   PORT=8080 npm start
//   CRICKETLE_DB=path.db   (default ./data/cricketle.db)
//   CRICKETLE_SECRET=...   (default: generated once and stored in the database)
//   ADMIN_KEY=...          (optional; the /admin portal is disabled when unset)

const http = require("node:http");
const fs = require("node:fs");
const zlib = require("node:zlib");
const path = require("node:path");
const crypto = require("node:crypto");

// Automatically load .env configuration if present
function loadEnv() {
  // Tests set CRICKETLE_SKIP_DOTENV so a developer's .env (often pointing at a
  // real Supabase project) can never leak into a test server.
  if (process.env.CRICKETLE_SKIP_DOTENV) return;
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          const k = trimmed.slice(0, eq).trim();
          const v = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
          if (process.env[k] === undefined) process.env[k] = v;
        }
      }
    } catch (_) {}
  }
}
loadEnv();

const core = require("./public/game-core.js");
const { Db } = require("./lib/db.js");
const { SupabaseDb } = require("./lib/supabase-db.js");
const auth = require("./lib/auth.js");
const { GameService } = require("./lib/game.js");
const { createLogger } = require("./lib/logger.js");
const { toE164 } = require("./lib/phone.js");

const COOKIE = "cricketle_sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BODY_LIMIT = 16 * 1024;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

const MESSAGES = {
  locked: "That puzzle is still locked.",
  not_ready: "That puzzle has already been started.",
  not_active: "That puzzle is not in play.",
  unknown_player: "Pick a player from the list.",
  already_guessed: "You already guessed that player.",
  no_hints_left: "No hints left for this puzzle.",
  sign_in_required: "Sign up or sign in to play the next puzzle.",
  bad_mode: "Unknown mode.",
  bad_index: "Unknown puzzle.",
  bad_state: "Bad request.",
  pin_locked: "Too many wrong PINs. Try again in 15 minutes.",
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function createApp(opts = {}) {
  const now = opts.now || Date.now;
  const logger = opts.logger || createLogger({
    enabled: opts.log !== false,
    level: opts.logLevel || process.env.LOG_LEVEL || "info",
    format: opts.logFormat || process.env.LOG_FORMAT || "text",
    color: opts.color,
  });

  // Backward-compatible log dispatcher routing through structured logger
  const log = opts.log === false ? () => {} : (tag, ...args) => {
    const cleanTag = String(tag || "SYSTEM").toUpperCase();
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    logger.info(cleanTag, msg);
  };

  const supabaseUrl = opts.supabaseUrl || process.env.SUPABASE_URL;
  const supabaseKey = opts.supabaseKey || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  let db;
  if (opts.db) {
    db = opts.db;
  } else if (opts.dbPath === ":memory:" || (!supabaseUrl && !opts.supabaseUrl)) {
    const dbPath = opts.dbPath || process.env.CRICKETLE_DB || path.join(__dirname, "data", "cricketle.db");
    db = new Db(dbPath, logger);
  } else if (supabaseUrl && supabaseKey) {
    db = new SupabaseDb(supabaseUrl, supabaseKey, logger);
    logger.db("supabase_connected", "Connected to Supabase PostgreSQL at " + supabaseUrl, { endpoint: supabaseUrl });
  } else {
    const dbPath = opts.dbPath || process.env.CRICKETLE_DB || path.join(__dirname, "data", "cricketle.db");
    db = new Db(dbPath, logger);
  }

  // CRICKETLE_SECRET=public uses the public seed (same answers as guests); only for local testing.
  const envSecret = process.env.CRICKETLE_SECRET;
  let secretReady = Promise.resolve();
  let secret = "";
  if (opts.secret !== undefined) {
    secret = opts.secret;
  } else if (envSecret === "public") {
    secret = "";
  } else if (envSecret) {
    secret = envSecret;
  } else if (typeof db.getOrCreateSecret === "function") {
    // Supabase resolves the secret asynchronously. `ready` rejects if it cannot
    // be loaded so the process refuses to serve accounts on the public seed.
    try {
      const res = db.getOrCreateSecret();
      if (typeof res === "string") secret = res;
      else if (res && typeof res.then === "function") {
        secretReady = res.then((s) => {
          if (!s) throw new Error("empty answer secret");
          if (game) game.secret = s;
        });
        secretReady.catch(() => {}); // surfaced through app.ready, not as an unhandled rejection
      }
    } catch (err) {
      secretReady = Promise.reject(err);
      secretReady.catch(() => {});
    }
  }

  const game = new GameService(db, { now, secret });
  const publicDir = opts.publicDir || PUBLIC_DIR;
  const limiter = opts.rateLimit === false ? null : new Map();
  // Keys tracked per in-memory counter map before expired entries are pruned.
  const MAX_TRACKED = opts.maxTrackedKeys || 5000;

  // Proxy headers (x-forwarded-for / -proto) are attacker-controlled unless a
  // trusted proxy in front of us sets them. Render does: TRUST_PROXY=1 there.
  const trustProxy = opts.trustProxy !== undefined
    ? Boolean(opts.trustProxy)
    : /^(1|true|yes)$/i.test(String(process.env.TRUST_PROXY || ""));

  function clientIp(req) {
    if (trustProxy) {
      const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1]; // the hop our proxy appended
    }
    return req.socket.remoteAddress || "?";
  }

  // Drops expired entries from a {key -> {hits, windowMs}} map. Never wipes
  // live state: a flood of fresh keys must not reset anyone else's counter.
  function prune(map, t) {
    for (const [k, v] of map) {
      if (!v.hits.length || t - v.hits[v.hits.length - 1] >= v.windowMs) map.delete(k);
    }
  }

  // Wrong-PIN protection per identifier (not per IP, so it also works behind a
  // shared NAT). Always on; `rateLimit: false` only disables the IP limiter.
  const PIN_MAX_FAILURES = 10;
  const PIN_WINDOW_MS = 15 * 60 * 1000;
  const pinFailures = new Map();
  // Keyed by account id when the identifier resolves (username and phone share
  // one budget), by the lower-cased identifier otherwise.
  function pinKey(row, identifier) { return row ? "u:" + row.id : "i:" + String(identifier).toLowerCase(); }
  function pinLocked(key) {
    const t = now();
    const entry = pinFailures.get(key);
    if (!entry) return false;
    entry.hits = entry.hits.filter((x) => t - x < PIN_WINDOW_MS);
    return entry.hits.length >= PIN_MAX_FAILURES;
  }
  function recordPinFailure(key) {
    const t = now();
    const entry = pinFailures.get(key) || { hits: [], windowMs: PIN_WINDOW_MS };
    entry.hits.push(t);
    pinFailures.set(key, entry);
    if (pinFailures.size > MAX_TRACKED) prune(pinFailures, t);
  }
  function clearPinFailures(key) { pinFailures.delete(key); }
  // Verified against when no account matches, so a miss costs the same time as a hit.
  const DUMMY_HASH = auth.hashPassword("000000");

  // Accounts whose PIN is not 6 digits are nudged towards an admin reset. The
  // server only learns the length at sign-in, so the flag lives in memory per
  // session token and is never stored.
  const pinNeedsUpdateBySession = new Map();

  // Admin access is opt-in: with no ADMIN_KEY configured there is no admin at all.
  const adminKey = opts.adminKey !== undefined ? String(opts.adminKey) : String(process.env.ADMIN_KEY || "");
  const adminPhone = opts.adminPhone ? normalizePhone(opts.adminPhone) : (process.env.ADMIN_PHONE ? normalizePhone(process.env.ADMIN_PHONE) : "");

  // ---------- helpers ----------

  // Requests must carry the country code: strict E.164 or nothing.
  function normalizePhone(rawPhone) { return toE164(rawPhone); }

  function isAdmin(user, req) {
    if (user && (user.is_admin || user.isAdmin)) return true;
    if (adminPhone && user && user.phone === adminPhone) return true;
    if (!adminKey) return false;
    const h = req && req.headers && req.headers["x-admin-key"];
    if (h && safeEqual(h, adminKey)) return true;
    const c = req && cookies(req)["cricketle_admin"];
    if (c && adminSessionValid(c)) return true;
    return false;
  }

  // Admin console sessions: random tokens, stored hashed in memory with an
  // expiry, revoked on logout. A server restart signs admins out, which is fine.
  const ADMIN_SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
  const adminSessions = new Map(); // tokenHash -> expiresAt
  function adminSessionValid(token) {
    const exp = adminSessions.get(auth.hashToken(token));
    if (!exp) return false;
    if (exp <= now()) { adminSessions.delete(auth.hashToken(token)); return false; }
    return true;
  }
  function adminCookie(req, token, maxAgeSec) {
    const parts = ["cricketle_admin=" + token, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=" + maxAgeSec];
    if (isSecure(req)) parts.push("Secure");
    return parts.join("; ");
  }
  function safeEqual(a, b) {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  function requireAdmin(req, user) {
    if (!isAdmin(user, req)) {
      throw new HttpError(403, "forbidden", "Admin access required.");
    }
    return true;
  }

  function send(res, status, body, headers) {
    const h = Object.assign({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    }, headers || {});
    res.writeHead(status, h);
    res.end(status === 204 ? undefined : JSON.stringify(body));
  }

  function fail(res, status, code, message) {
    res._failError = { status, code, message: message || MESSAGES[code] || code };
    const requestId = res.req && res.req.id;
    send(res, status, { error: code, message: message || MESSAGES[code] || code, requestId });
  }

  function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  function isSecure(req) {
    if (req.socket.encrypted) return true;
    return trustProxy && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
  }

  function sessionCookie(req, token, maxAge) {
    const parts = [COOKIE + "=" + token, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=" + maxAge];
    if (isSecure(req)) parts.push("Secure");
    return parts.join("; ");
  }

  async function currentUser(req) {
    const token = cookies(req)[COOKIE];
    if (!token) {
      if (isAdmin(null, req)) {
        const adminUser = { id: 0, username: "admin", display_name: "Administrator", isAdmin: true, is_admin: 1 };
        req._user = adminUser;
        return adminUser;
      }
      return null;
    }
    const user = await db.sessionUser(auth.hashToken(token), now());
    if (user) {
      user.isAdmin = isAdmin(user, req);
      req._user = user;
    } else if (isAdmin(null, req)) {
      const adminUser = { id: 0, username: "admin", display_name: "Administrator", isAdmin: true, is_admin: 1 };
      req._user = adminUser;
      return adminUser;
    }
    return user;
  }

  async function requireUser(req) {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "unauthorized", "Sign in to play for the leaderboard.");
    if (!user.id) throw new HttpError(403, "admin_not_player", "The admin key is not a player account. Sign in as a player.");
    return user;
  }

  // Query limits: a positive integer up to `max`, else the default.
  function clampLimit(raw, max, dflt) {
    const n = Math.trunc(Number(raw));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : dflt;
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const type = String(req.headers["content-type"] || "");
      if (!/^application\/json\b/i.test(type)) return reject(new HttpError(415, "json_required", "Send JSON."));
      const origin = req.headers.origin;
      if (origin) {
        const host = req.headers.host;
        const allowed = ["http://" + host, "https://" + host];
        if (!allowed.includes(origin)) return reject(new HttpError(403, "bad_origin", "Cross-origin requests are not allowed."));
      }
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > BODY_LIMIT) { reject(new HttpError(413, "too_large", "Request too large.")); req.destroy(); }
        else chunks.push(c);
      });
      req.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          const value = text ? JSON.parse(text) : {};
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
          resolve(value);
        } catch (_) {
          reject(new HttpError(400, "bad_json", "Malformed JSON."));
        }
      });
      req.on("error", () => reject(new HttpError(400, "bad_request", "Bad request.")));
    });
  }

  // Sliding-window limiter per IP and bucket.
  // With { defer: true } the hit is not recorded; the returned function spends
  // it (used by sign-up so rejected attempts do not burn the budget).
  function rateLimit(req, bucket, max, windowMs, options) {
    if (!limiter) return () => {};
    const ip = clientIp(req);
    const key = bucket + "|" + ip;
    const t = now();
    const entry = limiter.get(key) || { hits: [], windowMs };
    const hits = entry.hits.filter((x) => t - x < windowMs);
    if (hits.length >= max) {
      logger.warn("SECURITY", `Rate limit exceeded for bucket "${bucket}" by IP ${ip} (${hits.length}/${max} in ${windowMs / 1000}s)`, {
        bucket,
        ip,
        limit: max,
      });
      throw new HttpError(429, "rate_limited", "Too many requests. Try again in a few minutes.");
    }
    const spend = () => {
      hits.push(now());
      limiter.set(key, { hits, windowMs });
      if (limiter.size > MAX_TRACKED) prune(limiter, now());
    };
    if (options && options.defer) return spend;
    spend();
    return () => {};
  }

  function engineResult(res, req, r, extra) {
    if (!r.ok) return fail(res, 400, r.error);
    const out = Object.assign(game.present(r.state), extra || {});
    send(res, 200, out);
  }

  function puzzleArgs(body) {
    const mode = typeof body.mode === "string" ? body.mode : "";
    const idx = Number.isInteger(body.idx) ? body.idx : Number(body.idx);
    return { mode, idx };
  }

  // ---------- API ----------

  async function api(req, res, pathname, query) {
    const key = req.method + " " + pathname;

    if (key === "GET /api/health") {
      return send(res, 200, { ok: true, day: core.todayKey(now()), now: now(), puzzlesPerDay: core.PUZZLES_PER_DAY });
    }

    if (key === "POST /api/auth/login") {
      rateLimit(req, "auth", 20, 15 * 60 * 1000);
      const body = await readJson(req);
      const rawId = typeof body.identifier === "string" ? body.identifier : (typeof body.username === "string" ? body.username : "");
      const identifier = rawId.trim();
      const pin = String(body.pin !== undefined ? body.pin : "").trim();
      if (!identifier || !pin) {
        logger.authWarn("login_bad_input", "Sign in rejected: missing identifier or PIN");
        return fail(res, 400, "missing_fields", "Please enter both username and PIN.");
      }
      // Exact username, else exact E.164 phone. Nothing is guessed.
      let row = auth.validUsername(identifier) ? await db.userByName(identifier) : null;
      if (!row) {
        const e164 = normalizePhone(identifier);
        if (e164) row = await db.userByPhone(e164);
      }
      const lockKey = pinKey(row, identifier);
      if (pinLocked(lockKey)) {
        logger.authWarn("login_locked", "PIN locked after repeated failures", { identifier });
        return fail(res, 429, "pin_locked");
      }
      // A miss still runs scrypt so timing does not reveal whether the account exists.
      const ok = auth.verifyPassword(pin, row && row.pass_hash ? row.pass_hash : DUMMY_HASH) && Boolean(row && row.pass_hash);
      if (!ok) {
        recordPinFailure(lockKey);
        logger.authWarn("login_failed", "Incorrect username or PIN", { identifier, known: Boolean(row) });
        return fail(res, 401, "bad_credentials", "Incorrect username or PIN.");
      }
      clearPinFailures(lockKey);
      const token = auth.newToken();
      const tokenHash = auth.hashToken(token);
      await db.createSession(tokenHash, row.id, now(), SESSION_TTL_MS);
      const pinNeedsUpdate = pin.length !== 6;
      if (pinNeedsUpdate) pinNeedsUpdateBySession.set(tokenHash, true);
      if (pinNeedsUpdateBySession.size > 5000) pinNeedsUpdateBySession.clear();
      logger.auth("login_success", `Player @${row.username} signed in successfully`, { username: row.username, id: row.id });
      return send(res, 200, {
        ok: true,
        user: {
          id: row.id,
          username: row.username,
          displayName: row.display_name || row.username,
          avatar: core.normalizeAvatarId(row.avatar),
          bio: row.bio || "",
          favTeam: row.fav_team || "",
          favPlayer: row.fav_player || "",
          phone: row.phone || null,
          phoneConnected: Boolean(row.phone),
          isAdmin: isAdmin(row, req),
          pinNeedsUpdate,
          createdAt: row.created_at,
        },
      }, { "set-cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) });
    }

    if (key === "POST /api/auth/phone/register") {
      const spendSignup = rateLimit(req, "signup", 5, 60 * 60 * 1000, { defer: true });
      const body = await readJson(req);
      const phone = normalizePhone(body.phone);
      if (!phone || !/^\+[1-9]\d{9,14}$/.test(phone)) {
        return fail(res, 400, "invalid_phone", "Please enter a valid mobile number with country code.");
      }
      const pin = String(body.pin || "").trim();
      if (!/^\d{6}$/.test(pin)) {
        return fail(res, 400, "invalid_pin", "PIN must be exactly 6 digits.");
      }
      if (await db.userByPhone(phone)) {
        logger.authWarn("phone_register_conflict", `Registration rejected: mobile number already registered`, { phone });
        return fail(res, 409, "phone_exists", "This mobile number is already registered. Please sign in or reset your PIN.");
      }

      let username = "";
      if (typeof body.username === "string" && body.username.trim()) {
        const candidate = body.username.trim();
        if (!auth.validUsername(candidate)) {
          return fail(res, 400, "invalid_username", "Username must be 3-20 letters, numbers, or underscores.");
        }
        if (await db.userByName(candidate)) {
          logger.authWarn("phone_register_conflict", `Registration rejected: username "${candidate}" already taken`, { username: candidate, phone });
          return fail(res, 409, "username_taken", "That username is already taken. Please choose another.");
        }
        username = candidate;
      } else {
        const lastDigits = phone.slice(-4);
        const baseUsername = "Player_" + lastDigits;
        username = baseUsername;
        let suffix = 1;
        while ((await db.userByName(username)) && suffix < 1000) {
          username = "Player_" + lastDigits + "_" + suffix;
          suffix++;
        }
      }

      const displayName = typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim().slice(0, 30)
        : username;

      let user;
      try {
        user = await db.createUser(username, auth.hashPassword(pin), now(), {
          displayName,
          phone,
          avatar: "allrounder",
          bio: "Cricket fan playing on Cricketle",
        });
      } catch (err) {
        if (err.code === "phone_taken") {
          logger.authWarn("phone_register_conflict", `Registration conflict on DB insert: phone registered`, { phone });
          return fail(res, 409, "phone_exists", "This mobile number is already registered. Please sign in or reset your PIN.");
        }
        if (err.code === "username_taken") {
          logger.authWarn("phone_register_conflict", `Registration conflict on DB insert: username "${username}" taken`, { username, phone });
          return fail(res, 409, "username_taken", "That username is already taken. Please choose another.");
        }
        throw err;
      }

      const token = auth.newToken();
      await db.createSession(auth.hashToken(token), user.id, now(), SESSION_TTL_MS);
      logger.auth("phone_register_success", `New player registered via phone @${user.username}`, { user: user.username, phone, id: user.id });
      spendSignup();
      return send(res, 201, {
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
          phone: user.phone || phone,
          avatar: core.normalizeAvatarId(user.avatar),
          bio: user.bio || "",
          favTeam: user.favTeam || "",
          favPlayer: user.favPlayer || "",
          googleConnected: false,
          phoneConnected: true,
          createdAt: user.createdAt,
        },
      }, { "set-cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) });
    }

    if (key === "POST /api/profile/update") {
      const user = await requireUser(req);
      rateLimit(req, "profile", 40, 5 * 60 * 1000);
      const body = await readJson(req);

      const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 30) : undefined;
      const bio = typeof body.bio === "string" ? body.bio.trim().slice(0, 160) : undefined;
      const avatar = typeof body.avatar === "string" ? body.avatar.trim().slice(0, 100) : undefined;
      const favTeam = typeof body.favTeam === "string" ? body.favTeam.trim().slice(0, 50) : undefined;
      const favPlayer = typeof body.favPlayer === "string" ? body.favPlayer.trim().slice(0, 50) : undefined;

      const updated = await db.updateProfile(user.id, { displayName, bio, avatar, favTeam, favPlayer });
      const stats = await game.stats(user.id);

      return send(res, 200, {
        ok: true,
        user: {
          id: updated.id,
          username: updated.username,
          displayName: updated.display_name || updated.username,
          email: updated.email,
          avatar: core.normalizeAvatarId(updated.avatar),
          bio: updated.bio || "",
          favTeam: updated.fav_team || "",
          favPlayer: updated.fav_player || "",
          googleConnected: Boolean(updated.google_id),
          createdAt: updated.created_at,
        },
        stats,
      });
    }

    if (key === "POST /api/auth/logout") {
      await readJson(req);
      const token = cookies(req)[COOKIE];
      if (token) { await db.deleteSession(auth.hashToken(token)); pinNeedsUpdateBySession.delete(auth.hashToken(token)); }
      return send(res, 204, null, { "set-cookie": sessionCookie(req, "", 0) });
    }

    if (key === "GET /api/me") {
      const user = await currentUser(req);
      if (!user) return send(res, 200, { user: null, day: core.todayKey(now()), now: now() });
      return send(res, 200, {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name || user.username,
          email: user.email || null,
          phone: user.phone || null,
          avatar: core.normalizeAvatarId(user.avatar),
          bio: user.bio || "",
          favTeam: user.fav_team || "",
          favPlayer: user.fav_player || "",
          googleConnected: Boolean(user.google_id),
          phoneConnected: Boolean(user.phone),
          isAdmin: Boolean(user.isAdmin),
          pinNeedsUpdate: Boolean(pinNeedsUpdateBySession.get(auth.hashToken(cookies(req)[COOKIE] || ""))),
          createdAt: user.created_at,
        },
        stats: await game.stats(user.id),
        day: core.todayKey(now()),
        now: now(),
      });
    }

    if (key === "GET /api/state") {
      const user = await requireUser(req);
      return send(res, 200, game.present(await game.loadState(user.id)));
    }

    if (key === "POST /api/puzzle/start") {
      const user = await requireUser(req);
      rateLimit(req, "play", 600, 10 * 60 * 1000);
      const { mode, idx } = puzzleArgs(await readJson(req));
      logger.game("puzzle_start", `Player @${user.username} started ${mode} puzzle #${idx + 1}`, {
        user: user.username,
        mode,
        idx: idx + 1,
      });
      return engineResult(res, req, await game.start(user.id, mode, idx));
    }

    if (key === "POST /api/puzzle/guess") {
      const user = await requireUser(req);
      rateLimit(req, "play", 600, 10 * 60 * 1000);
      const body = await readJson(req);
      const { mode, idx } = puzzleArgs(body);
      if (typeof body.name !== "string") return fail(res, 400, "unknown_player");
      const r = await game.guess(user.id, mode, idx, body.name);
      if (!r.ok) {
        logger.game("guess_rejected", `Guess rejected for @${user.username} on ${mode} #${idx + 1}: ${r.error}`, {
          user: user.username,
          mode,
          idx: idx + 1,
          error: r.error,
          requestId: req.id,
        });
        logger.debug("GAME", `rejected guess text: "${body.name}"`, { requestId: req.id });
        return fail(res, 400, r.error);
      }
      const p = r.state.modes[mode].puzzles[idx];
      const extra = { rank: r.rank, solved: r.solved, guess: p.guesses[p.guesses.length - 1] };
      if (r.solved) {
        extra.answer = game.answerOf(r.state, mode, idx);
        logger.game("puzzle_solved", `🏆 Player @${user.username} SOLVED ${mode} puzzle #${idx + 1} in ${p.guesses.length} guesses! Score: ${p.points} pts`, {
          user: user.username,
          mode,
          idx: idx + 1,
          guesses: p.guesses.length,
          score: p.points,
          requestId: req.id,
        });
      } else {
        logger.game("guess_made", `@${user.username} guessed on ${mode} #${idx + 1} -> Rank ${r.rank} (guess ${p.guesses.length})`, {
          user: user.username,
          mode,
          idx: idx + 1,
          rank: r.rank,
          requestId: req.id,
        });
        logger.debug("GAME", `guess text: "${body.name}" -> rank ${r.rank}`, { requestId: req.id });
      }
      return engineResult(res, req, r, extra);
    }

    if (key === "POST /api/puzzle/hint") {
      const user = await requireUser(req);
      rateLimit(req, "play", 600, 10 * 60 * 1000);
      const { mode, idx } = puzzleArgs(await readJson(req));
      const r = await game.hint(user.id, mode, idx);
      if (r.ok) {
        logger.game("hint_unlocked", `💡 @${user.username} unlocked hint #${r.hint} on ${mode} #${idx + 1}`, {
          user: user.username,
          mode,
          idx: idx + 1,
          hint: r.hint,
        });
      }
      return engineResult(res, req, r, r.ok ? { hint: r.hint } : null);
    }

    if (key === "POST /api/puzzle/giveup") {
      const user = await requireUser(req);
      rateLimit(req, "play", 600, 10 * 60 * 1000);
      const { mode, idx } = puzzleArgs(await readJson(req));
      const r = await game.giveUp(user.id, mode, idx);
      if (r.ok) {
        const answer = game.answerOf(r.state, mode, idx);
        logger.game("puzzle_giveup", `🏳️ @${user.username} gave up on ${mode} #${idx + 1}. Answer was: ${answer ? answer.name : "unknown"}`, {
          user: user.username,
          mode,
          idx: idx + 1,
          answer: answer ? answer.name : undefined,
        });
        return engineResult(res, req, r, { answer });
      }
      return engineResult(res, req, r, null);
    }

    if (key === "GET /api/leaderboard/today") {
      const user = await currentUser(req);
      return send(res, 200, await game.leaderboardToday(user ? user.id : null, clampLimit(query.get("limit"), 50, 50)));
    }

    if (key === "GET /api/leaderboard/alltime") {
      const user = await currentUser(req);
      return send(res, 200, await game.leaderboardAllTime(user ? user.id : null, clampLimit(query.get("limit"), 50, 50)));
    }

    // ---------- Admin Endpoints ----------

    if (key === "POST /api/admin/login") {
      rateLimit(req, "admin_auth", 15, 15 * 60 * 1000);
      const body = await readJson(req);
      const keyInput = String(body.key || body.password || body.pin || "").trim();
      if (!adminKey || !keyInput || !safeEqual(keyInput, adminKey)) {
        return fail(res, 401, "invalid_admin_key", "Incorrect admin password or key.");
      }
      const token = auth.newToken();
      adminSessions.set(auth.hashToken(token), now() + ADMIN_SESSION_TTL_MS);
      if (adminSessions.size > 100) for (const [h, exp] of adminSessions) if (exp <= now()) adminSessions.delete(h);
      return send(res, 200, { ok: true, admin: true }, { "set-cookie": adminCookie(req, token, ADMIN_SESSION_TTL_MS / 1000) });
    }

    if (key === "POST /api/admin/logout") {
      await readJson(req); // same-origin JSON like every other mutation
      const c = cookies(req)["cricketle_admin"];
      if (c) adminSessions.delete(auth.hashToken(c));
      return send(res, 200, { ok: true }, { "set-cookie": adminCookie(req, "", 0) });
    }

    if (key === "GET /api/admin/stats") {
      const user = await currentUser(req);
      requireAdmin(req, user);
      const usersList = await db.listUsers(1, 0);
      const isSupabase = db instanceof SupabaseDb;
      return send(res, 200, {
        ok: true,
        totalUsers: usersList.total,
        dbEngine: isSupabase ? "Supabase PostgreSQL" : "Local SQLite",
        day: core.todayKey(now()),
      });
    }

    if (key === "GET /api/admin/users") {
      const user = await currentUser(req);
      requireAdmin(req, user);
      const limit = clampLimit(query.get("limit"), 200, 50);
      const offset = Math.max(Math.trunc(Number(query.get("offset"))) || 0, 0);
      const search = String(query.get("search") || "").trim();
      const result = await db.listUsers(limit, offset, search);
      return send(res, 200, {
        ok: true,
        users: (result.rows || []).map((u) => ({
          id: u.id,
          username: u.username,
          displayName: u.display_name || u.displayName || u.username,
          phone: u.phone || null,
          email: u.email || null,
          avatar: core.normalizeAvatarId(u.avatar),
          bio: u.bio || "",
          favTeam: u.fav_team || u.favTeam || "",
          isAdmin: Boolean(u.is_admin || u.isAdmin || (adminPhone && u.phone === adminPhone)),
          createdAt: u.created_at || u.createdAt,
        })),
        total: result.total,
      });
    }

    if (key === "POST /api/admin/user/reset-pin") {
      const user = await currentUser(req);
      requireAdmin(req, user);
      const body = await readJson(req);
      const userId = Number(body.userId);
      const newPin = String(body.newPin || "").trim();
      if (!userId) return fail(res, 400, "missing_user_id", "User ID is required.");
      if (!/^\d{6}$/.test(newPin)) return fail(res, 400, "invalid_pin", "New PIN must be exactly 6 digits.");
      const updated = await db.adminResetPin(userId, auth.hashPassword(newPin));
      if (!updated) return fail(res, 404, "user_not_found", "User not found.");
      log("admin_reset_pin", updated.username, userId);
      return send(res, 200, {
        ok: true,
        message: `PIN for @${updated.username} successfully reset to ${newPin}`,
        user: { id: updated.id, username: updated.username, phone: updated.phone },
      });
    }

    if (key === "POST /api/admin/user/delete") {
      const user = await currentUser(req);
      requireAdmin(req, user);
      const body = await readJson(req);
      const userId = Number(body.userId);
      if (!userId) return fail(res, 400, "missing_user_id", "User ID is required.");
      await db.adminDeleteUser(userId);
      log("admin_delete_user", userId);
      return send(res, 200, { ok: true, message: "User account deleted." });
    }

    return fail(res, 404, "not_found", "No such endpoint.");
  }

  // ---------- static ----------

  function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "method_not_allowed", "Method not allowed.");
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch (_) { return fail(res, 400, "bad_path", "Bad path."); }
    const rel = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
    let file = path.join(publicDir, rel);
    if (!file.startsWith(publicDir + path.sep) && file !== publicDir) return fail(res, 404, "not_found", "Not found.");
    let stat;
    try { stat = fs.statSync(file); } catch (_) { stat = null; }
    if (stat && stat.isDirectory()) {
      file = path.join(file, "index.html");
      try { stat = fs.statSync(file); } catch (_) { stat = null; }
    }
    if (!stat || !stat.isFile()) return fail(res, 404, "not_found", "Not found.");
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const since = req.headers["if-modified-since"];
    if (since && Math.floor(stat.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000)) {
      res.writeHead(304, { "cache-control": "no-cache" });
      return res.end();
    }
    // Assets referenced with ?v= are immutable per version; pages revalidate.
    const versioned = /[?&]v=/.test(req.url || "");
    const headers = {
      "content-type": type,
      "cache-control": versioned ? "public, max-age=31536000, immutable" : "no-cache",
      "last-modified": stat.mtime.toUTCString(),
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "vary": "accept-encoding",
    };
    if (ext === ".html") {
      headers["content-security-policy"] = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
      ].join("; ");
    }
    // Text assets are gzipped on the fly (no build step, no dependencies).
    const compressible = /^(text\/|application\/(json|manifest)|image\/svg)/.test(type);
    const gzip = compressible && stat.size > 1024 && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
    if (gzip) headers["content-encoding"] = "gzip";
    else headers["content-length"] = stat.size;
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(file);
    if (gzip) stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
    else stream.pipe(res);
  }

  // ---------- dispatch ----------

  const server = http.createServer((req, res) => {
    const startTime = Date.now();
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const pathname = url.pathname;
    const reqIp = clientIp(req);

    // One id per request: on the response, in error bodies and in every log line.
    req.id = crypto.randomBytes(8).toString("hex");
    res.setHeader("x-request-id", req.id);
    if (isSecure(req)) res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");

    res.on("finish", () => {
      const latencyMs = Date.now() - startTime;
      const meta = { ip: reqIp, requestId: req.id };
      if (req._user && req._user.username) meta.user = `@${req._user.username}`;
      if (res._failError) meta.error = res._failError.code;

      if (!pathname.startsWith("/api/")) {
        if (res.statusCode >= 400) {
          logger.http(req.method, pathname, res.statusCode, latencyMs, meta);
        } else {
          logger.debug("STATIC", `${req.method} ${pathname} -> ${res.statusCode} (${latencyMs}ms)`);
        }
      } else {
        logger.http(req.method, pathname, res.statusCode, latencyMs, meta);
      }
    });

    const done = (p) => p.catch((err) => {
      if (err instanceof HttpError) {
        res._failError = { status: err.status, code: err.code, message: err.message };
        return fail(res, err.status, err.code, err.message);
      }
      logger.error("SYSTEM", `Unhandled error on ${req.method} ${pathname}: ${err.message}`, err);
      res._failError = { status: 500, code: "server_error", message: err.message };
      if (!res.headersSent) fail(res, 500, "server_error", "Something went wrong.");
      else res.end();
    });

    if (pathname.startsWith("/api/")) done(api(req, res, pathname, url.searchParams));
    else if (pathname === "/admin" || pathname === "/admin/") serveStatic(req, res, "/admin.html");
    else serveStatic(req, res, pathname);
  });

  return {
    server,
    db,
    game,
    logger,
    ready: secretReady,
    close(cb) {
      server.close(() => {
        try { db.close(); } catch (_) { /* already closed */ }
        if (cb) cb();
      });
    },
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  // CRICKETLE_RATE_LIMIT=off disables the per-IP limiter (the e2e suite signs up
  // more accounts per hour from one address than a real visitor ever would).
  // The wrong-PIN lock stays on regardless.
  // The e2e switch never applies to a production-looking environment.
  const production = Boolean(process.env.SUPABASE_URL) || process.env.NODE_ENV === "production";
  const app = createApp(process.env.CRICKETLE_RATE_LIMIT === "off" && !production ? { rateLimit: false } : {});
  app.ready.catch((err) => {
    console.error("[SYSTEM] Could not load the answer secret; refusing to start on the public seed:", err && err.message);
    process.exit(1);
  });
  app.ready.then(() => app.server.listen(port, () => {
    const isSupabase = Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY));
    const dbType = isSupabase ? "Supabase PostgreSQL" : "Local SQLite";
    const banner = [
      "===========================================================",
      "🏏 CRICKETLE V2.0 · DAILY CRICKET CHALLENGE",
      "===========================================================",
      `[SYSTEM] Server listening on http://localhost:${port}`,
      `[SYSTEM] Active IST Calendar Day: ${core.todayKey()}`,
      `[SYSTEM] Database Engine: ${dbType}`,
      `[SYSTEM] Structured Logger: active (Level: ${process.env.LOG_LEVEL || "info"})`,
      "===========================================================",
    ].join("\n");
    console.log(banner);
  }));
  const stop = () => app.close(() => {
    console.log("[SYSTEM] Cricketle server shut down cleanly.");
    process.exit(0);
  });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

module.exports = { createApp };

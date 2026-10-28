"use strict";
// Cricketle server: static client + JSON API. Node 22.5+ only, no npm dependencies.
//
//   npm start              -> http://localhost:3000
//   PORT=8080 npm start
//   CRICKETLE_DB=path.db   (default ./data/cricketle.db)
//   CRICKETLE_SECRET=...   (default: generated once and stored in the database)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Automatically load .env configuration if present
function loadEnv() {
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

// OTP.dev Real SMS API dispatch and verification
async function sendOtpDev({ key, channel = "sms", sender = "OTP.dev", template = "", phone, code }) {
  const digits = String(phone).replace(/\D/g, "");
  const payload = {
    data: {
      channel: channel || "sms",
      sender: sender || "OTP.dev",
      phone: digits,
      code: String(code),
      code_length: String(code).length,
    },
  };
  if (template) payload.data.template = template;

  const res = await fetch("https://api.otp.dev/v1/verifications", {
    method: "POST",
    headers: {
      "X-OTP-Key": key,
      "accept": "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { ok: res.ok, status: res.status, json, text };
}

async function verifyOtpDev({ key, phone, code }) {
  const digits = String(phone).replace(/\D/g, "");
  const url = `https://api.otp.dev/v1/verifications?code=${encodeURIComponent(code)}&phone=${encodeURIComponent(digits)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-OTP-Key": key,
      "accept": "application/json",
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  const valid = res.ok && json && Array.isArray(json.data) && json.data.length > 0;
  return { ok: res.ok, valid, json };
}

const core = require("./public/game-core.js");
const { Db } = require("./lib/db.js");
const auth = require("./lib/auth.js");
const { GameService } = require("./lib/game.js");

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
  bad_mode: "Unknown mode.",
  bad_index: "Unknown puzzle.",
  bad_state: "Bad request.",
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
  const log = opts.log === false ? () => {} : (...a) => console.log(...a);
  const dbPath = opts.dbPath || process.env.CRICKETLE_DB || path.join(__dirname, "data", "cricketle.db");
  const db = new Db(dbPath);
  // CRICKETLE_SECRET=public uses the public seed (same answers as guests); only for local testing.
  const envSecret = process.env.CRICKETLE_SECRET;
  const secret = opts.secret !== undefined ? opts.secret : envSecret === "public" ? "" : (envSecret || db.getOrCreateSecret());
  const game = new GameService(db, { now, secret });
  const publicDir = opts.publicDir || PUBLIC_DIR;
  const limiter = opts.rateLimit === false ? null : new Map();

  const otpDevKey = opts.otpDevKey || process.env.OTP_DEV_KEY || process.env.OTP_DEV_API_KEY || "";
  const otpDevChannel = opts.otpDevChannel || process.env.OTP_DEV_CHANNEL || "sms";
  const otpDevSender = opts.otpDevSender || process.env.OTP_DEV_SENDER || "OTP.dev";
  const otpDevTemplate = opts.otpDevTemplate || process.env.OTP_DEV_TEMPLATE || "";

  // ---------- helpers ----------

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
    send(res, status, { error: code, message: message || MESSAGES[code] || code });
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
    return Boolean(req.socket.encrypted) || String(req.headers["x-forwarded-proto"] || "").startsWith("https");
  }

  function sessionCookie(req, token, maxAge) {
    const parts = [COOKIE + "=" + token, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=" + maxAge];
    if (isSecure(req)) parts.push("Secure");
    return parts.join("; ");
  }

  function currentUser(req) {
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    return db.sessionUser(auth.hashToken(token), now());
  }

  function requireUser(req) {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, "unauthorized", "Sign in to play for the leaderboard.");
    return user;
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
  function rateLimit(req, bucket, max, windowMs) {
    if (!limiter) return;
    const key = bucket + "|" + (req.socket.remoteAddress || "?");
    const t = now();
    const hits = (limiter.get(key) || []).filter((x) => t - x < windowMs);
    if (hits.length >= max) throw new HttpError(429, "rate_limited", "Too many requests. Try again in a few minutes.");
    hits.push(t);
    limiter.set(key, hits);
    if (limiter.size > 5000) limiter.clear();
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

    if (key === "POST /api/auth/register") {
      rateLimit(req, "auth", 20, 15 * 60 * 1000);
      const body = await readJson(req);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      if (!auth.validUsername(username)) return fail(res, 400, "invalid_username", "Usernames are 3-20 letters, numbers or underscores.");
      if (!auth.validPassword(body.password)) return fail(res, 400, "invalid_password", "Passwords need at least 6 characters.");
      const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim().slice(0, 30) : username;
      const avatar = typeof body.avatar === "string" ? body.avatar.trim().slice(0, 50) : "batter";

      let user;
      try {
        user = db.createUser(username, auth.hashPassword(body.password), now(), { displayName, avatar });
      } catch (err) {
        if (err.code === "username_taken") return fail(res, 409, "username_taken", "That username is taken.");
        throw err;
      }
      const token = auth.newToken();
      db.createSession(auth.hashToken(token), user.id, now(), SESSION_TTL_MS);
      log("register", user.username);
      return send(res, 201, {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
          avatar: user.avatar || "batter",
          bio: user.bio || "",
          favTeam: user.favTeam || "",
          favPlayer: user.favPlayer || "",
          googleConnected: false,
          createdAt: user.createdAt,
        },
      }, { "set-cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) });
    }

    if (key === "POST /api/auth/login") {
      rateLimit(req, "auth", 20, 15 * 60 * 1000);
      const body = await readJson(req);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const row = username ? db.userByName(username) : null;
      if (!row || !row.pass_hash || !auth.verifyPassword(String(body.password || ""), row.pass_hash)) {
        return fail(res, 401, "bad_credentials", "Wrong username or password.");
      }
      const token = auth.newToken();
      db.createSession(auth.hashToken(token), row.id, now(), SESSION_TTL_MS);
      return send(res, 200, {
        user: {
          id: row.id,
          username: row.username,
          displayName: row.display_name || row.username,
          avatar: row.avatar || "batter",
          bio: row.bio || "",
          favTeam: row.fav_team || "",
          favPlayer: row.fav_player || "",
          googleConnected: Boolean(row.google_id),
          createdAt: row.created_at,
        },
      }, { "set-cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) });
    }

    if (key === "POST /api/auth/google") {
      rateLimit(req, "auth", 30, 15 * 60 * 1000);
      const body = await readJson(req);
      let googleId = "";
      let email = "";
      let name = "";
      let picture = "";

      if (body.credential && typeof body.credential === "string") {
        try {
          const parts = body.credential.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
            googleId = payload.sub || "";
            email = payload.email || "";
            name = payload.name || payload.given_name || "";
            picture = payload.picture || "";
          }
        } catch (_) {
          return fail(res, 400, "invalid_google_token", "Invalid Google credentials.");
        }
      } else if (body.sub && typeof body.sub === "string") {
        googleId = body.sub;
        email = body.email || "";
        name = body.name || "";
        picture = body.picture || "";
      }

      if (!googleId) {
        return fail(res, 400, "missing_google_id", "Google account information was not received.");
      }

      let user = db.userByGoogleId(googleId);
      if (!user && email) {
        user = db.userByEmail(email);
        if (user) {
          user = db.linkGoogle(user.id, googleId, email, picture);
        }
      }

      if (!user) {
        let baseUsername = (name || email.split("@")[0] || "Cricketer")
          .replace(/[^A-Za-z0-9_]/g, "_")
          .slice(0, 15);
        if (baseUsername.length < 3) baseUsername = "Player_" + baseUsername;

        let username = baseUsername;
        let suffix = 1;
        while (db.userByName(username) && suffix < 1000) {
          username = (baseUsername.slice(0, 14) + "_" + suffix).slice(0, 20);
          suffix++;
        }

        user = db.createUser(username, null, now(), {
          displayName: name || username,
          email,
          googleId,
          avatar: "captain",
          bio: "Cricket enthusiast · Signed in with Google",
        });
      }

      const token = auth.newToken();
      db.createSession(auth.hashToken(token), user.id, now(), SESSION_TTL_MS);
      log("google_login", user.username);
      return send(
        res,
        200,
        {
          user: {
            id: user.id,
            username: user.username,
            displayName: user.display_name || user.displayName || user.username,
            email: user.email,
            avatar: user.avatar || "captain",
            bio: user.bio || "",
            favTeam: user.fav_team || user.favTeam || "",
            favPlayer: user.fav_player || user.favPlayer || "",
            googleConnected: true,
            createdAt: user.created_at || user.createdAt,
          },
        },
        { "set-cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) }
      );
    }

    if (key === "POST /api/auth/otp/send") {
      rateLimit(req, "otp_send", 20, 10 * 60 * 1000);
      const body = await readJson(req);
      const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
      let phone = rawPhone.replace(/[\s\-\(\)]/g, "");
      if (!phone) {
        return fail(res, 400, "missing_phone", "Please provide a valid mobile number.");
      }
      if (/^[6-9]\d{9}$/.test(phone)) {
        phone = "+91" + phone;
      } else if (!phone.startsWith("+") && /^\d{10,14}$/.test(phone)) {
        phone = "+" + phone;
      }
      if (!/^\+[1-9]\d{9,14}$/.test(phone)) {
        return fail(res, 400, "invalid_phone", "Please enter a valid mobile number with country code (e.g. +91 98765 43210).");
      }

      // Generate 6-digit cryptographically secure OTP
      const code = String(crypto.randomInt(100000, 1000000));
      const codeHash = crypto.createHash("sha256").update(phone + ":" + code).digest("hex");
      const expiresAt = now() + 5 * 60 * 1000; // 5 minutes

      db.setOtp(phone, codeHash, expiresAt, now());
      log("otp_sent", phone);

      let realSms = false;
      let gatewayMessage = null;

      if (otpDevKey) {
        try {
          const otpRes = await sendOtpDev({
            key: otpDevKey,
            channel: otpDevChannel,
            sender: otpDevSender,
            template: otpDevTemplate,
            phone,
            code,
          });
          if (otpRes.ok) {
            realSms = true;
            log("otp_dev_sent", phone, otpRes.status);
          } else {
            log("otp_dev_error", phone, otpRes.status, otpRes.text);
            gatewayMessage = (otpRes.json && (otpRes.json.message || otpRes.json.error)) || "OTP.dev delivery failed";
          }
        } catch (err) {
          log("otp_dev_exception", err);
          gatewayMessage = err.message || "Failed to reach OTP.dev";
        }
      }

      return send(res, 200, {
        ok: true,
        phone,
        realSms,
        channel: otpDevChannel,
        message: realSms
          ? `Real SMS sent to ${phone} via OTP.dev!`
          : (gatewayMessage ? `Gateway: ${gatewayMessage}. Test code provided below.` : "OTP code ready. (Set OTP_DEV_KEY in .env for real SMS delivery via OTP.dev)"),
        devOtp: realSms ? undefined : code,
        expiresAt,
      });
    }

    if (key === "POST /api/auth/otp/verify") {
      rateLimit(req, "otp_verify", 30, 10 * 60 * 1000);
      const body = await readJson(req);
      const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
      let phone = rawPhone.replace(/[\s\-\(\)]/g, "");
      if (/^[6-9]\d{9}$/.test(phone)) phone = "+91" + phone;
      else if (!phone.startsWith("+") && /^\d{10,14}$/.test(phone)) phone = "+" + phone;

      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!phone || !code) {
        return fail(res, 400, "missing_fields", "Mobile number and 6-digit OTP code are required.");
      }

      const otpRecord = db.getOtp(phone);
      if (!otpRecord || otpRecord.expires_at < now()) {
        if (otpRecord) db.deleteOtp(phone);
        return fail(res, 400, "otp_expired", "OTP has expired or was not requested. Please request a new OTP.");
      }

      if (otpRecord.attempts >= 5) {
        db.deleteOtp(phone);
        return fail(res, 400, "otp_locked", "Too many incorrect attempts. Please request a fresh OTP.");
      }

      let isValid = false;
      const expectedHash = crypto.createHash("sha256").update(phone + ":" + code).digest("hex");
      if (expectedHash === otpRecord.code_hash) {
        isValid = true;
      }

      // Also check OTP.dev remote verification if key is present
      if (!isValid && otpDevKey) {
        try {
          const remoteCheck = await verifyOtpDev({ key: otpDevKey, phone, code });
          if (remoteCheck.valid) isValid = true;
        } catch (_) {}
      }

      if (!isValid) {
        db.incrementOtpAttempts(phone);
        const remaining = 5 - (otpRecord.attempts + 1);
        if (remaining <= 0) {
          db.deleteOtp(phone);
          return fail(res, 400, "otp_locked", "Too many incorrect attempts. Please request a fresh OTP.");
        }
        return fail(res, 400, "invalid_otp", `Incorrect OTP code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`);
      }

      // Valid OTP: delete it immediately so it cannot be reused
      db.deleteOtp(phone);

      let user = db.userByPhone(phone);
      if (!user) {
        const lastDigits = phone.slice(-4);
        const baseUsername = "Player_" + lastDigits;
        let username = baseUsername;
        let suffix = 1;
        while (db.userByName(username) && suffix < 1000) {
          username = "Player_" + lastDigits + "_" + suffix;
          suffix++;
        }

        const displayName = (typeof body.displayName === "string" && body.displayName.trim())
          ? body.displayName.trim().slice(0, 30)
          : "Cricketer " + lastDigits;

        user = db.createUser(username, null, now(), {
          displayName,
          phone,
          avatar: "allrounder",
          bio: "Cricket fan playing on Cricketle",
        });
      }

      const token = auth.newToken();
      db.createSession(auth.hashToken(token), user.id, now(), SESSION_TTL_MS);
      log("otp_login", user.username);
      return send(
        res,
        200,
        {
          ok: true,
          user: {
            id: user.id,
            username: user.username,
            displayName: user.display_name || user.displayName || user.username,
            email: user.email,
            phone: user.phone || phone,
            avatar: user.avatar || "allrounder",
            bio: user.bio || "",
            favTeam: user.fav_team || user.favTeam || "",
            favPlayer: user.fav_player || user.favPlayer || "",
            googleConnected: Boolean(user.google_id),
            phoneConnected: true,
            createdAt: user.created_at || user.createdAt,
          },
        },
        { "set-cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000) }
      );
    }

    if (key === "POST /api/profile/update") {
      const user = requireUser(req);
      rateLimit(req, "profile", 40, 5 * 60 * 1000);
      const body = await readJson(req);

      const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 30) : undefined;
      const bio = typeof body.bio === "string" ? body.bio.trim().slice(0, 160) : undefined;
      const avatar = typeof body.avatar === "string" ? body.avatar.trim().slice(0, 100) : undefined;
      const favTeam = typeof body.favTeam === "string" ? body.favTeam.trim().slice(0, 50) : undefined;
      const favPlayer = typeof body.favPlayer === "string" ? body.favPlayer.trim().slice(0, 50) : undefined;

      const updated = db.updateProfile(user.id, { displayName, bio, avatar, favTeam, favPlayer });
      const stats = game.stats(user.id);

      return send(res, 200, {
        ok: true,
        user: {
          id: updated.id,
          username: updated.username,
          displayName: updated.display_name || updated.username,
          email: updated.email,
          avatar: updated.avatar || "batter",
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
      if (token) db.deleteSession(auth.hashToken(token));
      return send(res, 204, null, { "set-cookie": sessionCookie(req, "", 0) });
    }

    if (key === "GET /api/me") {
      const user = currentUser(req);
      if (!user) return send(res, 200, { user: null, day: core.todayKey(now()), now: now() });
      return send(res, 200, {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name || user.username,
          email: user.email || null,
          phone: user.phone || null,
          avatar: user.avatar || "batter",
          bio: user.bio || "",
          favTeam: user.fav_team || "",
          favPlayer: user.fav_player || "",
          googleConnected: Boolean(user.google_id),
          phoneConnected: Boolean(user.phone),
          createdAt: user.created_at,
        },
        stats: game.stats(user.id),
        day: core.todayKey(now()),
        now: now(),
      });
    }

    if (key === "GET /api/state") {
      const user = requireUser(req);
      return send(res, 200, game.present(game.loadState(user.id)));
    }

    if (key === "POST /api/puzzle/start") {
      const user = requireUser(req);
      rateLimit(req, "play", 600, 10 * 60 * 1000);
      const { mode, idx } = puzzleArgs(await readJson(req));
      return engineResult(res, req, game.start(user.id, mode, idx));
    }

    if (key === "POST /api/puzzle/guess") {
      const user = requireUser(req);
      rateLimit(req, "play", 600, 10 * 60 * 1000);
      const body = await readJson(req);
      const { mode, idx } = puzzleArgs(body);
      if (typeof body.name !== "string") return fail(res, 400, "unknown_player");
      const r = game.guess(user.id, mode, idx, body.name);
      if (!r.ok) return fail(res, 400, r.error);
      const p = r.state.modes[mode].puzzles[idx];
      const extra = { rank: r.rank, solved: r.solved, guess: p.guesses[p.guesses.length - 1] };
      if (r.solved) extra.answer = game.answerOf(r.state, mode, idx);
      return engineResult(res, req, r, extra);
    }

    if (key === "POST /api/puzzle/hint") {
      const user = requireUser(req);
      rateLimit(req, "play", 600, 10 * 60 * 1000);
      const { mode, idx } = puzzleArgs(await readJson(req));
      const r = game.hint(user.id, mode, idx);
      return engineResult(res, req, r, r.ok ? { hint: r.hint } : null);
    }

    if (key === "POST /api/puzzle/giveup") {
      const user = requireUser(req);
      rateLimit(req, "play", 600, 10 * 60 * 1000);
      const { mode, idx } = puzzleArgs(await readJson(req));
      const r = game.giveUp(user.id, mode, idx);
      return engineResult(res, req, r, r.ok ? { answer: game.answerOf(r.state, mode, idx) } : null);
    }

    if (key === "GET /api/leaderboard/today") {
      const user = currentUser(req);
      return send(res, 200, game.leaderboardToday(user ? user.id : null, Number(query.get("limit")) || undefined));
    }

    if (key === "GET /api/leaderboard/alltime") {
      const user = currentUser(req);
      return send(res, 200, game.leaderboardAllTime(user ? user.id : null, Number(query.get("limit")) || undefined));
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
    const headers = {
      "content-type": type,
      "content-length": stat.size,
      "cache-control": "no-cache",
      "last-modified": stat.mtime.toUTCString(),
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
    };
    if (ext === ".html") {
      headers["content-security-policy"] = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https://lh3.googleusercontent.com https://*.googleusercontent.com",
        "connect-src 'self' https://accounts.google.com/gsi/",
        "frame-src https://accounts.google.com/gsi/",
        "frame-ancestors 'none'",
        "base-uri 'self'",
      ].join("; ");
    }
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  }

  // ---------- dispatch ----------

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const pathname = url.pathname;
    const done = (p) => p.catch((err) => {
      if (err instanceof HttpError) return fail(res, err.status, err.code, err.message);
      log("error", err);
      if (!res.headersSent) fail(res, 500, "server_error", "Something went wrong.");
      else res.end();
    });
    if (pathname.startsWith("/api/")) done(api(req, res, pathname, url.searchParams));
    else serveStatic(req, res, pathname);
  });

  return {
    server,
    db,
    game,
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
  const app = createApp();
  app.server.listen(port, () => {
    console.log("Cricketle running at http://localhost:" + port + "  (IST day " + core.todayKey() + ")");
  });
  const stop = () => app.close(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

module.exports = { createApp };

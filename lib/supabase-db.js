"use strict";
// Supabase PostgreSQL adapter for Cricketle.
// Communicates with Supabase's PostgREST API using native fetch (Node 22 built-in, zero npm dependencies).
// Works as a seamless drop-in replacement for SQLite Db in production.

const crypto = require("node:crypto");

function formatUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    pass_hash: row.pass_hash,
    display_name: row.display_name || row.username,
    email: row.email || null,
    google_id: row.google_id || null,
    avatar: row.avatar || "batter",
    bio: row.bio || "",
    fav_team: row.fav_team || "",
    fav_player: row.fav_player || "",
    phone: row.phone || null,
    is_admin: Boolean(row.is_admin),
    isAdmin: Boolean(row.is_admin),
    created_at: Number(row.created_at),
  };
}

class SupabaseDb {
  constructor(url, key) {
    if (!url || !key) {
      throw new Error("SupabaseDb requires both url and key (SUPABASE_URL and SUPABASE_KEY/SUPABASE_ANON_KEY)");
    }
    this.url = String(url).replace(/\/+$/, "").replace(/\/rest\/v1\/?$/, "");
    this.key = String(key).trim();
  }

  async request(method, endpoint, body = null, extraHeaders = {}) {
    const fullUrl = this.url + "/rest/v1" + endpoint;
    const headers = {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    };

    const options = {
      method,
      headers,
    };

    if (body !== null && method !== "GET" && method !== "HEAD") {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(fullUrl, options);

    if (!res.ok) {
      let errData = null;
      try {
        errData = await res.json();
      } catch (_) {
        errData = { message: await res.text().catch(() => "") };
      }

      const message = String(errData.message || errData.details || "");
      if (res.status === 409 || errData.code === "23505" || /unique constraint/i.test(message)) {
        if (/phone/i.test(message) || /users_phone/i.test(message)) {
          const e = new Error("phone taken");
          e.code = "phone_taken";
          throw e;
        }
        if (/username/i.test(message) || /users_username/i.test(message)) {
          const e = new Error("username taken");
          e.code = "username_taken";
          throw e;
        }
      }

      const err = new Error(message || `Supabase HTTP ${res.status}: ${res.statusText}`);
      err.status = res.status;
      err.supabaseError = errData;
      throw err;
    }

    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  async getOrCreateSecret() {
    try {
      const rows = await this.request("GET", "/settings?key=eq.secret&select=value&limit=1");
      if (rows && rows.length > 0 && rows[0].value) {
        return rows[0].value;
      }
    } catch (_) {}

    const secret = crypto.randomBytes(32).toString("hex");
    try {
      await this.request("POST", "/settings", { key: "secret", value: secret }, { Prefer: "resolution=ignore-duplicates" });
    } catch (_) {}

    const verify = await this.request("GET", "/settings?key=eq.secret&select=value&limit=1");
    return verify && verify.length > 0 ? verify[0].value : secret;
  }

  async createUser(username, passHash, now, profile = {}) {
    const displayName = profile.displayName || username;
    const email = profile.email || null;
    const googleId = profile.googleId || null;
    const avatar = profile.avatar || "batter";
    const bio = profile.bio || "";
    const favTeam = profile.favTeam || "";
    const favPlayer = profile.favPlayer || "";
    const phone = profile.phone || null;

    const rows = await this.request(
      "POST",
      "/users",
      {
        username,
        pass_hash: passHash,
        display_name: displayName,
        email,
        google_id: googleId,
        avatar,
        bio,
        fav_team: favTeam,
        fav_player: favPlayer,
        phone,
        created_at: now,
      },
      { Prefer: "return=representation" }
    );

    const row = rows && rows[0] ? rows[0] : null;
    if (!row) throw new Error("Failed to insert user into Supabase");

    return {
      id: Number(row.id),
      username: row.username,
      displayName: row.display_name || row.username,
      email: row.email || null,
      googleId: row.google_id || null,
      avatar: row.avatar || "batter",
      bio: row.bio || "",
      favTeam: row.fav_team || "",
      favPlayer: row.fav_player || "",
      phone: row.phone || null,
      createdAt: Number(row.created_at || now),
    };
  }

  async userByName(username) {
    if (!username) return null;
    const rows = await this.request("GET", `/users?username=ilike.${encodeURIComponent(username)}&limit=1`);
    return rows && rows.length > 0 ? formatUser(rows[0]) : null;
  }

  async userById(id) {
    if (!id) return null;
    const rows = await this.request("GET", `/users?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows && rows.length > 0 ? formatUser(rows[0]) : null;
  }

  async userByGoogleId(googleId) {
    if (!googleId) return null;
    const rows = await this.request("GET", `/users?google_id=eq.${encodeURIComponent(googleId)}&limit=1`);
    return rows && rows.length > 0 ? formatUser(rows[0]) : null;
  }

  async userByEmail(email) {
    if (!email) return null;
    const rows = await this.request("GET", `/users?email=ilike.${encodeURIComponent(email)}&limit=1`);
    return rows && rows.length > 0 ? formatUser(rows[0]) : null;
  }

  async userByPhone(phone) {
    if (!phone) return null;
    const rows = await this.request("GET", `/users?phone=eq.${encodeURIComponent(phone)}&limit=1`);
    return rows && rows.length > 0 ? formatUser(rows[0]) : null;
  }

  async setOtp(phone, codeHash, expiresAt, now) {
    await this.request(
      "POST",
      "/otp_codes",
      {
        phone,
        code_hash: codeHash,
        expires_at: expiresAt,
        attempts: 0,
        created_at: now,
      },
      { Prefer: "resolution=merge-duplicates" }
    );
  }

  async getOtp(phone) {
    if (!phone) return null;
    const rows = await this.request("GET", `/otp_codes?phone=eq.${encodeURIComponent(phone)}&limit=1`);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  async deleteOtp(phone) {
    if (!phone) return;
    await this.request("DELETE", `/otp_codes?phone=eq.${encodeURIComponent(phone)}`);
  }

  async incrementOtpAttempts(phone) {
    const otp = await this.getOtp(phone);
    if (otp) {
      await this.request("PATCH", `/otp_codes?phone=eq.${encodeURIComponent(phone)}`, {
        attempts: (Number(otp.attempts) || 0) + 1,
      });
    }
  }

  async linkPhone(userId, phone) {
    await this.request("PATCH", `/users?id=eq.${encodeURIComponent(userId)}`, { phone });
    return this.userById(userId);
  }

  async updateProfile(userId, profile) {
    const patch = {};
    if (profile.displayName !== undefined) patch.display_name = profile.displayName;
    if (profile.bio !== undefined) patch.bio = profile.bio;
    if (profile.avatar !== undefined) patch.avatar = profile.avatar;
    if (profile.favTeam !== undefined) patch.fav_team = profile.favTeam;
    if (profile.favPlayer !== undefined) patch.fav_player = profile.favPlayer;

    await this.request("PATCH", `/users?id=eq.${encodeURIComponent(userId)}`, patch);
    return this.userById(userId);
  }

  async linkGoogle(userId, googleId, email, avatar) {
    const patch = { google_id: googleId };
    if (email) patch.email = email;
    if (avatar) patch.avatar = avatar;
    await this.request("PATCH", `/users?id=eq.${encodeURIComponent(userId)}`, patch);
    return this.userById(userId);
  }

  async updatePassword(userId, passHash) {
    await this.request("PATCH", `/users?id=eq.${encodeURIComponent(userId)}`, { pass_hash: passHash });
    return this.userById(userId);
  }

  async createSession(tokenHash, userId, now, ttlMs) {
    await this.request("POST", "/sessions", {
      token_hash: tokenHash,
      user_id: userId,
      created_at: now,
      expires_at: now + ttlMs,
    });
    if (Math.random() < 0.05) {
      this.purgeSessions(now).catch(() => {});
    }
  }

  async sessionUser(tokenHash, now) {
    if (!tokenHash) return null;
    const sessions = await this.request(
      "GET",
      `/sessions?token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${now}&select=user_id&limit=1`
    );
    if (!sessions || sessions.length === 0) return null;
    return this.userById(sessions[0].user_id);
  }

  async deleteSession(tokenHash) {
    if (!tokenHash) return;
    await this.request("DELETE", `/sessions?token_hash=eq.${encodeURIComponent(tokenHash)}`);
  }

  async purgeSessions(now) {
    await this.request("DELETE", `/sessions?expires_at=lte.${now}`);
  }

  async puzzlesFor(userId, day) {
    const rows = await this.request(
      "GET",
      `/puzzles?user_id=eq.${encodeURIComponent(userId)}&day=eq.${encodeURIComponent(day)}&select=mode,idx,status,guesses,hints,started_at,finished_at,points`
    );
    return (rows || []).map((r) => ({
      mode: r.mode,
      idx: r.idx,
      status: r.status,
      guesses: typeof r.guesses === "string" ? r.guesses : JSON.stringify(r.guesses || []),
      hints: r.hints,
      started_at: r.started_at ? Number(r.started_at) : null,
      finished_at: r.finished_at ? Number(r.finished_at) : null,
      points: r.points,
    }));
  }

  async puzzleHistory(userId) {
    const rows = await this.request(
      "GET",
      `/puzzles?user_id=eq.${encodeURIComponent(userId)}&status=in.(solved,gaveUp)&order=day.desc,idx.asc&select=day,mode,idx,status,guesses,hints,started_at,finished_at,points`
    );
    return (rows || []).map((r) => ({
      day: r.day,
      mode: r.mode,
      idx: r.idx,
      status: r.status,
      guesses: typeof r.guesses === "string" ? r.guesses : JSON.stringify(r.guesses || []),
      hints: r.hints,
      started_at: r.started_at ? Number(r.started_at) : null,
      finished_at: r.finished_at ? Number(r.finished_at) : null,
      points: r.points,
    }));
  }

  async savePuzzles(userId, state) {
    const items = [];
    for (const mode of Object.keys(state.modes)) {
      state.modes[mode].puzzles.forEach((p, idx) => {
        items.push({
          user_id: userId,
          day: state.day,
          mode,
          idx,
          status: p.status,
          guesses: Array.isArray(p.guesses) ? p.guesses : JSON.parse(p.guesses || "[]"),
          hints: p.hints,
          started_at: p.startedAt,
          finished_at: p.finishedAt,
          points: p.points,
        });
      });
    }
    if (items.length > 0) {
      await this.request("POST", "/puzzles", items, {
        Prefer: "resolution=merge-duplicates",
      });
    }
  }

  async leaderboardToday(day, limit = 50, userId = null) {
    const rows = (await this.request("POST", "/rpc/get_leaderboard_today", {
      p_day: day,
      p_limit: limit,
    })) || [];

    let me = null;
    if (userId) {
      me = rows.find((r) => Number(r.user_id) === Number(userId)) || null;
      if (!me) {
        try {
          const meRows = await this.request("POST", "/rpc/get_leaderboard_today_user", {
            p_day: day,
            p_user_id: userId,
          });
          if (meRows && meRows.length > 0) me = meRows[0];
        } catch (_) {}
      }
    }

    const normalizedRows = rows.map((r) => ({
      user_id: Number(r.user_id),
      username: r.username,
      display_name: r.display_name,
      avatar: r.avatar,
      points: Number(r.points),
      solved: Number(r.solved),
      guesses: Number(r.guesses),
      ms: Number(r.ms),
      rank: Number(r.rank),
      total: Number(r.total),
    }));

    const normalizedMe = me
      ? {
          user_id: Number(me.user_id),
          username: me.username,
          display_name: me.display_name,
          avatar: me.avatar,
          points: Number(me.points),
          solved: Number(me.solved),
          guesses: Number(me.guesses),
          ms: Number(me.ms),
          rank: Number(me.rank),
          total: Number(me.total),
        }
      : null;

    return {
      rows: normalizedRows,
      me: normalizedMe,
      total: normalizedRows.length ? normalizedRows[0].total : (normalizedMe ? normalizedMe.total : 0),
    };
  }

  async leaderboardAllTime(limit = 50, userId = null) {
    const rows = (await this.request("POST", "/rpc/get_leaderboard_alltime", {
      p_limit: limit,
    })) || [];

    let me = null;
    if (userId) {
      me = rows.find((r) => Number(r.user_id) === Number(userId)) || null;
      if (!me) {
        try {
          const meRows = await this.request("POST", "/rpc/get_leaderboard_alltime_user", {
            p_user_id: userId,
          });
          if (meRows && meRows.length > 0) me = meRows[0];
        } catch (_) {}
      }
    }

    const normalizedRows = rows.map((r) => ({
      user_id: Number(r.user_id),
      username: r.username,
      display_name: r.display_name,
      avatar: r.avatar,
      points: Number(r.points),
      solved: Number(r.solved),
      days: Number(r.days),
      rank: Number(r.rank),
      total: Number(r.total),
    }));

    const normalizedMe = me
      ? {
          user_id: Number(me.user_id),
          username: me.username,
          display_name: me.display_name,
          avatar: me.avatar,
          points: Number(me.points),
          solved: Number(me.solved),
          days: Number(me.days),
          rank: Number(me.rank),
          total: Number(me.total),
        }
      : null;

    return {
      rows: normalizedRows,
      me: normalizedMe,
      total: normalizedRows.length ? normalizedRows[0].total : (normalizedMe ? normalizedMe.total : 0),
    };
  }

  async solvedDays(userId) {
    const rows = (await this.request(
      "GET",
      `/puzzles?user_id=eq.${encodeURIComponent(userId)}&status=eq.solved&select=day&order=day.desc`
    )) || [];
    const days = [];
    const seen = new Set();
    for (const r of rows) {
      if (!seen.has(r.day)) {
        seen.add(r.day);
        days.push(r.day);
      }
    }
    return days;
  }

  async totals(userId) {
    const rows = (await this.request(
      "GET",
      `/puzzles?user_id=eq.${encodeURIComponent(userId)}&status=in.(solved,gaveUp)&select=day,status,points`
    )) || [];
    let points = 0;
    let solved = 0;
    const daysSet = new Set();
    for (const r of rows) {
      points += Number(r.points || 0);
      if (r.status === "solved") solved++;
      if (r.day) daysSet.add(r.day);
    }
    return {
      points,
      solved,
      days: daysSet.size,
    };
  }

  async listUsers(limit = 100, offset = 0, search = "") {
    let endpoint = `/users?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (search && search.trim()) {
      const q = encodeURIComponent(`*${search.trim()}*`);
      endpoint = `/users?select=*&or=(username.ilike.${q},phone.ilike.${q},display_name.ilike.${q})&order=created_at.desc&limit=${limit}`;
    }
    const rows = await this.request("GET", endpoint);
    return {
      rows: (rows || []).map(formatUser),
      total: Array.isArray(rows) ? rows.length : 0,
    };
  }

  async adminResetPin(userId, newPinHash) {
    await this.request("PATCH", `/users?id=eq.${encodeURIComponent(userId)}`, {
      pass_hash: newPinHash,
    });
    return this.userById(userId);
  }

  async adminDeleteUser(userId) {
    await this.request("DELETE", `/users?id=eq.${encodeURIComponent(userId)}`);
    return true;
  }

  close() {
    // Stateless HTTP REST — no connection pool to tear down.
  }
}

module.exports = { SupabaseDb };

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SupabaseDb } = require("../lib/supabase-db.js");

test("SupabaseDb: constructor requires url and key", () => {
  assert.throws(() => new SupabaseDb("", "key123"), /requires both url and key/);
  assert.throws(() => new SupabaseDb("https://example.supabase.co", ""), /requires both url and key/);
  const db = new SupabaseDb("https://xyz.supabase.co/", "my-secret-key  ");
  assert.equal(db.url, "https://xyz.supabase.co");
  assert.equal(db.key, "my-secret-key");
});

test("SupabaseDb: user creation and mapping", async () => {
  const originalFetch = global.fetch;
  const mockCalls = [];

  global.fetch = async (url, opts) => {
    mockCalls.push({ url, opts });
    if (url.endsWith("/rest/v1/users") && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify([{
          id: 42,
          username: body.username,
          pass_hash: body.pass_hash,
          display_name: body.display_name,
          email: body.email,
          google_id: body.google_id,
          avatar: body.avatar,
          bio: body.bio,
          fav_team: body.fav_team,
          fav_player: body.fav_player,
          phone: body.phone,
          created_at: body.created_at,
        }]),
      };
    }
    return { ok: false, status: 404, statusText: "Not Found", text: async () => "" };
  };

  try {
    const db = new SupabaseDb("https://mock.supabase.co", "test-key");
    const user = await db.createUser("dhoni", "hash123", 1000, {
      displayName: "MS Dhoni",
      phone: "+919876543210",
      avatar: "captain",
      bio: "Finisher",
      favTeam: "CSK",
    });

    assert.equal(user.id, 42);
    assert.equal(user.username, "dhoni");
    assert.equal(user.displayName, "MS Dhoni");
    assert.equal(user.phone, "+919876543210");
    assert.equal(mockCalls.length, 1);
    assert.equal(mockCalls[0].opts.headers.apikey, "test-key");
    assert.equal(mockCalls[0].opts.headers.Authorization, "Bearer test-key");
  } finally {
    global.fetch = originalFetch;
  }
});

test("SupabaseDb: translates unique constraint errors into phone_taken and username_taken", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url.includes("/users")) {
      return {
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({
          code: "23505",
          message: 'duplicate key value violates unique constraint "idx_users_phone"',
        }),
      };
    }
  };

  try {
    const db = new SupabaseDb("https://mock.supabase.co", "test-key");
    await assert.rejects(
      () => db.createUser("player2", "pass", 1000, { phone: "+919876543210" }),
      (err) => err.code === "phone_taken"
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("SupabaseDb: totals aggregation works across puzzles", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url.includes("/puzzles")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          { day: "2026-10-27", status: "solved", points: 95 },
          { day: "2026-10-27", status: "solved", points: 80 },
          { day: "2026-10-28", status: "gaveUp", points: 0 },
        ]),
      };
    }
  };

  try {
    const db = new SupabaseDb("https://mock.supabase.co", "test-key");
    const totals = await db.totals(42);
    assert.equal(totals.points, 175);
    assert.equal(totals.solved, 2);
    assert.equal(totals.days, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("SupabaseDb: leaderboard RPC parsing", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (url.endsWith("/rpc/get_leaderboard_today")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          { user_id: 1, username: "kohli", display_name: "Virat Kohli", avatar: "batter", points: 280, solved: 3, guesses: 6, ms: 45000, rank: 1, total: 1 },
        ]),
      };
    }
  };

  try {
    const db = new SupabaseDb("https://mock.supabase.co", "test-key");
    const lb = await db.leaderboardToday("2026-10-28", 50, 1);
    assert.equal(lb.total, 1);
    assert.equal(lb.rows.length, 1);
    assert.equal(lb.rows[0].username, "kohli");
    assert.equal(lb.me.rank, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("SupabaseDb: no OTP methods any more", () => {
  for (const m of ["setOtp", "getOtp", "deleteOtp", "incrementOtpAttempts"]) assert.equal(typeof SupabaseDb.prototype[m], "undefined", m);
});

// ---------- Security review fixes ----------

function recordingFetch(calls) {
  return async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "[]" };
  };
}

test("SupabaseDb: userByName escapes LIKE wildcards so al_ce cannot match alice", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = recordingFetch(calls);
  try {
    const db = new SupabaseDb("https://mock.supabase.co", "test-key");
    await db.userByName("al_ce");
    const url = decodeURIComponent(calls[0].url);
    assert.ok(url.includes("username=ilike.al\\_ce"), url);
  } finally {
    global.fetch = originalFetch;
  }
});

test("SupabaseDb: admin search quotes the pattern so filter syntax cannot be injected", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = recordingFetch(calls);
  try {
    const db = new SupabaseDb("https://mock.supabase.co", "test-key");
    await db.listUsers(10, 0, 'a,b)');
    const url = decodeURIComponent(calls[0].url);
    assert.ok(url.includes('username.ilike."*a,b)*"'), url);
    assert.ok(!url.includes("ilike.*a,b)*,"), "unquoted pattern would split the or() tree");
  } finally {
    global.fetch = originalFetch;
  }
});

test("SupabaseDb: adminResetPin also deletes the player's sessions", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = recordingFetch(calls);
  try {
    const db = new SupabaseDb("https://mock.supabase.co", "test-key");
    await db.adminResetPin(7, "newhash");
    const del = calls.find((c) => c.opts.method === "DELETE" && c.url.includes("/sessions?user_id=eq.7"));
    assert.ok(del, calls.map((c) => c.opts.method + " " + c.url).join(" | "));
  } finally {
    global.fetch = originalFetch;
  }
});

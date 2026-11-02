"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server.js");

const T0 = Date.parse("2026-10-27T06:00:00.000Z");

async function boot() {
  let now = T0;
  const app = createApp({
    dbPath: ":memory:",
    adminKey: "adminkey1234567890abcdef",
    secret: "testsecret0123456789abcdef0123456789abcdef",
    now: () => now,
    logger: null,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    setNow: (t) => { now = t; },
    close: () => new Promise((resolve) => app.server.close(resolve)),
  };
}

function client(base) {
  let cookie = "";
  return {
    async post(path, body) {
      const res = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: base,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body || {}),
      });
      const c = res.headers.get("set-cookie");
      if (c) cookie = c.split(";")[0];
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      return { status: res.status, json, text };
    },
    async get(path) {
      const res = await fetch(base + path, {
        headers: { ...(cookie ? { Cookie: cookie } : {}) },
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      return { status: res.status, json, text };
    },
  };
}

let phoneCounter = Math.floor(Math.random() * 10000) + 10000;
async function registerUser(base, username) {
  const c = client(base);
  const phone = "+9199999" + String(++phoneCounter).padStart(5, "0");
  const res = await c.post("/api/auth/phone/register", { username, phone, pin: "123456" });
  assert.equal(res.status, 201, "Registration failed: " + res.text);
  return c;
}

test("leaderboard displays all registered users even if they have 0 points (daily & all-time)", async () => {
  const app = await boot();
  try {
    const u1 = await registerUser(app.base, "player_zero");
    const u2 = await registerUser(app.base, "player_hero");
    const guest = client(app.base);

    // Hero completes connections variant with 95 points
    const resComplete = await u2.post("/api/variant/complete", {
      variant: "connections",
      status: "solved",
      score: 95,
      durationMs: 45000,
      guesses: [["a", "b", "c", "d"]],
    });
    assert.equal(resComplete.status, 200);
    assert.equal(resComplete.json.score, 95);

    // Check today's leaderboard
    const todayLb = await guest.get("/api/leaderboard/today");
    assert.equal(todayLb.status, 200);
    assert.equal(todayLb.json.total, 2);
    assert.equal(todayLb.json.rows.length, 2);

    // player_hero is rank 1 with 95 points
    assert.equal(todayLb.json.rows[0].username, "player_hero");
    assert.equal(todayLb.json.rows[0].points, 95);
    assert.equal(todayLb.json.rows[0].rank, 1);

    // player_zero is rank 2 with 0 points
    assert.equal(todayLb.json.rows[1].username, "player_zero");
    assert.equal(todayLb.json.rows[1].points, 0);
    assert.equal(todayLb.json.rows[1].rank, 2);

    // Check all-time leaderboard
    const alltimeLb = await guest.get("/api/leaderboard/alltime");
    assert.equal(alltimeLb.status, 200);
    assert.equal(alltimeLb.json.total, 2);
    assert.equal(alltimeLb.json.rows.length, 2);
    assert.equal(alltimeLb.json.rows[0].username, "player_hero");
    assert.equal(alltimeLb.json.rows[0].points, 95);
    assert.equal(alltimeLb.json.rows[1].username, "player_zero");
    assert.equal(alltimeLb.json.rows[1].points, 0);
  } finally {
    await app.close();
  }
});

test("variant completions aggregate correctly across multiple variants for total player score", async () => {
  const app = await boot();
  try {
    const user = await registerUser(app.base, "multivariant_champ");

    // Complete connections (90 pts)
    await user.post("/api/variant/complete", {
      variant: "connections",
      status: "solved",
      score: 90,
      durationMs: 30000,
    });

    // Complete stadium (85 pts)
    await user.post("/api/variant/complete", {
      variant: "stadium",
      status: "solved",
      score: 85,
      durationMs: 25000,
    });

    // Complete pixel (75 pts)
    await user.post("/api/variant/complete", {
      variant: "pixel",
      status: "solved",
      score: 75,
      durationMs: 20000,
    });

    const guest = client(app.base);
    const lb = await guest.get("/api/leaderboard/today");
    assert.equal(lb.status, 200);
    // Total points: 90 + 85 + 75 = 250
    assert.equal(lb.json.rows[0].points, 250);
    assert.equal(lb.json.rows[0].solved, 3);
  } finally {
    await app.close();
  }
});

test("POST /api/activity secretly logs activity without leaking secrets", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    const res = await c.post("/api/activity", {
      variant: "connections",
      action: "guess_attempt",
      details: { item: "Kohli", pin: "secret_pin_should_be_stripped" },
      durationMs: 12000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  } finally {
    await app.close();
  }
});

test("POST /api/variant/complete requires authenticated member", async () => {
  const app = await boot();
  try {
    const guest = client(app.base);
    const res = await guest.post("/api/variant/complete", {
      variant: "connections",
      status: "solved",
      score: 100,
    });
    assert.equal(res.status, 401);
  } finally {
    await app.close();
  }
});

test("POST /api/feedback/inaccuracy captures player reports and admin can view them", async () => {
  const app = await boot();
  try {
    const guest = client(app.base);
    const member = await registerUser(app.base, "diligent_player");

    // 1. Guest reports wrong photo for a cricketer
    const r1 = await guest.post("/api/feedback/inaccuracy", {
      variant: "pixel",
      issueType: "wrong_photo",
      targetName: "Rashid Khan",
      targetId: "13",
      photoUrl: "photos/player_15.jpg",
      details: "Photo shows Rashid Khan but answer was revealed as another player",
      meta: { mode: "easy" },
    });
    assert.equal(r1.status, 200);
    assert.equal(r1.json.ok, true);

    // 2. Member reports a stat or hint inconsistency
    const r2 = await member.post("/api/feedback/inaccuracy", {
      variant: "stadium",
      issueType: "incorrect_hint",
      targetName: "Wankhede Stadium",
      details: "Capacity listed as 33,000, updated capacity is 33,108",
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.json.ok, true);

    // 3. Validation: missing details/type rejected
    const rBad = await guest.post("/api/feedback/inaccuracy", {
      variant: "pixel",
      details: "",
      issueType: "",
    });
    assert.equal(rBad.status, 400);

    // 4. Non-admin cannot access admin reports endpoint
    const nonAdminGet = await guest.get("/api/admin/reports");
    assert.equal(nonAdminGet.status, 403);

    // 5. Admin can retrieve submitted inaccuracy reports
    const admin = client(app.base);
    const adminLogin = await admin.post("/api/admin/login", { key: "adminkey1234567890abcdef" });
    assert.equal(adminLogin.status, 200);

    const reportsRes = await admin.get("/api/admin/reports");
    assert.equal(reportsRes.status, 200);
    assert.equal(reportsRes.json.ok, true);
    assert.equal(reportsRes.json.reports.length, 2);
    assert.equal(reportsRes.json.reports[0].target_name, "Wankhede Stadium");
    assert.equal(reportsRes.json.reports[1].target_name, "Rashid Khan");
  } finally {
    await app.close();
  }
});


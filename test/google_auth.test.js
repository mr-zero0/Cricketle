"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server.js");

const T0 = Date.parse("2026-10-27T06:00:00.000Z");

async function boot(opts = {}) {
  let now = T0;
  const app = createApp({
    dbPath: ":memory:",
    adminKey: "adminkey1234567890abcdef",
    secret: "testsecret0123456789abcdef0123456789abcdef",
    now: () => now,
    logger: null,
    ...opts,
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
      return { status: res.status, json, text, cookie };
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

test("Google Auth: registers new user with mock Google credential and creates session", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    // credential format: mock_google_:sub:email:name
    const res = await c.post("/api/auth/google", {
      credential: "mock_google_:1092837465:virat_fan@gmail.com:Virat Fan"
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.user.displayName, "Virat Fan");
    assert.equal(res.json.user.email, "virat_fan@gmail.com");
    assert.equal(res.json.user.googleConnected, true);
    assert.ok(res.cookie.includes("cricketle_sid="));

    // Verify session via /api/me
    const me = await c.get("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, "virat_fan@gmail.com");

    // Logging in again with the same Google ID should return the same user
    const res2 = await client(app.base).post("/api/auth/google", {
      credential: "mock_google_:1092837465:virat_fan@gmail.com:Virat Fan"
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.json.user.id, res.json.user.id);
  } finally {
    await app.close();
  }
});

test("Google Auth: rejects missing or invalid credential", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    const resEmpty = await c.post("/api/auth/google", {});
    assert.equal(resEmpty.status, 400);
    assert.equal(resEmpty.json.error, "missing_credential");

    const resBad = await c.post("/api/auth/google", { credential: "invalid_token_string" });
    assert.equal(resBad.status, 401);
  } finally {
    await app.close();
  }
});

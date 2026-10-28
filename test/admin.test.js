"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server.js");

const IST = 5.5 * 3600 * 1000;
const T0 = Date.UTC(2026, 9, 27) - IST + 9 * 3600 * 1000;

async function bootAdminApp(opts = {}) {
  let now = T0;
  const app = createApp({
    dbPath: ":memory:",
    now: () => now,
    rateLimit: false,
    log: false,
    secret: "",
    adminKey: "master_admin_secret_999",
    adminPhone: "+919876543210",
    ...opts,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const close = () => new Promise((resolve) => app.close(resolve));
  return { base, close };
}

function client(base) {
  const jar = new Map();
  async function call(method, path, body, extraHeaders) {
    const headers = Object.assign({}, extraHeaders || {});
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => k + "=" + v).join("; ");
    if (body !== undefined) {
      headers["content-type"] = headers["content-type"] || "application/json";
      if (!("origin" in headers)) headers.origin = base;
    }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [pair, ...attrs] = sc.split(";");
      const [k, v] = pair.split("=");
      const maxAge = attrs.map((a) => a.trim().toLowerCase()).find((a) => a.startsWith("max-age="));
      if (maxAge && Number(maxAge.slice(8)) <= 0) jar.delete(k.trim());
      else jar.set(k.trim(), v);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* not json */ }
    return { status: res.status, headers: res.headers, json, text };
  }
  return {
    get: (p, h) => call("GET", p, undefined, h),
    post: (p, b, h) => call("POST", p, b === undefined ? {} : b, h),
    jar,
  };
}

test("admin security: non-admin cannot access admin endpoints", async () => {
  const app = await bootAdminApp();
  try {
    const guest = client(app.base);
    const r = await guest.get("/api/admin/users");
    assert.equal(r.status, 403);
    assert.equal(r.json.error, "forbidden");

    // Regular registered user also rejected
    const user = client(app.base);
    await user.post("/api/auth/register", { username: "regular_user", password: "password123" });
    const r2 = await user.get("/api/admin/users");
    assert.equal(r2.status, 403);
  } finally {
    await app.close();
  }
});

test("admin login: unlocks access, lists users, and resets player PIN", async () => {
  const app = await bootAdminApp();
  try {
    // 1. Create a sample player with a PIN
    const playerClient = client(app.base);
    const regRes = await playerClient.post("/api/auth/phone/register", {
      phone: "+919999888877",
      pin: "111111",
      username: "kohli_fan",
    });
    assert.equal(regRes.status, 201);
    const playerId = regRes.json.user.id;

    // 2. Admin client logs in via /api/admin/login
    const admin = client(app.base);
    const badLogin = await admin.post("/api/admin/login", { key: "wrong_password" });
    assert.equal(badLogin.status, 401);

    const goodLogin = await admin.post("/api/admin/login", { key: "master_admin_secret_999" });
    assert.equal(goodLogin.status, 200);
    assert.equal(goodLogin.json.admin, true);

    // 3. Admin can view stats
    const stats = await admin.get("/api/admin/stats");
    assert.equal(stats.status, 200);
    assert.ok(stats.json.totalUsers >= 1);

    // 4. Admin lists users and searches
    const usersRes = await admin.get("/api/admin/users?search=kohli_fan");
    assert.equal(usersRes.status, 200);
    assert.equal(usersRes.json.users.length, 1);
    assert.equal(usersRes.json.users[0].phone, "+919999888877");

    // 5. Admin resets player's PIN to 999888
    const resetRes = await admin.post("/api/admin/user/reset-pin", {
      userId: playerId,
      newPin: "999888",
    });
    assert.equal(resetRes.status, 200);
    assert.ok(resetRes.json.message.includes("999888"));

    // 6. Verify player can sign in with the new PIN!
    const newLoginClient = client(app.base);
    const oldPinLogin = await newLoginClient.post("/api/auth/phone/login", {
      phone: "+919999888877",
      pin: "111111",
    });
    assert.equal(oldPinLogin.status, 401); // old pin fails

    const newPinLogin = await newLoginClient.post("/api/auth/phone/login", {
      phone: "+919999888877",
      pin: "999888",
    });
    assert.equal(newPinLogin.status, 200); // new pin succeeds!
    assert.equal(newPinLogin.json.user.username, "kohli_fan");
  } finally {
    await app.close();
  }
});

test("admin phone auto-detection: user with ADMIN_PHONE receives isAdmin: true in /api/me", async () => {
  const app = await bootAdminApp();
  try {
    const adminPlayer = client(app.base);
    const r = await adminPlayer.post("/api/auth/phone/register", {
      phone: "+919876543210", // matches adminPhone
      pin: "123456",
      username: "chief_admin",
    });
    assert.equal(r.status, 201);

    const me = await adminPlayer.get("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.user.isAdmin, true);

    // This player can directly access admin routes without separate admin login!
    const users = await adminPlayer.get("/api/admin/users");
    assert.equal(users.status, 200);
  } finally {
    await app.close();
  }
});

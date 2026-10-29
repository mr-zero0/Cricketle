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
    await user.post("/api/auth/phone/register", { username: "regular_user", phone: "+919876500010", pin: "123456" });
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

    // 5. Admin resets player's PIN to 999888 (exactly 6 digits)
    const shortPin = await admin.post("/api/admin/user/reset-pin", { userId: playerId, newPin: "1234" });
    assert.equal(shortPin.status, 400);
    assert.equal(shortPin.json.error, "invalid_pin");
    const resetRes = await admin.post("/api/admin/user/reset-pin", {
      userId: playerId,
      newPin: "999888",
    });
    assert.equal(resetRes.status, 200);
    assert.ok(resetRes.json.message.includes("999888"));

    // 6. Verify player can sign in with the new PIN!
    const newLoginClient = client(app.base);
    const oldPinLogin = await newLoginClient.post("/api/auth/login", {
      identifier: "+919999888877",
      pin: "111111",
    });
    assert.equal(oldPinLogin.status, 401); // old pin fails

    const newPinLogin = await newLoginClient.post("/api/auth/login", {
      identifier: "+919999888877",
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

test("admin access is disabled when no ADMIN_KEY is configured", async () => {
  const { base, close } = await bootAdminApp({ adminKey: "", adminPhone: "" });
  try {
    const c = client(base);
    // The old built-in default must not work.
    const login = await c.post("/api/admin/login", { key: "cricketle_admin_2026" });
    assert.equal(login.status, 401);
    const viaHeader = await c.get("/api/admin/users", { "x-admin-key": "cricketle_admin_2026" });
    assert.equal(viaHeader.status, 403);
    // An empty key must not match an empty header either.
    const viaEmpty = await c.get("/api/admin/users", { "x-admin-key": "" });
    assert.equal(viaEmpty.status, 403);
  } finally { await close(); }
});

// ---------- Security review fixes ----------

const { hashToken } = require("../lib/auth.js");

test("admin login issues a random revocable cookie; logout revokes it; Secure behind HTTPS", async () => {
  const app = await bootAdminApp({ trustProxy: true });
  try {
    const c = client(app.base);
    const login = await c.post("/api/admin/login", { key: "master_admin_secret_999" });
    assert.equal(login.status, 200, login.text);
    const cookie = c.jar.get("cricketle_admin");
    assert.ok(cookie && cookie.length >= 32, "cookie set");
    assert.notEqual(cookie, hashToken("master_admin_secret_999"), "cookie is not derived from the key");
    assert.equal((await c.get("/api/admin/stats")).status, 200);

    assert.equal((await c.post("/api/admin/logout", {})).status, 200);
    const stale = client(app.base);
    stale.jar.set("cricketle_admin", cookie);
    assert.equal((await stale.get("/api/admin/stats")).status, 403, "revoked cookie is useless");

    const https = client(app.base);
    const r = await https.post("/api/admin/login", { key: "master_admin_secret_999" }, { "x-forwarded-proto": "https" });
    const setCookie = r.headers.getSetCookie().find((x) => x.startsWith("cricketle_admin="));
    assert.match(setCookie, /; Secure/);
  } finally {
    await app.close();
  }
});

test("logout needs a same-origin JSON request like every other mutation", async () => {
  const app = await bootAdminApp();
  try {
    const r = await fetch(app.base + "/api/admin/logout", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
    assert.equal(r.status, 403);
  } finally {
    await app.close();
  }
});

test("the header-only admin is not a player: player routes answer 403, not 500", async () => {
  const app = await bootAdminApp();
  try {
    const c = client(app.base);
    const r = await c.post("/api/puzzle/start", { mode: "easy", idx: 0 }, { "x-admin-key": "master_admin_secret_999" });
    assert.equal(r.status, 403, r.text);
    const p = await c.post("/api/profile/update", { displayName: "x" }, { "x-admin-key": "master_admin_secret_999" });
    assert.equal(p.status, 403, p.text);
  } finally {
    await app.close();
  }
});

test("an admin PIN reset signs the player out of every session", async () => {
  const app = await bootAdminApp();
  try {
    const player = client(app.base);
    const reg = await player.post("/api/auth/phone/register", { username: "resetme", phone: "+919811100001", pin: "246810" });
    assert.equal(reg.status, 201, reg.text);
    assert.equal((await player.get("/api/me")).status, 200);

    const admin = client(app.base);
    assert.equal((await admin.post("/api/admin/login", { key: "master_admin_secret_999" })).status, 200);
    const r = await admin.post("/api/admin/user/reset-pin", { userId: reg.json.user.id, newPin: "135790" });
    assert.equal(r.status, 200, r.text);

    const me = await player.get("/api/me");
    assert.ok(me.status === 401 || (me.json && me.json.user === null), "old session is gone: " + me.text);
    const again = await client(app.base).post("/api/auth/login", { identifier: "resetme", pin: "135790" });
    assert.equal(again.status, 200, again.text);
  } finally {
    await app.close();
  }
});

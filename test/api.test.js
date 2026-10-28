"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../public/game-core.js");
const { createApp } = require("../server.js");

const IST = 5.5 * 3600 * 1000;
// 2026-10-27 09:00 IST.
const T0 = Date.UTC(2026, 9, 27) - IST + 9 * 3600 * 1000;

// Boots an app on an ephemeral port with an in-memory database and a fake clock.
async function boot() {
  let now = T0;
  // secret "" = the public seed, so the test can compute today's answers with the core.
  const app = createApp({ dbPath: ":memory:", now: () => now, rateLimit: false, log: false, secret: "" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const close = () => new Promise((resolve) => app.close(resolve));
  return { base, close, setNow: (t) => { now = t; }, getNow: () => now };
}

// Minimal cookie-jar client: one jar per "browser".
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

async function signUp(base, username, password) {
  const c = client(base);
  const r = await c.post("/api/auth/register", { username, password: password || "secret123" });
  assert.equal(r.status, 201, "register " + username + ": " + r.text);
  return c;
}

async function solve(c, mode, idx, day, extraGuesses) {
  const answer = core.answerFor(day, mode, idx).name;
  let r = await c.post("/api/puzzle/start", { mode, idx });
  assert.equal(r.status, 200, r.text);
  for (const g of extraGuesses || []) {
    r = await c.post("/api/puzzle/guess", { mode, idx, name: g });
    assert.equal(r.status, 200, r.text);
  }
  r = await c.post("/api/puzzle/guess", { mode, idx, name: answer });
  assert.equal(r.status, 200, r.text);
  return r.json;
}

test("health reports the IST game day and server time", async () => {
  const app = await boot();
  try {
    const r = await client(app.base).get("/api/health");
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.day, "2026-10-27");
    assert.equal(r.json.now, T0);
  } finally { await app.close(); }
});

test("serves the client and refuses path traversal", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    const home = await c.get("/");
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type"), /text\/html/);
    assert.match(home.text, /Cricketle/);
    const js = await c.get("/game-core.js");
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type"), /javascript/);
    const css = await c.get("/styles.css");
    assert.match(css.headers.get("content-type"), /text\/css/);
    const res = await fetch(app.base + "/..%2fpackage.json");
    assert.equal(res.status, 404);
    const missing = await c.get("/nope.txt");
    assert.equal(missing.status, 404);
  } finally { await app.close(); }
});

test("register creates an account, starts a session and /api/me returns it", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    const r = await c.post("/api/auth/register", { username: "aman_7", password: "secret123" });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.user.username, "aman_7");
    assert.ok(c.jar.has("cricketle_sid"));
    const me = await c.get("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.user.username, "aman_7");
    assert.equal(me.json.stats.allTimePoints, 0);
    assert.equal(me.json.stats.title, "Net Bowler");
  } finally { await app.close(); }
});

test("register validates input and rejects duplicate usernames case-insensitively", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    assert.equal((await c.post("/api/auth/register", { username: "ab", password: "secret123" })).json.error, "invalid_username");
    assert.equal((await c.post("/api/auth/register", { username: "bad name!", password: "secret123" })).json.error, "invalid_username");
    assert.equal((await c.post("/api/auth/register", { username: "goodname", password: "123" })).json.error, "invalid_password");
    assert.equal((await c.post("/api/auth/register", { username: "GoodName", password: "secret123" })).status, 201);
    const dup = await client(app.base).post("/api/auth/register", { username: "goodname", password: "secret123" });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error, "username_taken");
  } finally { await app.close(); }
});

test("login checks the password, logout ends the session", async () => {
  const app = await boot();
  try {
    await signUp(app.base, "rohit", "hitman45");
    const c = client(app.base);
    const bad = await c.post("/api/auth/login", { username: "rohit", password: "wrong" });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error, "bad_credentials");
    const ok = await c.post("/api/auth/login", { username: "Rohit", password: "hitman45" });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.username, "rohit");
    assert.equal((await c.get("/api/me")).json.user.username, "rohit");
    const out = await c.post("/api/auth/logout");
    assert.equal(out.status, 204);
    assert.equal((await c.get("/api/me")).json.user, null);
  } finally { await app.close(); }
});

test("state needs a session and starts fresh with the first puzzle ready", async () => {
  const app = await boot();
  try {
    assert.equal((await client(app.base).get("/api/state")).status, 401);
    const c = await signUp(app.base, "virat");
    const r = await c.get("/api/state");
    assert.equal(r.status, 200);
    assert.equal(r.json.day, "2026-10-27");
    assert.equal(r.json.now, T0);
    for (const mode of core.MODES) {
      assert.deepEqual(r.json.state.modes[mode].puzzles.map((p) => p.status), ["ready", "locked", "locked"]);
    }
  } finally { await app.close(); }
});

test("a signed-in player can start, guess, solve and unlock the next puzzle", async () => {
  const app = await boot();
  try {
    const c = await signUp(app.base, "sachin");
    const day = "2026-10-27";
    const answer = core.answerFor(day, "easy", 0).name;
    const other = core.poolFor("easy").find((p) => p.name !== answer).name;

    const start = await c.post("/api/puzzle/start", { mode: "easy", idx: 0 });
    assert.equal(start.status, 200, start.text);
    assert.equal(start.json.state.modes.easy.puzzles[0].status, "active");
    assert.equal(start.json.state.modes.easy.puzzles[0].startedAt, T0);

    app.setNow(T0 + 10 * 1000);
    const wrong = await c.post("/api/puzzle/guess", { mode: "easy", idx: 0, name: other });
    assert.equal(wrong.status, 200, wrong.text);
    assert.equal(wrong.json.solved, false);
    assert.ok(wrong.json.rank > 1);

    app.setNow(T0 + 25 * 1000);
    const right = await c.post("/api/puzzle/guess", { mode: "easy", idx: 0, name: answer });
    assert.equal(right.status, 200, right.text);
    assert.equal(right.json.solved, true);
    assert.equal(right.json.rank, 1);
    const p = right.json.state.modes.easy.puzzles[0];
    assert.equal(p.status, "solved");
    assert.equal(p.points, 96);
    assert.equal(p.finishedAt, T0 + 25 * 1000);
    assert.equal(right.json.state.modes.easy.puzzles[1].status, "ready");

    const again = await c.get("/api/state");
    assert.equal(again.json.state.modes.easy.puzzles[0].status, "solved");
    assert.deepEqual(again.json.state.modes.easy.puzzles[0].guesses.map((g) => g.name), [other, answer]);
    assert.equal(again.json.state.answers.easy[0].name, answer);
    assert.equal(again.json.state.answers.easy[1], null);
  } finally { await app.close(); }
});

test("the server enforces the rules: locked puzzles, unknown players, pools and replays", async () => {
  const app = await boot();
  try {
    const c = await signUp(app.base, "rahul");
    const day = "2026-10-27";
    assert.equal((await c.post("/api/puzzle/start", { mode: "easy", idx: 1 })).json.error, "locked");
    assert.equal((await c.post("/api/puzzle/start", { mode: "medium", idx: 0 })).status, 400);
    assert.equal((await c.post("/api/puzzle/guess", { mode: "easy", idx: 0, name: "Virat Kohli" })).json.error, "not_active");
    await c.post("/api/puzzle/start", { mode: "easy", idx: 0 });
    assert.equal((await c.post("/api/puzzle/guess", { mode: "easy", idx: 0, name: "Munaf Patel" })).json.error, "unknown_player");
    assert.equal((await c.post("/api/puzzle/guess", { mode: "easy", idx: 0, name: 12 })).status, 400);
    const answer = core.answerFor(day, "easy", 0).name;
    await c.post("/api/puzzle/guess", { mode: "easy", idx: 0, name: answer });
    const replay = await c.post("/api/puzzle/guess", { mode: "easy", idx: 0, name: answer });
    assert.equal(replay.status, 400);
    assert.equal(replay.json.error, "not_active");
    assert.equal((await c.post("/api/puzzle/start", { mode: "easy", idx: 0 })).json.error, "not_ready");
  } finally { await app.close(); }
});

test("hints come back in order, three at most, and cost points", async () => {
  const app = await boot();
  try {
    const c = await signUp(app.base, "jadeja");
    const day = "2026-10-27";
    const answer = core.answerFor(day, "hard", 0);
    assert.equal((await c.post("/api/puzzle/hint", { mode: "hard", idx: 0 })).json.error, "not_active");
    await c.post("/api/puzzle/start", { mode: "hard", idx: 0 });
    const h1 = await c.post("/api/puzzle/hint", { mode: "hard", idx: 0 });
    assert.equal(h1.status, 200, h1.text);
    assert.equal(h1.json.hint.label, "Nation");
    assert.match(h1.json.hint.text, new RegExp(core.byName(answer.name).country === "IND" ? "India" : "Represents"));
    assert.equal(h1.json.state.modes.hard.puzzles[0].hints, 1);
    const h2 = await c.post("/api/puzzle/hint", { mode: "hard", idx: 0 });
    assert.equal(h2.json.hint.label, "Role");
    const h3 = await c.post("/api/puzzle/hint", { mode: "hard", idx: 0 });
    assert.equal(h3.json.hint.label, "Era");
    assert.deepEqual(h3.json.state.hints.hard[0].map((h) => h.label), ["Nation", "Role", "Era"]);
    const h4 = await c.post("/api/puzzle/hint", { mode: "hard", idx: 0 });
    assert.equal(h4.status, 400);
    assert.equal(h4.json.error, "no_hints_left");
    const r = await c.post("/api/puzzle/guess", { mode: "hard", idx: 0, name: answer.name });
    assert.equal(r.json.state.modes.hard.puzzles[0].points, 105);
  } finally { await app.close(); }
});

test("giving up closes the puzzle with no points and unlocks the next", async () => {
  const app = await boot();
  try {
    const c = await signUp(app.base, "ashwin");
    assert.equal((await c.post("/api/puzzle/giveup", { mode: "easy", idx: 0 })).json.error, "not_active");
    await c.post("/api/puzzle/start", { mode: "easy", idx: 0 });
    const r = await c.post("/api/puzzle/giveup", { mode: "easy", idx: 0 });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.state.modes.easy.puzzles[0].status, "gaveUp");
    assert.equal(r.json.state.modes.easy.puzzles[0].points, 0);
    assert.equal(r.json.state.modes.easy.puzzles[1].status, "ready");
    assert.equal(r.json.answer.name, core.answerFor("2026-10-27", "easy", 0).name);
  } finally { await app.close(); }
});

test("progress follows the account across sessions and devices", async () => {
  const app = await boot();
  try {
    const c = await signUp(app.base, "dhoni", "helicopter7");
    await solve(c, "easy", 0, "2026-10-27");
    const other = client(app.base);
    await other.post("/api/auth/login", { username: "dhoni", password: "helicopter7" });
    const r = await other.get("/api/state");
    assert.equal(r.json.state.modes.easy.puzzles[0].status, "solved");
  } finally { await app.close(); }
});

test("today's leaderboard ranks players by points then time, and shows the viewer's row", async () => {
  const app = await boot();
  try {
    const day = "2026-10-27";
    const a = await signUp(app.base, "alpha");
    const b = await signUp(app.base, "bravo");
    const g = client(app.base);

    app.setNow(T0);
    await solve(a, "easy", 0, day);                       // 100 pts, 0 s
    app.setNow(T0 + 60 * 1000);
    const bAnswer = core.answerFor(day, "easy", 0).name;
    const wrongs = core.poolFor("easy").filter((p) => p.name !== bAnswer).slice(0, 2).map((p) => p.name);
    await solve(b, "easy", 0, day, wrongs);               // 94 pts, 0 s (3 guesses)
    app.setNow(T0 + 120 * 1000);
    await solve(b, "easy", 1, day);                       // +100

    const lb = await g.get("/api/leaderboard/today");
    assert.equal(lb.status, 200);
    assert.equal(lb.json.day, day);
    assert.equal(lb.json.total, 2);
    assert.deepEqual(lb.json.rows.map((r) => [r.rank, r.username, r.points, r.solved]), [[1, "bravo", 194, 2], [2, "alpha", 100, 1]]);
    assert.equal(lb.json.rows[1].guesses, 1);
    assert.equal(lb.json.me, null);

    const mine = await a.get("/api/leaderboard/today");
    assert.equal(mine.json.me.rank, 2);
    assert.equal(mine.json.me.username, "alpha");

    const me = await a.get("/api/me");
    assert.equal(me.json.stats.todayPoints, 100);
    assert.equal(me.json.stats.todayRank, 2);
  } finally { await app.close(); }
});

test("the all-time leaderboard accumulates across days and tracks streaks", async () => {
  const app = await boot();
  try {
    const a = await signUp(app.base, "legend");
    const b = await signUp(app.base, "rookie");
    await solve(a, "easy", 0, "2026-10-27");
    await solve(b, "easy", 0, "2026-10-27");

    app.setNow(T0 + core.DAY_MS);                           // 2026-10-28
    const fresh = await a.get("/api/state");
    assert.equal(fresh.json.day, "2026-10-28");
    assert.equal(fresh.json.state.modes.easy.puzzles[0].status, "ready");
    await solve(a, "easy", 0, "2026-10-28");
    await solve(a, "hard", 0, "2026-10-28");

    const lb = await client(app.base).get("/api/leaderboard/alltime");
    assert.equal(lb.status, 200);
    assert.deepEqual(lb.json.rows.map((r) => [r.rank, r.username, r.points, r.solved, r.days]), [[1, "legend", 350, 3, 2], [2, "rookie", 100, 1, 1]]);

    const me = await a.get("/api/me");
    assert.equal(me.json.stats.allTimePoints, 350);
    assert.equal(me.json.stats.allTimeRank, 1);
    assert.equal(me.json.stats.currentStreak, 2);
    assert.equal(me.json.stats.bestStreak, 2);
    assert.equal(me.json.stats.daysPlayed, 2);
    assert.equal(me.json.stats.title, "Club Pro");

    app.setNow(T0 + 3 * core.DAY_MS);                       // skipped a day: streak broken
    const later = await a.get("/api/me");
    assert.equal(later.json.stats.currentStreak, 0);
    assert.equal(later.json.stats.bestStreak, 2);
  } finally { await app.close(); }
});

test("POST requests must be JSON from the same origin", async () => {
  const app = await boot();
  try {
    const c = await signUp(app.base, "secure");
    const form = await fetch(app.base + "/api/puzzle/start", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: "cricketle_sid=" + c.jar.get("cricketle_sid"), origin: app.base },
      body: "mode=easy&idx=0",
    });
    assert.equal(form.status, 415);
    const cross = await c.post("/api/puzzle/start", { mode: "easy", idx: 0 }, { origin: "https://evil.example" });
    assert.equal(cross.status, 403);
    const broken = await fetch(app.base + "/api/puzzle/start", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "cricketle_sid=" + c.jar.get("cricketle_sid"), origin: app.base },
      body: "{not json",
    });
    assert.equal(broken.status, 400);
    assert.equal((await c.get("/api/nothing")).status, 404);
  } finally { await app.close(); }
});

test("google sign-in creates an account and sets up profile", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    // Sign in with Google payload
    const r1 = await c.post("/api/auth/google", {
      sub: "google-123456",
      email: "aman@example.com",
      name: "Mohd Aman",
      picture: "https://lh3.googleusercontent.com/a/photo.jpg",
    });
    assert.equal(r1.status, 200, r1.text);
    assert.equal(r1.json.user.displayName, "Mohd Aman");
    assert.equal(r1.json.user.email, "aman@example.com");
    assert.equal(r1.json.user.googleConnected, true);

    // Verify /api/me returns user details
    const me = await c.get("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.user.displayName, "Mohd Aman");
    assert.equal(me.json.user.googleConnected, true);
    assert(Array.isArray(me.json.stats.achievements));

    // Logging in again with same Google sub returns the same user
    const c2 = client(app.base);
    const r2 = await c2.post("/api/auth/google", {
      sub: "google-123456",
      email: "aman@example.com",
      name: "Mohd Aman",
    });
    assert.equal(r2.status, 200);
    assert.equal(r2.json.user.id, r1.json.user.id);
  } finally { await app.close(); }
});

test("profile updates change display name, avatar, bio and favorite team", async () => {
  const app = await boot();
  try {
    const c = await signUp(app.base, "cricketer_pro");
    const updateRes = await c.post("/api/profile/update", {
      displayName: "Virat Fan 18",
      bio: "Chase master devotee. Cover drive enthusiast.",
      avatar: "captain",
      favTeam: "Royal Challengers Bengaluru",
      favPlayer: "Virat Kohli",
    });
    assert.equal(updateRes.status, 200, updateRes.text);
    assert.equal(updateRes.json.user.displayName, "Virat Fan 18");
    assert.equal(updateRes.json.user.avatar, "captain");
    assert.equal(updateRes.json.user.favTeam, "Royal Challengers Bengaluru");
    assert.equal(updateRes.json.user.favPlayer, "Virat Kohli");

    const me = await c.get("/api/me");
    assert.equal(me.json.user.displayName, "Virat Fan 18");
    assert.equal(me.json.user.bio, "Chase master devotee. Cover drive enthusiast.");

    // Verify streak and achievements in stats
    assert(me.json.stats.streak.week.length === 7);
    const firstBall = me.json.stats.achievements.find((a) => a.id === "first_ball");
    assert(firstBall);
    assert.equal(firstBall.unlocked, false);

    // Solve a puzzle and verify First Ball achievement unlocks!
    await solve(c, "easy", 0, "2026-10-27");
    const meAfter = await c.get("/api/me");
    const firstBallAfter = meAfter.json.stats.achievements.find((a) => a.id === "first_ball");
    assert.equal(firstBallAfter.unlocked, true);
  } finally { await app.close(); }
});

test("mobile OTP login sends code, verifies, and logs in player", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    // Request OTP for phone
    const sendRes = await c.post("/api/auth/otp/send", { phone: "+919876543210" });
    assert.equal(sendRes.status, 200, sendRes.text);
    assert.equal(sendRes.json.ok, true);
    assert.ok(sendRes.json.devOtp);
    assert.equal(sendRes.json.devOtp.length, 6);

    // Verify with invalid OTP fails
    const badVerify = await c.post("/api/auth/otp/verify", {
      phone: "+919876543210",
      code: "000000",
    });
    assert.equal(badVerify.status, 400);

    // Verify with correct OTP succeeds
    const goodVerify = await c.post("/api/auth/otp/verify", {
      phone: "+919876543210",
      code: sendRes.json.devOtp,
      displayName: "Dhoni Fan",
    });
    assert.equal(goodVerify.status, 200, goodVerify.text);
    assert.equal(goodVerify.json.user.displayName, "Dhoni Fan");
    assert.equal(goodVerify.json.user.phone, "+919876543210");
    assert.equal(goodVerify.json.user.phoneConnected, true);

    // Check /api/me has session
    const me = await c.get("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.user.displayName, "Dhoni Fan");
    assert.equal(me.json.user.phone, "+919876543210");
  } finally { await app.close(); }
});

test("mobile OTP rejects invalid phone formats and expired codes", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    const badPhone = await c.post("/api/auth/otp/send", { phone: "123" });
    assert.equal(badPhone.status, 400);

    const sendRes = await c.post("/api/auth/otp/send", { phone: "+919999988888" });
    assert.equal(sendRes.status, 200);

    // Fast-forward past 5 minutes (301 seconds)
    app.setNow(app.getNow() + 301 * 1000);

    const expiredVerify = await c.post("/api/auth/otp/verify", {
      phone: "+919999988888",
      code: sendRes.json.devOtp,
    });
    assert.equal(expiredVerify.status, 400);
    assert.equal(expiredVerify.json.error, "otp_expired");
  } finally { await app.close(); }
});

test("mobile OTP uses OTP.dev configuration when otpDevKey is provided", async () => {
  let now = T0;
  const app = createApp({
    dbPath: ":memory:",
    now: () => now,
    rateLimit: false,
    log: false,
    secret: "",
    otpDevKey: "test_key_mock",
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  try {
    const c = client(base);
    const res = await c.post("/api/auth/otp/send", { phone: "+919876543210" });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.channel, "sms");
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});

test("GET /api/config/firebase returns enabled status and public configuration", async () => {
  const app = createApp({
    dbPath: ":memory:",
    rateLimit: false,
    log: false,
    firebaseApiKey: "AIzaSyFakeKey123",
    firebaseProjectId: "cricketle-app",
    firebaseAuthDomain: "cricketle-app.firebaseapp.com",
    firebaseAppId: "1:123:web:abc",
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  try {
    const c = client(base);
    const res = await c.get("/api/config/firebase");
    assert.equal(res.status, 200);
    assert.equal(res.json.enabled, true);
    assert.equal(res.json.config.apiKey, "AIzaSyFakeKey123");
    assert.equal(res.json.config.projectId, "cricketle-app");
    assert.equal(res.json.config.authDomain, "cricketle-app.firebaseapp.com");
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});

test("POST /api/auth/firebase-phone logs in or creates player and establishes session cookie", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    const res = await c.post("/api/auth/firebase-phone", {
      phone: "+919876543210",
      displayName: "Virat Century",
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.user.phone, "+919876543210");
    assert.equal(res.json.user.displayName, "Virat Century");
    assert.equal(res.json.user.phoneConnected, true);

    // Verify session was set and me endpoint recognizes player
    const me = await c.get("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.user.phone, "+919876543210");
    assert.equal(me.json.user.displayName, "Virat Century");

    // Invalid phone rejection
    const bad = await c.post("/api/auth/firebase-phone", { phone: "123" });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, "invalid_phone");
  } finally {
    await app.close();
  }
});





"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../public/game-core.js");
const { createApp } = require("../server.js");

const IST = 5.5 * 3600 * 1000;
// 2026-10-27 09:00 IST.
const T0 = Date.UTC(2026, 9, 27) - IST + 9 * 3600 * 1000;

// Boots an app on an ephemeral port with an in-memory database and a fake clock.
async function boot(extra = {}) {
  let now = T0;
  // secret "" = the public seed, so the test can compute today's answers with the core.
  const app = createApp({ dbPath: ":memory:", now: () => now, rateLimit: false, log: false, secret: "", ...extra });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const close = () => new Promise((resolve) => app.close(resolve));
  return { base, close, db: app.db, setNow: (t) => { now = t; }, getNow: () => now };
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

// Accounts are username + phone + 6-digit PIN. Each sign-up gets a fresh phone.
let phoneSeq = 0;
const nextPhone = () => "+9198000" + String(++phoneSeq).padStart(5, "0");
const PIN = "246810";

async function signUp(base, username, pin) {
  const c = client(base);
  const r = await c.post("/api/auth/phone/register", { username, phone: nextPhone(), pin: pin || PIN });
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
    const r = await c.post("/api/auth/phone/register", { username: "aman_7", phone: "+919876500001", pin: "123456" });
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

test("register validates input: username, exactly 6-digit PIN, E.164 phone, unique username", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    const reg = (body) => c.post("/api/auth/phone/register", Object.assign({ phone: nextPhone(), pin: "123456" }, body));
    assert.equal((await reg({ username: "ab" })).json.error, "invalid_username");
    assert.equal((await reg({ username: "bad name!" })).json.error, "invalid_username");
    assert.equal((await reg({ username: "goodname", pin: "12345" })).json.error, "invalid_pin", "5 digits rejected");
    assert.equal((await reg({ username: "goodname", pin: "1234567" })).json.error, "invalid_pin", "7 digits rejected");
    assert.equal((await reg({ username: "goodname", pin: "12a456" })).json.error, "invalid_pin");
    assert.equal((await reg({ username: "goodname", phone: "9876543210" })).json.error, "invalid_phone", "country code required");
    assert.equal((await reg({ username: "GoodName" })).status, 201);
    const dup = await client(app.base).post("/api/auth/phone/register", { username: "goodname", phone: nextPhone(), pin: "123456" });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error, "username_taken");
  } finally { await app.close(); }
});

test("login checks the PIN, logout ends the session", async () => {
  const app = await boot();
  try {
    await signUp(app.base, "rohit", "456789");
    const c = client(app.base);
    const bad = await c.post("/api/auth/login", { identifier: "rohit", pin: "000000" });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error, "bad_credentials");
    const ok = await c.post("/api/auth/login", { identifier: "Rohit", pin: "456789" });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.username, "rohit");
    assert.equal(ok.json.user.pinNeedsUpdate, false);
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
    const c = await signUp(app.base, "dhoni");
    await solve(c, "easy", 0, "2026-10-27");
    const other = client(app.base);
    await other.post("/api/auth/login", { identifier: "dhoni", pin: PIN });
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

test("mobile phone and 6-digit PIN authentication (Option A)", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    const testPhone = "+919876543210";

    // 2. Register new player with custom username and 6-digit PIN
    const regRes = await c.post("/api/auth/phone/register", {
      phone: testPhone,
      username: "cricket_champ",
      pin: "875542",
    });
    assert.equal(regRes.status, 201, regRes.text);
    assert.equal(regRes.json.ok, true);
    assert.equal(regRes.json.user.phone, testPhone);
    assert.equal(regRes.json.user.username, "cricket_champ");
    assert.equal(regRes.json.user.phoneConnected, true);

    // 3. Verify session works with /api/me and returns custom username
    const me1 = await c.get("/api/me");
    assert.equal(me1.status, 200);
    assert.equal(me1.json.user.phone, testPhone);
    assert.equal(me1.json.user.username, "cricket_champ");

    // 4. Duplicate phone re-creation rejected
    const dupPhone = await c.post("/api/auth/phone/register", {
      phone: testPhone,
      username: "another_user",
      pin: "875542",
    });
    assert.equal(dupPhone.status, 409);
    assert.equal(dupPhone.json.error, "phone_exists");

    // 5. Duplicate username rejection (exact and case-insensitive)
    const dupUser = await c.post("/api/auth/phone/register", {
      phone: "+919876543299",
      username: "cricket_champ",
      pin: "123456",
    });
    assert.equal(dupUser.status, 409);
    assert.equal(dupUser.json.error, "username_taken");

    const dupUserCase = await c.post("/api/auth/phone/register", {
      phone: "+919876543298",
      username: "Cricket_Champ",
      pin: "123456",
    });
    assert.equal(dupUserCase.status, 409);
    assert.equal(dupUserCase.json.error, "username_taken");

    // 7. Login in a separate client: bad PIN fails
    const c2 = client(app.base);
    const badLogin = await c2.post("/api/auth/login", {
      identifier: testPhone,
      pin: "000000",
    });
    assert.equal(badLogin.status, 401);
    assert.equal(badLogin.json.error, "bad_credentials");

    // 8. Login with correct PIN succeeds
    const goodLogin = await c2.post("/api/auth/login", {
      identifier: testPhone,
      pin: "875542",
    });
    assert.equal(goodLogin.status, 200, goodLogin.text);
    assert.equal(goodLogin.json.user.phone, testPhone);
    assert.equal(goodLogin.json.user.username, "cricket_champ");

    // 11. Direct Username + PIN sign-in via POST /api/auth/login
    const c4 = client(app.base);
    const badPinAuth = await c4.post("/api/auth/login", {
      username: "cricket_champ",
      pin: "999999",
    });
    assert.equal(badPinAuth.status, 401);
    assert.equal(badPinAuth.json.error, "bad_credentials");

    const nonExistentAuth = await c4.post("/api/auth/login", {
      username: "ghost_player",
      pin: "875542",
    });
    assert.equal(nonExistentAuth.status, 401);

    const goodUserPinAuth = await c4.post("/api/auth/login", {
      username: "Cricket_Champ", // verifies case-insensitive match
      pin: "875542",
    });
    assert.equal(goodUserPinAuth.status, 200);
    assert.equal(goodUserPinAuth.json.ok, true);
    assert.equal(goodUserPinAuth.json.user.username, "cricket_champ");

    const meUserPin = await c4.get("/api/me");
    assert.equal(meUserPin.status, 200);
    assert.equal(meUserPin.json.user.username, "cricket_champ");

    // 11b. Mobile phone + PIN sign-in via POST /api/auth/login (E.164 only; bare 10 digits rejected)
    const cPhone1 = client(app.base);
    const phone10Auth = await cPhone1.post("/api/auth/login", {
      username: "9876543210",
      pin: "875542",
    });
    assert.equal(phone10Auth.status, 401, "bare 10-digit numbers are not guessed as +91 any more");

    const cPhone2 = client(app.base);
    const phoneFullAuth = await cPhone2.post("/api/auth/login", {
      username: "+919876543210",
      pin: "875542",
    });
    assert.equal(phoneFullAuth.status, 200, "Full +91 phone login should succeed");
    assert.equal(phoneFullAuth.json.user.username, "cricket_champ");

    const cPhone3 = client(app.base);
    const phoneSpacedAuth = await cPhone3.post("/api/auth/login", {
      username: "+91 9876 543 210",
      pin: "875542",
    });
    assert.equal(phoneSpacedAuth.status, 200, "Spaced international phone login should succeed");
    assert.equal(phoneSpacedAuth.json.user.username, "cricket_champ");

    // 12. Custom username appears on leaderboard when solving
    await solve(c, "easy", 0, "2026-10-27");
    const board = await c.get("/api/leaderboard/today");
    assert.equal(board.status, 200);
    const row = board.json.rows.find((r) => r.username === "cricket_champ");
    assert.ok(row, "custom username should appear on leaderboard");
    assert.equal(row.username, "cricket_champ");
  } finally {
    await app.close();
  }
});

test("unverified sign-in endpoints no longer exist", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    const gone = [
      ["POST", "/api/auth/google", { sub: "google-1", email: "x@example.com" }],
      ["POST", "/api/auth/otp/send", { phone: "+919876543210" }],
      ["POST", "/api/auth/otp/verify", { phone: "+919876543210", code: "000000" }],
      ["POST", "/api/auth/firebase-phone", { phone: "+919876543210" }],
      ["GET", "/api/config/firebase"],
      ["POST", "/api/auth/phone/check", { phone: "+919876543210" }],
      ["POST", "/api/auth/phone/reset", { phone: "+919876543210", newPin: "112233" }],
    ];
    for (const [method, path, body] of gone) {
      const r = method === "GET" ? await c.get(path) : await c.post(path, body);
      assert.equal(r.status, 404, method + " " + path + " should be gone");
      assert.equal(r.json.error, "not_found");
    }
    // Nobody got a session out of it.
    const me = await c.get("/api/me");
    assert.equal(me.json.user, null);
  } finally { await app.close(); }
});

test("login flags accounts whose stored PIN is not 6 digits", async () => {
  const app = await boot();
  try {
    const auth = require("../lib/auth.js");
    app.db.createUser("legacy4", auth.hashPassword("1234"), app.getNow(), { phone: "+919876500003" });
    const c = client(app.base);
    const r = await c.post("/api/auth/login", { identifier: "legacy4", pin: "1234" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.user.pinNeedsUpdate, true);
    const me = await c.get("/api/me");
    assert.equal(me.json.user.pinNeedsUpdate, true);
  } finally { await app.close(); }
});

test("ten wrong PINs lock the identifier for fifteen minutes", async () => {
  const app = await boot();
  try {
    await signUp(app.base, "locked_out", "135790");
    const c = client(app.base);
    for (let i = 0; i < 10; i++) {
      const r = await c.post("/api/auth/login", { identifier: "locked_out", pin: "000000" });
      assert.equal(r.status, 401, "attempt " + (i + 1));
    }
    const locked = await c.post("/api/auth/login", { identifier: "locked_out", pin: "135790" });
    assert.equal(locked.status, 429, "11th attempt is locked even with the right PIN");
    assert.equal(locked.json.error, "pin_locked");
    app.setNow(app.getNow() + 15 * 60 * 1000 + 1);
    const ok = await c.post("/api/auth/login", { identifier: "locked_out", pin: "135790" });
    assert.equal(ok.status, 200, ok.text);
  } finally { await app.close(); }
});

test("sign-up is limited to five per IP per hour", async () => {
  let now = T0;
  const app = createApp({ dbPath: ":memory:", now: () => now, log: false, secret: "" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  try {
    const c = client(base);
    for (let i = 0; i < 5; i++) {
      const r = await c.post("/api/auth/phone/register", { username: "burst_" + i, phone: nextPhone(), pin: "123456" });
      assert.equal(r.status, 201, r.text);
    }
    const sixth = await c.post("/api/auth/phone/register", { username: "burst_5", phone: nextPhone(), pin: "123456" });
    assert.equal(sixth.status, 429);
  } finally { await new Promise((resolve) => app.close(resolve)); }
});

test("the username-only register route and the phone-login route are gone", async () => {
  const app = await boot();
  try {
    const c = client(app.base);
    assert.equal((await c.post("/api/auth/register", { username: "x_y_z", password: "secret123" })).status, 404);
    assert.equal((await c.post("/api/auth/phone/login", { phone: "+919876500001", pin: "123456" })).status, 404);
  } finally { await app.close(); }
});

// A logger that records every call, for asserting what the server logs.
function recordingLogger() {
  const calls = [];
  const rec = (level) => (tag, message, meta) => calls.push({ level, tag, message, meta });
  return {
    calls,
    info: rec("info"), warn: rec("warn"), error: rec("error"), debug: rec("debug"),
    db: (op, message, meta) => calls.push({ level: "info", tag: "DB", action: op, message, meta }),
    dbWarn: (op, message, meta) => calls.push({ level: "warn", tag: "DB", action: op, message, meta }),
    auth: (action, message, meta) => calls.push({ level: "info", tag: "AUTH", action, message, meta }),
    authWarn: (action, message, meta) => calls.push({ level: "warn", tag: "AUTH", action, message, meta }),
    game: (action, message, meta) => calls.push({ level: "info", tag: "GAME", action, message, meta }),
    http: (method, path, status, latencyMs, meta) => calls.push({ level: "info", tag: "HTTP", message: method + " " + path + " " + status, meta }),
    child() { return this; },
  };
}

test("every response carries a request id that also appears in error bodies and logs", async () => {
  let now = T0;
  const logger = recordingLogger();
  const app = createApp({ dbPath: ":memory:", now: () => now, rateLimit: false, logger, secret: "" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  try {
    const c = client(base);
    const ok = await c.get("/api/health");
    const id = ok.headers.get("x-request-id");
    assert.match(id, /^[0-9a-f]{16}$/);

    const missing = await c.get("/api/nothing");
    const id2 = missing.headers.get("x-request-id");
    assert.match(id2, /^[0-9a-f]{16}$/);
    assert.notEqual(id2, id);
    assert.equal(missing.json.requestId, id2);

    const httpLogs = logger.calls.filter((x) => x.tag === "HTTP");
    assert.ok(httpLogs.length >= 2);
    assert.ok(httpLogs.every((x) => x.meta && /^[0-9a-f]{16}$/.test(x.meta.requestId)), "HTTP logs carry requestId");
    assert.ok(httpLogs.some((x) => x.meta.requestId === id2));
  } finally { await new Promise((resolve) => app.close(resolve)); }
});

test("HSTS is sent only when the request arrived over https", async () => {
  const app = await boot({ trustProxy: true });
  try {
    const c = client(app.base);
    const plain = await c.get("/api/health");
    assert.equal(plain.headers.get("strict-transport-security"), null);
    const secure = await c.get("/api/health", { "x-forwarded-proto": "https" });
    assert.equal(secure.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
    const page = await c.get("/", { "x-forwarded-proto": "https" });
    assert.equal(page.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains", "static files too");
  } finally { await app.close(); }
});

test("guess text is logged at debug level only", async () => {
  let now = T0;
  const logger = recordingLogger();
  const app = createApp({ dbPath: ":memory:", now: () => now, rateLimit: false, logger, secret: "" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  try {
    const c = await signUp(base, "quiet_logs");
    await c.post("/api/puzzle/start", { mode: "easy", idx: 0 });
    const wrong = core.poolFor("easy").find((p) => p.name !== core.answerFor("2026-10-27", "easy", 0).name).name;
    const r = await c.post("/api/puzzle/guess", { mode: "easy", idx: 0, name: wrong });
    assert.equal(r.status, 200, r.text);
    const leaks = logger.calls.filter((x) => x.level !== "debug" && JSON.stringify([x.message, x.meta]).includes(wrong));
    assert.deepEqual(leaks, [], "no info/warn log contains the guessed name");
    assert.ok(logger.calls.some((x) => x.level === "debug" && JSON.stringify([x.message, x.meta]).includes(wrong)), "debug log has it");
  } finally { await new Promise((resolve) => app.close(resolve)); }
});

test("the SQLite database has no OTP table or OTP methods any more", async () => {
  const { Db } = require("../lib/db.js");
  const db = new Db(":memory:");
  try {
    const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    assert.ok(!tables.includes("otp_codes"), "otp_codes table gone");
    for (const m of ["setOtp", "getOtp", "deleteOtp", "incrementOtpAttempts"]) assert.equal(typeof db[m], "undefined", m);
  } finally { db.close(); }
});

test("a stored legacy avatar id is presented as its cricket replacement everywhere", async () => {
  const app = await boot();
  try {
    const day = "2026-10-27";
    const c = await signUp(app.base, "simba");
    const me0 = await c.get("/api/me");
    assert.equal(me0.status, 200);
    app.db.updateProfile(me0.json.user.id, { avatar: "lion" });

    app.setNow(T0);
    await solve(c, "easy", 0, day);

    const me = await c.get("/api/me");
    assert.equal(me.json.user.avatar, "captain");
    const today = await c.get("/api/leaderboard/today");
    assert.equal(today.json.rows.find((r) => r.username === "simba").avatar, "captain");
    assert.equal(today.json.me.avatar, "captain");
    const alltime = await c.get("/api/leaderboard/alltime");
    assert.equal(alltime.json.rows.find((r) => r.username === "simba").avatar, "captain");
  } finally {
    await app.close();
  }
});

test("HTML responses carry a CSP with script-src 'self' and no 'unsafe-inline' for scripts", async () => {
  const app = await boot();
  try {
    for (const path of ["/", "/admin"]) {
      const r = await client(app.base).get(path);
      assert.equal(r.status, 200, path);
      const csp = r.headers.get("content-security-policy") || "";
      const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
      assert.equal(script, "script-src 'self'", path + ": " + csp);
      assert.match(csp, /frame-ancestors 'none'/);
    }
  } finally {
    await app.close();
  }
});

test("static text assets are gzipped on request and versioned ones cache immutably", async () => {
  const app = await boot();
  try {
    // Node's fetch asks for gzip by default; identity gets the raw file.
    const plain = await client(app.base).get("/app.js", { "accept-encoding": "identity" });
    assert.equal(plain.status, 200);
    assert.equal(plain.headers.get("content-encoding"), null);
    assert.ok(Number(plain.headers.get("content-length")) > 1024);
    assert.equal(plain.headers.get("cache-control"), "no-cache");

    const gz = await fetch(app.base + "/app.js?v=test", { headers: { "accept-encoding": "gzip" } });
    assert.equal(gz.status, 200);
    assert.equal(gz.headers.get("content-encoding"), "gzip");
    assert.equal(gz.headers.get("vary"), "accept-encoding");
    assert.equal(gz.headers.get("cache-control"), "public, max-age=31536000, immutable");
    const body = await gz.text(); // fetch decodes gzip transparently
    assert.match(body, /CricketleLog|use strict/);

    const png = await fetch(app.base + "/favicon-32.png", { headers: { "accept-encoding": "gzip" } });
    assert.equal(png.headers.get("content-encoding"), null, "binary assets are not re-compressed");
  } finally {
    await app.close();
  }
});

// ---------- Security review fixes ----------

async function bootLimited(extra = {}) {
  let now = T0;
  const app = createApp({ dbPath: ":memory:", now: () => now, log: false, secret: "", ...extra });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  return { base, close: () => new Promise((resolve) => app.close(resolve)), setNow: (t) => { now = t; } };
}

test("X-Forwarded-For cannot defeat the sign-up throttle unless the proxy is trusted", async () => {
  const app = await bootLimited();
  try {
    for (let i = 1; i <= 5; i++) {
      const r = await client(app.base).post("/api/auth/phone/register", { username: "xff" + i, phone: nextPhone(), pin: PIN }, { "x-forwarded-for": "198.51.100." + i });
      assert.equal(r.status, 201, r.text);
    }
    const sixth = await client(app.base).post("/api/auth/phone/register", { username: "xff6", phone: nextPhone(), pin: PIN }, { "x-forwarded-for": "198.51.100.99" });
    assert.equal(sixth.status, 429, "a spoofed header is not a new client");
  } finally {
    await app.close();
  }

  // Behind a trusted proxy the client is the address the proxy appended (last hop).
  const proxied = await bootLimited({ trustProxy: true });
  try {
    for (let i = 1; i <= 5; i++) {
      const r = await client(proxied.base).post("/api/auth/phone/register", { username: "pxy" + i, phone: nextPhone(), pin: PIN }, { "x-forwarded-for": "198.51.100." + i + ", 203.0.113.9" });
      assert.equal(r.status, 201, r.text);
    }
    const same = await client(proxied.base).post("/api/auth/phone/register", { username: "pxy6", phone: nextPhone(), pin: PIN }, { "x-forwarded-for": "198.51.100.77, 203.0.113.9" });
    assert.equal(same.status, 429, "rotating the attacker-controlled first entry changes nothing");
    const other = await client(proxied.base).post("/api/auth/phone/register", { username: "pxy7", phone: nextPhone(), pin: PIN }, { "x-forwarded-for": "203.0.113.10" });
    assert.equal(other.status, 201, "a different real client is not throttled");
  } finally {
    await proxied.close();
  }
});

test("the PIN lock keys on the account and survives a flood of unknown identifiers", async () => {
  // Small cap so the prune path runs without thousands of scrypt calls.
  const app = await boot({ maxTrackedKeys: 20 });
  try {
    const phone = nextPhone();
    const reg = await client(app.base).post("/api/auth/phone/register", { username: "locked_one", phone, pin: PIN });
    assert.equal(reg.status, 201);
    const c = client(app.base);
    for (let i = 0; i < 10; i++) {
      assert.equal((await c.post("/api/auth/login", { identifier: "locked_one", pin: "000000" })).status, 401);
    }
    assert.equal((await c.post("/api/auth/login", { identifier: "locked_one", pin: PIN })).json.error, "pin_locked");
    // The phone is the same account: no second budget.
    assert.equal((await c.post("/api/auth/login", { identifier: phone, pin: PIN })).json.error, "pin_locked");

    // More misses on unknown identifiers than the map tracks must not reset anyone's lock.
    const ids = Array.from({ length: 30 }, (_, i) => "ghost_" + i);
    for (let i = 0; i < ids.length; i += 5) {
      const rs = await Promise.all(ids.slice(i, i + 5).map((id) => client(app.base).post("/api/auth/login", { identifier: id, pin: "123456" })));
      for (const r of rs) assert.equal(r.status, 401);
    }
    assert.equal((await c.post("/api/auth/login", { identifier: "locked_one", pin: PIN })).json.error, "pin_locked", "lock survived the flood");
  } finally {
    await app.close();
  }
});

test("leaderboard limits are clamped and never crash", async () => {
  const app = await boot();
  try {
    const c = await signUp(app.base, "clamp");
    app.setNow(T0);
    await solve(c, "easy", 0, "2026-10-27");
    for (const q of ["-1", "0.5", "abc", "999", "0"]) {
      const today = await c.get("/api/leaderboard/today?limit=" + q);
      assert.equal(today.status, 200, "today limit=" + q + ": " + today.text);
      assert.ok(today.json.rows.length >= 1 && today.json.rows.length <= 50);
      const all = await c.get("/api/leaderboard/alltime?limit=" + q);
      assert.equal(all.status, 200, "alltime limit=" + q + ": " + all.text);
    }
  } finally {
    await app.close();
  }
});

test("sign-in accepts a formatted phone: spaces, dashes, leading 0, 0091 and +91 all match the stored row", async () => {
  const app = await boot();
  try {
    const phone = "+919876501234";
    const reg = await client(app.base).post("/api/auth/phone/register", { username: "fmt_user", phone, pin: PIN });
    assert.equal(reg.status, 201, reg.text);
    for (const id of ["+91 98765-01234", "0091 98765 01234", "+91 (98765) 01234", "+919876501234"]) {
      const r = await client(app.base).post("/api/auth/login", { identifier: id, pin: PIN });
      assert.equal(r.status, 200, id + ": " + r.text);
      assert.equal(r.json.user.username, "fmt_user");
    }
  } finally {
    await app.close();
  }
});

test("all-digit usernames are rejected at sign-up because digits mean a phone at sign-in", async () => {
  const app = await boot();
  try {
    const r = await client(app.base).post("/api/auth/phone/register", { username: "2007", phone: nextPhone(), pin: PIN });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json.error, "invalid_username");
    const ok = await client(app.base).post("/api/auth/phone/register", { username: "y2007", phone: nextPhone(), pin: PIN });
    assert.equal(ok.status, 201, ok.text);
  } finally {
    await app.close();
  }
});

test("the sign-up throttle counts created accounts, not failed attempts", async () => {
  const app = await bootLimited();
  try {
    assert.equal((await client(app.base).post("/api/auth/phone/register", { username: "taken_one", phone: nextPhone(), pin: PIN })).status, 201);
    for (let i = 0; i < 5; i++) {
      const r = await client(app.base).post("/api/auth/phone/register", { username: "taken_one", phone: nextPhone(), pin: PIN });
      assert.equal(r.status, 409, r.text);
    }
    const fresh = await client(app.base).post("/api/auth/phone/register", { username: "finally_free", phone: nextPhone(), pin: PIN });
    assert.equal(fresh.status, 201, "five rejected attempts did not spend the budget: " + fresh.text);
  } finally {
    await app.close();
  }
});

test("the HTTP log records the socket address unless the proxy is trusted", async () => {
  let now = T0;
  const logger = recordingLogger();
  const app = createApp({ dbPath: ":memory:", now: () => now, rateLimit: false, logger, secret: "" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.server.address().port;
  try {
    await client(base).get("/api/health", { "x-forwarded-for": "203.0.113.77" });
    const line = logger.calls.find((e) => e.tag === "HTTP" && e.message.includes("/api/health"));
    assert.ok(line, JSON.stringify(logger.calls.slice(-3)));
    assert.equal(line.meta.ip, "127.0.0.1");
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});

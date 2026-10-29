"use strict";
// End-to-end tests. The server runs with CRICKETLE_SECRET=public (see playwright.config.js),
// so today's answers can be computed with the shared core for both guests and accounts.

const { test, expect } = require("@playwright/test");
const core = require("../../public/game-core.js");

const day = () => core.todayKey(Date.now());
const answer = (mode, idx) => core.answerFor(day(), mode, idx).name;
const wrongGuess = (mode, idx, skip) => {
  const avoid = new Set([answer(mode, idx), ...(skip || [])]);
  return core.poolFor(mode).find((p) => !avoid.has(p.name)).name;
};
const shot = (page, name) => page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png`, fullPage: true });

async function guess(page, name) {
  const input = page.locator("#guess-input");
  const row = page.locator("#suggestions li.highlight", { hasText: name });
  // The matching row is highlighted as soon as it renders; Enter submits it.
  // Clicking it is flaky on phones while a hint reveal is still animating, and
  // the first keystrokes occasionally land before the dropdown is listening, so
  // retype once or twice if nothing shows.
  for (let attempt = 0; attempt < 3; attempt++) {
    await input.fill("");
    await input.fill(name);
    if (await row.isVisible().catch(() => false)) break;
    await page.waitForTimeout(300);
  }
  await expect(row).toBeVisible();
  await input.press("Enter");
}

async function startPuzzle(page) {
  await page.getByRole("button", { name: "Start puzzle" }).click();
  await expect(page.locator("#guess-input")).toBeEnabled();
}

async function solveCurrent(page, mode, idx) {
  await startPuzzle(page);
  await guess(page, answer(mode, idx));
  await expect(page.locator("#win")).toBeVisible();
}

// Accounts are username + mobile number + PIN. The phone must be unique, so
// each sign-up gets a fresh Indian-looking 10-digit number.
const uniqPhone = () => "9" + String(Date.now() % 1e9).padStart(9, "0");

async function signUp(page, username, pin, phone) {
  await page.goto("/#profile");
  await page.getByRole("tab", { name: "Create Account" }).click();
  await page.locator("#register-username").fill(username);
  await page.locator("#register-phone").fill(phone || uniqPhone());
  await page.locator("#register-pin").fill(pin);
  await page.locator("#register-pin-confirm").fill(pin);
  await page.locator("#auth-register-btn").click();
  await expect(page.locator("#nav-profile-label")).toHaveText(username);
}

const uniq = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);

const SEEN_HELP = "cricketle:v3:seen-help";

// Every test is a returning visitor unless it says otherwise: the onboarding
// sheet is covered by its own describe block below.
test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => { try { localStorage.setItem(key, "1"); } catch (_) {} }, SEEN_HELP);
});

test.describe("onboarding", () => {
  test("first visit: the sheet shows and Play starts puzzle 1 with the timer running", async ({ page }) => {
    await page.addInitScript((key) => { try { localStorage.removeItem(key); } catch (_) {} }, SEEN_HELP);
    await page.goto("/");
    const sheet = page.locator("#onboard");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Guess the secret cricketer");
    await expect(sheet).toContainText("The first is free");
    await expect(page.locator("#onboard-signin")).toBeVisible();
    await page.locator("#onboard-play").click();
    await expect(sheet).toBeHidden();
    await expect(page.locator("#guess-input")).toBeEnabled();
    await expect(page.locator(".stat-timer")).toHaveClass(/running/);
    await expect(page.locator("#dots .dot").nth(0)).toHaveClass(/active/);
    const seen = await page.evaluate((key) => localStorage.getItem(key), SEEN_HELP);
    expect(seen).toBe("1");
  });

  test("returning visit: no sheet, the help button reopens it without starting anything", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#onboard")).toBeHidden();
    await expect(page.locator("#timer")).toHaveText("00:00");
    await page.locator("#help-btn").click();
    await expect(page.locator("#onboard")).toBeVisible();
    await page.locator("#onboard-scoring summary").click();
    await expect(page.locator("#onboard-scoring")).toContainText("Hard mode counts");
    await page.locator("#onboard-play").click();
    await expect(page.locator("#onboard")).toBeHidden();
    await expect(page.locator("#timer")).toHaveText("00:00", { timeout: 1500 });
  });

  test("storage blocked: the page still loads, the sheet shows once and Play works", async ({ page }) => {
    await page.addInitScript(() => {
      const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
      Object.defineProperty(window, "localStorage", { get: () => broken });
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.locator("#onboard")).toBeVisible();
    await page.locator("#onboard-play").click();
    await expect(page.locator("#onboard")).toBeHidden();
    await expect(page.locator("#guess-input")).toBeEnabled();
    expect(errors).toEqual([]);
  });
});

test.describe("guest play", () => {
  test("Easy puzzle: timer runs, hint costs points, tags explain closeness, solve unlocks the next", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cricketle", level: 1 })).toBeVisible();
    await expect(page.locator("#guest-banner")).toBeVisible();
    await expect(page.locator("#timer")).toHaveText("00:00");
    await expect(page.locator("#worth")).toHaveText("100");
    await expect(page.locator("#dots .dot").nth(1)).toHaveClass(/gated/);
    await expect(page.locator("#dots .dot").nth(1)).toBeEnabled();

    await startPuzzle(page);
    await page.waitForTimeout(1500);
    await expect(page.locator("#timer")).not.toHaveText("00:00");
    await expect(page.locator(".stat-timer")).toHaveClass(/running/);

    await page.locator(".reveal-btn").click();
    await expect(page.locator(".hint.revealed .hint-text")).toContainText("Represents");
    await expect(page.locator("#worth")).toHaveText("90");
    await expect(page.locator("#message")).toContainText("Hint 1");

    const wrong = wrongGuess("easy", 0);
    await guess(page, wrong);
    const row = page.locator("#last-guess .row");
    await expect(row).toContainText(wrong);
    await expect(row.locator(".rank")).not.toHaveText("1");
    await expect(page.locator("#guess-count")).toHaveText("1");
    await shot(page, "play-guessing");

    await guess(page, answer("easy", 0));
    await expect(page.locator("#win")).toContainText("you got it");
    await expect(page.locator("#win")).toContainText(answer("easy", 0));
    await expect(page.locator("#win .win-stat.points .v")).toContainText("+");
    await expect(page.locator(".stat-timer")).toHaveClass(/done/);
    await expect(page.locator("#dots .dot").nth(0)).toHaveClass(/solved/);
    await expect(page.locator("#dots .dot").nth(1)).toHaveClass(/gated/);
    await expect(page.locator("#today-points")).toContainText(/Today: \d+ pts/);
    await shot(page, "play-solved");

    // Progress survives a reload.
    await page.reload();
    await expect(page.locator("#dots .dot").nth(0)).toHaveClass(/solved/);
    await expect(page.locator("#win")).toContainText(answer("easy", 0));

    // Guests get no "Next puzzle": the gate card and the other mode's free one.
    await expect(page.getByRole("button", { name: "Next puzzle" })).toHaveCount(0);
    await expect(page.locator("#gate")).toBeVisible();
    await page.getByRole("button", { name: /Try Hard mode, also free/ }).click();
    await expect(page.getByRole("button", { name: "Start puzzle" })).toBeVisible();
    await expect(page.locator("#tracker-label")).toHaveText("Hard · Puzzle 1 of 3");
  });

  test("typing right after tapping a hint keeps the suggestions open", async ({ page }) => {
    await page.goto("/");
    await startPuzzle(page);
    await page.locator("#guess-input").fill("vir");
    await expect(page.locator("#suggestions")).toBeVisible();
    // Tapping the hint blurs the input; typing again within its hide delay must not lose the list.
    await page.locator(".reveal-btn").click();
    await page.locator("#guess-input").fill("virat");
    await expect(page.locator("#suggestions li.highlight")).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.locator("#suggestions")).toBeVisible();
    await expect(page.locator("#suggestions li.highlight")).toContainText(/Virat/);
  });

  test("Hard mode: rank only, three hints at most, give up reveals the answer and scores zero", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Hard" }).click();
    await expect(page.locator("body")).toHaveClass(/hard/);
    await expect(page.locator("#worth")).toHaveText("150");
    await startPuzzle(page);

    await guess(page, wrongGuess("hard", 0));
    await expect(page.locator("#last-guess .row .tags")).toHaveCount(0);
    await expect(page.locator("#last-guess .row .tier-label")).toBeVisible();

    for (let i = 0; i < 3; i++) await page.locator(".reveal-btn").click();
    await expect(page.locator(".hint.revealed")).toHaveCount(3);
    await expect(page.locator(".reveal-btn")).toHaveCount(0);
    await expect(page.locator(".hint.revealed").nth(2)).toContainText("Debuted in");
    await expect(page.locator(".hint.revealed").nth(2)).not.toContainText("initials");

    await page.locator("#give-up").click();
    await expect(page.locator("#confirm")).toBeVisible();
    await page.locator("#confirm button[value=ok]").click();
    await expect(page.locator("#win")).toHaveClass(/lost/);
    await expect(page.locator("#win")).toContainText(answer("hard", 0));
    await expect(page.locator("#win .win-stat.points .v")).toHaveText("0");
    await expect(page.locator("#dots .dot").nth(0)).toHaveClass(/gaveUp/);
    await expect(page.locator("#dots .dot").nth(1)).toHaveClass(/gated/);
    await shot(page, "hard-gave-up");
  });

  test("three puzzles a day: the mode closes after the third (signed in)", async ({ page }) => {
    // Guests get only the first puzzle (see "guest gate"); the full day needs an account.
    await signUp(page, uniq("trio"), "246810");
    await page.goto("/");
    for (let i = 0; i < 3; i++) {
      await solveCurrent(page, "easy", i);
      if (i < 2) await page.getByRole("button", { name: "Next puzzle" }).click();
    }
    await expect(page.locator("#win")).toContainText("All 3 Easy puzzles done");
    await expect(page.getByRole("button", { name: "Next puzzle" })).toHaveCount(0);
    await expect(page.locator("#dots .dot.solved")).toHaveCount(3);
    await expect(page.locator("#today-points")).toContainText("Today:");
    await page.getByRole("button", { name: "Try Hard mode" }).click();
    await expect(page.locator("#tracker-label")).toHaveText("Hard · Puzzle 1 of 3");
    await expect(page.getByRole("button", { name: "Start puzzle" })).toBeVisible();
    await shot(page, "easy-complete");
  });
});

test.describe("guest gate", () => {
  test("guest: puzzles 2 and 3 are gated and the gate card appears after solving puzzle 1", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#dots .dot.gated")).toHaveCount(2);
    await expect(page.locator("#dots .dot.gated").first()).toBeEnabled();
    await expect(page.locator("#gate")).toBeHidden();

    // Tapping a gated dot explains, without starting anything.
    await page.locator("#dots .dot.gated").first().click();
    await expect(page.locator("#gate")).toBeVisible();
    await expect(page.locator("#gate")).toContainText("Sign up or sign in");
    await page.locator("#gate-close").click();
    await expect(page.locator("#gate")).toBeHidden();

    await solveCurrent(page, "easy", 0);
    await expect(page.locator("#gate")).toBeVisible();
    await expect(page.locator("#gate")).toContainText("free puzzle in Easy");
    await expect(page.locator("#gate-signup")).toBeVisible();
    await expect(page.locator("#gate-signin")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next puzzle" })).toHaveCount(0);
    await shot(page, "guest-gate");

    await page.locator("#gate-signup").click();
    await expect(page.locator("#auth-card")).toBeVisible();
    await expect(page.locator("#auth-view-register")).toBeVisible();
  });

  test("guest: after Easy 1 the win card offers Hard for free, then Hard gates too", async ({ page }) => {
    await page.goto("/");
    await solveCurrent(page, "easy", 0);
    const other = page.locator("#other-mode-btn");
    await expect(other).toHaveText(/Try Hard mode, also free/);
    await other.click();
    await expect(page.locator("#tracker-label")).toHaveText("Hard · Puzzle 1 of 3");
    await expect(page.locator("#gate")).toBeHidden();
    await solveCurrent(page, "hard", 0);
    await expect(page.locator("#gate")).toBeVisible();
    await expect(page.locator("#gate")).toContainText("free puzzle in Hard");
    await expect(page.locator("#other-mode-btn")).toHaveCount(0);
  });

  test("signed in: no gated dots and the next puzzle unlocks", async ({ page }) => {
    await signUp(page, uniq("gate"), "246810");
    await page.goto("/");
    await expect(page.locator("#dots .dot.gated")).toHaveCount(0);
    await expect(page.locator("#gate")).toBeHidden();
    await solveCurrent(page, "easy", 0);
    await expect(page.locator("#gate")).toBeHidden();
    await expect(page.getByRole("button", { name: "Next puzzle" })).toBeVisible();
  });
});

test.describe("accounts and leaderboards", () => {
  test("sign up, play for the leaderboard, see rank, profile stats and sign out", async ({ page }) => {
    const username = uniq("pw");
    await signUp(page, username, "246810");
    await expect(page).toHaveURL(/#play$/);
    await expect(page.locator("#guest-banner")).toBeHidden();
    await expect(page.locator("#today-rank")).toContainText("Finish a puzzle");

    await solveCurrent(page, "easy", 0);
    await expect(page.locator("#today-rank")).toContainText(/Rank #\d+/);
    const points = Number(await page.locator("#dots .dot.solved .dot-pts").first().textContent());
    expect(points).toBeGreaterThan(0);

    // Server-side state: a fresh page for the same account shows the solve.
    await page.reload();
    await expect(page.locator("#dots .dot").nth(0)).toHaveClass(/solved/);
    await expect(page.locator("#win")).toContainText(answer("easy", 0));

    await page.locator("#today-rank a").click();
    await expect(page.locator("#view-leaderboard")).toBeVisible();
    const myRow = page.locator("#board-list .board-row.me");
    await expect(myRow).toContainText(username);
    await expect(myRow.locator(".board-pts .v")).toHaveText(String(points));
    await expect(page.locator("#board-me")).toContainText(/#\d+/);
    await shot(page, "leaderboard-today");

    await page.getByRole("tab", { name: "All-time" }).click();
    await expect(page.locator("#board-list .board-row.me")).toContainText(username);
    await expect(page.locator("#board-list .board-row.me")).toContainText("Net Bowler");
    await shot(page, "leaderboard-alltime");

    await page.goto("/#profile");
    await expect(page.locator("#profile-card")).toContainText(username);
    await expect(page.locator("#profile-card")).toContainText("Net Bowler");
    await expect(page.locator(".stat-tile").filter({ hasText: "Today's points" }).locator(".v")).toHaveText(String(points));
    await expect(page.locator(".stat-tile").filter({ hasText: "Puzzles solved" }).locator(".v")).toHaveText("1");
    await expect(page.locator(".streak-card")).toContainText("Best streak: 1 days");
    await shot(page, "profile");

    await page.locator('.subnav-btn[data-subtab="account"]').click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator("#nav-profile-label")).toHaveText("Sign in");
    await expect(page.locator("#guest-banner")).toBeVisible();
  });

  test("sign-in form validates inline and reports wrong credentials", async ({ page }) => {
    await page.goto("/#profile");
    const summary = page.locator("#auth-summary");
    await page.locator("#auth-signin-btn").click();
    // Missing input is an inline field error, not a summary.
    await expect(page.locator("#signin-identifier-error")).toContainText("Enter your username or mobile number.");
    await expect(page.locator("#signin-identifier")).toHaveAttribute("aria-invalid", "true");
    await expect(summary).toBeHidden();

    await page.locator("#signin-identifier").fill("nobody_here");
    await page.locator("#signin-pin").fill("999999");
    await page.locator("#auth-signin-btn").click();
    // Server errors go to the one summary.
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute("role", "alert");
    await expect(summary).toContainText("Incorrect username or PIN");
    await expect(page.locator("#signin-identifier-error")).toHaveText("");

    // There is no self-service PIN reset any more: the form points at the admin.
    await expect(page.locator("#auth-view-signin")).toContainText("Ask the Cricketle admin");
    await expect(page.locator("#auth-view-reset")).toHaveCount(0);

    await page.getByRole("tab", { name: "Create Account" }).click();
    await page.locator("#register-username").fill("x!");
    await page.locator("#auth-register-btn").click();
    await expect(page.locator("#register-username-error")).toContainText("3-20 letters");
  });

  test("typing digits reveals the country code picker and signs in by phone", async ({ page }) => {
    const username = uniq("pw");
    const pin = "246810";
    const phone = uniqPhone();
    await signUp(page, username, pin, phone);
    await page.goto("/#profile");
    await page.locator('.subnav-btn[data-subtab="account"]').click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator("#nav-profile-label")).toHaveText("Sign in");

    await page.goto("/#profile");
    const country = page.locator("#signin-country");
    const id = page.locator("#signin-identifier");
    await expect(country).toBeHidden();
    await id.fill("aman");
    await expect(country).toBeHidden();
    await id.fill(phone);
    await expect(country).toBeVisible();
    await expect(country).toHaveValue("+91");
    await page.locator("#signin-pin").fill(pin);
    await page.locator("#auth-signin-btn").click();
    await expect(page.locator("#nav-profile-label")).toHaveText(username);
  });

  test("signing in with 0091 and a spaced number still finds the account", async ({ page }) => {
    const username = uniq("pw");
    const phone = uniqPhone();
    await signUp(page, username, "246810", phone);
    await page.goto("/#profile");
    await page.locator('.subnav-btn[data-subtab="account"]').click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator("#nav-profile-label")).toHaveText("Sign in");

    await page.goto("/#profile");
    await page.locator("#signin-identifier").fill("0091 " + phone.slice(0, 5) + " " + phone.slice(5));
    await expect(page.locator("#signin-country")).toBeHidden();
    await page.locator("#signin-pin").fill("246810");
    await page.locator("#auth-signin-btn").click();
    await expect(page.locator("#nav-profile-label")).toHaveText(username);
  });

  test("guest Account tab: the sign-in button opens the form and never mentions Google", async ({ page }) => {
    await page.goto("/#profile");
    await page.locator('.subnav-btn[data-subtab="account"]').click();
    await expect(page.locator("#profile-card")).not.toContainText("Google");
    await page.locator("#guest-to-auth-btn").click();
    await expect(page.locator("#auth-card")).toBeVisible();
    await expect(page.locator("#signin-identifier")).toBeFocused();
  });

  test("inline errors: empty username, 5-digit PIN, PIN mismatch each mark their own field", async ({ page }) => {
    await page.goto("/#profile");
    await page.getByRole("tab", { name: "Create Account" }).click();
    for (const id of ["register-pin", "register-pin-confirm"]) {
      await expect(page.locator("#" + id)).toHaveAttribute("maxlength", "6");
      await expect(page.locator("#" + id)).toHaveAttribute("pattern", "\\d{6}");
    }
    await expect(page.locator("#register-country")).toHaveValue("+91");

    const btn = page.locator("#auth-register-btn");
    await btn.click();
    // One tap marks every empty field at once; the summary is for server errors only.
    await expect(page.locator("#register-username-error")).not.toHaveText("");
    await expect(page.locator("#register-username")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#register-phone-error")).not.toHaveText("");
    await expect(page.locator("#register-pin-error")).toContainText("6 digits");
    await expect(page.locator("#register-pin-confirm-error")).toHaveText("");
    await expect(page.locator("#auth-summary")).toBeHidden();

    await page.locator("#register-username").fill(uniq("pw"));
    await page.locator("#register-phone").fill(uniqPhone());
    await page.locator("#register-pin").fill("12345");
    await page.locator("#register-pin-confirm").fill("12345");
    await btn.click();
    await expect(page.locator("#register-username-error")).toHaveText("");
    await expect(page.locator("#register-phone-error")).toHaveText("");
    await expect(page.locator("#register-pin-error")).toContainText("6 digits");
    await expect(page.locator("#register-pin")).toHaveAttribute("aria-invalid", "true");

    await page.locator("#register-pin").fill("123456");
    await page.locator("#register-pin-confirm").fill("654321");
    await btn.click();
    await expect(page.locator("#register-pin-error")).toHaveText("");
    await expect(page.locator("#register-pin-confirm-error")).toContainText("match");
    await expect(page.locator("#register-pin-confirm")).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("layout", () => {
  test("phone: bottom tab bar, no horizontal scroll, comfortable targets", async ({ page }) => {
    test.skip(test.info().project.name !== "phone", "phone project only");
    await page.goto("/");
    await expect(page.locator(".tabbar")).toBeVisible();
    await expect(page.locator(".nav")).toBeHidden();
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    // Only the controls on screen: segmented tabs inside hidden views measure 0.
    for (const sel of [".tabbar .tab", "#start-btn", "#view-play .dot", "#help-btn", "#view-play .seg"]) {
      const boxes = await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(boxes.length, sel).toBeGreaterThan(0);
      for (const h of boxes) expect(h, sel).toBeGreaterThanOrEqual(44);
    }
    await shot(page, "phone-play");
    await page.locator(".tabbar a[href='#leaderboard']").click();
    await expect(page.locator("#view-leaderboard")).toBeVisible();
    await expect(page.locator("#view-play")).toBeHidden();
    await shot(page, "phone-leaderboard");
    await page.locator(".tabbar a[href='#profile']").click();
    await expect(page.locator("#auth-card")).toBeVisible();
    await shot(page, "phone-profile");
    await page.goBack();
    await expect(page.locator("#view-leaderboard")).toBeVisible();
  });

  test("desktop: top navigation, two-column play layout, help dialog", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await page.goto("/");
    await expect(page.locator(".nav")).toBeVisible();
    await expect(page.locator(".tabbar")).toBeHidden();
    const cols = await page.locator(".view-play").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(cols).toBe(2);
    await page.locator("#help-btn").click();
    await expect(page.locator("#onboard")).toBeVisible();
    await expect(page.locator("#onboard")).toContainText("3 puzzles a day");
    await expect(page.locator("#onboard")).toContainText("3 hints per puzzle");
    await page.locator("#onboard-play").click();
    await expect(page.locator("#onboard")).toBeHidden();
    await shot(page, "desktop-home");
  });
});

test.describe("theme", () => {
  const THEME_COLOR = { day: "#bfe3ff", night: "#0b1220" };

  test("theme toggle flips the tokens and persists across reload", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const before = await html.getAttribute("data-theme");
    expect(["day", "night"]).toContain(before);
    const after = before === "day" ? "night" : "day";

    await page.locator("#theme-btn").click();
    await expect(html).toHaveAttribute("data-theme", after);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", THEME_COLOR[after]);
    await expect(page.locator("#theme-btn")).toHaveAttribute("aria-label", after === "day" ? "Switch to night" : "Switch to day");
    await expect(page.locator("body")).toHaveCSS("color", after === "day" ? "rgb(14, 42, 20)" : "rgb(248, 250, 252)");

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", after);
  });

  test("auto mode follows the IST clock; a manual choice sticks", async ({ page }) => {
    // 17:59 IST is 12:29 UTC. Fake clock, no stored preference.
    await page.clock.install({ time: new Date("2026-10-27T12:29:00Z") });
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "day");

    await page.clock.fastForward("02:00");
    await expect(html).toHaveAttribute("data-theme", "night");

    await page.locator("#theme-btn").click();
    await expect(html).toHaveAttribute("data-theme", "day");
    await page.clock.fastForward("02:00:00");
    await expect(html).toHaveAttribute("data-theme", "day");
  });
});

test.describe("stadium scene", () => {
  // Reads one canvas pixel at (5 %, 5 %): top-left sky, away from the sun and clouds.
  async function skyPixel(page) {
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const c = document.getElementById("bg");
      const ctx = c.getContext("2d");
      const [r, g, b, a] = ctx.getImageData(Math.round(c.width * 0.05), Math.round(c.height * 0.05), 1, 1).data;
      return { r, g, b, a };
    });
  }

  test("day scene renders a blue sky", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem("cricketle:v3:theme", "day"); } catch (_) {} });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
    const p = await skyPixel(page);
    expect(p.a, "opaque sky").toBe(255);
    expect(p.b, "bright").toBeGreaterThan(150);
    expect(p.b).toBeGreaterThan(p.r);
    expect(p.b).toBeGreaterThan(p.g);
    await shot(page, "day");
  });

  test("night scene renders a dark floodlit sky", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem("cricketle:v3:theme", "night"); } catch (_) {} });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    const p = await skyPixel(page);
    expect(p.a, "opaque sky").toBe(255);
    expect(p.r).toBeLessThan(60);
    expect(p.g).toBeLessThan(60);
    await shot(page, "night");
  });
});

test.describe("minimal information", () => {
  async function signOut(page) {
    await page.goto("/#profile");
    await page.locator('.subnav-btn[data-subtab="account"]').click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator("#nav-profile-label")).toHaveText("Sign in");
  }

  test("profile shows four tiles first and the rest behind More", async ({ page }) => {
    await signUp(page, uniq("pw"), "246810");
    await page.goto("/#profile");
    const firstTiles = page.locator(".stat-tile:not(#more-stats .stat-tile)");
    await expect(firstTiles).toHaveCount(4);
    await expect(firstTiles.locator(".k")).toHaveText(["Today's points", "Today's rank", "Streak", "All-time points"]);
    const more = page.locator("#more-stats");
    await expect(more).toBeVisible();
    await expect(more.locator(".stat-tile").first()).toBeHidden();
    await more.locator("summary").click();
    await expect(more.locator(".stat-tile").first()).toBeVisible();
    await expect(more.locator(".streak-card")).toBeVisible();
    await page.locator('.subnav-btn[data-subtab="account"]').click();
    await expect(page.locator("#profile-card")).not.toContainText("scrypt");
    await expect(page.locator("#profile-card")).not.toContainText("Google");
  });

  test("leaderboard rows show rank, avatar, name and points; only your own row adds time and guesses", async ({ page }) => {
    const other = uniq("pw");
    await signUp(page, other, "246810");
    await page.goto("/");
    await solveCurrent(page, "easy", 0);
    await signOut(page);

    await signUp(page, uniq("pw"), "246810");
    await page.goto("/");
    await solveCurrent(page, "easy", 0);
    await page.goto("/#leaderboard");
    const me = page.locator("#board-list .board-row.me");
    await expect(me).toBeVisible();
    await expect(me.locator(".board-avatar")).toBeVisible();
    await expect(me.locator(".board-time")).toBeVisible();
    const theirs = page.locator("#board-list .board-row:not(.me)").filter({ hasText: other });
    await expect(theirs).toBeVisible();
    await expect(theirs.locator(".board-avatar")).toBeVisible();
    await expect(theirs.locator(".board-time")).toHaveCount(0);
    await expect(theirs.locator(".board-pts .v")).toHaveText(/\d+/);
  });

  test("phone: the guest banner is a single line", async ({ page }) => {
    test.skip(test.info().project.name !== "phone", "phone project only");
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    const banner = page.locator("#guest-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Playing as a guest");
    const box = await banner.boundingBox();
    expect(box.height).toBeLessThanOrEqual(48);
  });
});

test.describe("motion", () => {
  const style = (loc, prop) => loc.evaluate((el, p) => getComputedStyle(el)[p], prop);

  test.describe("reduced", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });
    test("reduced motion disables animations", async ({ page }) => {
      await page.goto("/");
      await startPuzzle(page);
      await guess(page, wrongGuess("easy", 0));
      const row = page.locator("#last-guess .row");
      await expect(row).toBeVisible();
      expect(await style(row, "transitionDuration")).toBe("0s");
      expect(await style(row, "animationName")).toBe("none");
      await page.locator("#help-btn").click();
      const sheet = page.locator("#onboard");
      await expect(sheet).toBeVisible();
      expect(await style(sheet, "animationName")).toBe("none");
    });
  });

  test.describe("full", () => {
    test.use({ contextOptions: { reducedMotion: "no-preference" } });
    test("motion on: the dot pops on solve, the sheet slides, the new row fades its heat", async ({ page }) => {
      await page.goto("/");
      await startPuzzle(page);
      // The pop lasts 320 ms, shorter than an expect poll, so record it as it happens.
      await page.evaluate(() => {
        window.__popSeen = false;
        const dots = document.getElementById("dots");
        new MutationObserver(() => { if (dots.querySelector(".dot.pop")) window.__popSeen = true; })
          .observe(dots, { childList: true, subtree: true, attributes: true });
      });
      await guess(page, answer("easy", 0));
      const dot = page.locator("#dots .dot").nth(0);
      await expect.poll(() => page.evaluate(() => window.__popSeen), { timeout: 2000 }).toBe(true);
      await expect(dot).not.toHaveClass(/pop/, { timeout: 2000 });

      await page.locator("#help-btn").click();
      const sheet = page.locator("#onboard");
      await expect(sheet).toBeVisible();
      expect(await style(sheet, "animationName")).not.toBe("none");
      await page.locator("#onboard-play").click();

      await page.locator("#mode-hard").click();
      await startPuzzle(page);
      await guess(page, wrongGuess("hard", 0));
      const row = page.locator("#last-guess .row");
      await expect(row).toHaveClass(/heat-fade/);
      expect(await style(row, "animationName")).toContain("heat-fade");
    });
  });
});

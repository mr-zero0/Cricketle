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
  await page.locator("#guess-input").fill(name);
  await page.locator("#suggestions li", { hasText: name }).first().click();
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

async function signUp(page, username, password) {
  await page.goto("/#profile");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.locator("#auth-username").fill(username);
  await page.locator("#auth-password").fill(password);
  await page.locator("#auth-confirm").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("#nav-profile-label")).toHaveText(username);
}

const uniq = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);

test.describe("guest play", () => {
  test("Easy puzzle: timer runs, hint costs points, tags explain closeness, solve unlocks the next", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cricketle", level: 1 })).toBeVisible();
    await expect(page.locator("#guest-banner")).toBeVisible();
    await expect(page.locator("#timer")).toHaveText("00:00");
    await expect(page.locator("#worth")).toHaveText("100");
    await expect(page.locator("#dots .dot").nth(1)).toBeDisabled();

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
    await expect(page.locator("#dots .dot").nth(1)).toHaveClass(/ready/);
    await expect(page.locator("#today-points")).toContainText(/Today: \d+ pts/);
    await shot(page, "play-solved");

    // Progress survives a reload.
    await page.reload();
    await expect(page.locator("#dots .dot").nth(0)).toHaveClass(/solved/);
    await expect(page.locator("#win")).toContainText(answer("easy", 0));

    await page.getByRole("button", { name: "Next puzzle" }).click();
    await expect(page.getByRole("button", { name: "Start puzzle" })).toBeVisible();
    await expect(page.locator("#tracker-label")).toHaveText("Easy · Puzzle 2 of 3");
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
    await expect(page.locator("#dots .dot").nth(1)).toHaveClass(/ready/);
    await shot(page, "hard-gave-up");
  });

  test("three puzzles a day: the mode closes after the third", async ({ page }) => {
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

test.describe("accounts and leaderboards", () => {
  test("sign up, play for the leaderboard, see rank, profile stats and sign out", async ({ page }) => {
    const username = uniq("pw");
    await signUp(page, username, "pitch-fever-9");
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
    await expect(page.locator(".stat-tile").filter({ hasText: "Current streak" }).locator(".v")).toHaveText("1");
    await shot(page, "profile");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator("#nav-profile-label")).toHaveText("Sign in");
    await expect(page.locator("#guest-banner")).toBeVisible();
  });

  test("sign-in form validates inline and reports wrong credentials", async ({ page }) => {
    await page.goto("/#profile");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#auth-summary")).toBeVisible();
    await expect(page.locator("#auth-summary")).toBeFocused();
    await expect(page.locator("#auth-username-error")).toHaveText("Enter a username.");

    await page.locator("#auth-username").fill("nobody_here");
    await page.locator("#auth-password").fill("wrongpass");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#auth-password-error")).toHaveText("Wrong username or password.");

    await page.getByRole("tab", { name: "Create account" }).click();
    await page.locator("#auth-username").fill("x!");
    await page.locator("#auth-username").blur();
    await expect(page.locator("#auth-username-error")).toContainText("3–20 letters");
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
    await expect(page.locator("#help")).toBeVisible();
    await expect(page.locator("#help")).toContainText("three puzzles a day");
    await expect(page.locator("#help")).toContainText("three hints");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator("#help")).toBeHidden();
    await shot(page, "desktop-home");
  });
});

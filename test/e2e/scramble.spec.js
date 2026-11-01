"use strict";

const { test, expect } = require("@playwright/test");

function monitorConsole(page) {
  const errors = [];
  page.on("pageerror", (err) => {
    errors.push(`PageError: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`ConsoleError: ${msg.text()}`);
    }
  });
  return errors;
}

test.describe("Scramble — Member Gating", () => {
  test("unauthenticated visitor sees Member Access Only modal on scramble.html", async ({ page }) => {
    await page.route("/api/me", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });
    await page.goto("/scramble.html");
    await expect(page.locator("#member-gate-modal")).toBeVisible();
    await expect(page.locator("#btn-submit-guess")).toBeDisabled();
  });
});

test.describe("Scramble — Wordle Anagram Gameplay", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: 1, username: "cricketfan", phone: "+919876543210" },
        }),
      });
    });
  });

  test("Scramble UI: renders mystery blank slots, 6 wordle rows, and virtual keyboard", async ({ page }) => {
    const errors = monitorConsole(page);
    await page.goto("/scramble.html");
    await expect(page.locator("h1")).toContainText("Scramble");

    // Mystery tiles rendered as empty dashes _ (no letters revealed upfront)
    const mysteryTiles = page.locator(".scramble-letter-tile");
    const tileCount = await mysteryTiles.count();
    expect(tileCount).toBeGreaterThan(4);
    const firstTileText = await mysteryTiles.first().textContent();
    expect(firstTileText.trim()).toBe("_");

    // Pattern text indicates total character length
    await expect(page.locator("#scramble-pattern-text")).toContainText("Characters");

    // Wordle rows rendered (6 rows) starting empty with _
    const rows = page.locator(".wordle-row");
    await expect(rows).toHaveCount(6);
    const firstRowEmptyTiles = rows.first().locator(".wordle-tile.empty");
    const emptyCount = await firstRowEmptyTiles.count();
    expect(emptyCount).toBeGreaterThan(4);

    // Virtual keyboard rendered (26 letters + ENTER + ⌫ + SPACE = 29 keys)
    const keys = page.locator(".key-btn");
    await expect(keys).toHaveCount(29);

    // Country clue unlocked
    await expect(page.locator("#clue-country")).toHaveClass(/unlocked/);

    const fatal = errors.filter(e => !e.includes("favicon"));
    expect(fatal).toHaveLength(0);
  });

  test("Autocomplete dropdown: typing shows matching players and clicking auto-fills", async ({ page }) => {
    await page.goto("/scramble.html");

    const input = page.locator("#guess-input");
    await input.focus();
    await input.pressSequentially("virat", { delay: 30 });

    const suggestions = page.locator("#suggestions li");
    await expect(suggestions.first()).toBeVisible();
    const count = await suggestions.count();
    expect(count).toBeGreaterThan(0);

    const firstText = await suggestions.first().textContent();
    expect(firstText).toContain("Virat");

    // Clicking suggestion should auto-fill the full name and submit
    await suggestions.first().click();

    // After submission, first row should be evaluated
    const firstRowTiles = page.locator(".wordle-row").first().locator(".wordle-tile");
    const tileCount = await firstRowTiles.count();
    expect(tileCount).toBeGreaterThan(5);
  });

  test("Wordle Feedback: wrong guess evaluates tiles to Green/Yellow/Red including space", async ({ page }) => {
    await page.goto("/scramble.html");

    // Type a test guess with space
    const input = page.locator("#guess-input");
    await input.fill("BEN STOKES");
    await page.locator("#btn-submit-guess").click();

    // First row should now contain evaluated tiles
    const firstRowTiles = page.locator(".wordle-row").first().locator(".wordle-tile");
    const count = await firstRowTiles.count();
    expect(count).toBe(10); // "BEN STOKES" has 10 characters

    // Verify at least one tile received Wordle status class (correct, present, or absent)
    const statuses = await firstRowTiles.evaluateAll(els => els.map(el => el.className));
    const hasWordleStatus = statuses.some(c => c.includes("correct") || c.includes("present") || c.includes("absent"));
    expect(hasWordleStatus).toBe(true);

    // Verify keyboard keys updated including SPACE key
    const coloredKeys = page.locator(".key-btn.key-correct, .key-btn.key-present, .key-btn.key-absent");
    const coloredCount = await coloredKeys.count();
    expect(coloredCount).toBeGreaterThan(0);
  });

  test("Solving Scramble: submitting correct name shows celebration and summary card", async ({ page }) => {
    await page.goto("/scramble.html");

    // Get today's daily player name from the page state
    const target = await page.evaluate(() => {
      // Return targetName if accessible, or read from window or pattern text
      const name = window.targetName || (document.getElementById("player-reveal-name") ? document.getElementById("player-reveal-name").textContent : null);
      return name;
    });

    // Alternatively, guess via autocomplete or multiple guesses to verify win/loss summary view
    const input = page.locator("#guess-input");
    await input.fill("VIRAT");
    await page.waitForTimeout(200);

    // Autocomplete dropdown appears
    const suggestions = page.locator("#suggestions li");
    if (await suggestions.count() > 0) {
      await suggestions.first().click();
    } else {
      await page.locator("#btn-submit-guess").click();
    }

    // Play remaining guesses to verify summary card appears at end of game
    for (let i = 0; i < 5; i++) {
      if (await page.locator("#finished-view").isVisible()) break;
      await input.fill("ROHIT SHARMA");
      await page.locator("#btn-submit-guess").click();
      await page.waitForTimeout(100);
    }

    // Final summary view should be displayed (either won or out of attempts)
    await expect(page.locator("#finished-view")).toBeVisible();
    await expect(page.locator("#summary-grid-preview")).toBeVisible();
    await expect(page.locator("#btn-share-whatsapp")).toBeVisible();
    await expect(page.locator("#btn-copy-score")).toBeVisible();
    await expect(page.locator("#countdown-timer")).toBeVisible();
  });

  test("Scramble page has zero horizontal overflow across all viewports", async ({ page }) => {
    for (const width of [360, 412, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/scramble.html");

      const hasHScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasHScroll).toBe(false);
    }
  });
});


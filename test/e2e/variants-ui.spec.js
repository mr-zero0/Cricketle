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

test.describe("Member Gating on Variants", () => {
  test("unauthenticated visitor sees Member Access Only modal on bonus variants", async ({ page }) => {
    // Force unauthenticated
    await page.route("/api/me", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });
    await page.goto("/journey.html");
    await expect(page.locator("#member-gate-modal")).toBeVisible();
    await expect(page.locator("#guess-input")).toBeDisabled();
  });
});

test.describe("Full UI & Gameplay Tests (Authenticated Member)", () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate member
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

  test("Hub: renders all 9 live game cards", async ({ page }) => {
    const errors = monitorConsole(page);
    await page.goto("/hub.html");

    await expect(page.locator(".hub-hero h2")).toContainText("CHOOSE YOUR CHALLENGE");

    // 9 Live game cards
    await expect(page.locator("#tile-cricketle")).toBeVisible();
    await expect(page.locator("#tile-connections")).toBeVisible();
    await expect(page.locator("#tile-journey")).toBeVisible();
    await expect(page.locator("#tile-scorecard")).toBeVisible();
    await expect(page.locator("#tile-puzzle")).toBeVisible();
    await expect(page.locator("#tile-pixel")).toBeVisible();
    await expect(page.locator("#tile-stadium")).toBeVisible();
    await expect(page.locator("#tile-facts")).toBeVisible();
    await expect(page.locator("#tile-scramble")).toBeVisible();

    // Topbar Auth Button shows signed-in state
    const authBtn = page.locator("#topbar-auth-btn");
    await expect(authBtn).toBeVisible();
    await expect(authBtn).toHaveClass(/signed-in/);

    expect(errors.filter((e) => !e.includes("404") && !e.includes("favicon") && !e.includes("accounts.google.com"))).toEqual([]);
  });

  test("Hub: clicking game tiles navigates to correct game pages", async ({ page }) => {
    await page.goto("/hub.html");
    await page.locator("#tile-journey").click();
    await expect(page).toHaveURL(/journey\.html/);
    await expect(page.locator("h1")).toContainText("IPL Journey");
  });

  test("Mobile Variants Rail: visible on phone and hidden on desktop", async ({ page, isMobile }) => {
    await page.goto("/hub.html");
    const bar = page.locator(".mobile-variants-bar");

    if (isMobile) {
      await expect(bar).toBeVisible();
      const pills = bar.locator(".mv-pill");
      await expect(pills).toHaveCount(10);
      await expect(bar.locator('.mv-pill[data-game="hub"]')).toHaveClass(/active/);
    } else {
      await expect(bar).toBeHidden();
      await expect(page.locator(".nav")).toBeVisible();
    }
  });

  test("Mobile Variants Rail: can switch variants directly", async ({ page, isMobile }) => {
    if (!isMobile) test.skip();

    await page.goto("/journey.html");
    const bar = page.locator(".mobile-variants-bar");
    await expect(bar).toBeVisible();
    await expect(bar.locator('.mv-pill[data-game="journey"]')).toHaveClass(/active/);

    // Switch to Connections
    await bar.locator('.mv-pill[data-game="connections"]').click();
    await expect(page).toHaveURL(/connections\.html/);
    await expect(page.locator("h1")).toContainText("Cricket Connections");

    // Switch to Stadium
    await page.locator('.mobile-variants-bar .mv-pill[data-game="stadium"]').click();
    await expect(page).toHaveURL(/stadium\.html/);
    await expect(page.locator("h1")).toContainText("Stadium Mystery");
  });

  test("IPL Journey UI: renders timeline steps with official team logos", async ({ page }) => {
    const errors = monitorConsole(page);
    await page.goto("/journey.html");

    await expect(page.locator("h1")).toContainText("IPL Journey");

    // Gate is hidden for member
    await expect(page.locator("#member-gate-modal")).toBeHidden();

    // Timeline trail and steps
    const steps = page.locator(".trail-step");
    await expect(steps.first()).toBeVisible();

    // Team logo image
    const logoImg = steps.first().locator(".team-badge-icon img");
    await expect(logoImg).toBeVisible();
    const src = await logoImg.getAttribute("src");
    expect(src).toMatch(/logos\/ipl\/\w+\.png/);

    // Metadata pills
    await expect(page.locator("#meta-country-role")).toBeVisible();
    await expect(page.locator("#meta-matches")).toContainText("IPL Matches");

    // Input enabled for member
    await expect(page.locator("#guess-input")).toBeEnabled();

    // Mode toggle switches to IPL Legends
    const legendsBtn = page.locator("#mode-hard");
    await legendsBtn.click();
    await expect(legendsBtn).toHaveClass(/active/);

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });

  test("Cricket Connections UI: 4x4 grid of 16 players, selection & controls", async ({ page }) => {
    const errors = monitorConsole(page);
    await page.goto("/connections.html");

    await expect(page.locator("h1")).toContainText("Cricket Connections");
    await expect(page.locator("#member-gate-modal")).toBeHidden();

    // 16 Player tiles with distinct unique ids
    const tiles = page.locator(".conn-tile");
    await expect(tiles).toHaveCount(16);
    const tileIds = await tiles.evaluateAll((list) => list.map((el) => el.getAttribute("data-id")));
    expect(new Set(tileIds).size).toBe(16);

    // Selection: clicking a tile selects only that single tile
    await tiles.nth(0).click();
    await expect(page.locator(".conn-tile.selected")).toHaveCount(1);
    await expect(tiles.nth(0)).toHaveClass(/selected/);
    await expect(tiles.nth(1)).not.toHaveClass(/selected/);
    await tiles.nth(1).click();
    await tiles.nth(2).click();
    await tiles.nth(3).click();
    await expect(page.locator(".conn-tile.selected")).toHaveCount(4);

    // Deselect all
    await page.locator("#btn-deselect").click();
    await expect(page.locator(".conn-tile.selected")).toHaveCount(0);

    // Shuffle rearranges tiles
    await page.locator("#btn-shuffle").click();
    await expect(tiles).toHaveCount(16);

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });

  test("Stadium Mystery UI: SVG blueprint, boundary meters, autocomplete", async ({ page }) => {
    const errors = monitorConsole(page);
    await page.goto("/stadium.html");

    await expect(page.locator("h1")).toContainText("Stadium Mystery");
    await expect(page.locator("#member-gate-modal")).toBeHidden();

    // Blueprint container and boundary meters
    await expect(page.locator(".stadium-svg")).toBeVisible();
    await expect(page.locator("#svg-dist-straight")).toBeVisible();
    await expect(page.locator("#svg-dist-square-l")).toBeVisible();

    // Input and autocomplete
    const input = page.locator("#guess-input");
    await expect(input).toBeEnabled();
    await input.fill("Lord");
    const suggestions = page.locator("#suggestions li");
    await expect(suggestions.first()).toBeVisible();
    await expect(suggestions.first()).toContainText("Lord's");

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });

  test("Scorecard Mystery UI: historic match board and scorecard table", async ({ page }) => {
    const errors = monitorConsole(page);
    await page.goto("/scorecard.html");

    await expect(page.locator("h1")).toContainText("Scorecard Mystery");
    await expect(page.locator(".scorecard-card")).toBeVisible();
    await expect(page.locator("#scorecard-body")).toBeVisible();
    await expect(page.locator(".mystery-badge").first()).toBeVisible();

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });

  test("Puzzle Cricketer UI: interactive rearrangeable puzzle and 3 attempts", async ({ page }) => {
    const errors = monitorConsole(page);
    await page.goto("/puzzle.html");

    await expect(page.locator("h1")).toContainText("Puzzle Cricketer");
    await expect(page.locator("#puzzle-canvas")).toBeVisible();
    await expect(page.locator("#btn-reset-scramble")).toBeVisible();
    await expect(page.locator("#guess-input")).toBeEnabled();
    await expect(page.locator("#btn-guess")).toBeVisible();
    
    // Exactly 3 attempts dots
    const dots = page.locator("#attempts-track .attempt-dot");
    await expect(dots).toHaveCount(3);

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });

  test("Pixel Cricketer UI: photo unblur container and active controls", async ({ page }) => {
    const errors = monitorConsole(page);
    await page.goto("/pixel.html");

    await expect(page.locator("h1")).toContainText("Pixel Cricketer");
    await expect(page.locator("#pixel-canvas")).toBeVisible();
    await expect(page.locator("#guess-input")).toBeEnabled();
    await expect(page.locator("#btn-guess")).toBeVisible();
    await expect(page.locator("#btn-skip")).toBeVisible();

    // 6 attempts dots
    const dots = page.locator("#attempts-track .attempt-dot");
    await expect(dots).toHaveCount(6);

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });
});

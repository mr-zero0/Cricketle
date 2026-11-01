"use strict";

const { test, expect } = require("@playwright/test");

test.describe("Mobile Virtual Keyboard & Clue In View", () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate user so member-gated variants render their game views
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

  test("Classic Cricketle: focusing input hides fixed bottom tabbar on phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/index.html");

    // Close onboard dialog if open
    const onboardClose = page.locator("#onboard [data-close]");
    if (await onboardClose.isVisible()) {
      await onboardClose.click();
    }

    const tabbar = page.locator(".tabbar");
    await expect(tabbar).toBeVisible();

    // Start puzzle
    const startBtn = page.getByRole("button", { name: "Start puzzle" });
    if (await startBtn.isVisible()) {
      await startBtn.click();
    }

    const input = page.locator("#guess-input");
    await expect(input).toBeEnabled();

    await input.focus();
    await page.waitForTimeout(300);

    // Body gets keyboard-open
    await expect(page.locator("body")).toHaveClass(/keyboard-open/);
    // Fixed bottom tabbar hidden so it never floats over virtual keyboard
    await expect(tabbar).toBeHidden();
  });

  test("Journey: focusing input unsticks variants bar and keeps timeline clue visible", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/journey.html");
    const variantsBar = page.locator(".mobile-variants-bar");
    const timeline = page.locator(".journey-card");
    const input = page.locator("#guess-input");

    await expect(variantsBar).toBeVisible();
    await expect(timeline).toBeVisible();

    await input.focus();
    await page.waitForTimeout(300);

    await expect(page.locator("body")).toHaveClass(/keyboard-open/);

    // Mobile variants bar should become static (not sticky) so it does not crowd the viewport
    const pos = await variantsBar.evaluate(el => window.getComputedStyle(el).position);
    expect(pos).toBe("static");

    // The timeline clue MUST remain visible above the input
    await expect(timeline).toBeVisible();

    // Type a player name
    await input.fill("Virat");
    await page.waitForTimeout(200);

    const suggestions = page.locator(".suggestions");
    if (await suggestions.isVisible()) {
      const maxHeight = await suggestions.evaluate(el => window.getComputedStyle(el).maxHeight);
      expect(parseInt(maxHeight)).toBeLessThanOrEqual(250);
    }
  });

  test("Stadium: focusing input keeps stadium blueprint visible and unsticks variants bar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/stadium.html");
    const variantsBar = page.locator(".mobile-variants-bar");
    const blueprint = page.locator(".stadium-blueprint-card");
    const input = page.locator("#guess-input");

    await expect(variantsBar).toBeVisible();
    await expect(blueprint).toBeVisible();

    await input.focus();
    await page.waitForTimeout(300);

    await expect(page.locator("body")).toHaveClass(/keyboard-open/);
    await expect(blueprint).toBeVisible();

    const pos = await variantsBar.evaluate(el => window.getComputedStyle(el).position);
    expect(pos).toBe("static");
  });

  test("Scorecard: focusing input keeps scorecard table visible and compact", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/scorecard.html");
    const scorecardCard = page.locator(".scorecard-card");
    const input = page.locator("#guess-input");

    await expect(scorecardCard).toBeVisible();

    await input.focus();
    await page.waitForTimeout(300);

    await expect(page.locator("body")).toHaveClass(/keyboard-open/);
    await expect(scorecardCard).toBeVisible();

    const tableWrap = page.locator(".scorecard-table-wrap");
    const maxHeight = await tableWrap.evaluate(el => window.getComputedStyle(el).maxHeight);
    expect(parseInt(maxHeight)).toBeLessThanOrEqual(160);
  });
});

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

test.describe("Fact or Fiction — Member Gating", () => {
  test("unauthenticated visitor sees Member Access Only modal on facts.html", async ({ page }) => {
    await page.route("/api/me", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });
    await page.goto("/facts.html");
    await expect(page.locator("#member-gate-modal")).toBeVisible();
    await expect(page.locator("#btn-submit-round")).toBeDisabled();
  });
});

test.describe("Fact or Fiction — 1 Daily Challenge Gameplay", () => {
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

  test("Facts UI: renders 6 cards, tallies, dual-choice selection, and submission", async ({ page }) => {
    const errors = monitorConsole(page);
    await page.goto("/facts.html");
    await expect(page.locator("h1")).toContainText("Fact or Fiction");

    // Check round indicator and subtitle
    await expect(page.locator("#step-pill-0")).toHaveClass(/active/);
    await expect(page.locator("#facts-theme-tag")).toContainText("Daily Trivia");
    await expect(page.locator("#count-real-num")).toHaveText("0");
    await expect(page.locator("#count-fake-num")).toHaveText("0");

    // Exactly 6 fact cards rendered for the daily challenge
    const cards = page.locator(".fact-card");
    await expect(cards).toHaveCount(6);

    // Submit button initially disabled
    const submitBtn = page.locator("#btn-submit-round");
    await expect(submitBtn).toBeDisabled();

    // Select 3 as real, 3 as fake
    await cards.nth(0).locator('.choice-btn[data-choice="real"]').click();
    await cards.nth(1).locator('.choice-btn[data-choice="real"]').click();
    await cards.nth(2).locator('.choice-btn[data-choice="real"]').click();

    await expect(page.locator("#count-real-num")).toHaveText("3");

    await cards.nth(3).locator('.choice-btn[data-choice="fake"]').click();
    await cards.nth(4).locator('.choice-btn[data-choice="fake"]').click();
    await cards.nth(5).locator('.choice-btn[data-choice="fake"]').click();

    await expect(page.locator("#count-fake-num")).toHaveText("3");

    // Submit button should now be enabled
    await expect(submitBtn).toBeEnabled();

    // Submit daily challenge
    await submitBtn.click();

    // Explanations and verdict header should now be visible on cards
    await expect(cards.nth(0).locator(".fact-explanation-box")).toBeVisible();
    await expect(cards.nth(0).locator(".verdict-header")).toBeVisible();

    // Finished view shown with score out of 6 and share controls
    await expect(page.locator("#finished-view")).toBeVisible();
    await expect(page.locator("#final-score-display")).toBeVisible();
    await expect(page.locator("#final-score-display")).toContainText("/ 6");
    await expect(page.locator("#summary-grid-preview")).toBeVisible();
    await expect(page.locator("#btn-copy-score")).toBeVisible();
    await expect(page.locator("#btn-share-whatsapp")).toBeVisible();
    await expect(page.locator("#countdown-timer")).toBeVisible();

    // Check for fatal console errors
    const fatal = errors.filter(e => !e.includes("favicon") && !e.includes("401"));
    expect(fatal).toHaveLength(0);
  });

  test("Facts page has zero horizontal overflow on mobile and desktop", async ({ page }) => {
    for (const width of [360, 412, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/facts.html");

      const hasHScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasHScroll).toBe(false);
    }
  });
});

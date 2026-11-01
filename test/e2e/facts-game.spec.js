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

test.describe("Fact or Fiction — Full Gameplay & Rounds", () => {
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

  test("Facts UI: renders 6 cards, round 1, tallies, and dual-choice selection", async ({ page }) => {
    const errors = monitorConsole(page);
    await page.goto("/facts.html");
    await expect(page.locator("h1")).toContainText("Fact or Fiction");

    // Check round indicator and subtitle
    await expect(page.locator("#step-pill-0")).toHaveClass(/active/);
    await expect(page.locator("#facts-theme-tag")).toContainText("Round 1");
    await expect(page.locator("#count-real-num")).toHaveText("0");
    await expect(page.locator("#count-fake-num")).toHaveText("0");

    // 6 fact cards rendered
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

    // Submit round 1
    await submitBtn.click();

    // Explanations and verdict header should now be visible
    await expect(cards.nth(0).locator(".fact-explanation-box")).toBeVisible();
    await expect(cards.nth(0).locator(".verdict-header")).toBeVisible();

    // Next round button should appear
    const nextBtn = page.locator("#btn-next-round");
    await expect(nextBtn).toBeVisible();
    await expect(nextBtn).toContainText("Continue to Round 2 →");

    // Proceed to Round 2
    await nextBtn.click();
    await expect(page.locator("#step-pill-1")).toHaveClass(/active/);
    await expect(page.locator("#facts-theme-tag")).toContainText("Round 2");
    await expect(page.locator("#count-real-num")).toHaveText("0");
    await expect(page.locator("#count-fake-num")).toHaveText("0");

    // Check for fatal console errors
    const fatal = errors.filter(e => !e.includes("favicon"));
    expect(fatal).toHaveLength(0);
  });

  test("Play through all 3 rounds to reach daily completion summary", async ({ page }) => {
    await page.goto("/facts.html");

    for (let round = 0; round < 3; round++) {
      await expect(page.locator(`#step-pill-${round}`)).toHaveClass(/active/);
      const cards = page.locator(".fact-card");
      await expect(cards).toHaveCount(6);

      // Choose 3 real and 3 fake
      await cards.nth(0).locator('.choice-btn[data-choice="real"]').click();
      await cards.nth(1).locator('.choice-btn[data-choice="real"]').click();
      await cards.nth(2).locator('.choice-btn[data-choice="real"]').click();
      await cards.nth(3).locator('.choice-btn[data-choice="fake"]').click();
      await cards.nth(4).locator('.choice-btn[data-choice="fake"]').click();
      await cards.nth(5).locator('.choice-btn[data-choice="fake"]').click();

      await page.locator("#btn-submit-round").click();

      if (round < 2) {
        await page.locator("#btn-next-round").click();
      }
    }

    // After Round 3, summary view is shown
    await expect(page.locator("#finished-view")).toBeVisible();
    await expect(page.locator("#final-score-display")).toBeVisible();
    await expect(page.locator("#summary-grid-preview")).toBeVisible();
    await expect(page.locator("#btn-copy-score")).toBeVisible();
    await expect(page.locator("#btn-share-whatsapp")).toBeVisible();
    await expect(page.locator("#countdown-timer")).toBeVisible();
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

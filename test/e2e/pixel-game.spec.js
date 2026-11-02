const { test, expect } = require("@playwright/test");

test.describe("Pixel Cricketer — Daily Photo Unblur Gameplay", () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate member so gameplay controls are active
    await page.route("/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: 1, username: "cricketfan", phone: "+919876543210" },
        }),
      });
    });
    await page.goto("/pixel.html");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test("Pixel Member Gate: unauthenticated visitor sees Member Access Only modal", async ({ page }) => {
    await page.unroute("/api/me");
    await page.route("/api/me", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });
    await page.goto("/pixel.html");
    await expect(page.locator("#member-gate-modal")).toBeVisible();
    await expect(page.locator("#guess-input")).toBeDisabled();
  });

  test("Pixel UI: renders canvas, 6 attempt dots, skip and guess controls", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Pixel Cricketer");
    await expect(page.locator("h2")).toContainText("PIXEL CRICKETER");
    await expect(page.locator("#pixel-canvas")).toBeVisible();

    // 6 attempts dots
    const dots = page.locator("#attempts-track .attempt-dot");
    await expect(dots).toHaveCount(6);
    await expect(dots.first()).toHaveClass(/current/);

    // Controls
    await expect(page.locator("#guess-input")).toBeEnabled();
    await expect(page.locator("#btn-guess")).toBeVisible();
    await expect(page.locator("#btn-skip")).toBeVisible();
  });

  test("Pixel Gameplay: skip button unblurs photo and consumes attempt", async ({ page }) => {
    await expect(page.locator("#pixel-canvas")).toBeVisible();

    // Click skip
    await page.locator("#btn-skip").click();

    // First attempt dot should now be marked
    const dots = page.locator("#attempts-track .attempt-dot");
    await expect(dots.nth(0)).toHaveClass(/used-wrong/);
    await expect(dots.nth(1)).toHaveClass(/current/);

    // Guess history records skipped
    const historyItem = page.locator("#guess-history .guess-item");
    await expect(historyItem).toHaveCount(1);
    await expect(historyItem.first()).toContainText("Skipped");
  });

  test("Pixel Autocomplete: typing shows matching players and clicking fills input", async ({ page }) => {
    const input = page.locator("#guess-input");
    await input.focus();
    await input.fill("Virat");

    const suggestions = page.locator("#suggestions li");
    await expect(suggestions.first()).toBeVisible();
    const count = await suggestions.count();
    expect(count).toBeGreaterThan(0);

    const firstText = await suggestions.first().textContent();
    expect(firstText).toContain("Virat Kohli");

    // Click suggestion
    await suggestions.first().click();

    // Guess history now has an entry
    const historyItem = page.locator("#guess-history .guess-item");
    await expect(historyItem).toHaveCount(1);
  });

  test("Pixel Responsiveness: zero horizontal overflow", async ({ page }) => {
    const viewports = [
      { width: 360, height: 740 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 }
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto("/pixel.html");
      await page.waitForTimeout(300);

      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(overflow).toBe(false);
    }
  });
});


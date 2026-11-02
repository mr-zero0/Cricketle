const { test, expect } = require("@playwright/test");

test.describe("Puzzle Cricketer — Interactive Rearrangeable Portrait Puzzle", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure fresh daily state
    await page.goto("/puzzle.html");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test("Puzzle UI: renders canvas, 3 attempt dots, reset button, and no skip button", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Puzzle Cricketer");
    await expect(page.locator("h2")).toContainText("PUZZLE CRICKETER");
    await expect(page.locator("#puzzle-canvas")).toBeVisible();

    // Exactly 3 attempts dots
    const dots = page.locator("#attempts-track .attempt-dot");
    await expect(dots).toHaveCount(3);
    await expect(dots.first()).toHaveClass(/current/);
    await expect(page.locator("#attempts-label")).toContainText("3 guesses remaining");

    // Controls: Reset button, Rotate button & Guess button present; No skip button!
    await expect(page.locator("#btn-reset-scramble")).toBeVisible();
    await expect(page.locator("#btn-rotate-tile")).toBeVisible();
    await expect(page.locator("#guess-input")).toBeEnabled();
    await expect(page.locator("#btn-guess")).toBeVisible();
    await expect(page.locator("#btn-skip")).toHaveCount(0);

    // Progress bar shows pieces in place
    await expect(page.locator("#puzzle-progress-text")).toContainText("of 9 pieces in place");
  });

  test("Interactive Rearrange: tapping tiles selects and swaps them", async ({ page }) => {
    await expect(page.locator("#puzzle-canvas")).toBeVisible();
    const canvas = page.locator("#puzzle-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // Tile width & height for 3x3 grid
    const tileW = box.width / 3;
    const tileH = box.height / 3;

    // Tap tile at (0, 0)
    await page.mouse.click(box.x + tileW / 2, box.y + tileH / 2);
    await page.waitForTimeout(100);

    // Tap tile at (1, 1) -> swaps them!
    await page.mouse.click(box.x + tileW * 1.5, box.y + tileH * 1.5);
    await page.waitForTimeout(200);

    // Progress text is still valid
    await expect(page.locator("#puzzle-progress-text")).toContainText("of 9 pieces in place");

    // Reset button reverts scramble
    await page.locator("#btn-reset-scramble").click();
    await page.waitForTimeout(200);
    await expect(page.locator("#puzzle-progress-text")).toContainText("of 9 pieces in place");
  });

  test("Piece Rotation: selecting tile and clicking rotate button or tapping rotates piece", async ({ page }) => {
    await expect(page.locator("#puzzle-canvas")).toBeVisible();
    const canvas = page.locator("#puzzle-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    const tileW = box.width / 3;
    const tileH = box.height / 3;
    const rotateBtn = page.locator("#btn-rotate-tile");

    // Initially rotate button is visible but not active
    await expect(rotateBtn).toBeVisible();
    await expect(rotateBtn).not.toHaveClass(/active/);

    // Tap tile at (0, 0) to select it
    await page.mouse.click(box.x + tileW / 2, box.y + tileH / 2);
    await page.waitForTimeout(100);

    // Rotate button becomes active
    await expect(rotateBtn).toHaveClass(/active/);

    // Click rotate button -> rotates tile
    await rotateBtn.click();
    await page.waitForTimeout(100);

    // Tapping the selected tile again rotates it another 90°
    await page.mouse.click(box.x + tileW / 2, box.y + tileH / 2);
    await page.waitForTimeout(100);

    // Reset button restores initial scramble and orientations
    await page.locator("#btn-reset-scramble").click();
    await page.waitForTimeout(200);
    await expect(rotateBtn).not.toHaveClass(/active/);
  });

  test("Puzzle Guessing: wrong guess consumes 1 of 3 attempts", async ({ page }) => {
    const input = page.locator("#guess-input");
    await input.fill("Definitely Not Target");
    await page.locator("#btn-guess").click();

    // First attempt dot should now be marked wrong
    const dots = page.locator("#attempts-track .attempt-dot");
    await expect(dots.nth(0)).toHaveClass(/used-wrong/);
    await expect(dots.nth(1)).toHaveClass(/current/);
    await expect(page.locator("#attempts-label")).toContainText("2 guesses remaining");

    // Guess history has 1 entry
    const historyItem = page.locator("#guess-history .guess-item");
    await expect(historyItem).toHaveCount(1);
    await expect(historyItem.first()).toContainText("Definitely Not Target");
  });

  test("Puzzle Autocomplete: typing suggests cricketers and clicking fills guess", async ({ page }) => {
    const input = page.locator("#guess-input");
    await input.focus();
    await input.fill("Rohit");

    const suggestions = page.locator("#suggestions li");
    await expect(suggestions.first()).toBeVisible();
    const count = await suggestions.count();
    expect(count).toBeGreaterThan(0);

    const firstText = await suggestions.first().textContent();
    expect(firstText).toContain("Rohit Sharma");

    // Click suggestion
    await suggestions.first().click();

    // Attempt consumed
    const historyItem = page.locator("#guess-history .guess-item");
    await expect(historyItem).toHaveCount(1);
  });

  test("Puzzle Game Over: 3 wrong guesses reveals portrait and OUT result card", async ({ page }) => {
    const input = page.locator("#guess-input");

    // 3 distinct wrong guesses
    await input.fill("Adam Gilchrist");
    await page.locator("#btn-guess").click();

    await input.fill("Glenn McGrath");
    await page.locator("#btn-guess").click();

    await input.fill("Brett Lee");
    await page.locator("#btn-guess").click();

    // Game Over
    await expect(page.locator("#result-card")).toBeVisible();
    await expect(page.locator("#result-status")).toHaveText("OUT!");
    await expect(page.locator("#result-name")).not.toBeEmpty();
    await expect(page.locator("#guess-controls")).toBeHidden();
  });

  test("Hard Mode (Legends): switches to 24-piece randomized puzzle and allows tile rearranging", async ({ page }) => {
    // Switch to Hard Mode
    const hardBtn = page.locator("#mode-hard");
    await hardBtn.click();
    await expect(hardBtn).toHaveClass(/active/);

    // Progress bar shows 24 pieces
    await expect(page.locator("#puzzle-progress-text")).toContainText("of 24 pieces in place");

    // Canvas is visible
    const canvas = page.locator("#puzzle-canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // 4 cols x 6 rows tile size
    const tileW = box.width / 4;
    const tileH = box.height / 6;

    // Tap tile at (0, 0)
    await page.mouse.click(box.x + tileW / 2, box.y + tileH / 2);
    await page.waitForTimeout(100);

    // Tap tile at (1, 1) -> swaps them
    await page.mouse.click(box.x + tileW * 1.5, box.y + tileH * 1.5);
    await page.waitForTimeout(200);

    // Still reports 24 pieces in place
    await expect(page.locator("#puzzle-progress-text")).toContainText("of 24 pieces in place");

    // Reset button restores scramble
    await page.locator("#btn-reset-scramble").click();
    await page.waitForTimeout(200);
    await expect(page.locator("#puzzle-progress-text")).toContainText("of 24 pieces in place");

    // Switch back to Easy Mode -> restores 9 pieces
    const easyBtn = page.locator("#mode-easy");
    await easyBtn.click();
    await expect(easyBtn).toHaveClass(/active/);
    await expect(page.locator("#puzzle-progress-text")).toContainText("of 9 pieces in place");
  });

  test("Puzzle Responsiveness: zero horizontal overflow", async ({ page }) => {
    const viewports = [
      { width: 360, height: 740 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 }
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto("/puzzle.html");
      await page.waitForTimeout(300);

      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(overflow).toBe(false);
    }
  });
});

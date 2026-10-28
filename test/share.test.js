"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../public/game-core.js");

function guessTiles(guesses, pSize) {
  if (!guesses || !guesses.length) return "";
  const tiles = guesses.map((g) => {
    const t = core.tier(g.rank, pSize);
    if (t.key === "answer") return "🟩";
    if (t.key === "hot") return "🟧";
    if (t.key === "warm") return "🟨";
    if (t.key === "cool") return "🟦";
    return "⬜";
  });
  if (tiles.length > 15) {
    return tiles.slice(0, 7).join("") + "…" + tiles.slice(-6).join("");
  }
  return tiles.join("");
}

test("guessTiles: maps rank tiers to standard colored square emojis", () => {
  const pSize = 100;
  const guesses = [
    { rank: 80 }, // cold -> ⬜
    { rank: 35 }, // cool -> 🟦
    { rank: 14 }, // warm -> 🟨
    { rank: 5 },  // hot  -> 🟧
    { rank: 1 },  // ans  -> 🟩
  ];
  const tiles = guessTiles(guesses, pSize);
  assert.equal(tiles, "⬜🟦🟨🟧🟩");
  assert.ok(!tiles.includes("\uFFFD"), "no replacement characters");
});

test("guessTiles: compresses overlong guess streaks with ellipsis", () => {
  const pSize = 100;
  const guesses = Array.from({ length: 20 }, (_, i) => ({ rank: 20 - i }));
  const tiles = guessTiles(guesses, pSize);
  assert.ok(tiles.includes("…"));
  assert.ok(tiles.endsWith("🟩"));
});

test("WhatsApp URL: uses standard api.whatsapp.com and preserves all emojis", () => {
  const text = "🏏 Cricketle · 28-Oct-26 (# 5.6.13)\nEasy Mode · 3/3 Solved\n⏱️ Total Time: 04:27\n🏆 Points: 195 pts · 🔥 1-day streak\n\nP1: ⬜🟦🟨🟧🟩 · 86 pts (5 guesses)\n\nPlay now: https://mr-zero0.github.io/Cricketle";
  const encoded = encodeURIComponent(text);
  const url = `https://api.whatsapp.com/send?text=${encoded}`;

  assert.ok(url.startsWith("https://api.whatsapp.com/send?text="));
  assert.ok(!url.includes("whatsapp://"));

  const decoded = decodeURIComponent(url.split("text=")[1]);
  assert.equal(decoded, text);
  assert.ok(!decoded.includes("\uFFFD"), "no Unicode replacement diamond characters");
});

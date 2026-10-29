"use strict";
// The pages must work under `script-src 'self'`: no inline scripts, no inline
// event handlers, no javascript: URLs. Reads the shipped HTML straight from disk.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "public");
const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".html"));

test("every page exists to be checked", () => {
  assert.ok(pages.includes("index.html") && pages.includes("admin.html"), pages.join(","));
});

for (const page of pages) {
  const html = fs.readFileSync(path.join(PUBLIC, page), "utf8");

  test(`${page}: no inline <script> blocks`, () => {
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter((m) => !/\bsrc\s*=/.test(m[1]) && m[2].trim().length > 0);
    assert.deepEqual(inline.map((m) => m[2].trim().slice(0, 60)), []);
  });

  test(`${page}: no inline event handler attributes`, () => {
    const handlers = [...html.matchAll(/\son[a-z]+\s*=\s*["']/gi)].map((m) => m[0].trim());
    assert.deepEqual(handlers, []);
  });

  test(`${page}: no javascript: URLs`, () => {
    assert.ok(!/href\s*=\s*["']\s*javascript:/i.test(html));
  });
}

// The GitHub Pages copies of index.html / admin.html at the project root exist only
// to send visitors to the hosted server, where accounts and leaderboards work.
test("the GitHub Pages entry pages redirect to the hosted server, not to the static copy", () => {
  const HOST = "https://cricketle-sy03.onrender.com/";
  for (const page of ["index.html", "admin.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
    assert.ok(html.includes(HOST), page + " names the hosted server");
    assert.ok(!/location\.replace\(\s*["']public\//.test(html), page + " must not redirect into public/");
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    for (const body of scripts) assert.ok(body.includes("cricketle-sy03.onrender.com"), page + " script redirects to the server");
  }
  const app = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  assert.match(app, /const siteUrl = "https:\/\/cricketle-sy03\.onrender\.com"/, "share links point at the hosted game");
  const index = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.ok(index.includes('<meta property="og:url" content="https://cricketle-sy03.onrender.com/" />'), "og:url is the hosted game");
});

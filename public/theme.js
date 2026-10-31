// Cricketle theme: night (floodlit) or day (sunlit) token set.
// Picked from the IST clock (06:00 to 18:00 is day) unless the player chose one
// with the header toggle; that choice is kept in localStorage. This runs in
// <head> so the first paint already has the right tokens, which is why the IST
// rule is repeated here instead of waiting for game-core.js (core.sceneForHour).
//
// Exposes window.CricketleTheme = { current(), mode(), toggle(), onChange(fn) }.

(function (root) {
  "use strict";

  const KEY = "cricketle:v3:theme";
  const META_COLOR = { day: "#bfe3ff", night: "#0b1220" };
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const listeners = [];
  // ?theme=day|night forces a scene for this page load only (screenshots, audits).
  const param = new URLSearchParams(location.search).get("theme");
  const forced = param === "day" || param === "night" ? param : null;
  let override = forced || read(); // "day" | "night" | null (auto)
  let current = null;

  function read() {
    try {
      const v = localStorage.getItem(KEY);
      return v === "day" || v === "night" ? v : null;
    } catch (_) {
      return null;
    }
  }

  function write(v) {
    try {
      if (v) localStorage.setItem(KEY, v);
      else localStorage.removeItem(KEY);
    } catch (_) {
      // Storage blocked: the choice lasts for this page only.
    }
  }

  function sceneNow() {
    const h = new Date(Date.now() + IST_OFFSET_MS).getUTCHours();
    return h >= 6 && h < 18 ? "day" : "night";
  }

  function labelButton() {
    const btn = document.getElementById("theme-btn");
    if (btn) btn.setAttribute("aria-label", current === "day" ? "Switch to night" : "Switch to day");
  }

  function apply() {
    const next = override || sceneNow();
    if (next === current) return;
    current = next;
    document.documentElement.setAttribute("data-theme", next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", META_COLOR[next]);
    labelButton();
    for (const fn of listeners) {
      try { fn(next); } catch (err) { console.error(err); }
    }
  }

  function toggle() {
    override = current === "day" ? "night" : "day";
    write(override);
    apply();
  }

  apply();
  setInterval(apply, 60 * 1000);

  // The web-font stylesheet is linked as media="print" so it never blocks the
  // first paint; switch it on once it has arrived (system fonts show until then).
  const fontCss = document.getElementById("font-css");
  if (fontCss) {
    const enable = () => { fontCss.media = "all"; };
    if (fontCss.sheet) enable();
    else fontCss.addEventListener("load", enable, { once: true });
  }

  // The button is parsed after this script.
  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("theme-btn");
    if (btn) {
      labelButton();
      btn.addEventListener("click", toggle);
    }
    const activePill = document.querySelector(".mv-pill.active");
    if (activePill) {
      activePill.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
    }
  });

  root.CricketleTheme = {
    current: () => current,
    mode: () => override || "auto",
    toggle,
    onChange: (fn) => { listeners.push(fn); },
  };
})(window);

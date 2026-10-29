"use strict";
// Phone numbers are stored and compared as E.164 strings ("+" followed by
// 8 to 15 digits, first digit 1-9). Requests must already carry the country
// code; the one place that still guesses "+91" for bare Indian numbers is the
// one-time migration of rows written before this rule existed.

const E164_RE = /^\+[1-9]\d{7,14}$/;

function stripFormatting(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  return s;
}

// Strict: "+<cc><number>" or "". Never adds a country code.
function toE164(raw) {
  const s = stripFormatting(raw);
  return E164_RE.test(s) ? s : "";
}

// Migration only: the v2 heuristics for numbers typed without a country code.
function legacyToE164(raw) {
  let s = stripFormatting(raw);
  if (/^0[6-9]\d{9}$/.test(s)) s = "+91" + s.slice(1);
  else if (/^[6-9]\d{9}$/.test(s)) s = "+91" + s;
  else if (/^91[6-9]\d{9}$/.test(s)) s = "+" + s;
  else if (!s.startsWith("+") && /^\d{10,14}$/.test(s)) s = "+" + s;
  return E164_RE.test(s) ? s : "";
}

module.exports = { toE164, legacyToE164, E164_RE };

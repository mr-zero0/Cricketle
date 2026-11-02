"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Username validation & community protection module.
 * Protects players from offensive, abusive, hateful, or misleading handles.
 *
 * Configurable without hardcoding:
 * - Load custom terms via BLOCKED_WORDS or BLOCKED_USERNAMES environment variables (.env).
 * - Or place custom words in data/blocked_words.txt (automatically ignored by Git).
 * - Encoded baseline ensures standard protection without committing explicit dictionaries.
 */

const ABUSIVE_USERNAME_MESSAGE = "This username can't be chosen to avoid misuse and abuse.";

// System and staff keywords reserved for platform integrity
const RESERVED_TOKENS = new Set([
  "admin", "administrator", "moderator", "mod", "cricketle", "support",
  "official", "staff", "system", "superuser"
]);

// Encoded baseline dictionary (Base64) - decoded in-memory at runtime to prevent
// explicit vulgarity from appearing in repository source code or Git history.
const ENCODED_BASELINE_TERMS =
  "ZnVjayxmdWssZmNrLGZ1Y2tlcixmdWNraW5nLG1vdGhlcmZ1Y2tlcixzaGl0LHNoaXRlLHNoaXR0eSxidWxsc2hpdCxiaXRjaCxiaXRjaGVzLGJpdGNoaW5nLGN1bnQsY3VudHMsZGlja2hlYWQsY29ja3N1Y2tlcixwdXNzeSxwdXNzaWVzLGFzc2hvbGUsYXJzZWhvbGUsYmFzdGFyZCxiYXN0YXJkcyxzbHV0LHNsdXRzLHdob3JlLHdob3JlcyxibG93am9iLGhhbmRqb2IsZGVlcHRocm9hdCxwb3JuLHBvcm5vLHh4eCxib29icyx0aXRzLHRpdHRpZXMscGVuaXMsdmFnaW5hLGRpbGRvLHNlbWVuLGVqYWN1bGF0LG5pZ2dlcixuaWdnYSxuaWdnLG4xZ2dlcixuMWdnYSxmYWdnb3QsZmFnLGZhZ2csZmFndCxjaGluayxraWtlLHNwaWMsZ29vayx3ZXRiYWNrLHJldGFyZCxyZXRhcmRlZCx0ZXJyb3Jpc3QsamloYWRpLHRhbGliYW4saXNpcyxhbHFhZWRhLGFscWFpZGEsbmF6aSxuYXppcyxoaXRsZXIsaG9sb2NhdXN0LHN3YXN0aWthLHdoaXRlcG93ZXIsbHluY2gsY2hhbWFyLGJoYW5naSxyYXBlLHJhcGlzdCxyYXBpbmcscGVkb3BoaWxlLHBhZWRvcGhpbGUscGVkbyxwYWVkbyxjaGlsZHBvcm4sc3VpY2lkZSxraWxsYWxsLGdlbm9jaWRlLGJlaGVhZA==";

const ENCODED_BOUNDED_TERMS =
  "YXNzLGFyc2UsdGl0LGhlbGwsY3JhcCxob2UsYm90LHJvb3QsY3VtLGRpY2ssY29jayxhbnVz";

// Decode terms dynamically into sets in memory
function loadTerms() {
  const terms = new Set();
  try {
    const raw = Buffer.from(ENCODED_BASELINE_TERMS, "base64").toString("utf8");
    for (const w of raw.split(",")) {
      if (w) terms.add(w.trim().toLowerCase());
    }
  } catch (_) {}

  // Load custom terms from environment variable (e.g. in Render or .env)
  const envWords = (process.env.BLOCKED_WORDS || process.env.BLOCKED_USERNAMES || "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  for (const w of envWords) terms.add(w);

  // Load custom terms from git-ignored data/blocked_words.txt if present
  try {
    const customFilePath = path.join(__dirname, "..", "data", "blocked_words.txt");
    if (fs.existsSync(customFilePath)) {
      const fileContent = fs.readFileSync(customFilePath, "utf8");
      for (const line of fileContent.split("\n")) {
        const trimmed = line.trim().toLowerCase();
        if (trimmed && !trimmed.startsWith("#")) terms.add(trimmed);
      }
    }
  } catch (_) {}

  return terms;
}

function loadBoundedTerms() {
  const bounded = new Set();
  try {
    const raw = Buffer.from(ENCODED_BOUNDED_TERMS, "base64").toString("utf8");
    for (const w of raw.split(",")) {
      if (w) bounded.add(w.trim().toLowerCase());
    }
  } catch (_) {}
  return bounded;
}

const BLOCKED_TERMS_SET = loadTerms();
const BOUNDED_TERMS_SET = loadBoundedTerms();

/**
 * Normalizes username by converting to lowercase, stripping separators,
 * and replacing common leetspeak substitutions.
 */
function normalizeForProfanity(str) {
  if (!str || typeof str !== "string") return "";
  let s = str.toLowerCase();

  // Strip leading/trailing symbols
  s = s.replace(/^[_\W]+|[_\W]+$/g, "");

  // Leetspeak substitutions
  s = s
    .replace(/@/g, "a")
    .replace(/4/g, "a")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/!/g, "i")
    .replace(/\|/g, "i")
    .replace(/3/g, "e")
    .replace(/5/g, "s")
    .replace(/\$/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b");

  return s;
}

/**
 * Checks if a given username is abusive, hateful, vulgar, offensive, or reserved.
 * @param {string} username - The candidate username.
 * @returns {boolean} - True if abusive/blocked, false if clean.
 */
function isAbusiveUsername(username) {
  if (!username || typeof username !== "string") return false;

  const raw = username.toLowerCase().trim();
  const normalized = normalizeForProfanity(username);
  const stripped = normalized.replace(/[^a-z]/g, "");

  // Whitelist legitimate cricket names that might contain ambiguous substrings (like Pat Cummins)
  if (raw.includes("cummins") || raw.includes("dickwella") || raw.includes("dekock") || raw.includes("de_kock")) {
    const safeCheck = raw
      .replace(/cummins/g, "")
      .replace(/dickwella/g, "")
      .replace(/dekock/g, "")
      .replace(/de_kock/g, "");
    if (!safeCheck || safeCheck.replace(/[_\d]/g, "").length === 0) {
      return false;
    }
  }

  // 1. Check exact match on the bounded bad words set or reserved tokens
  if (BOUNDED_TERMS_SET.has(raw) || BOUNDED_TERMS_SET.has(normalized) || BOUNDED_TERMS_SET.has(stripped)) {
    return true;
  }
  if (RESERVED_TOKENS.has(raw) || RESERVED_TOKENS.has(normalized) || RESERVED_TOKENS.has(stripped)) {
    return true;
  }

  // 2. Tokenize by underscores and digits to inspect words separately
  const tokens = raw.split(/[_\d\s]+/).filter(Boolean);
  const normalizedTokens = normalized.split(/[_\d\s]+/).filter(Boolean);

  for (const t of [...tokens, ...normalizedTokens]) {
    if (BOUNDED_TERMS_SET.has(t) && t !== "root") return true;
    if (RESERVED_TOKENS.has(t)) return true;
  }

  // 3. System prefix or suffix impersonation (e.g. "admin_bob", "official_cricketle", "cricketle_support")
  if (/^admin[_\d]|admin$/i.test(raw) || /^mod[_\d]/i.test(raw) || /cricketle/i.test(raw)) {
    return true;
  }

  // 4. Check forbidden words across normalized and stripped strings
  for (const word of BLOCKED_TERMS_SET) {
    if (normalized.includes(word) || stripped.includes(word) || raw.includes(word)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  isAbusiveUsername,
  normalizeForProfanity,
  ABUSIVE_USERNAME_MESSAGE,
  RESERVED_TOKENS
};

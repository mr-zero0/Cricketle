"use strict";
// Password hashing (scrypt) and opaque session tokens.

const crypto = require("node:crypto");

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

function validUsername(u) {
  return typeof u === "string" && USERNAME_RE.test(u);
}

function validPassword(p) {
  return typeof p === "string" && p.length >= 6 && p.length <= 128;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT);
  return ["scrypt", SCRYPT.N, salt.toString("hex"), hash.toString("hex")].join("$");
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  const actual = crypto.scryptSync(password, salt, expected.length, { ...SCRYPT, N: Number(parts[1]) });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

module.exports = { validUsername, validPassword, hashPassword, verifyPassword, newToken, hashToken, USERNAME_RE };

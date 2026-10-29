"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { toE164, legacyToE164 } = require("../lib/phone.js");
const { Db } = require("../lib/db.js");

test("toE164 keeps only well-formed international numbers", () => {
  assert.equal(toE164("+91 98765-43210"), "+919876543210");
  assert.equal(toE164("0091 9876543210"), "+919876543210");
  assert.equal(toE164("(+44) 7700 900123"), "+447700900123");
  assert.equal(toE164("9876543210"), "", "bare digits are not guessed as Indian");
  assert.equal(toE164("+1"), "", "too short");
  assert.equal(toE164("+0123456789"), "", "country code cannot start with 0");
  assert.equal(toE164(""), "");
  assert.equal(toE164(undefined), "");
});

test("legacyToE164 applies the v2 Indian-number heuristics for migration only", () => {
  assert.equal(legacyToE164("9876543210"), "+919876543210");
  assert.equal(legacyToE164("09876543210"), "+919876543210");
  assert.equal(legacyToE164("919876543210"), "+919876543210");
  assert.equal(legacyToE164("+447700900123"), "+447700900123");
  assert.equal(legacyToE164("12345"), "");
  assert.equal(legacyToE164("abc"), "");
});

test("Db.migratePhones rewrites legacy phones once and lookup is exact afterwards", () => {
  const file = path.join(os.tmpdir(), `cricketle-phone-${process.pid}-${Date.now()}.db`);
  const quiet = { info() {}, warn() {}, error() {}, debug() {}, db() {}, auth() {}, game() {}, http() {}, authWarn() {} };
  try {
    const first = new Db(file, quiet);
    first.createUser("legacy_in", "x", 1, { phone: "9876543210" });
    first.createUser("uk_fine", "x", 2, { phone: "+447700900123" });
    first.createUser("garbage", "x", 3, { phone: "abc" });
    first.close();

    const second = new Db(file, quiet);
    const result = second.lastPhoneMigration;
    assert.deepEqual(result, { changed: 1, skipped: ["abc"] });
    assert.equal(second.userByName("legacy_in").phone, "+919876543210");
    assert.equal(second.userByName("uk_fine").phone, "+447700900123");
    assert.equal(second.userByName("garbage").phone, "abc");

    assert.equal(second.userByPhone("+919876543210").username, "legacy_in");
    assert.equal(second.userByPhone("9876543210"), null, "no fuzzy suffix match any more");

    // Running again changes nothing.
    second.close();
    const third = new Db(file, quiet);
    assert.deepEqual(third.lastPhoneMigration, { changed: 0, skipped: ["abc"] });
    third.close();
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(file + suffix); } catch (_) {} }
  }
});

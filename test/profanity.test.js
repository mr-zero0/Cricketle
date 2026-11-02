"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isAbusiveUsername, ABUSIVE_USERNAME_MESSAGE } = require("../lib/profanity");

const decodeList = (b64) => Buffer.from(b64, "base64").toString("utf8").split(",");

test("profanity filter blocks obvious slurs and swear words", () => {
  // Encoded test terms to avoid plain-text profanities in the repository
  const badNames = decodeList(
    "ZnVjayxmdWNrZXIsYml0Y2gsYXNzaG9sZSxjdW50LG5pZ2dlcixuaWdnYSxmYWdnb3QsYmFzdGFyZCx3aG9yZSxzbHV0LGhpdGxlcixuYXppLHRlcnJvcmlzdCxwZWRvcGhpbGU="
  );

  for (const name of badNames) {
    assert.strictEqual(
      isAbusiveUsername(name),
      true,
      `Expected test term to be blocked as abusive`
    );
  }
});

test("profanity filter catches leetspeak and separated variations", () => {
  // Encoded leetspeak terms to keep repo clean
  const leetNames = decodeList(
    "Zl91X2NfayxiMXRjaCxhNTVob2xlLGZAZ2dvdCxuMWdnZXIsc2gxdF9oZWFkLGNfdV9uX3QsaDF0bGVy"
  );

  for (const name of leetNames) {
    assert.strictEqual(
      isAbusiveUsername(name),
      true,
      `Expected leetspeak test term to be blocked`
    );
  }
});

test("profanity filter reserves system and official keywords", () => {
  const reservedNames = [
    "admin",
    "administrator",
    "moderator",
    "cricketle",
    "official_cricketle",
    "cricketle_support",
    "support_team"
  ];

  for (const name of reservedNames) {
    assert.strictEqual(
      isAbusiveUsername(name),
      true,
      `Expected reserved keyword "${name}" to be blocked`
    );
  }
});

test("profanity filter allows legitimate cricket and standard usernames", () => {
  const cleanNames = [
    "virat_kohli_18",
    "rohit_sharma_45",
    "dhoni_07",
    "joe_root",
    "classic_batter",
    "grass_roots_fan",
    "passionate_bowler",
    "steve_smith",
    "pat_cummins",
    "bumrah_boom",
    "allrounder_99",
    "cricket_lover_india"
  ];

  for (const name of cleanNames) {
    assert.strictEqual(
      isAbusiveUsername(name),
      false,
      `Expected clean name "${name}" to be accepted`
    );
  }
});

test("canonical rejection message matches user requirements exactly", () => {
  assert.strictEqual(
    ABUSIVE_USERNAME_MESSAGE,
    "This username can't be chosen to avoid misuse and abuse."
  );
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createLogger, formatIstTimestamp, maskPhone, sanitize, LEVELS } = require("../lib/logger.js");

test("formatIstTimestamp: outputs valid IST string with offset", () => {
  const t = new Date(Date.UTC(2026, 9, 28, 10, 30, 0, 0)); // 10:30 UTC -> 16:00 IST
  const str = formatIstTimestamp(t);
  assert.match(str, /^2026-10-28 16:00:00\.000 IST$/);
});

test("maskPhone: safely obscures middle digits while keeping country and last 4", () => {
  assert.equal(maskPhone("+919876543210"), "+9198****3210");
  assert.equal(maskPhone("+447123456789"), "+4471****6789");
  assert.equal(maskPhone("1234"), "1234");
});

test("sanitize: redacts sensitive keys and phones recursively", () => {
  const input = {
    username: "aman",
    pin: "123456",
    password: "mySecretPassword!",
    nested: {
      secretToken: "xyz-abc",
      token: "secret-token-value",
      phone: "+919876543210",
      normal: "ok",
    },
    list: [{ pin: "9999" }, "regular text"],
  };

  const clean = sanitize(input);
  assert.equal(clean.username, "aman");
  assert.equal(clean.pin, "[REDACTED]");
  assert.equal(clean.password, "[REDACTED]");
  assert.equal(clean.nested.token, "[REDACTED]");
  assert.equal(clean.nested.phone, "+9198****3210");
  assert.equal(clean.nested.normal, "ok");
  assert.equal(clean.list[0].pin, "[REDACTED]");
  assert.equal(clean.list[1], "regular text");
});

test("Logger: level filtering works accurately", () => {
  let output = "";
  const mockLogger = createLogger({
    level: "warn",
    color: false,
  });

  // Override write to capture
  const lines = [];
  mockLogger.write = (lvl, tag, msg) => {
    if (mockLogger.shouldLog(lvl)) lines.push(`${lvl}:${tag}:${msg}`);
  };

  mockLogger.debug("SYSTEM", "debug msg");
  mockLogger.info("SYSTEM", "info msg");
  mockLogger.warn("SYSTEM", "warn msg");
  mockLogger.error("SYSTEM", "error msg");

  assert.equal(lines.length, 2);
  assert.equal(lines[0], "warn:SYSTEM:warn msg");
  assert.equal(lines[1], "error:SYSTEM:error msg");
});

test("Logger: silent mode disables all logging", () => {
  const silent = createLogger({ enabled: false });
  assert.equal(silent.shouldLog("info"), false);
  assert.equal(silent.shouldLog("error"), false);
});

test("Logger: JSON format outputs valid JSON objects", () => {
  const lines = [];
  const origStdout = process.stdout.write;
  try {
    process.stdout.write = (chunk) => {
      lines.push(chunk);
      return true;
    };
    const jsonLogger = createLogger({
      format: "json",
      enabled: true,
      level: "info",
    });
    jsonLogger.info("AUTH", "User signed in", { username: "aman", ip: "127.0.0.1" });
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level, "INFO");
    assert.equal(parsed.tag, "AUTH");
    assert.equal(parsed.message, "User signed in");
    assert.equal(parsed.meta.username, "aman");
    assert.equal(parsed.meta.ip, "127.0.0.1");
  } finally {
    process.stdout.write = origStdout;
  }
});

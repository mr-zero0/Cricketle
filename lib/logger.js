"use strict";

const util = require("util");

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

const TAG_COLORS = {
  HTTP: COLOR.blue,
  AUTH: COLOR.cyan,
  GAME: COLOR.magenta,
  DB: COLOR.green,
  ADMIN: COLOR.yellow,
  SECURITY: COLOR.red,
  SYSTEM: COLOR.white,
};

function formatIstTimestamp(date = new Date()) {
  const istOffset = 5.5 * 3600 * 1000;
  const ist = new Date(date.getTime() + istOffset);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const y = ist.getUTCFullYear();
  const m = pad(ist.getUTCMonth() + 1);
  const d = pad(ist.getUTCDate());
  const hh = pad(ist.getUTCHours());
  const mm = pad(ist.getUTCMinutes());
  const ss = pad(ist.getUTCSeconds());
  const ms = pad(ist.getUTCMilliseconds(), 3);
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}.${ms} IST`;
}

function maskPhone(phone) {
  if (!phone || typeof phone !== "string") return phone;
  const cleaned = phone.trim();
  if (cleaned.length <= 6) return cleaned;
  // Keep first 5 (e.g. +91 98) and last 4 (e.g. 3210), mask middle
  const start = cleaned.slice(0, Math.min(5, cleaned.length - 4));
  const end = cleaned.slice(-4);
  return `${start}****${end}`;
}

const SENSITIVE_KEYS = /^(password|pin|pass_hash|passhash|newpin|confirmPin|resetpin|secret|credential|token|cookie|authorization)$/i;

function sanitize(val, depth = 0) {
  if (depth > 4) return "[Deep]";
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    // If it looks like a phone number with country code
    if (/^\+[1-9]\d{9,14}$/.test(val)) return maskPhone(val);
    if (val.length > 300) return val.slice(0, 300) + "...[truncated]";
    return val;
  }
  if (typeof val === "number" || typeof val === "boolean") return val;
  if (Array.isArray(val)) {
    return val.map((item) => sanitize(item, depth + 1));
  }
  if (typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (SENSITIVE_KEYS.test(k)) {
        out[k] = "[REDACTED]";
      } else if (/phone/i.test(k) && typeof v === "string") {
        out[k] = maskPhone(v);
      } else {
        out[k] = sanitize(v, depth + 1);
      }
    }
    return out;
  }
  return String(val);
}

class Logger {
  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    this.level = opts.level ? String(opts.level).toLowerCase() : (process.env.LOG_LEVEL || "info").toLowerCase();
    this.format = opts.format || process.env.LOG_FORMAT || "text"; // "text" or "json"
    this.useColor = opts.color !== undefined ? Boolean(opts.color) : (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
    this.prefix = opts.prefix || "";
  }

  shouldLog(levelName) {
    if (!this.enabled) return false;
    const currentLevelNum = LEVELS[this.level] !== undefined ? LEVELS[this.level] : LEVELS.info;
    const targetLevelNum = LEVELS[levelName] !== undefined ? LEVELS[levelName] : LEVELS.info;
    return targetLevelNum >= currentLevelNum;
  }

  write(levelName, tag, message, meta) {
    if (!this.shouldLog(levelName)) return;

    const timestamp = formatIstTimestamp();
    const cleanMeta = meta ? sanitize(meta) : null;
    const cleanTag = (tag || "SYSTEM").toUpperCase();

    if (this.format === "json") {
      const entry = {
        timestamp,
        level: levelName.toUpperCase(),
        tag: cleanTag,
        message,
      };
      if (cleanMeta) entry.meta = cleanMeta;
      const str = JSON.stringify(entry);
      if (levelName === "error") process.stderr.write(str + "\n");
      else process.stdout.write(str + "\n");
      return;
    }

    // Text formatting
    let levelBadge = `[${levelName.toUpperCase()}]`;
    let tagBadge = `[${cleanTag}]`;

    if (this.useColor) {
      if (levelName === "error") levelBadge = `${COLOR.bold}${COLOR.red}${levelBadge}${COLOR.reset}`;
      else if (levelName === "warn") levelBadge = `${COLOR.bold}${COLOR.yellow}${levelBadge}${COLOR.reset}`;
      else if (levelName === "debug") levelBadge = `${COLOR.dim}${levelBadge}${COLOR.reset}`;
      else levelBadge = `${COLOR.green}${levelBadge}${COLOR.reset}`;

      const tagColor = TAG_COLORS[cleanTag] || COLOR.cyan;
      tagBadge = `${tagColor}${tagBadge}${COLOR.reset}`;
    }

    const timeStr = this.useColor ? `${COLOR.dim}${timestamp}${COLOR.reset}` : timestamp;
    let metaStr = "";
    if (cleanMeta && Object.keys(cleanMeta).length > 0) {
      if (cleanMeta instanceof Error || cleanMeta.stack) {
        metaStr = "\n" + (cleanMeta.stack || cleanMeta.message);
      } else {
        const pairs = Object.entries(cleanMeta)
          .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
          .join(" ");
        metaStr = this.useColor ? ` ${COLOR.dim}(${pairs})${COLOR.reset}` : ` (${pairs})`;
      }
    }

    const line = `${timeStr} ${levelBadge} ${tagBadge} ${message}${metaStr}\n`;
    if (levelName === "error") process.stderr.write(line);
    else process.stdout.write(line);
  }

  info(tag, message, meta) {
    this.write("info", tag, message, meta);
  }

  warn(tag, message, meta) {
    this.write("warn", tag, message, meta);
  }

  error(tag, message, meta) {
    this.write("error", tag, message, meta);
  }

  debug(tag, message, meta) {
    this.write("debug", tag, message, meta);
  }

  http(method, path, status, latencyMs, meta = {}) {
    let level = "info";
    if (status >= 500) level = "error";
    else if (status >= 400) level = "warn";

    let statusStr = String(status);
    if (this.useColor) {
      if (status >= 500) statusStr = `${COLOR.bold}${COLOR.red}${status}${COLOR.reset}`;
      else if (status >= 400) statusStr = `${COLOR.bold}${COLOR.yellow}${status}${COLOR.reset}`;
      else if (status >= 300) statusStr = `${COLOR.cyan}${status}${COLOR.reset}`;
      else statusStr = `${COLOR.green}${status}${COLOR.reset}`;
    }

    const msStr = typeof latencyMs === "number" ? `${latencyMs.toFixed(1)}ms` : "";
    const msg = `${method} ${path} -> ${statusStr} ${msStr}`.trim();
    this.write(level, "HTTP", msg, meta);
  }

  auth(action, message, meta) {
    this.write("info", "AUTH", `${action}: ${message}`, meta);
  }

  authWarn(action, message, meta) {
    this.write("warn", "AUTH", `${action}: ${message}`, meta);
  }

  game(action, message, meta) {
    this.write("info", "GAME", `${action}: ${message}`, meta);
  }

  db(op, message, meta) {
    this.write("info", "DB", `${op}: ${message}`, meta);
  }

  dbWarn(op, message, meta) {
    this.write("warn", "DB", `${op}: ${message}`, meta);
  }

  dbError(op, message, meta) {
    this.write("error", "DB", `${op}: ${message}`, meta);
  }

  child(subTag) {
    return new Logger({
      enabled: this.enabled,
      level: this.level,
      format: this.format,
      color: this.useColor,
      prefix: this.prefix ? `${this.prefix}:${subTag}` : subTag,
    });
  }
}

function createLogger(opts = {}) {
  return new Logger(opts);
}

module.exports = {
  createLogger,
  Logger,
  formatIstTimestamp,
  maskPhone,
  sanitize,
  LEVELS,
};

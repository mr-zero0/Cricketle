# 🏏 Cricketle

Guess the secret cricketer. Every guess returns a **rank**: 1 is the answer, and the lower the number, the closer you are. Three puzzles a day in **Easy** (171 well-known players, with clue tags) and **Hard** (all 425 players, rank only), three hints per puzzle, a live timer, points, accounts, today's and all-time leaderboards, and a rank ladder from Net Bowler to Legend.

![Cricketle](https://img.shields.io/badge/Cricketle-v3.0-blue?style=for-the-badge)
[![Play Live](https://img.shields.io/badge/▶_Play_Live-cricketle-sy03.onrender.com-2ea44f?style=for-the-badge&logo=googlechrome&logoColor=white)](https://cricketle-sy03.onrender.com/)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.5-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

---

## 🌐 Play Online

Jump straight into today's puzzles (no download needed, sign in for the leaderboard):

👉 **[https://cricketle-sy03.onrender.com/](https://cricketle-sy03.onrender.com/)**

The GitHub Pages address redirects there. Any static copy of `public/` still works as a **guest-only** game (progress in your browser, no accounts, no leaderboard): accounts and scores exist only where the server can verify them.

---

## 🚀 Run Locally

Requires Node 22.5 or newer (the server uses the built-in `node:sqlite`). No npm install is needed to play.

```bash
npm start
```

Then open <http://localhost:3000>. The database is automatically created at `data/cricketle.db`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `CRICKETLE_DB` | `data/cricketle.db` | SQLite file (`:memory:` for a throwaway database) |
| `CRICKETLE_SECRET` | generated once, stored in the database | Seed salt for signed-in puzzles. `public` makes accounts use the same answers as guests (testing only). |
| `SUPABASE_URL`, `SUPABASE_KEY` | unset | Use Supabase PostgreSQL instead of SQLite. `SUPABASE_KEY` must be the **service_role** key; the database has RLS on with no policies, so nothing else can read it. |
| `ADMIN_KEY` | unset | Password for `/admin` and `/api/admin/*`. **No default**: when unset the admin portal is disabled. |
| `ADMIN_PHONE` | unset | The account registered with this number is an admin when signed in. |

Opening `public/index.html` directly, or hosting `public/` on any static host, also works: the page plays in **guest mode** (progress saved in localStorage, standalone engine).

---

## 🧠 How it Works

- `public/game-core.js` holds every rule once: pools, similarity and rank tables, the IST game day, seeded daily answers, hints, scoring, the rank ladder and the puzzle state machine. The browser and the server both run it.
- **First visit:** a short "how to play" sheet, then straight into puzzle 1.
- **Guests** play against the browser copy: puzzle 1 of each mode (Easy 1 and Hard 1) is free every day; puzzles 2 and 3 ask for an account.
- **Signed-in players** send each action to the server, which runs the same engine against the database, so leaderboard results are verified and progress follows the account across devices. Signed-in puzzles use a server-side seed, so the answers cannot be inspected in client source. The browser never talks to the database.
- **Scoring**: A solve is worth 100 points, minus 3 per guess after the first (max 60), 10 per hint, and 1 per 20 seconds (max 25), never below 5. Hard mode counts 1.5×. Giving up scores 0.
- The day rolls over at **midnight IST** for everyone.
- **Stadium scene:** the background is a canvas stadium with two scenes. Day (06:00–18:00 IST): sun, clouds, stands, sunlit outfield. Night: floodlights and haze. The sun/moon button in the header overrides the clock and the choice is remembered on the device.
- **Minimal by design:** four stat tiles on the profile with the rest behind "More"; leaderboard rows show rank, avatar, name and points; your own row adds time and guesses.
- **Browser storage** (guests only; accounts live on the server): `cricketle:v2:guest` (today's puzzles), `cricketle:v2:profile`, `cricketle:v2:history`, `cricketle:v2:mode`, `cricketle:v3:seen-help`, `cricketle:v3:theme`. All reads and writes tolerate blocked storage.

---

## ☁️ Deploy (Render, free tier)

1. Supabase → SQL Editor → run `supabase_schema.sql` (it enables RLS and removes the old permissive policies).
2. Render → **New → Blueprint** → this repository. `render.yaml` defines the service; paste `SUPABASE_URL` and the **service_role** `SUPABASE_KEY` when asked. `ADMIN_KEY` is generated for you (read it from the service's Environment tab).
3. If Render gives you a name other than `cricketle`, change the URL in the root `index.html`, `admin.html` and this README.
4. Browsers never hold a database key. There is no self-service PIN reset: an admin resets PINs from `/admin`.

---

## 📡 API

All responses are JSON. POST bodies must be `application/json` from the same origin.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | IST day and server time |
| `POST` | `/api/auth/phone/register` | `{ username, phone, pin }` (unique username, E.164 phone, 6-digit PIN) → session cookie |
| `POST` | `/api/auth/login` | `{ identifier, pin }` where `identifier` is the username or the phone (`+91…`, `0091…`, spaces and dashes allowed) |
| `POST` | `/api/auth/logout` | Ends session |
| `GET` | `/api/me` | Current user, stats, ranks, streaks, title |
| `POST` | `/api/profile/update` | Update display name, avatar, bio, and favorite team |
| `GET` | `/api/state` | Today's puzzles (signed in) |
| `POST` | `/api/puzzle/start` | `{ mode, idx }` starts the puzzle timer |
| `POST` | `/api/puzzle/guess` | `{ mode, idx, name }` → rank, solved, state |
| `POST` | `/api/puzzle/hint` | `{ mode, idx }` → next hint |
| `POST` | `/api/puzzle/giveup` | `{ mode, idx }` → answer |
| `GET` | `/api/leaderboard/today` | Daily rankings, points, and current user rank |
| `GET` | `/api/leaderboard/alltime` | Cumulative leaderboard, titles, and streaks |

---

## 🔒 Security

- **Browser never touches the database.** Every read and write goes through `server.js`; the Supabase key (service role) lives only on the server. Row Level Security is enabled on every table with no policies, so the anon key can do nothing.
- **Accounts:** unique username + mobile number (E.164) + 6-digit PIN hashed with scrypt. Wrong PINs lock the identifier for 15 minutes after 10 attempts, independent of the per-IP rate limits. There is no self-service PIN reset; the admin resets PINs.
- **Sessions:** random 256-bit tokens stored hashed, HttpOnly + SameSite=Lax cookies, `Secure` on HTTPS.
- **Headers:** `Content-Security-Policy` with `script-src 'self'` (no inline scripts anywhere, enforced by `test/csp.test.js`), `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS on HTTPS, a per-request `x-request-id`.
- **Admin:** enabled only when `ADMIN_KEY` is set; the admin console (`/admin`) signs in to a random, revocable 7-day session cookie (never the key itself). A PIN reset also signs the player out of every device.
- **Proxy headers:** client IP (for rate limits) and HTTPS detection come from `x-forwarded-*` only when `TRUST_PROXY=1` (set on Render); otherwise the socket is the truth, so the headers cannot be spoofed to dodge limits.
- **Known trade-off:** every account gets the same daily answers and "give up" reveals them, so a second account could harvest answers for the first. The sign-up throttle (5 per hour per IP) is the brake; per-account answers would break the shared puzzle.
- **Logging:** structured JSON; guess text only at `debug`; PINs and tokens are never logged.
- **Dependencies:** zero runtime dependencies (`npm audit --omit=dev` reports none). `@playwright/test` is the only dev dependency.
- **Env switches:** `CRICKETLE_RATE_LIMIT=off` disables the per-IP limiter for the e2e suite only; never set it in production.

## 📱 Screens

The e2e suite writes screenshots to `test-results/screens/` (`desktop-day.png`, `phone-day.png`, `desktop-night.png`, `phone-night.png`, plus play, profile and leaderboard shots). Lighthouse, mobile preset, Play view: measured 2026-10-29 with Lighthouse 12.8 (mobile preset, simulated throttling, headless Chromium): day performance 89, night 88–91 on most runs with occasional runs near 50 caused by one slow first canvas frame under throttling; accessibility 100 and best practices 100 on both scenes.

## 🧪 Tests

```bash
npm test
```

Runs the unit tests for the shared core and the API integration tests (Node's built-in test runner, in-memory database, fake clock; zero dependencies).

```bash
npm run test:e2e
```

Runs the Playwright browser suite on desktop and phone profiles against a real server with a throwaway database (sign-up throttle off, public answer seed). Covers onboarding, the guest gate, sign-in by username and by phone with the country picker, inline form errors, leaderboards, the day and night scenes (pixel-sampled), the theme toggle and auto mode, reduced-motion and full-motion variants, and the phone layout. Requires `npm install` and browser binaries. `npm run test:all` runs both suites.

---

## 📂 Project Layout

```
server.js            HTTP server: static files + JSON API, cookie sessions, CSP/HSTS, request ids
lib/db.js            SQLite schema, queries and the one-time phone migration
lib/supabase-db.js   the same interface over Supabase PostgREST (service role key)
lib/auth.js          scrypt PIN hashing, session tokens
lib/game.js          server-side game service and leaderboards
lib/phone.js         E.164 normalisation (strict) and the legacy-number heuristics
public/              the client: index.html, styles.css, app.js, theme.js (day/night), bg.js (stadium canvas),
                     players.js, game-core.js, admin.html + admin.js, favicon.svg / favicon-32.png
index.html           GitHub Pages entry: redirects to the hosted server
render.yaml          Render Blueprint (free Node web service)
test/core.test.js    engine unit tests (incl. guest gate, scene by IST hour, avatars)
test/phone.test.js   phone normalisation
test/csp.test.js     no inline scripts or handlers in any page
test/api.test.js     API integration tests
test/e2e/            Playwright specs
docs/superpowers/    design notes & specs
```

---

## 📄 License

MIT

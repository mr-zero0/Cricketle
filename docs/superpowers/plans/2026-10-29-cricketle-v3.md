# Cricketle v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cricketle a phone-first, cricket-themed, zero-cost game: onboarding sheet, one free puzzle per mode for guests, username+phone+PIN accounts only, day/night stadium, real cricket ball and icons, minimal screens, with tests, request-scoped logging and a security pass.

**Architecture:** Same shape as v2: pure shared engine `public/game-core.js` (rules, now also guest limit and scene selection), vanilla client `public/app.js` with `LocalStore` (guest) and `RemoteStore` (server), `node:http` server with SQLite or Supabase behind `lib/`. New small modules split out where a file would otherwise grow: `lib/phone.js`, `public/theme.js`, `public/admin.js`, `public/icons.svg` stays inline in `index.html`.

**Tech Stack:** Node 22.5+, `node:sqlite`, `node:test`, vanilla HTML/CSS/JS, Canvas 2D, Web Animations API, Playwright 1.55 (dev only). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-29-cricketle-v3-design.md`

## Global Constraints

- Zero cost: no SMS, OTP, Firebase, paid API, or script CDN. Only external request: Google Fonts (already in CSP).
- No npm runtime dependencies; `@playwright/test` is the only dev dependency.
- Browsers never talk to the database. Server authoritative for signed-in play; guests use `LocalStore` only.
- Accounts: unique username, unique phone (E.164), 6-digit PIN at sign-up and admin reset; sign-in accepts 4–8 digits.
- Guest allowance: `GUEST_PUZZLES_PER_MODE = 1` in both modes.
- Every control ≥ 44 px; no horizontal scroll at 360 px; every animation has a `prefers-reduced-motion` variant.
- CSP stays `default-src 'self'`; scripts from `'self'` only by the end of Task 14.
- Commit after every task with the message given; never commit `.env` or `data/`.
- Run `npm test` before every commit; run `npm run test:e2e` at the end of Tasks 6, 7, 8, 9, 10, 12, 13.

## Review Focus

1. A phone typed with spaces, dashes, a leading 0 or `0091` at sign-in must still match the stored E.164 row. Test added in Task 1.
2. Two guests on the same device on consecutive IST days: the lock on puzzle 2 must reset at midnight IST, not at local midnight. Test added in Task 5.
3. The onboarding sheet must not steal the first tap on a returning visitor who has `localStorage` blocked (private mode): it shows once per page load at most and never throws. Test added in Task 6.
4. A player whose avatar id is `lion` or `eagle` (removed) must still see a valid avatar everywhere, including the leaderboard rows served to other players. Test added in Task 11.
5. Theme override must win over the clock across a day/night boundary while the tab stays open; auto mode must flip at 06:00 and 18:00 IST without reload. Test added in Task 9.

---

### Task 1: Strict phone normalisation and one-time migration

**Files:**
- Create: `lib/phone.js`
- Modify: `lib/db.js` (constructor, `userByPhone`), `lib/supabase-db.js` (`userByPhone`), `supabase_schema.sql`, `server.js` (`normalizePhone` → use lib)
- Test: `test/phone.test.js`, `test/api.test.js`

**Interfaces:**
- Produces: `toE164(raw: string) → string` returns `+<8-15 digits>` or `""`; strips spaces, dashes, parentheses; converts leading `00` to `+`; **does not** add `+91` to bare digits. `legacyToE164(raw) → string` same plus the v2 heuristics (bare 10-digit Indian → `+91`, `0` + 10 digits → `+91`, `91` + 10 digits → `+`). `Db.migratePhones(logger) → { changed: number, skipped: string[] }` run once in the constructor.

- [ ] **Step 1: Write failing tests** in `test/phone.test.js`:
  - `toE164("+91 98765-43210") === "+919876543210"`, `toE164("0091 9876543210") === "+919876543210"`, `toE164("9876543210") === ""`, `toE164("+1") === ""`.
  - `legacyToE164("9876543210") === "+919876543210"`, `legacyToE164("09876543210") === "+919876543210"`, `legacyToE164("919876543210") === "+919876543210"`, `legacyToE164("12345") === ""`.
  - `Db` test: insert users with phones `"9876543210"`, `"+447700900123"`, `"abc"`; construct `Db` again on the same file; expect rows `"+919876543210"`, unchanged, unchanged; `migratePhones` result `{ changed: 1, skipped: ["abc"] }`.
  - `userByPhone("+919876543210")` finds the migrated row; `userByPhone("9876543210")` returns `null`.
- [ ] **Step 2: Run** `node --test test/phone.test.js` → FAIL (module not found).
- [ ] **Step 3: Implement** `lib/phone.js` and `Db.migratePhones`; call it from the `Db` constructor after migrations; remove the `LIKE '%last10'` fallback in both `userByPhone`s; add to `supabase_schema.sql` a commented one-time `UPDATE users SET phone = ...` block for +91 defaults using `regexp_replace` and a `WHERE phone ~ '^[6-9][0-9]{9}$'` guard; replace `server.js` `normalizePhone` with `toE164` for requests and keep `legacyToE164` only inside the migration.
- [ ] **Step 4: Run** `npm test` → PASS (update any API test that signed in with a bare 10-digit number to send `+91…`).
- [ ] **Step 5: Commit** `feat(auth): strict E.164 phones with one-time migration`

### Task 2: One sign-in route, 6-digit PIN, per-account attempt limit

**Files:**
- Modify: `server.js` (routes `POST /api/auth/register`, `/api/auth/login`, `/api/auth/phone/register`, `/api/auth/phone/login`, admin reset), `public/admin.html` (reset form copy)
- Test: `test/api.test.js`, `test/admin.test.js`

**Interfaces:**
- Produces: `POST /api/auth/login { identifier, pin }` where `identifier` is an exact username or an E.164 string; response unchanged plus `user.pinNeedsUpdate: boolean` (true when `pin.length !== 6`). `POST /api/auth/phone/register` requires `/^\d{6}$/`. Routes `/api/auth/register` and `/api/auth/phone/login` return 404. Error `pin_locked` (429) after 10 wrong PINs for one identifier in 15 minutes.

- [ ] **Step 1: Write failing tests**: `register rejects a 5-digit PIN with invalid_pin`; `login by +E.164 and by username both work, bare 10 digits is bad_credentials`; `login response flags a legacy 4-digit PIN with pinNeedsUpdate: true` (seed via `db.createUser` with `auth.hashPassword("1234")`); `11th wrong PIN returns 429 pin_locked, a correct PIN after the window succeeds` (use `app.setNow`); `removed routes are 404`; admin test: `reset-pin rejects 4 digits`.
- [ ] **Step 2: Run** `npm test` → FAIL on the new tests.
- [ ] **Step 3: Implement**: delete the two routes; `identifier = body.identifier || body.username`; attempt limiter is a second `Map` keyed by `"pin|" + identifier.toLowerCase()` using the existing `rateLimit` helper with bucket `pin`, max 10, window 15 min, counted only on failure; sign-up bucket `signup` max 5 per hour per IP.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(auth): single sign-in route, 6-digit PINs, PIN attempt limit`

### Task 3: Request ids, HSTS, quieter logs

**Files:**
- Modify: `server.js` (dispatch, `send`, `fail`), `lib/logger.js` (`child` already exists; use it)
- Test: `test/api.test.js`, `test/logger.test.js`

**Interfaces:**
- Produces: every response carries header `x-request-id` (16 hex chars from `crypto.randomBytes(8)`); every JSON error body has `requestId`; API log lines include `meta.requestId`; `Strict-Transport-Security: max-age=31536000; includeSubDomains` when `isSecure(req)`.

- [ ] **Step 1: Write failing tests**: `/api/health` has a 16-hex `x-request-id`; a 404 error body has the same `requestId`; with header `x-forwarded-proto: https` the HSTS header is present and absent without it; logger test: `http()` meta with `requestId` appears in JSON output; `game()` at info level never includes `guess` text (move it to a `debug` call).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** in the request handler: `req.id = …`, `res.setHeader("x-request-id", req.id)` before dispatch; `fail` adds `requestId: req.id` (pass `req` to `fail`, update call sites); `logger.http` meta gets `requestId`.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(server): request ids, HSTS, guess text at debug level`

### Task 4: Remove dead OTP persistence

**Files:**
- Modify: `lib/db.js` (schema, queries, methods `setOtp/getOtp/deleteOtp/incrementOtpAttempts/cleanExpiredOtps`), `lib/supabase-db.js` (same), `supabase_schema.sql` (`DROP TABLE IF EXISTS otp_codes;` replaces its CREATE and RLS lines)
- Test: `test/supabase.test.js`, `test/api.test.js`

- [ ] **Step 1: Write failing test**: `new Db(":memory:")` has no `otp_codes` table (`sqlite_master` query) and no `setOtp` method; `SupabaseDb.prototype.setOtp === undefined`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the removals; `Db` constructor runs `DROP TABLE IF EXISTS otp_codes`.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `chore(db): drop otp_codes and its code paths`

### Task 5: Guest gate in the engine and LocalStore

**Files:**
- Modify: `public/game-core.js` (constants, `startPuzzle`), `public/app.js` (`LocalStore.start`)
- Test: `test/core.test.js`

**Interfaces:**
- Produces: `core.GUEST_PUZZLES_PER_MODE = 1`; `core.guestCanPlay(idx: number) → boolean`; `core.startPuzzle(state, mode, idx, now, { guest: true })` returns `{ ok: false, error: "sign_in_required" }` when `!guestCanPlay(idx)`; `LocalStore.start` passes `{ guest: true }`. New `MESSAGES.sign_in_required = "Sign up or sign in to play the next puzzle."` in `app.js` and `server.js`.

- [ ] **Step 1: Write failing tests** in `test/core.test.js`: `guestCanPlay(0) === true`, `guestCanPlay(1) === false`; a guest who solved puzzle 0 gets `sign_in_required` on `startPuzzle(…, 1, …, { guest: true })` and the state is unchanged; without the `guest` option the same call is `ok`; **Review Focus 2**: a guest state from day `D` gets a fresh `newDayState` on `D+1` (IST) and `guestCanPlay(0)` again, using `core.todayKey(T0 + DAY_MS)`.
- [ ] **Step 2: Run** `node --test test/core.test.js` → FAIL.
- [ ] **Step 3: Implement** in `game-core.js`; `LocalStore.start` in `app.js` forwards `{ guest: true }`.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(core): one free puzzle per mode for guests`

### Task 6: Onboarding sheet that starts the first puzzle

**Files:**
- Modify: `public/index.html` (replace `<dialog id="help">` with `<dialog id="onboard" class="sheet">`), `public/app.js` (`fillHelp` → `renderOnboard`, `bootstrap`, help button), `public/styles.css` (`.sheet` bottom-sheet on ≤ 700 px, centered dialog above)
- Test: `test/e2e/cricketle.spec.js`

**Interfaces:**
- Produces: `localStorage` key `cricketle:v3:seen-help` = `"1"`; dialog `#onboard` with `#onboard-play` (button text "Play"), `#onboard-signin` (link "Sign in"), `<details id="onboard-scoring">` ("Scoring details") holding the old legend and ladder spans (`#legend-*`, `#pool-easy`, `#pool-hard`, `#ladder`). `openOnboard({ firstVisit: boolean })`. On first visit, "Play" closes the sheet and calls `startPuzzle()` for the current mode if puzzle `idx()` is `ready`; otherwise it only closes.

Copy (exact): title "Cricketle"; line "Guess the secret cricketer. Every guess tells you how close you are."; rows: "Rank 1 is the answer. Lower is closer." / "3 hints per puzzle. Each costs 10 points." / "3 puzzles a day in each mode. The first is free."

- [ ] **Step 1: Write failing e2e tests**: `first visit: sheet shows, Play starts puzzle 1 and the timer runs` (fresh context, assert `#onboard` visible, click `#onboard-play`, expect `#guess-input` enabled and `.stat-timer` has class `running`); `returning visit: no sheet, help button reopens it` (set the key via `addInitScript`); **Review Focus 3**: with `addInitScript` that makes `localStorage.getItem/setItem` throw, the page still loads, the sheet shows once, and "Play" works.
- [ ] **Step 2: Run** `npx playwright test -g "first visit"` → FAIL.
- [ ] **Step 3: Implement** markup, `renderOnboard`, CSS; wrap every `localStorage` access in `try/catch` (there is a helper pattern already in `LocalStore.read/write`; reuse it as `safeGet/safeSet` at module scope).
- [ ] **Step 4: Run** `npm run test:e2e` → PASS (update `desktop: … help dialog` test to the new ids and copy).
- [ ] **Step 5: Commit** `feat(ui): onboarding sheet; Play starts the first puzzle`

### Task 7: Gate UI: locked dots, gate card, free Hard offer

**Files:**
- Modify: `public/app.js` (`renderTracker`, `renderWin`, `viewPuzzle`, `startPuzzle`, `handleError`), `public/index.html` (`<section id="gate" class="gate card" hidden>`), `public/styles.css`
- Test: `test/e2e/cricketle.spec.js`

**Interfaces:**
- Produces: for guests, dots with `idx >= GUEST_PUZZLES_PER_MODE` render class `dot gated` (lock icon, enabled, `aria-label="Puzzle N: sign in to play"`); tapping one, or `sign_in_required` from the store, calls `showGate(mode)`; `#gate` copy "You've played today's free puzzle in {Mode}. Sign up or sign in for all three, hints, streaks and the leaderboard." with buttons `#gate-signup` and `#gate-signin` (both go to `#profile` and open the matching auth view) and `#gate-close`. In `renderWin`, when guest and the other mode's puzzle 0 is not finished: button `#other-mode-btn` text "Try {Other} mode, also free"; when guest and it is finished: `showGate` content replaces the next-puzzle action.

- [ ] **Step 1: Write failing e2e tests**: `guest: puzzle 2 is gated and the gate card appears after solving puzzle 1` (solve Easy 1 via the existing helpers, expect `#gate` visible with text "free puzzle in Easy", `#dots .dot.gated` count 2); `guest: after Easy 1 the win card offers Hard for free` (expect `#other-mode-btn` text "Try Hard mode, also free"); `signed in: no gated dots` (reuse `signUp`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `npm run test:e2e` → PASS. The existing `three puzzles a day` guest test must now sign up first; update it.
- [ ] **Step 5: Commit** `feat(ui): guest gate on puzzles 2 and 3`

### Task 8: Sign-in and sign-up forms

**Files:**
- Modify: `public/index.html` (auth card), `public/app.js` (`initPhoneAuth`, `switchAuthView`, `fieldError`), `public/styles.css`
- Test: `test/e2e/cricketle.spec.js`

**Interfaces:**
- Produces: sign-in: `#signin-identifier`, `#signin-country` (hidden until the value is all digits, then shown with a 150 ms slide), `#signin-pin`, `#auth-signin-btn`; client sends `{ identifier, pin }` where `identifier` is `country + digits` when numeric. Sign-up: `#register-username`, `#register-country`, `#register-phone`, `#register-pin`, `#register-pin-confirm` (all `maxlength="6"`, `pattern="\d{6}"`), `#auth-register-btn`. Inline errors in `#<field>-error` under each field; `#auth-summary` only for server errors. Profile shows "Your PIN is not 6 digits. Ask the admin to reset it." when `user.pinNeedsUpdate`.

- [ ] **Step 1: Write failing e2e tests**: `typing digits reveals the country code picker and signs in by phone` (sign up, sign out, sign in with the 10 digits); `inline errors: empty username, 5-digit PIN, PIN mismatch each mark their own field`; update `sign-in form validates inline…` to the new ids.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; delete the dead `validateAuth/submitAuth/handleGoogleLogin/initGoogleAuth/clearOtpErrors/showOtpError` functions and their listeners.
- [ ] **Step 4: Run** `npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(ui): single-field sign-in with country picker; 6-digit PIN forms`

### Task 9: Theme system: day and night tokens, auto by IST, toggle

**Files:**
- Create: `public/theme.js` (loaded before `bg.js`)
- Modify: `public/game-core.js` (`sceneForHour`), `public/index.html` (`#theme-btn` in `.topbar`, `data-theme` on `<html>`), `public/styles.css` (`:root[data-theme="day"]` token block), `public/app.js` (nothing; theme is independent)
- Test: `test/core.test.js`, `test/e2e/cricketle.spec.js`

**Interfaces:**
- Produces: `core.sceneForHour(hourIST: number) → "day" | "night"` (day for 6 ≤ h < 18); `core.istHour(now) → number`. `window.CricketleTheme = { current(): "day"|"night", mode(): "auto"|"day"|"night", toggle(), onChange(fn) }`; `localStorage` key `cricketle:v3:theme` holds `"day"` or `"night"` when overridden, absent in auto; auto re-evaluates every 60 s; `<html data-theme>` and `<meta name="theme-color">` (`#0b1220` night, `#bfe3ff` day) follow. Toggle button `#theme-btn` with `aria-label` "Switch to day" / "Switch to night", sun and moon `<symbol>`s `#i-sun`, `#i-moon`. Day tokens: `--bg-top:#bfe3ff; --bg-mid:#e8f4ff; --bg-pitch:#2f7d32; --card:rgba(255,252,245,0.9); --card-solid:#fffcf5; --fg:#0e2a14; --muted:#3f5a46; --border:rgba(14,42,20,0.12); --primary:#1b7a33; --primary-bright:#23a047; --accent:#d97706;` all others derived; each pair annotated with its contrast ratio in a comment (AA ≥ 4.5 text, ≥ 3 UI).

- [ ] **Step 1: Write failing tests**: core: `sceneForHour(5) === "night"`, `sceneForHour(6) === "day"`, `sceneForHour(17) === "day"`, `sceneForHour(18) === "night"`; `istHour(Date.UTC(2026,9,27,0,30)) === 6`. e2e: `theme toggle persists across reload` (click `#theme-btn`, expect `html[data-theme]` flips and survives `page.reload()`); **Review Focus 5**: with `page.clock.install` at 17:59 IST in auto mode, `html[data-theme]` is `day`; advance 2 minutes → `night`; then toggle to `day`, advance 2 hours → still `day`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `theme.js` (applies `data-theme` synchronously at load to avoid a flash), tokens, button, meta; body transition `background-color 600ms` under motion, none under reduced motion.
- [ ] **Step 4: Run** `npm test && npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(theme): day and night themes, auto by IST, toggle`

### Task 10: Day stadium scene in `bg.js`

**Files:**
- Modify: `public/bg.js`
- Test: `test/e2e/cricketle.spec.js` (screenshots)

**Interfaces:**
- Consumes: `window.CricketleTheme.current()` and `onChange`.
- Produces: `drawDaySky(t)`, `drawSun(t)`, `drawClouds(dt, t)`, `drawStands()`; `drawPitch()` takes `scene` and uses brighter stripe colours and a sun-direction shadow by day; `drawFloodlights` only at night; a 600 ms cross-fade between scenes (`sceneMix` 0..1). Particle budget unchanged (`small()` rules apply to clouds too: ≤ 3 clouds on phones).

- [ ] **Step 1: Write failing e2e test**: `day scene renders` (force `cricketle:v3:theme = "day"` via `addInitScript`, wait 500 ms, sample canvas pixel at (5 %, 5 %) via `page.evaluate` reading `getImageData`; expect blue dominant `b > r && b > g`); `night scene renders` (same at night expects `r < 60 && g < 60`). Save `test-results/screens/{project}-day.png` and `-night.png`.
- [ ] **Step 2: Run** → FAIL (day pixel is dark).
- [ ] **Step 3: Implement** the day scene and the cross-fade; `drawStatic()` renders the current scene once under reduced motion.
- [ ] **Step 4: Run** `npm run test:e2e` → PASS; open both screenshots and check the pitch, stands and sun are legible behind the cards.
- [ ] **Step 5: Commit** `feat(fx): sunlit day stadium scene with cross-fade`

### Task 11: Cricket ball, icons, avatars

**Files:**
- Create: `public/favicon.svg`, `public/favicon-32.png` (export of the SVG; any free tool, committed binary)
- Modify: `public/index.html` (`<symbol>` set, `<link rel="icon">`, brand mark), `public/game-core.js` (`AVATARS`, `normalizeAvatarId`), `lib/game.js` (leaderboard rows and stats use `normalizeAvatarId`), `server.js` (`/api/me`, login responses), `public/app.js` (`getAvatar`), `public/styles.css` (`.brand-mark`, `.avatar-*`)
- Test: `test/core.test.js`, `test/api.test.js`

**Interfaces:**
- Produces: `<symbol id="i-ball">` = red leather ball with white seam (two stitch rows), `#i-ball-white` variant; `#i-bolt` → yorker ball with motion lines, `#i-crown` → cap, `#i-star` → trophy, `#i-medal` → medal with ball, `#i-shield` → helmet; `#i-flame` unchanged. `core.AVATARS` ids exactly: `batter, bowler, spinner, keeper, captain, allrounder, legend, stumps, pads`, each `{ id, name, role, icon: "#i-…", bg, color }` (icon is now a symbol ref, not an emoji). `core.normalizeAvatarId(id) → string` maps `lion → captain`, `eagle → allrounder`, unknown → `batter`.

- [ ] **Step 1: Write failing tests**: core: `AVATARS.map(a => a.id)` equals the list above; every `icon` starts with `#i-`; `normalizeAvatarId("lion") === "captain"`, `("eagle") === "allrounder"`, `("nope") === "batter"`. **Review Focus 4** (API): create a user, `db.updateProfile(id, { avatar: "lion" })`, solve a puzzle, `GET /api/leaderboard/today` row for that user has `avatar: "captain"` and `GET /api/me` too.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the SVG symbols (hand-drawn paths, 24×24 viewBox, `currentColor` for line icons, fixed fills for the ball), favicon files, avatar set, mapping on the server presenters and in `getAvatar`; `bg.js` ball sprite seam colour/stitch count matches the symbol.
- [ ] **Step 4: Run** `npm test` → PASS; open `/` in a browser and check header, dots, favicon, profile avatars.
- [ ] **Step 5: Commit** `feat(brand): real cricket ball, cricket-only icons and avatars`

### Task 12: Minimal information pass

**Files:**
- Modify: `public/app.js` (`renderProfile`, `renderBoard`, `renderTracker`, `renderWin`, `toast`), `public/index.html` (tagline, banners), `public/styles.css`
- Test: `test/e2e/cricketle.spec.js`

**Interfaces:**
- Produces: profile `stats` tab shows exactly four `.stat-tile` first (Today's points, Today's rank, Streak, All-time points) and a `<details id="more-stats">` "More" with the rest; leaderboard rows show rank, avatar, name, points; `.board-row.me` additionally shows time and guesses; the "Security" and "Google Account" rows are gone; guest banner is one line "Playing as a guest · Sign in to be ranked"; toasts are ≤ 80 characters (truncate with `…`).

- [ ] **Step 1: Write failing e2e tests**: `profile shows four tiles and a More section` (count `.stat-tile:not(details .stat-tile)` === 4); `leaderboard rows show only rank, avatar, name and points` (a non-me row has no `.board-time`); `phone play view above the fold has no banner text longer than one line` (guest banner height ≤ 48 px at 360×740).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(ui): minimal profile, leaderboard and play screens`

### Task 13: Motion catalogue with reduced-motion variants

**Files:**
- Modify: `public/styles.css` (`@media (prefers-reduced-motion: no-preference)` blocks), `public/app.js` (`bump`, `countUp`, `renderTracker` pop, `showGate`, `openOnboard`)
- Test: `test/e2e/cricketle.spec.js`

**Interfaces:**
- Produces: CSS classes `.sheet` (slide-up 280 ms cubic-bezier(.2,.8,.2,1)), `.dot.pop` (scale 1→1.25→1, 320 ms), `.heat-fade` (background-color 400 ms on a new guess row), `.tab-underline` (transform 200 ms), theme cross-fade (Task 9). `countUp` uses `requestAnimationFrame` for 600 ms, instant under reduced motion. Every animated property is `transform`, `opacity` or `background-color` only.

- [ ] **Step 1: Write failing e2e test**: `reduced motion disables animations` (context with `reducedMotion: "reduce"`: after a guess, `getComputedStyle(row).transitionDuration === "0s"`; sheet opens with no `animation-name` other than `none`); `motion on: dot pops on solve` (context `reducedMotion: "no-preference"`, after solving, `#dots .dot.solved` had class `pop` within 100 ms and loses it within 1 s).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(motion): catalogue with reduced-motion variants`

### Task 14: Admin script extraction, CSP without inline scripts, security pass

**Files:**
- Create: `public/admin.js`
- Modify: `public/admin.html` (remove inline `<script>`, add `<script src="admin.js">`), `public/index.html` (any inline handlers → listeners), `server.js` (CSP `script-src 'self'`), `README.md` (security section)
- Test: `test/api.test.js`, `test/admin.test.js`

- [ ] **Step 1: Write failing tests**: `HTML responses carry script-src 'self' without 'unsafe-inline'`; `grep` test: `test/csp.test.js` reads `public/*.html` and asserts no `<script>` tag with inline content and no `on[a-z]+=` attributes.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; convert `onclick="openResetModal(…)"` in `admin.js` to delegated listeners with `data-` attributes.
- [ ] **Step 4: Run** `npm test` → PASS; then run the `security-review` skill on `server.js`, `lib/`, `public/app.js`, `public/admin.js` and fix every finding it marks high or medium; run `npm audit --omit=dev` (expect `found 0 vulnerabilities`) and `npm audit` (record dev findings in the commit body if any).
- [ ] **Step 5: Commit** `chore(security): no inline scripts, strict CSP, review fixes`

### Task 15: Docs, deploy check, hand-off

**Files:**
- Modify: `README.md` (How it works, Scoring, Screens), `docs/superpowers/specs/2026-10-29-cricketle-v3-design.md` (status line "Implemented 2026-xx-xx"), `render.yaml` (no change expected; verify `healthCheckPath`)

- [ ] **Step 1: Run** `npm test && npm run test:e2e` → both PASS; keep `test-results/screens/*-day.png` and `*-night.png`.
- [ ] **Step 2: Lighthouse** (Chrome DevTools, mobile, Play view, night and day) → Performance ≥ 90, Accessibility ≥ 95; note the scores in the README.
- [ ] **Step 3: Update docs**; list the localStorage keys (`cricketle:v2:guest`, `cricketle:v2:profile`, `cricketle:v2:history`, `cricketle:v2:mode`, `cricketle:v3:seen-help`, `cricketle:v3:theme`) in the README.
- [ ] **Step 4: Commit** `docs: v3 complete`

# Cricketle v3 — design

Date: 2026-10-29. Author: Claude, from a conversation with the owner.
Status: Implemented 2026-10-29 (plan `docs/superpowers/plans/2026-10-29-cricketle-v3.md`, all 15 tasks; left uncommitted in the working tree at the owner's request).
Supersedes parts of `2026-10-27-cricketle-v2-design.md`; everything not
mentioned here stays as v2 built it.

## Intent

Cricketle is a free daily cricketer-guessing game played mostly on phones.
v2 shipped the engine, accounts, leaderboards and a server. v3 is about
how it feels: a first-time player on a phone should understand the game in
one screen, play immediately, and be asked to sign in only when they want
more. Everything on screen should look like cricket, and the whole thing
must never cost the owner a rupee.

## Decisions the owner made

1. **Zero cost, forever.** No SMS, no OTP, no Firebase, no paid API, no
   CDN that could bill. Render free tier + Supabase free tier + GitHub Pages
   redirect only.
2. **Accounts are username + phone + 6-digit PIN.** Username unique,
   phone unique, PIN chosen by the player at sign-up and hashed on the
   server. Sign in with username **or** phone, plus PIN. No biometrics,
   no passkeys, no Google, no email, no OTP.
3. **Forgot PIN is admin-only** (from `/admin`), because nothing can prove
   phone ownership without SMS.
4. **Guests get puzzle 1 of 3 in each mode.** Puzzles 2 and 3 show a lock
   and "Sign up or sign in to continue". Guest results live on the device
   only. Signed-in players get everything.
5. **First visit opens a "How to play" sheet**, then the game. Short,
   one button, never shown again on that device unless opened from the
   help button.
6. **Cricket everywhere.** The ball must look like a real cricket ball
   (red leather, white stitched seam). Logos, avatars and icons are
   cricket objects only.
7. **Full stadium background with a day / night toggle.** Day = sunlit
   ground, blue sky, green outfield. Night = the existing floodlit scene.
   Realistic rather than cartoon.
8. **Minimal information.** Show the player only what they need to act.
9. **Best-practice engineering**: tests, structured logging, security
   review and vulnerability scan before it ships.

## Goals / non-goals / anti-goals

- Goals: phone-first, one-hand play; a first puzzle within 10 seconds of
  landing; every control at least 44 px; no horizontal scroll at 360 px;
  motion that feels alive but is cheap on a mid-range Android and fully
  respects `prefers-reduced-motion`; zero runtime dependencies kept.
- Non-goals: native app, PWA install prompt, push notifications, social
  login, multiplayer, i18n.
- Anti-goals (failure even if it works): anything that can incur a bill;
  any path that lets a browser touch the database; a first screen that is
  mostly text; a day theme that is just "dark theme inverted" with grey
  cards; auth that asks for more than username, phone and PIN.

## Constraints

- Vanilla HTML/CSS/JS, Node 22.5+ server, no npm runtime dependencies
  (`@playwright/test` dev-only stays). No third-party scripts; the only
  external request allowed is Google Fonts, already in the CSP.
- The server is authoritative for signed-in play (unchanged). Guests play
  the browser engine in `localStorage` (unchanged).
- The shared engine `public/game-core.js` stays pure; any new rule (guest
  limit) is a constant and a function there, used by both sides.
- Hosting as decided on 2026-10-29: Render free tier runs `server.js`;
  GitHub Pages redirects to it; static copies are guest-only.

## The parts, as decided

### A. Onboarding sheet

- Shown on first visit (flag `cricketle:v3:seen-help` in localStorage) as
  a bottom sheet on phones and a centered dialog on desktop, above the
  live game so the background is visible.
- Content, in this order: title, one sentence ("Guess the secret
  cricketer. Every guess tells you how close you are."), three icon rows
  (rank number = closeness; 3 hints cost points; 3 puzzles a day, first
  one free), one button "Play". A small "Sign in" text link under it.
- The help button in the header reopens it. The old long help dialog is
  replaced by this sheet plus a collapsible "Scoring details" section
  inside it.

### B. Guest gate

- `game-core.js` gains `GUEST_PUZZLES_PER_MODE = 1` and
  `guestCanPlay(idx)`. The browser `LocalStore` refuses `start` on
  `idx >= 1` with error `sign_in_required`. The server never serves
  guests, so nothing changes there; a test proves a guest `LocalStore`
  cannot start puzzle 2.
- UI: puzzle dots 2 and 3 render with a lock icon for guests. Tapping one,
  or finishing puzzle 1, slides up a compact card: "You've used today's
  free puzzle. Sign up or sign in for all three, hints, streaks and the
  leaderboard." Two buttons: Sign up, Sign in. Dismissable.
- The persistent side prompt for guests is one line in the profile tab
  and the existing guest banner; no modal nagging.

### C. Accounts (cleanup, not new behaviour)

- Sign-up form: username, phone (country code selector defaulting to
  +91), PIN, confirm PIN. Sign-in form: username or phone, PIN. Inline
  errors under the field, one summary for server errors.
- Server: keep `POST /api/auth/phone/register`, `/api/auth/login`,
  `/api/auth/phone/login`, `/api/auth/logout`. Remove the remaining dead
  OTP code paths from `lib/db.js`, `lib/supabase-db.js`,
  `supabase_schema.sql` (drop `otp_codes`; keep a one-line `DROP TABLE IF
  EXISTS` migration). Stop writing `google_id`, `email`; leave the columns
  (SQLite column drops are not worth the risk).
- Phone lookup: exact match on the normalised E.164 string only. The
  `LIKE '%last10'` fallback goes, as does the 10-digit "login by phone"
  guess; sign-in by phone normalises with the same country-code selector.

### D. Visual system

- **Ball.** One SVG master: red leather sphere with a lighter highlight,
  a single white seam band with two rows of stitches, slight shadow.
  Used as logo mark, favicon (SVG + 32 px PNG), loading spinner, the
  "ball" icon, the rank-tier legend, and the canvas ball sprite. Hard
  mode uses the white-ball variant of the same master.
- **Avatars.** Replace the lion/eagle/etc. set with nine cricket objects
  rendered from the same icon family: bat, red ball, white ball, stumps,
  keeping gloves, helmet, cap, pads, trophy. Same ids where they exist
  (`batter` → bat, `bowler` → red ball, `keeper` → gloves, `captain` → cap,
  `legend` → trophy, `spinner` → white ball, `allrounder` → helmet) plus
  `stumps` and `pads`; migrate `lion`/`eagle` to `cap`/`helmet` in a one-time
  read-side mapping.
- **Icons.** Audit every `<symbol>`; anything non-cricket but functional
  (search, close, refresh, copy, arrow, lock, logout, edit, phone) stays
  as a plain line icon; decorative ones (flame, bolt, crown, star, medal,
  shield) are redrawn as cricket objects (flame → burning bails? no:
  flame stays for streaks, it is the one accepted non-cricket metaphor;
  bolt → yorker ball; crown → captain's cap; star → ICC trophy; medal →
  medal with ball; shield → helmet).
- **Stadium, two scenes, one renderer** (`bg.js`):
  - *Night* (existing): floodlights, haze, drifting ball.
  - *Day*: sky gradient (cerulean to pale horizon), sun with soft bloom,
    sparse clouds drifting slowly, stands in the distance with a
    light-grey roof line, bright green mown stripes, cream pitch with
    creases and stumps, a shadow direction from the sun. Same particle
    budget as night.
  - Scene is chosen automatically from the IST clock (06:00–18:00 day,
    otherwise night) and can be overridden with a toggle in the header
    (sun / moon icon). Override persisted in localStorage. The
    `theme-color` meta and the CSS token set switch with it.
- **Day theme tokens.** Light surfaces with real colour: warm white
  cards on a sky-and-grass backdrop, dark green text, amber accent kept.
  Contrast AA on every token pair; the audit lives in `styles.css`
  comments next to the tokens.
- **Motion.** CSS and Web Animations API only (no GSAP, no libraries).
  Catalogue: sheet slide-up, dot pop on solve, rank number count-up,
  heat colour fade on a new guess, confetti burst on the canvas, theme
  cross-fade (600 ms), tab underline slide. Each has a reduced-motion
  variant (instant or opacity-only).

### E. Minimal information

- Play screen for a guest: logo, mode switch, timer, 3 dots, input,
  guesses list, 1 hint row collapsed. Nothing else above the fold.
- Profile: four stat tiles max on the first screen (today's points,
  today's rank, streak, all-time points); the rest behind "More".
- Leaderboard rows: rank, avatar, name, points. Time and guesses only in
  the player's own expanded row.
- Remove: "Security: scrypt" row, Google row, IST timestamps in
  non-debug UI, the big banner texts. Toasts max one line.

### F. Data, logging, security, tests

- Data: no schema change beyond dropping `otp_codes`. Supabase RLS on, no
  policies (unchanged). Guest state never leaves the device.
- Logging: keep the structured logger; add a per-request id and include it
  in every API log line and in the JSON error body as `requestId`.
  Remove logging of raw phone numbers (already masked) and of guess text
  at info level (debug only).
- Security: tighten CSP further if any inline script can be moved to a
  file; add `Strict-Transport-Security` when `x-forwarded-proto` is https;
  rate limit sign-up to 5 per IP per hour; run the `security-review`
  skill and `npm audit` (dev deps) before shipping; PIN attempts per
  account limited to 10 per 15 min, then 429.
- Tests: unit tests for the guest gate, scene selection by IST hour,
  avatar migration; API tests for request ids, HSTS header, PIN attempt
  limit; e2e for onboarding sheet → first guess within one tap, guest
  lock after puzzle 1, theme toggle persistence, phone layout at 360 px;
  visual screenshots for day and night kept in `test-results/screens`.

## Calls made after the builder check (Claude's, overridable)

1. **Start step and timer.** The Start button and start-on-press timer
   stay for fairness. On a first visit the sheet's **Play** button *is*
   the start: it closes the sheet and starts puzzle 1 in the current
   mode, for guests and signed-in players alike. Returning visitors see
   the Start panel as today. The e2e "first guess within one tap" means
   one tap after the sheet.
2. **Phone formats in existing rows.** A one-time normalisation runs at
   server start (SQLite) and ships as a SQL statement (Supabase): every
   `users.phone` is rewritten to E.164 with the current rules (+91 default
   for bare 10-digit Indian numbers). Rows that cannot be normalised are
   left alone and logged once. After that, lookup is exact match only.
   A unit test covers the migration.
3. **Sign-in form.** One identifier field. When the value is all digits,
   the country-code selector slides in beside it (default +91) and the
   client sends E.164; otherwise it is a username. The server accepts an
   exact username or an exact `+…` string; `normalizePhone` keeps only
   the strip-spaces and leading-00 rules, loses the +91 guess.
   `/api/auth/phone/login` goes; `/api/auth/register` (no phone) goes.
4. **PIN length.** Exactly 6 digits at sign-up and admin reset. Sign-in
   accepts 4–8 so existing accounts keep working; the profile shows a
   one-line nudge to an admin reset if the PIN is not 6 digits (the
   server knows the length only at sign-in, so it sets a flag on the
   session user object, never stores it).
5. **Guest allowance.** Two free puzzles a day: Easy 1 and Hard 1. After
   Easy 1 the win card offers "Try Hard mode, also free" and the gate card
   says "You've played today's free puzzle in Easy". The gate appears on
   the first locked puzzle in each mode.

Also decided by the builder check: the admin page's inline script moves to
`public/admin.js` so the CSP can drop `'unsafe-inline'` for scripts;
avatar id migration is applied where users are presented (server) and
defensively in the client; Lighthouse is run by hand, no dev dependency.

## Left to the builder

- Exact SVG paths for the ball, avatars and icons (hand-drawn in SVG, no
  raster except the favicon PNG).
- Day-scene composition details and particle counts, within the stated
  budget.
- Exact copy of the onboarding sheet within the structure above.
- Where the theme toggle sits on phones if the header is full (fallback:
  inside the help sheet).

## Verification

`npm test` (unit + API), `npm run test:e2e` (desktop + phone, day and
night screenshots), Lighthouse mobile performance ≥ 90 on the play view,
`security-review` skill clean, `npm audit` clean.

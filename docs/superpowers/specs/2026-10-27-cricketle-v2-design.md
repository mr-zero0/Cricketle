# Cricketle v2 — design

Date: 2026-10-27. Author: Claude (autonomous run on the user's request).

## Intent

Cricketle is a Contexto-style daily cricketer-guessing game (vanilla HTML/CSS/JS,
425 players, every guess returns a closeness rank). The request: make it better,
with an easy-player pool for Easy mode, a limit of **3 per day in each mode**,
3 hints in both modes, accounts, today's and all-time leaderboards, a live timer
and ranks, a stronger UI, and a better mobile experience, all tested end-to-end.

## Decisions taken as my calls (the user was not available to ask)

Update 2026-10-27: the user confirmed decision 1 (3 puzzles per day per mode).

1. **"3 guesses per day in each mode" = 3 puzzles per day per mode** (was 5).
   The existing limit is "five puzzles a day in each mode" and the request mirrors
   that sentence. Guesses inside a puzzle stay unlimited: the rank-feedback
   mechanic needs them, and the leaderboard rewards fewer guesses. The constant
   `PUZZLES_PER_DAY` is the single switch if the other reading was meant.
2. **Easy pool = a curated list of household names** (about 140 players), not a
   stats threshold: match counts alone promote journeymen from small nations and
   demote stars with short careers. Easy mode draws its answers from that pool,
   restricts guesses and ranks to it, and shows the clue tags as before. Hard
   mode uses the full pool, no tags.
3. **Accounts and leaderboards need a server.** A zero-dependency Node server
   (`node:http` + `node:sqlite`) serves the static client and a JSON API.
   Passwords are hashed with scrypt, sessions are HttpOnly cookies. The server
   is authoritative for signed-in play (it re-runs the same engine), so the
   leaderboard cannot be fed fabricated results. Guests still play fully
   offline with localStorage; the page degrades to guest mode when the API is
   unreachable (static hosting still works).
4. **Scoring** (shared code, shown in Help): 100 points per solve, −3 per guess
   after the first (max −60), −10 per hint, −1 per 20 s (max −25), floor 5;
   Hard ×1.5; give-up 0. Max 750 per day.
5. **Hints** (3 per puzzle, fixed order, both modes): nation; role + batting hand
   (+ bowling style when the player bowls); debut year + active/retired, with the
   player's initials added in Easy mode only.
6. **Timer** starts when the player presses *Start puzzle* (not on page load), is
   wall-clock based, and freezes on solve/give-up. Server timestamps are used
   when signed in.
7. **Ranks**: live leaderboard position for today and all-time, plus a ladder
   title from all-time points (Net Bowler → Club Pro → Domestic Star →
   International → World Class → Legend).
8. **Two answer seeds.** Guests use a public seed (the client can compute the
   answers, as before). Signed-in play uses a per-server secret seed, so the
   leaderboard answers cannot be read out of the JavaScript; the server returns
   each guess's rank and clue tags, and the answer only once a puzzle is over.
   All signed-in players still share the same six cricketers each day.
   `CRICKETLE_SECRET=public` collapses the two for local testing.

## Goals / non-goals

- Goals: everything above; one shared engine for browser and server; keyboard
  and screen-reader friendly; 44 px targets; reduced-motion safe; phone-first
  layout with bottom navigation; automated tests (unit, API, browser).
- Non-goals: email/password-reset flows, OAuth, light theme, PWA install,
  multiplayer, anti-cheat beyond server-side validation of signed-in play.

## Architecture

```
server.js              node:http static + API, cookie sessions, sqlite
lib/db.js              schema + queries (users, sessions, puzzles)
lib/auth.js            scrypt hashing, session tokens, validation
lib/game.js            server-side puzzle service using the shared engine
public/players.js      data (unchanged rows) + CommonJS export shim
public/game-core.js    shared pure logic: similarity, ranks, daily answers,
                       pools, hints, scoring, engine state machine, IST time
public/app.js          UI: views (Play / Leaderboard / Profile), stores
public/styles.css      design system tokens + components
public/bg.js           canvas stadium FX (lighter on phones)
test/core.test.js      node:test unit tests for game-core
test/api.test.js       node:test integration tests against a temp DB
test/e2e/*.spec.js     Playwright: desktop + phone flows, screenshots
```

### Engine state (per user per IST day)

```
{ day, modes: { easy: { puzzles: [P, P, P] }, hard: { puzzles: [P, P, P] } } }
P = { status: locked|ready|active|solved|gaveUp, guesses: [name], hints: n,
      startedAt: ms|null, finishedAt: ms|null, points: n }
```
Puzzle 0 is `ready` at day start; finishing a puzzle makes the next one `ready`.
Engine functions are pure (`startPuzzle`, `applyGuess`, `useHint`, `giveUp`),
return `{ ok, error?, state, rank? }` and are used by both the browser guest
store and the server.

### API

- `POST /api/auth/register|login`, `POST /api/auth/logout`, `GET /api/me`
- `GET /api/state`, `POST /api/puzzle/start|guess|hint|giveup`
- `GET /api/leaderboard/today`, `GET /api/leaderboard/alltime`
All POSTs require `Content-Type: application/json` and a same-origin `Origin`.

### UI direction (ui-ux-pro-max: "Vibrant & block-based", Bebas Neue + Source Sans 3)

Keep the floodlit-stadium identity (dark pitch greens, amber for Hard), bolder
block layout, 48 px section rhythm on desktop, strong hover colour shifts,
stagger-in lists, tabular numerals for timer and points. Mobile: fixed bottom
tab bar (Play, Leaderboard, Profile) with safe-area padding, dialogs become
bottom sheets, canvas FX lighter, no horizontal scroll at 360 px.

## Verification

- `npm test` runs unit + API tests (node:test, no deps).
- `npm run test:e2e` runs Playwright against the real server on a temp DB:
  plays through puzzles (the spec reads the daily answer from the page's own
  engine), checks timer, hints, points, lock-out after 3, sign-up, leaderboard
  rows and rank, and the phone layout; screenshots land in `test-results/`.

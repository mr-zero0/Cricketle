# 🏏 Cricketle

Guess the secret cricketer. Every guess returns a **rank**: 1 is the answer, and the lower the number, the closer you are. Three puzzles a day in **Easy** (171 well-known players, with clue tags) and **Hard** (all 425 players, rank only), three hints per puzzle, a live timer, points, accounts, today's and all-time leaderboards, and a rank ladder from Net Bowler to Legend.

![Cricketle](https://img.shields.io/badge/Cricketle-v2.0-blue?style=for-the-badge)
[![Play Live](https://img.shields.io/badge/▶_Play_Live-mr--zero0.github.io%2FCricketle-2ea44f?style=for-the-badge&logo=googlechrome&logoColor=white)](https://mr-zero0.github.io/Cricketle/)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.5-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

---

## 🌐 Play Online

Jump straight into today's puzzles (no download or login needed):

👉 **[https://mr-zero0.github.io/Cricketle/](https://mr-zero0.github.io/Cricketle/)**

*(Plays in **guest mode** with progress saved locally in your browser)*

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

Opening `public/index.html` directly, or hosting `public/` on any static host, also works: the page plays in **guest mode** (progress saved in localStorage, standalone engine).

---

## 🧠 How it Works

- `public/game-core.js` holds every rule once: pools, similarity and rank tables, the IST game day, seeded daily answers, hints, scoring, the rank ladder and the puzzle state machine. The browser and the server both run it.
- **Guests** play against the browser copy.
- **Signed-in players** send each action to the server, which runs the same engine against the database, so leaderboard results are verified and progress follows the account across devices. Signed-in puzzles use a server-side seed, so the answers cannot be inspected in client source.
- **Scoring**: A solve is worth 100 points, minus 3 per guess after the first (max 60), 10 per hint, and 1 per 20 seconds (max 25), never below 5. Hard mode counts 1.5×. Giving up scores 0.
- The day rolls over at **midnight IST** for everyone.

---

## 📡 API

All responses are JSON. POST bodies must be `application/json` from the same origin.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | IST day and server time |
| `POST` | `/api/auth/register` | `{ username, password }` → session cookie |
| `POST` | `/api/auth/login` | `{ username, password }` |
| `POST` | `/api/auth/google` | Google One-Tap / OAuth sign-in |
| `GET` | `/api/config/firebase` | Public Firebase Phone configuration status |
| `POST` | `/api/auth/firebase-phone` | Verified Firebase phone token login (10,000 free real SMS/mo) |
| `POST` | `/api/auth/otp/send` | Send mobile verification OTP code |
| `POST` | `/api/auth/otp/verify` | Verify mobile 6-digit OTP code |
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

## 🧪 Tests

```bash
npm test
```

Runs the unit tests for the shared core and the API integration tests (Node's built-in test runner, in-memory database, fake clock; zero dependencies).

```bash
npm run test:e2e
```

Runs the Playwright browser suite on desktop and phone profiles against a real server with a throwaway database. Requires `npm install` and browser binaries.

---

## 📂 Project Layout

```
server.js            HTTP server: static files + JSON API, cookie sessions
lib/db.js            SQLite schema and queries
lib/auth.js          scrypt password hashing, session tokens
lib/game.js          server-side game service and leaderboards
public/              the client (index.html, styles.css, app.js, bg.js, players.js, game-core.js)
index.html           entry redirect to /public for static hosts & GitHub Pages
test/core.test.js    engine unit tests
test/api.test.js     API integration tests
test/e2e/            Playwright specs
docs/superpowers/    design notes & specs
```

---

## 📄 License

MIT

// Cricketle shared game core.
//
// One copy of the rules for both sides: the browser loads this as a classic script
// (after players.js) and gets window.CricketleCore; the Node server requires it.
// Everything here is pure: no DOM, no storage, no clocks (callers pass `now`).
//
// Contents: player pools (Easy = curated well-known names, Hard = everyone),
// similarity + rank tables, the IST game day, seeded daily answers, hints,
// scoring, the rank ladder and the puzzle state machine.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./players.js"));
  } else {
    /* global PLAYERS, COUNTRIES, IPL_TEAMS, BOWL_STYLES, PACE, SPIN */
    root.CricketleCore = factory({ PLAYERS, COUNTRIES, IPL_TEAMS, BOWL_STYLES, PACE, SPIN });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (data) {
  "use strict";

  const { PLAYERS, COUNTRIES, BOWL_STYLES, PACE, SPIN } = data;

  // ---------- Constants ----------

  const PUZZLES_PER_DAY = 3;
  // Guests (no account) may play this many puzzles per mode per day; the rest
  // ask them to sign in. Signed-in play is never gated.
  const GUEST_PUZZLES_PER_MODE = 1;
  const HINTS_PER_PUZZLE = 3;
  const HINT_COST = 10;
  const MODES = ["easy", "hard"];
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ---------- Pools ----------

  // Easy mode uses household names only. Curated by hand rather than by a stats
  // threshold: match counts alone promote long-serving journeymen from small
  // nations and demote stars with short careers.
  const EASY_NAMES = [
    // India
    "Virat Kohli", "Rohit Sharma", "MS Dhoni", "Sachin Tendulkar", "Jasprit Bumrah", "Ravindra Jadeja",
    "Ravichandran Ashwin", "Hardik Pandya", "KL Rahul", "Shubman Gill", "Yuvraj Singh", "Virender Sehwag",
    "Rahul Dravid", "Zaheer Khan", "Harbhajan Singh", "Mohammed Shami", "Rishabh Pant", "Suryakumar Yadav",
    "Gautam Gambhir", "Shikhar Dhawan", "Kuldeep Yadav", "Yuzvendra Chahal", "Bhuvneshwar Kumar",
    "Mohammed Siraj", "Ajinkya Rahane", "Irfan Pathan", "Ishant Sharma", "Dinesh Karthik", "Suresh Raina",
    "Shreyas Iyer", "Axar Patel", "Yashasvi Jaiswal",
    // Pakistan
    "Babar Azam", "Shaheen Afridi", "Shahid Afridi", "Shoaib Akhtar", "Inzamam-ul-Haq", "Younis Khan",
    "Misbah-ul-Haq", "Mohammad Rizwan", "Shadab Khan", "Mohammad Amir", "Fakhar Zaman", "Mohammad Hafeez",
    "Shoaib Malik", "Saeed Ajmal", "Mohammad Yousuf", "Abdul Razzaq", "Sarfaraz Ahmed", "Haris Rauf",
    // Australia
    "Ricky Ponting", "Steve Smith", "David Warner", "Glenn McGrath", "Adam Gilchrist", "Pat Cummins",
    "Mitchell Starc", "Glenn Maxwell", "Travis Head", "Michael Clarke", "Brett Lee", "Matthew Hayden",
    "Mitchell Johnson", "Aaron Finch", "Josh Hazlewood", "Marnus Labuschagne", "Shane Watson",
    "Michael Hussey", "Andrew Symonds", "Mitchell Marsh", "Nathan Lyon",
    // England
    "Ben Stokes", "Joe Root", "Jos Buttler", "James Anderson", "Stuart Broad", "Kevin Pietersen",
    "Andrew Flintoff", "Alastair Cook", "Eoin Morgan", "Jofra Archer", "Moeen Ali", "Harry Brook",
    "Graeme Swann", "Adil Rashid", "Jonny Bairstow", "Sam Curran", "Chris Woakes",
    // South Africa
    "AB de Villiers", "Jacques Kallis", "Dale Steyn", "Kagiso Rabada", "Quinton de Kock", "Faf du Plessis",
    "Hashim Amla", "Graeme Smith", "Shaun Pollock", "Aiden Markram", "Heinrich Klaasen", "Imran Tahir",
    "Morne Morkel", "JP Duminy", "Herschelle Gibbs", "Mark Boucher", "Makhaya Ntini",
    // New Zealand
    "Kane Williamson", "Brendon McCullum", "Trent Boult", "Daniel Vettori", "Ross Taylor", "Tim Southee",
    "Martin Guptill", "Rachin Ravindra", "Mitchell Santner", "Devon Conway", "Stephen Fleming", "Shane Bond",
    "Glenn Phillips", "James Neesham", "Tom Latham", "Daryl Mitchell", "Chris Cairns", "Nathan Astle",
    // Sri Lanka
    "Kumar Sangakkara", "Mahela Jayawardene", "Muttiah Muralitharan", "Lasith Malinga", "Sanath Jayasuriya",
    "Chaminda Vaas", "Tillakaratne Dilshan", "Angelo Mathews", "Wanindu Hasaranga", "Rangana Herath",
    "Thisara Perera", "Kusal Mendis", "Ajantha Mendis",
    // West Indies
    "Chris Gayle", "Dwayne Bravo", "Andre Russell", "Sunil Narine", "Shai Hope", "Shivnarine Chanderpaul",
    "Marlon Samuels", "Darren Sammy", "Kemar Roach", "Jason Holder", "Carlos Brathwaite",
    // Bangladesh
    "Shakib Al Hasan", "Tamim Iqbal", "Mushfiqur Rahim", "Mustafizur Rahman", "Mashrafe Mortaza",
    "Mahmudullah", "Litton Das", "Mehidy Hasan Miraz",
    // Afghanistan
    "Rashid Khan", "Mohammad Nabi", "Mujeeb Ur Rahman", "Rahmanullah Gurbaz", "Ibrahim Zadran",
    "Mohammad Shahzad",
    // Zimbabwe
    "Sikandar Raza", "Heath Streak", "Brendan Taylor", "Hamilton Masakadza", "Sean Williams", "Tatenda Taibu",
    // Ireland
    "Paul Stirling", "Kevin O'Brien", "William Porterfield", "Andrew Balbirnie",
  ];

  const PLAYER_BY_NAME = new Map(PLAYERS.map((p) => [p.name, p]));
  const EASY_SET = new Set(EASY_NAMES);
  const POOLS = {
    easy: PLAYERS.filter((p) => EASY_SET.has(p.name)),
    hard: PLAYERS.slice(),
  };
  const POOL_SETS = {
    easy: new Set(POOLS.easy.map((p) => p.name)),
    hard: new Set(POOLS.hard.map((p) => p.name)),
  };

  function poolFor(mode) {
    if (!POOLS[mode]) throw new Error("Unknown mode: " + mode);
    return POOLS[mode];
  }

  function inPool(mode, name) {
    return Boolean(POOL_SETS[mode] && POOL_SETS[mode].has(name));
  }

  function byName(name) {
    return PLAYER_BY_NAME.get(name);
  }

  // ---------- Similarity ----------

  function logGap(a, b) {
    return Math.abs(Math.log10(a + 1) - Math.log10(b + 1));
  }

  function statScore(a, b) {
    // Full marks when numbers are the same order of magnitude; fades out at ~30x apart.
    return 5 * Math.max(0, 1 - logGap(a, b) / 1.5);
  }

  function bowlFamily(code) {
    if (PACE.has(code)) return "pace";
    if (SPIN.has(code)) return "spin";
    return "none";
  }

  function sharedTeams(a, b) {
    return a.ipl.filter((t) => b.ipl.includes(t));
  }

  // Higher = closer. Symmetric.
  function similarity(a, b) {
    let s = 0;
    if (a.country === b.country) s += 30;
    if (a.role === b.role) s += 15;
    if (a.bat === b.bat) s += 5;

    if (a.bowl === b.bowl) s += 10;
    else if (bowlFamily(a.bowl) === bowlFamily(b.bowl)) s += 5;

    s += 12 * Math.max(0, 1 - Math.abs(a.debut - b.debut) / 25);
    if (a.active === b.active) s += 4;

    const shared = sharedTeams(a, b).length;
    const union = new Set([...a.ipl, ...b.ipl]).size;
    if (union === 0) s += 6;
    else s += 15 * (shared / union);

    s += 5 * Math.max(0, 1 - Math.abs(a.titles - b.titles) / 4);

    s += statScore(a.matches, b.matches);
    s += statScore(a.runs, b.runs);
    s += statScore(a.wkts, b.wkts);
    return s;
  }

  // Human-readable reasons a guess is close. Only confirms what the guess shares
  // with the answer; never states the answer's own values.
  function reasons(guess, answer) {
    const out = [];
    if (guess.country === answer.country) out.push("Same nation");
    if (guess.role === answer.role) out.push("Same role");
    const teams = sharedTeams(guess, answer);
    if (teams.length) out.push("IPL: " + teams.join(", "));
    if (guess.bowl === answer.bowl && guess.bowl !== "-") out.push("Same bowling style");
    else if (bowlFamily(guess.bowl) === bowlFamily(answer.bowl) && guess.bowl !== "-") out.push("Both " + bowlFamily(guess.bowl));
    if (guess.bat === answer.bat) out.push(guess.bat === "L" ? "Both left-handed" : "Both right-handed");
    if (Math.abs(guess.debut - answer.debut) <= 5) out.push("Same era");
    if (guess.active === answer.active) out.push(guess.active ? "Both active" : "Both retired");
    if (guess.titles > 0 && guess.titles === answer.titles) out.push("Both won " + guess.titles + " ICC title" + (guess.titles > 1 ? "s" : ""));
    if (logGap(guess.runs, answer.runs) < 0.12) out.push("Similar runs");
    if (logGap(guess.wkts, answer.wkts) < 0.12 && answer.wkts > 20) out.push("Similar wickets");
    return out.slice(0, 5);
  }

  // Rank table over a pool: every member ordered by closeness. Rank 1 is the answer.
  function buildRanks(answer, pool) {
    const scored = pool.map((pl) => ({
      name: pl.name,
      score: pl.name === answer.name ? Infinity : similarity(pl, answer),
    }));
    scored.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
    const ranks = new Map();
    scored.forEach((e, i) => ranks.set(e.name, i + 1));
    return ranks;
  }

  // Heat tiers scale with the size of the pool.
  function tiers(poolSize) {
    return { hot: 10, warm: Math.round(poolSize * 0.15), cool: Math.round(poolSize * 0.4) };
  }

  function tier(rank, poolSize) {
    const t = tiers(poolSize);
    if (rank === 1) return { key: "answer", label: "Answer" };
    if (rank <= t.hot) return { key: "hot", label: "Hot" };
    if (rank <= t.warm) return { key: "warm", label: "Warm" };
    if (rank <= t.cool) return { key: "cool", label: "Cool" };
    return { key: "cold", label: "Cold" };
  }

  // ---------- IST day ----------

  const pad = (n) => String(n).padStart(2, "0");

  function todayKey(now) {
    const d = new Date((now === undefined ? Date.now() : now) + IST_OFFSET_MS);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function msUntilReset(now) {
    const t = (now === undefined ? Date.now() : now) + IST_OFFSET_MS;
    const d = new Date(t);
    const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return nextMidnight - t;
  }

  // Hour of day in IST (0-23) for a UTC instant.
  function istHour(now) {
    return new Date((now === undefined ? Date.now() : now) + IST_OFFSET_MS).getUTCHours();
  }

  // Stadium scene for an IST hour: daylight from 06:00 until 18:00.
  // theme.js repeats this rule because it runs in <head>, before this file.
  function sceneForHour(hourIST) {
    return hourIST >= 6 && hourIST < 18 ? "day" : "night";
  }

  // ---------- Seeded daily answers ----------

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Partial Fisher-Yates driven by a seeded generator; skips excluded names.
  function pickFrom(pool, seedStr, n, exclude) {
    const rnd = mulberry32(hashString(seedStr));
    const idx = pool.map((_, i) => i);
    const out = [];
    for (let i = 0; i < idx.length && out.length < n; i++) {
      const j = i + Math.floor(rnd() * (idx.length - i));
      const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
      const name = pool[idx[i]].name;
      if (!exclude.has(name)) out.push(name);
    }
    return out;
  }

  const answerCache = new Map();

  // Three Easy answers from the easy pool and three Hard answers from everyone,
  // identical for every player on the same IST day, six different cricketers.
  // `secret` is empty for guest play (public seed) and a per-server secret for
  // signed-in play, so leaderboard answers cannot be read out of the client.
  function dailyAnswers(day, secret) {
    const salt = secret || "";
    const key = salt + "|" + day;
    if (answerCache.has(key)) return answerCache.get(key);
    const easy = pickFrom(POOLS.easy, "cricketle:v2:easy:" + salt + ":" + day, PUZZLES_PER_DAY, new Set());
    const hard = pickFrom(POOLS.hard, "cricketle:v2:hard:" + salt + ":" + day, PUZZLES_PER_DAY, new Set(easy));
    const out = { easy, hard };
    if (answerCache.size > 64) answerCache.clear();
    answerCache.set(key, out);
    return out;
  }

  function answerFor(day, mode, idx, secret) {
    return byName(dailyAnswers(day, secret)[mode][idx]);
  }

  const rankCache = new Map();

  function ranksFor(day, mode, idx, secret) {
    const key = (secret || "") + "|" + day + "|" + mode + "|" + idx;
    if (rankCache.has(key)) return rankCache.get(key);
    const table = buildRanks(answerFor(day, mode, idx, secret), poolFor(mode));
    if (rankCache.size > 64) rankCache.clear();
    rankCache.set(key, table);
    return table;
  }

  // Moves a YYYY-MM-DD key by whole days.
  function shiftDay(day, n) {
    const [y, m, d] = day.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate());
  }

  // The facts about a player that may be shown once a puzzle is over.
  function describe(p) {
    return { name: p.name, country: p.country, countryName: COUNTRIES[p.country], role: p.role, debut: p.debut, active: p.active };
  }

  // ---------- Hints ----------

  const HINT_LABELS = ["Nation", "Role", "Era"];

  const PLAYER_FEATS = {
    "Virat Kohli": { label: "Famous Inning", text: "Masterful 82* vs Pakistan at Melbourne in 2022 T20 World Cup chase" },
    "Rohit Sharma": { label: "Famous Inning", text: "World-record 264 vs Sri Lanka at Eden Gardens and 5 centuries in 2019 World Cup" },
    "MS Dhoni": { label: "Famous Inning", text: "Match-winning 91* in 2011 World Cup Final with the iconic winning six over long-on" },
    "Sachin Tendulkar": { label: "Famous Inning", text: "'Desert Storm' 143 vs Australia in Sharjah and first male double-century in ODIs" },
    "Jasprit Bumrah": { label: "Known For", text: "Premier death-overs yorker specialist with 2/18 in the 2024 T20 World Cup Final" },
    "Ravindra Jadeja": { label: "Known For", text: "Only Indian with three first-class triple centuries; 10 wickets and 175* in Mohali 2022" },
    "Ravichandran Ashwin": { label: "Known For", text: "Fastest to 250, 300, and 350 Test wickets; over 500 Test wickets and 5 Test tons" },
    "Hardik Pandya": { label: "Known For", text: "Defended 16 in final over of 2024 T20 World Cup Final and 76 off 43 in 2017 CT Final" },
    "KL Rahul": { label: "Known For", text: "Fastest 50 in IPL history (14 balls) and scored century on ODI debut" },
    "Shubman Gill": { label: "Famous Inning", text: "Blasted 208 vs New Zealand in Hyderabad becoming youngest ODI double-centurion" },
    "Yuvraj Singh": { label: "Famous Inning", text: "6 sixes in one over off Stuart Broad in 2007 T20 World Cup and 2011 WC Player of Tournament" },
    "Virender Sehwag": { label: "Famous Inning", text: "Two triple-centuries in Tests (309 in Multan, 319 vs SA) and an ODI 219" },
    "Rahul Dravid": { label: "Famous Inning", text: "'The Wall' with marathon 180 in Kolkata 2001 and over 31,000 balls faced in Tests" },
    "Zaheer Khan": { label: "Known For", text: "Joint-highest wicket-taker in 2011 World Cup with 21 wickets including knuckle-ball mastery" },
    "Harbhajan Singh": { label: "Famous Inning", text: "First Indian to take a Test hat-trick (2001 vs Australia) and 700+ international wickets" },
    "Mohammed Shami": { label: "Famous Inning", text: "Stunning 7/57 vs New Zealand in 2023 World Cup Semi-Final; leading wicket-taker of 2023 WC" },
    "Rishabh Pant": { label: "Famous Inning", text: "Heroic 89* at the Gabba on Day 5 to breach Australia's 32-year fortress in 2021" },
    "Suryakumar Yadav": { label: "Known For", text: "World No. 1 360-degree T20 batter with 4 T20I tons and iconic 2024 final boundary catch" },
    "Gautam Gambhir": { label: "Famous Inning", text: "Top-scored in both the 2007 T20 World Cup Final (75) and 2011 World Cup Final (97)" },
    "Shikhar Dhawan": { label: "Famous Inning", text: "Fastest century on Test debut (85 balls vs Australia) and 'Mr. ICC' with 6 ICC tournament tons" },
    "Kuldeep Yadav": { label: "Known For", text: "Only Indian bowler with two international hat-tricks (ODIs vs Australia and West Indies)" },
    "Yuzvendra Chahal": { label: "Known For", text: "First Indian bowler to take a 6-wicket haul in T20Is (6/25 vs England in Bengaluru)" },
    "Bhuvneshwar Kumar": { label: "Known For", text: "Took a wicket on his very first ball in T20Is and bowled Mohammad Hafeez first ball in ODIs" },
    "Mohammed Siraj": { label: "Famous Inning", text: "Sensational 6/21 in Asia Cup 2023 Final dismantling Sri Lanka for 50" },
    "Ajinkya Rahane": { label: "Famous Inning", text: "Captain's century (112) at the MCG in Boxing Day Test to turn the 2020-21 Border-Gavaskar series" },
    "Irfan Pathan": { label: "Famous Inning", text: "Historic hat-trick in the first over of a Test match vs Pakistan in Karachi (2006)" },
    "Ishant Sharma": { label: "Famous Inning", text: "Iconic 7/74 at Lord's in 2014 to seal a historic Test win in England" },
    "Dinesh Karthik": { label: "Famous Inning", text: "Smashed 29 off 8 balls including a last-ball six to win the 2018 Nidahas Trophy Final" },
    "Suresh Raina": { label: "Known For", text: "First Indian to score a century in all three international formats (Tests, ODIs, T20Is)" },
    "Shreyas Iyer": { label: "Famous Inning", text: "Scored 105 off 70 balls in the 2023 World Cup Semi-Final vs New Zealand in Mumbai" },
    "Axar Patel": { label: "Known For", text: "Crucial 47 off 31 in 2024 T20 World Cup Final and 27 wickets in debut 3-Test series vs England" },
    "Yashasvi Jaiswal": { label: "Famous Inning", text: "Consecutive Test double-centuries (209 & 214*) vs England in 2024 at age 22" },
    "Babar Azam": { label: "Known For", text: "Fastest player in history to 5,000 ODI runs, achieving it in just 97 innings" },
    "Shaheen Afridi": { label: "Famous Inning", text: "Sensational opening spell of 3/31 dismantling India's top order at 2021 T20 World Cup" },
    "Shahid Afridi": { label: "Famous Inning", text: "Blasted a 37-ball ODI century using Sachin Tendulkar's bat in only his second innings" },
    "Shoaib Akhtar": { label: "Known For", text: "'Rawalpindi Express' who bowled the fastest officially recorded ball at 161.3 km/h" },
    "Inzamam-ul-Haq": { label: "Famous Inning", text: "Match-turning 60 off 37 balls in 1992 World Cup Semi-Final vs New Zealand" },
    "Younis Khan": { label: "Known For", text: "Only Pakistani batsman with 10,000+ Test runs and captained 2009 T20 World Cup win" },
    "Misbah-ul-Haq": { label: "Known For", text: "Equalled Viv Richards' then-record for fastest Test century off 56 balls vs Australia" },
    "Mohammad Rizwan": { label: "Known For", text: "Scored 1,326 T20I runs in a single calendar year (2021), a world record" },
    "Mohammad Amir": { label: "Famous Inning", text: "Blistering spell of 3/16 taking out Rohit, Kohli, and Dhawan in 2017 Champions Trophy Final" },
    "Fakhar Zaman": { label: "Famous Inning", text: "Match-winning 114 in 2017 Champions Trophy Final and Pakistan's first ODI double-centurion (210*)" },
    "Ricky Ponting": { label: "Famous Inning", text: "Dominant 140* in 2003 World Cup Final and led Australia to two World Cup crowns" },
    "Steve Smith": { label: "Known For", text: "Averaged over 110 in the 2019 Ashes series with 774 runs in just 7 innings" },
    "David Warner": { label: "Famous Inning", text: "Triple-centurion in Tests (335*) and 2021 T20 World Cup Player of the Tournament" },
    "Glenn McGrath": { label: "Known For", text: "All-time leading World Cup wicket-taker with 71 wickets at an average of 18.19" },
    "Adam Gilchrist": { label: "Famous Inning", text: "Blistering 149 in 2007 World Cup Final with a squash ball in his glove" },
    "Pat Cummins": { label: "Known For", text: "Captained Australia to 2023 WTC and 2023 ODI World Cup victories in the same year" },
    "Mitchell Starc": { label: "Known For", text: "Fastest bowler to 150, 200, and 250 ODI wickets and 2015 World Cup Player of the Tournament" },
    "Glenn Maxwell": { label: "Famous Inning", text: "Miraculous 201* from 91/7 vs Afghanistan in the 2023 World Cup while battling cramps" },
    "Travis Head": { label: "Famous Inning", text: "Player of the Match in both the 2023 WTC Final (163) and 2023 World Cup Final (137)" },
    "Brett Lee": { label: "Known For", text: "One of the fastest bowlers ever clocked at 161.1 km/h with 718 international wickets" },
    "Matthew Hayden": { label: "Famous Inning", text: "Broke Brian Lara's Test record with 380 vs Zimbabwe in Perth (2003)" },
    "Ben Stokes": { label: "Famous Inning", text: "Unbelievable 135* at Headingley in 2019 Ashes chase and 84* in 2019 World Cup Final" },
    "Joe Root": { label: "Known For", text: "England's leading Test century-maker with 35+ Test hundreds and 12,000+ Test runs" },
    "Jos Buttler": { label: "Known For", text: "Captained England to 2022 T20 World Cup title and smashed 863 runs in IPL 2022" },
    "James Anderson": { label: "Known For", text: "Most wickets by any pacer in Test history (704 Test wickets across 188 matches)" },
    "Stuart Broad": { label: "Famous Inning", text: "Devastating 8/15 at Trent Bridge in 2015 Ashes and 604 Test wickets" },
    "Kevin Pietersen": { label: "Famous Inning", text: "Player of the Tournament in 2010 T20 World Cup and iconic 158 at the Oval in 2005 Ashes" },
    "Alastair Cook": { label: "Famous Inning", text: "Batted for 2,171 minutes scoring 766 runs in the 2010-11 Ashes series in Australia" },
    "Jofra Archer": { label: "Famous Inning", text: "Bowled the dramatic Super Over in the 2019 World Cup Final to win the title for England" },
    "AB de Villiers": { label: "Known For", text: "Fastest century in ODI history off just 31 balls vs West Indies in Johannesburg" },
    "Jacques Kallis": { label: "Known For", text: "Only player in cricket history with 10,000+ runs and 250+ wickets in both Tests and ODIs" },
    "Dale Steyn": { label: "Known For", text: "Held the world No. 1 Test bowling ranking for a record 2,356 days with 439 Test wickets" },
    "Kagiso Rabada": { label: "Known For", text: "Youngest bowler to take a 6-wicket haul on ODI debut including a hat-trick (6/16 vs BAN)" },
    "Quinton de Kock": { label: "Famous Inning", text: "Smashed 4 centuries in the 2023 World Cup and 178 vs Australia at Centurion" },
    "Faf du Plessis": { label: "Famous Inning", text: "Marathon 110* on Test debut batting 376 balls on Day 5 to save the Adelaide Test in 2012" },
    "Hashim Amla": { label: "Known For", text: "Fastest batsman to 2,000, 3,000, 4,000, 5,000, 6,000, and 7,000 ODI runs" },
    "Kane Williamson": { label: "Known For", text: "Player of the Tournament at the 2019 World Cup and led New Zealand to 2021 WTC glory" },
    "Brendon McCullum": { label: "Famous Inning", text: "Fastest Test century in history off 54 balls and 158* on IPL opening night in 2008" },
    "Trent Boult": { label: "Known For", text: "Took a World Cup hat-trick at Lord's in 2019 and over 600 international wickets" },
    "Martin Guptill": { label: "Famous Inning", text: "World Cup record 237* off 163 balls vs West Indies in 2015 Quarter-Final" },
    "Kumar Sangakkara": { label: "Famous Inning", text: "Scored four consecutive centuries in the 2015 World Cup and over 28,000 international runs" },
    "Mahela Jayawardene": { label: "Famous Inning", text: "Scored a century in 2011 World Cup Final (103*) and 374 in Tests vs South Africa" },
    "Muttiah Muralitharan": { label: "Known For", text: "All-time leading international wicket-taker with 800 Test and 534 ODI wickets" },
    "Lasith Malinga": { label: "Known For", text: "Four wickets in four balls twice in international cricket and two World Cup hat-tricks" },
    "Sanath Jayasuriya": { label: "Known For", text: "Revolutionized ODI batting in 1996 World Cup; 13,000+ runs and 300+ ODI wickets" },
    "Chris Gayle": { label: "Known For", text: "'Universe Boss' with 175* off 66 balls in IPL and first double-century in World Cup history" },
    "Brian Lara": { label: "Famous Inning", text: "World record 400* in Test cricket and 501* in first-class cricket" },
    "Carlos Brathwaite": { label: "Famous Inning", text: "'Remember the name!' - hit 4 consecutive sixes in the final over of 2016 T20 World Cup Final" },
    "Shakib Al Hasan": { label: "Known For", text: "Only player to score 600+ runs and take 10+ wickets in a single World Cup (2019)" },
    "Rashid Khan": { label: "Known For", text: "Fastest bowler to 100 ODI wickets in just 44 matches and premier global T20 leg-spinner" },
    "Kapil Dev": { label: "Famous Inning", text: "Legendary 175* from 17/5 vs Zimbabwe in 1983 World Cup sparking India's triumph" },
    "Viv Richards": { label: "Famous Inning", text: "Blasted 138* in 1979 World Cup Final and a 56-ball Test century vs England" },
    "Wasim Akram": { label: "Famous Inning", text: "'Sultan of Swing' with two wickets in two balls in 1992 World Cup Final" },
    "Sunil Gavaskar": { label: "Known For", text: "First batsman to reach 10,000 Test runs and score 34 Test centuries" },
    "Anil Kumble": { label: "Famous Inning", text: "Took all 10 wickets in a single Test innings (10/74 vs Pakistan in Delhi 1999)" },
    "Sourav Ganguly": { label: "Famous Inning", text: "'God of the Off-Side' who scored 183 in 1999 World Cup and led India to 2003 Final" },
    "VVS Laxman": { label: "Famous Inning", text: "Epic 281 against Australia at Eden Gardens in 2001 after following on" },
    "Shane Watson": { label: "Famous Inning", text: "Scored 117* on one leg in 2019 IPL Final and won two World Cup titles" },
    "Kevin O'Brien": { label: "Famous Inning", text: "Fastest century in World Cup history (off 50 balls) to defeat England in Bengaluru (2011)" }
  };

  function getPlayerFeat(player) {
    if (PLAYER_FEATS[player.name]) return PLAYER_FEATS[player.name];
    if (player.titles >= 2) {
      return { label: "Career Feat", text: "Multi-time ICC title winner with " + player.titles + " global championships" };
    }
    if (player.titles === 1) {
      return { label: "Career Feat", text: "ICC trophy winner who represented " + COUNTRIES[player.country] + " in " + player.matches + " matches" };
    }
    if (player.runs >= 10000) {
      return { label: "Career Feat", text: "Prolific run-scorer with over " + (Math.floor(player.runs / 1000) * 1000).toLocaleString() + " international runs" };
    }
    if (player.wkts >= 300) {
      return { label: "Career Feat", text: "Premier strike bowler with over " + (Math.floor(player.wkts / 50) * 50).toLocaleString() + " international wickets" };
    }
    if (player.runs >= 3000 && player.wkts >= 100) {
      return { label: "Career Feat", text: "Accomplished all-rounder with " + player.runs.toLocaleString() + " runs and " + player.wkts + " international wickets" };
    }
    if (player.ipl && player.ipl.length) {
      const teams = player.ipl.map((t) => (typeof IPL_TEAMS !== "undefined" && IPL_TEAMS[t]) || t).join(", ");
      return { label: "Known For", text: "Featured for " + teams + " in the IPL" };
    }
    return {
      label: "Career Feat",
      text: (player.active ? "Active international cricketer" : "Retired international cricketer") + " with " + player.matches + " appearances for " + COUNTRIES[player.country],
    };
  }

  function initials(name) {
    return name.split(/\s+/).map((w) => w[0].toUpperCase()).join(".") + ".";
  }

  function isNationIdentified(player, guesses) {
    if (!guesses || !guesses.length) return false;
    return guesses.some((g) => {
      if (g.tags && g.tags.includes("Same nation")) return true;
      if (g.country && g.country === player.country) return true;
      const gp = byName(g.name || g);
      return gp && gp.country === player.country;
    });
  }

  function isRoleIdentified(player, guesses) {
    if (!guesses || !guesses.length) return false;
    return guesses.some((g) => {
      if (g.tags && g.tags.includes("Same role")) return true;
      if (g.role && g.role === player.role) return true;
      const gp = byName(g.name || g);
      return gp && gp.role === player.role;
    });
  }

  function getHintsForPuzzle(player, mode, guesses) {
    const nationIdentified = isNationIdentified(player, guesses);
    const roleIdentified = isRoleIdentified(player, guesses);

    const pool = [];

    // 1. Nation (only if not already identified)
    if (!nationIdentified) {
      pool.push({
        key: "nation",
        label: "Nation",
        text: "Represents " + COUNTRIES[player.country],
        cost: HINT_COST,
      });
    }

    // 2. Role (only if not already identified)
    if (!roleIdentified) {
      let roleText = (player.bat === "L" ? "Left-handed " : "Right-handed ") + player.role.toLowerCase();
      if (player.bowl !== "-") roleText += ", bowls " + BOWL_STYLES[player.bowl].toLowerCase();
      pool.push({
        key: "role",
        label: "Role",
        text: roleText,
        cost: HINT_COST,
      });
    }

    // 3. Era
    let eraText = "Debuted in " + player.debut + " · " + (player.active ? "still playing" : "retired");
    if (mode === "easy" && !nationIdentified && !roleIdentified) {
      eraText += " · initials " + initials(player.name);
    }
    pool.push({
      key: "era",
      label: "Era",
      text: eraText,
      cost: HINT_COST,
    });

    // 4. Famous Inning or Known For
    const feat = getPlayerFeat(player);
    if (feat) {
      pool.push({
        key: "feat",
        label: feat.label || "Known For",
        text: feat.text,
        cost: HINT_COST,
      });
    }

    // 5. Name Initials
    pool.push({
      key: "initials",
      label: "Initials",
      text: "Player's name initials are " + initials(player.name),
      cost: HINT_COST,
    });

    return pool;
  }

  function hintFor(player, n, mode, context) {
    if (!Number.isInteger(n) || n < 1 || n > HINTS_PER_PUZZLE) throw new RangeError("Hint number out of range: " + n);
    const guesses = (context && context.guesses) ? context.guesses : (Array.isArray(context) ? context : []);
    const hints = getHintsForPuzzle(player, mode, guesses);
    const chosen = hints[n - 1] || hints[hints.length - 1];
    return { n, label: chosen.label, text: chosen.text, cost: HINT_COST };
  }

  // ---------- Scoring ----------

  // 100 a solve, minus 3 per guess after the first (max 60), 10 per hint and
  // 1 per 20 seconds (max 25); never below 5 once solved. Hard counts 1.5x.
  function scorePuzzle(o) {
    if (!o.solved) return 0;
    const guessPen = Math.min(60, 3 * Math.max(0, (o.guesses || 0) - 1));
    const hintPen = HINT_COST * (o.hints || 0);
    const timePen = Math.min(25, Math.floor(Math.max(0, o.seconds || 0) / 20));
    let pts = Math.max(5, 100 - guessPen - hintPen - timePen);
    if (o.mode === "hard") pts = Math.round(pts * 1.5);
    return pts;
  }

  const RANK_LADDER = [
    { title: "Net Bowler", min: 0 },
    { title: "Club Pro", min: 300 },
    { title: "Domestic Star", min: 1000 },
    { title: "International", min: 2500 },
    { title: "World Class", min: 6000 },
    { title: "Legend", min: 12000 },
  ];

  function rankTitle(points) {
    const pts = Math.max(0, points || 0);
    let i = 0;
    while (i + 1 < RANK_LADDER.length && pts >= RANK_LADDER[i + 1].min) i++;
    const cur = RANK_LADDER[i];
    const next = RANK_LADDER[i + 1] || null;
    const progress = next ? (pts - cur.min) / (next.min - cur.min) : 1;
    return { title: cur.title, min: cur.min, next, progress };
  }

  // ---------- Puzzle state machine ----------
  //
  // state = { day, modes: { easy: { puzzles: [P x3] }, hard: { puzzles: [P x3] } } }
  // P = { status: locked|ready|active|solved|gaveUp, guesses: [{ name, rank, tags }],
  //       hints: n, startedAt: ms|null, finishedAt: ms|null, points: n }
  // Mutating functions take an optional `opts.secret` (see dailyAnswers).

  function clone(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function newPuzzle(i) {
    return { status: i === 0 ? "ready" : "locked", guesses: [], hints: 0, startedAt: null, finishedAt: null, points: 0 };
  }

  function newDayState(day) {
    const modes = {};
    for (const m of MODES) modes[m] = { puzzles: Array.from({ length: PUZZLES_PER_DAY }, (_, i) => newPuzzle(i)) };
    return { day, modes };
  }

  function locate(state, mode, idx) {
    if (!MODES.includes(mode)) return { error: "bad_mode" };
    if (!Number.isInteger(idx) || idx < 0 || idx >= PUZZLES_PER_DAY) return { error: "bad_index" };
    const puzzle = state && state.modes && state.modes[mode] && state.modes[mode].puzzles[idx];
    if (!puzzle) return { error: "bad_state" };
    return { puzzle };
  }

  function fail(state, error) {
    return { ok: false, error, state };
  }

  function isFinished(p) {
    return p.status === "solved" || p.status === "gaveUp";
  }

  function finish(next, mode, idx, status, now) {
    const p = next.modes[mode].puzzles[idx];
    p.status = status;
    p.finishedAt = now;
    p.points = scorePuzzle({
      mode,
      guesses: p.guesses.length,
      hints: p.hints,
      seconds: (now - p.startedAt) / 1000,
      solved: status === "solved",
    });
    const following = next.modes[mode].puzzles[idx + 1];
    if (following && following.status === "locked") following.status = "ready";
  }

  function guestCanPlay(idx) {
    return Number.isInteger(idx) && idx >= 0 && idx < GUEST_PUZZLES_PER_MODE;
  }

  // opts.guest = true applies the guest allowance; the server never sets it.
  function startPuzzle(state, mode, idx, now, opts) {
    const loc = locate(state, mode, idx);
    if (loc.error) return fail(state, loc.error);
    if (opts && opts.guest && !guestCanPlay(idx)) return fail(state, "sign_in_required");
    if (loc.puzzle.status === "locked") return fail(state, "locked");
    if (loc.puzzle.status !== "ready") return fail(state, "not_ready");
    const next = clone(state);
    const p = next.modes[mode].puzzles[idx];
    p.status = "active";
    p.startedAt = now === undefined ? Date.now() : now;
    return { ok: true, state: next };
  }

  function applyGuess(state, mode, idx, name, now, opts) {
    const secret = opts && opts.secret;
    const loc = locate(state, mode, idx);
    if (loc.error) return fail(state, loc.error);
    if (loc.puzzle.status !== "active") return fail(state, "not_active");
    const player = typeof name === "string" ? byName(name) : null;
    if (!player || !inPool(mode, name)) return fail(state, "unknown_player");
    if (loc.puzzle.guesses.some((g) => g.name === name)) return fail(state, "already_guessed");
    const rank = ranksFor(state.day, mode, idx, secret).get(name);
    const solved = rank === 1;
    // Easy mode explains what the guess shares with the answer; Hard gives rank only.
    const tags = mode === "easy" && !solved ? reasons(player, answerFor(state.day, mode, idx, secret)) : [];
    const next = clone(state);
    const p = next.modes[mode].puzzles[idx];
    p.guesses.push({ name, rank, tags });
    if (solved) finish(next, mode, idx, "solved", now === undefined ? Date.now() : now);
    return { ok: true, state: next, rank, solved };
  }

  function useHint(state, mode, idx, now, opts) {
    const secret = opts && opts.secret;
    const loc = locate(state, mode, idx);
    if (loc.error) return fail(state, loc.error);
    if (loc.puzzle.status !== "active") return fail(state, "not_active");
    if (loc.puzzle.hints >= HINTS_PER_PUZZLE) return fail(state, "no_hints_left");
    const next = clone(state);
    const p = next.modes[mode].puzzles[idx];
    p.hints += 1;
    const hint = hintFor(answerFor(state.day, mode, idx, secret), p.hints, mode, p);
    void now;
    return { ok: true, state: next, hint };
  }

  function giveUp(state, mode, idx, now) {
    const loc = locate(state, mode, idx);
    if (loc.error) return fail(state, loc.error);
    if (loc.puzzle.status !== "active") return fail(state, "not_active");
    const next = clone(state);
    finish(next, mode, idx, "gaveUp", now === undefined ? Date.now() : now);
    return { ok: true, state: next };
  }

  function revealedHints(state, mode, idx, opts) {
    const loc = locate(state, mode, idx);
    if (loc.error) return [];
    const answer = answerFor(state.day, mode, idx, opts && opts.secret);
    const out = [];
    for (let n = 1; n <= loc.puzzle.hints; n++) out.push(hintFor(answer, n, mode, loc.puzzle));
    return out;
  }

  function modeDone(state, mode) {
    return state.modes[mode].puzzles.every(isFinished);
  }

  function dayPoints(state) {
    const out = { total: 0 };
    for (const m of MODES) {
      out[m] = state.modes[m].puzzles.reduce((s, p) => s + (p.points || 0), 0);
      out.total += out[m];
    }
    return out;
  }

  function elapsedMs(p, now) {
    if (!p || !p.startedAt) return 0;
    const end = p.finishedAt != null ? p.finishedAt : (now === undefined ? Date.now() : now);
    return Math.max(0, end - p.startedAt);
  }

  function totalElapsedMs(state, mode, now) {
    if (!state || !state.modes || !state.modes[mode]) return 0;
    const ps = state.modes[mode].puzzles || [];
    return ps.reduce((s, p) => s + elapsedMs(p, now), 0);
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? h + ":" + pad(m) + ":" + pad(sec) : pad(m) + ":" + pad(sec);
  }

  // ---------- Avatars & Achievements ----------

  // Profile avatars: every one is a piece of cricket kit, drawn as an SVG
  // symbol in index.html. `icon` is the symbol reference.
  const AVATARS = [
    { id: "batter", name: "Master Blaster", role: "Batter", icon: "#i-bat", bg: "linear-gradient(135deg, #15803d, #22c55e)", color: "#22c55e" },
    { id: "bowler", name: "Speed Merchant", role: "Pacer", icon: "#i-bolt", bg: "linear-gradient(135deg, #b91c1c, #ef4444)", color: "#ef4444" },
    { id: "spinner", name: "Spin Wizard", role: "Spinner", icon: "#i-ball", bg: "linear-gradient(135deg, #0369a1, #38bdf8)", color: "#38bdf8" },
    { id: "keeper", name: "Safe Hands", role: "Wicketkeeper", icon: "#i-shield", bg: "linear-gradient(135deg, #b45309, #f59e0b)", color: "#f59e0b" },
    { id: "captain", name: "The Skipper", role: "Captain", icon: "#i-crown", bg: "linear-gradient(135deg, #7e22ce, #a855f7)", color: "#a855f7" },
    { id: "allrounder", name: "Powerhouse", role: "All-Rounder", icon: "#i-medal", bg: "linear-gradient(135deg, #0f766e, #14b8a6)", color: "#14b8a6" },
    { id: "legend", name: "Hall of Fame", role: "Legend", icon: "#i-trophy", bg: "linear-gradient(135deg, #ca8a04, #facc15)", color: "#facc15" },
    { id: "stumps", name: "Timber!", role: "Stumps", icon: "#i-stumps", bg: "linear-gradient(135deg, #ea580c, #fb923c)", color: "#fb923c" },
    { id: "pads", name: "Front Foot", role: "Pads", icon: "#i-pads", bg: "linear-gradient(135deg, #475569, #94a3b8)", color: "#94a3b8" },
  ];

  // Older accounts may still store the retired mascots.
  const AVATAR_ALIASES = { lion: "captain", eagle: "allrounder" };

  function normalizeAvatarId(id) {
    const v = typeof id === "string" ? id : "";
    if (AVATARS.some((a) => a.id === v)) return v;
    return AVATAR_ALIASES[v] || "batter";
  }

  const ACHIEVEMENTS = [
    {
      id: "first_ball",
      title: "First Ball",
      desc: "Solve your very first Cricketle puzzle.",
      tier: "bronze",
      icon: "ball",
      check: function (s) {
        const c = s.solved != null ? s.solved : (s.solvedPuzzles || 0);
        return { unlocked: c >= 1, progress: { current: Math.min(1, c), max: 1, pct: c >= 1 ? 100 : 0 } };
      },
    },
    {
      id: "quick_single",
      title: "Quick Single",
      desc: "Solve a puzzle in under 45 seconds.",
      tier: "silver",
      icon: "bolt",
      check: function (s, h) {
        const hit = h.some(function (p) {
          return p.status === "solved" && p.started_at && p.finished_at && (p.finished_at - p.started_at) <= 45000;
        });
        return { unlocked: hit, progress: { current: hit ? 1 : 0, max: 1, pct: hit ? 100 : 0 } };
      },
    },
    {
      id: "lightning_strike",
      title: "Lightning Strike",
      desc: "Solve a puzzle in under 20 seconds.",
      tier: "gold",
      icon: "bolt",
      check: function (s, h) {
        const hit = h.some(function (p) {
          return p.status === "solved" && p.started_at && p.finished_at && (p.finished_at - p.started_at) <= 20000;
        });
        return { unlocked: hit, progress: { current: hit ? 1 : 0, max: 1, pct: hit ? 100 : 0 } };
      },
    },
    {
      id: "clean_sheet",
      title: "Clean Sheet",
      desc: "Solve a puzzle without using any hints.",
      tier: "silver",
      icon: "shield",
      check: function (s, h) {
        const hit = h.some(function (p) {
          return p.status === "solved" && (p.hints === 0 || p.hints == null);
        });
        return { unlocked: hit, progress: { current: hit ? 1 : 0, max: 1, pct: hit ? 100 : 0 } };
      },
    },
    {
      id: "sharp_shooter",
      title: "Sharp Shooter",
      desc: "Solve a puzzle with 3 or fewer guesses.",
      tier: "silver",
      icon: "stumps",
      check: function (s, h) {
        const hit = h.some(function (p) {
          if (p.status !== "solved") return false;
          let count = 0;
          if (Array.isArray(p.guesses)) count = p.guesses.length;
          else if (typeof p.guesses === "string") {
            try { count = JSON.parse(p.guesses).length; } catch (_) { count = 0; }
          }
          return count > 0 && count <= 3;
        });
        return { unlocked: hit, progress: { current: hit ? 1 : 0, max: 1, pct: hit ? 100 : 0 } };
      },
    },
    {
      id: "golden_arm",
      title: "Golden Arm",
      desc: "Solve a puzzle on your very first guess!",
      tier: "gold",
      icon: "crown",
      check: function (s, h) {
        const hit = h.some(function (p) {
          if (p.status !== "solved") return false;
          let count = 0;
          if (Array.isArray(p.guesses)) count = p.guesses.length;
          else if (typeof p.guesses === "string") {
            try { count = JSON.parse(p.guesses).length; } catch (_) { count = 0; }
          }
          return count === 1;
        });
        return { unlocked: hit, progress: { current: hit ? 1 : 0, max: 1, pct: hit ? 100 : 0 } };
      },
    },
    {
      id: "century",
      title: "Century",
      desc: "Score 100 or more points on a single puzzle.",
      tier: "gold",
      icon: "trophy",
      check: function (s, h) {
        const hit = h.some(function (p) {
          return p.status === "solved" && (p.points || 0) >= 100;
        });
        return { unlocked: hit, progress: { current: hit ? 1 : 0, max: 1, pct: hit ? 100 : 0 } };
      },
    },
    {
      id: "hat_trick",
      title: "Hat-Trick",
      desc: "Solve all 3 puzzles of a mode in a single day.",
      tier: "silver",
      icon: "stumps",
      check: function (s, h) {
        const byDay = {};
        for (let i = 0; i < h.length; i++) {
          const p = h[i];
          if (p.status === "solved") {
            const k = (p.day || "") + ":" + (p.mode || "");
            byDay[k] = (byDay[k] || 0) + 1;
          }
        }
        let hit = false;
        for (const k in byDay) {
          if (byDay[k] >= 3) { hit = true; break; }
        }
        return { unlocked: hit, progress: { current: hit ? 1 : 0, max: 1, pct: hit ? 100 : 0 } };
      },
    },
    {
      id: "on_strike",
      title: "On Strike",
      desc: "Achieve a 3-day playing streak.",
      tier: "bronze",
      icon: "flame",
      check: function (s) {
        const best = Math.max(s.currentStreak || 0, s.bestStreak || 0);
        return { unlocked: best >= 3, progress: { current: Math.min(3, best), max: 3, pct: Math.min(100, Math.round((best / 3) * 100)) } };
      },
    },
    {
      id: "weekly_maestro",
      title: "Weekly Maestro",
      desc: "Maintain a 7-day playing streak.",
      tier: "silver",
      icon: "flame",
      check: function (s) {
        const best = Math.max(s.currentStreak || 0, s.bestStreak || 0);
        return { unlocked: best >= 7, progress: { current: Math.min(7, best), max: 7, pct: Math.min(100, Math.round((best / 7) * 100)) } };
      },
    },
    {
      id: "fortnight_hero",
      title: "Fortnight Hero",
      desc: "Maintain a 14-day playing streak.",
      tier: "gold",
      icon: "flame",
      check: function (s) {
        const best = Math.max(s.currentStreak || 0, s.bestStreak || 0);
        return { unlocked: best >= 14, progress: { current: Math.min(14, best), max: 14, pct: Math.min(100, Math.round((best / 14) * 100)) } };
      },
    },
    {
      id: "ten_solves",
      title: "10 Not Out",
      desc: "Solve 10 total Cricketle puzzles.",
      tier: "bronze",
      icon: "bat",
      check: function (s) {
        const c = s.solved != null ? s.solved : (s.solvedPuzzles || 0);
        return { unlocked: c >= 10, progress: { current: Math.min(10, c), max: 10, pct: Math.min(100, Math.round((c / 10) * 100)) } };
      },
    },
    {
      id: "fifty_solves",
      title: "Half-Century Club",
      desc: "Solve 50 total Cricketle puzzles.",
      tier: "silver",
      icon: "trophy",
      check: function (s) {
        const c = s.solved != null ? s.solved : (s.solvedPuzzles || 0);
        return { unlocked: c >= 50, progress: { current: Math.min(50, c), max: 50, pct: Math.min(100, Math.round((c / 50) * 100)) } };
      },
    },
    {
      id: "domestic_star",
      title: "Domestic Star",
      desc: "Accumulate 1,000 career points.",
      tier: "silver",
      icon: "star",
      check: function (s) {
        const pts = s.allTimePoints || 0;
        return { unlocked: pts >= 1000, progress: { current: Math.min(1000, pts), max: 1000, pct: Math.min(100, Math.round((pts / 1000) * 100)) } };
      },
    },
    {
      id: "international_cap",
      title: "International Cap",
      desc: "Accumulate 2,500 career points.",
      tier: "gold",
      icon: "star",
      check: function (s) {
        const pts = s.allTimePoints || 0;
        return { unlocked: pts >= 2500, progress: { current: Math.min(2500, pts), max: 2500, pct: Math.min(100, Math.round((pts / 2500) * 100)) } };
      },
    },
    {
      id: "world_class",
      title: "World Class Legend",
      desc: "Accumulate 6,000 career points.",
      tier: "diamond",
      icon: "crown",
      check: function (s) {
        const pts = s.allTimePoints || 0;
        return { unlocked: pts >= 6000, progress: { current: Math.min(6000, pts), max: 6000, pct: Math.min(100, Math.round((pts / 6000) * 100)) } };
      },
    },
  ];

  function evaluateAchievements(stats, history) {
    const s = stats || {};
    const h = Array.isArray(history) ? history : [];
    return ACHIEVEMENTS.map(function (a) {
      const res = a.check(s, h);
      return {
        id: a.id,
        title: a.title,
        desc: a.desc,
        tier: a.tier,
        icon: a.icon,
        unlocked: res.unlocked,
        progress: res.progress,
      };
    });
  }

  function streakDetails(daysDesc, todayKey) {
    const set = new Set(daysDesc || []);
    let current = 0;
    let d = set.has(todayKey) ? todayKey : shiftDay(todayKey, -1);
    while (set.has(d)) {
      current++;
      d = shiftDay(d, -1);
    }
    const asc = [...set].sort();
    let best = 0;
    let run = 0;
    let prev = null;
    for (let i = 0; i < asc.length; i++) {
      const day = asc[i];
      run = prev && shiftDay(prev, 1) === day ? run + 1 : 1;
      if (run > best) best = run;
      prev = day;
    }
    const week = [];
    const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 6; i >= 0; i--) {
      const dayStr = shiftDay(todayKey, -i);
      const parts = dayStr.split("-").map(Number);
      const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      week.push({
        day: dayStr,
        label: DAY_LABELS[dt.getUTCDay()],
        active: set.has(dayStr),
        isToday: dayStr === todayKey,
      });
    }
    return {
      current: current,
      best: best,
      activeToday: set.has(todayKey),
      week: week,
    };
  }

  return {
    PUZZLES_PER_DAY, GUEST_PUZZLES_PER_MODE, HINTS_PER_PUZZLE, HINT_COST, MODES, IST_OFFSET_MS, DAY_MS,
    guestCanPlay,
    EASY_NAMES, RANK_LADDER, HINT_LABELS, AVATARS, ACHIEVEMENTS, normalizeAvatarId,
    data: { COUNTRIES: data.COUNTRIES, IPL_TEAMS: data.IPL_TEAMS, BOWL_STYLES: data.BOWL_STYLES },
    poolFor, inPool, byName, describe,
    similarity, reasons, buildRanks, tiers, tier,
    todayKey, msUntilReset, shiftDay, istHour, sceneForHour, hashString, mulberry32,
    dailyAnswers, answerFor, ranksFor,
    hintFor, getHintsForPuzzle, isNationIdentified, isRoleIdentified, scorePuzzle, rankTitle,
    newDayState, startPuzzle, applyGuess, useHint, giveUp, revealedHints,
    modeDone, dayPoints, elapsedMs, totalElapsedMs, formatTime, isFinished,
    evaluateAchievements, streakDetails,
  };
});

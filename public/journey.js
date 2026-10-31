(function () {
  "use strict";

  const MAX_ATTEMPTS = 6;

  const TEAM_CONFIG = {
    CSK: {
      name: "Chennai Super Kings",
      bg: "linear-gradient(135deg, #fdb913, #e69d00)",
      border: "#fdb913",
      textColor: "#003b6d",
      icon: `<svg viewBox="0 0 24 24"><path d="M12 2l2.5 5 5.5.5-4 4 1 5.5-5-2.5-5 2.5 1-5.5-4-4 5.5-.5z" fill="#003b6d"/></svg>`
    },
    MI: {
      name: "Mumbai Indians",
      bg: "linear-gradient(135deg, #004ba0, #002e6b)",
      border: "#d4af37",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#d4af37" stroke-width="2.2"/><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M6.3 17.7 17.7 6.3" stroke="#d4af37" stroke-width="1.6"/></svg>`
    },
    KKR: {
      name: "Kolkata Knight Riders",
      bg: "linear-gradient(135deg, #3a225d, #25123d)",
      border: "#f7d046",
      textColor: "#f7d046",
      icon: `<svg viewBox="0 0 24 24"><path d="M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-4z" fill="#f7d046"/><path d="M12 5v12M8 9h8" stroke="#3a225d" stroke-width="2"/></svg>`
    },
    RCB: {
      name: "Royal Challengers",
      bg: "linear-gradient(135deg, #ec1c24, #990000)",
      border: "#d4af37",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#d4af37"/><path d="M12 5v14M8 8l8 8M16 8l-8 8" stroke="#ec1c24" stroke-width="2.2"/></svg>`
    },
    DC: {
      name: "Delhi Capitals",
      bg: "linear-gradient(135deg, #0076bf, #004e80)",
      border: "#e21a22",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" fill="#e21a22"/><circle cx="12" cy="12" r="4" fill="#ffffff"/></svg>`
    },
    DD: {
      name: "Delhi Daredevils",
      bg: "linear-gradient(135deg, #004c87, #00294d)",
      border: "#dd1d21",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><path d="M4 12l8-9 8 9-8 9-8-9z" fill="#dd1d21"/><circle cx="12" cy="12" r="3" fill="#ffffff"/></svg>`
    },
    SRH: {
      name: "Sunrisers Hyderabad",
      bg: "linear-gradient(135deg, #f26522, #c8480d)",
      border: "#111111",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="6" fill="#111111"/><path d="M12 3v4M6 6l2.8 2.8M18 6l-2.8 2.8M3 14h4M17 14h4" stroke="#ffffff" stroke-width="2"/></svg>`
    },
    RR: {
      name: "Rajasthan Royals",
      bg: "linear-gradient(135deg, #ea1a85, #b51263)",
      border: "#254aa5",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><path d="M5 16l2-8 5 4 5-4 2 8H5z" fill="#ffffff"/><circle cx="12" cy="7" r="2.5" fill="#254aa5"/></svg>`
    },
    PBKS: {
      name: "Punjab Kings",
      bg: "linear-gradient(135deg, #ed1b24, #b8141b)",
      border: "#edd887",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><path d="M12 3l7 3.5v7c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5v-7L12 3z" fill="#edd887"/><circle cx="12" cy="12" r="3.5" fill="#ed1b24"/></svg>`
    },
    KXIP: {
      name: "Kings XI Punjab",
      bg: "linear-gradient(135deg, #d71920, #961217)",
      border: "#edd887",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><path d="M12 3l6 4v6c0 4-2.5 7-6 8.5-3.5-1.5-6-4.5-6-8.5V7l6-4z" fill="#edd887"/></svg>`
    },
    GT: {
      name: "Gujarat Titans",
      bg: "linear-gradient(135deg, #1c2438, #0e121d)",
      border: "#b6985a",
      textColor: "#b6985a",
      icon: `<svg viewBox="0 0 24 24"><path d="M12 2l8 14H4l8-14z" fill="#b6985a"/><polygon points="12,7 15,14 9,14" fill="#1c2438"/></svg>`
    },
    LSG: {
      name: "Lucknow Super Giants",
      bg: "linear-gradient(135deg, #0057b7, #003673)",
      border: "#ff5500",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><path d="M12 3c-4 4-7 8-7 12 0 3.3 2.7 6 6 6s6-2.7 6-6c0-4-3-8-5-12z" fill="#ff5500"/></svg>`
    },
    DCH: {
      name: "Deccan Chargers",
      bg: "linear-gradient(135deg, #2b547e, #1a334d)",
      border: "#cbd5e1",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#cbd5e1"/><circle cx="12" cy="12" r="5" fill="#2b547e"/></svg>`
    },
    GL: {
      name: "Gujarat Lions",
      bg: "linear-gradient(135deg, #e35205, #a33800)",
      border: "#2d583e",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#ffffff"/><circle cx="12" cy="12" r="4" fill="#e35205"/></svg>`
    },
    RPS: {
      name: "Rising Pune Supergiant",
      bg: "linear-gradient(135deg, #7b113a, #4a0620)",
      border: "#fdb913",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><path d="M12 4l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" fill="#fdb913"/></svg>`
    },
    PWI: {
      name: "Pune Warriors",
      bg: "linear-gradient(135deg, #008080, #004d4d)",
      border: "#c0c0c0",
      textColor: "#ffffff",
      icon: `<svg viewBox="0 0 24 24"><path d="M12 3v18M6 8l6-5 6 5" stroke="#ffffff" stroke-width="2.2" fill="none"/></svg>`
    },
    KTK: {
      name: "Kochi Tuskers",
      bg: "linear-gradient(135deg, #5c2d91, #361759)",
      border: "#f7931e",
      textColor: "#f7931e",
      icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#f7931e"/><circle cx="12" cy="12" r="4" fill="#5c2d91"/></svg>`
    }
  };

  let allPlayers = [];
  let currentTarget = null;
  let currentAttempts = [];
  let currentMode = "easy";
  let isGameOver = false;
  let currentUser = null;
  const gateModal = document.getElementById("member-gate-modal");

  const timelineTrail = document.getElementById("timeline-trail");
  const timelineSpan = document.getElementById("timeline-span");
  const metaCountryRole = document.getElementById("meta-country-role");
  const metaMatches = document.getElementById("meta-matches");
  const nameLettersWrap = document.getElementById("name-letters-wrap");
  const clueHintText = document.getElementById("clue-hint-text");
  const hintLockedBanner = document.getElementById("hint-locked-banner");
  const hintLockDesc = document.getElementById("hint-lock-desc");
  const input = document.getElementById("guess-input");
  const guessBtn = document.getElementById("btn-guess");
  const skipBtn = document.getElementById("btn-skip");
  const suggestions = document.getElementById("suggestions");
  const historyList = document.getElementById("guess-history");
  const track = document.getElementById("attempts-track");
  const resultCard = document.getElementById("result-card");
  const resultStatus = document.getElementById("result-status");
  const resultName = document.getElementById("result-name");
  const resultStats = document.getElementById("result-stats");
  const resultFunfact = document.getElementById("result-funfact");
  const guessControls = document.getElementById("guess-controls");

  let highlighted = -1;
  let currentMatches = [];
  let blurTimer = null;

  function getTodayKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const cycleCache = new Map();
  function getPermutation(N, cycle, salt) {
    const key = `${N}:${cycle}:${salt}`;
    if (cycleCache.has(key)) return cycleCache.get(key);

    const arr = Array.from({ length: N }, (_, i) => i);
    const rng = mulberry32(hashString(salt + "_cycle_" + cycle));
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    if (cycle > 0) {
      const prev = getPermutation(N, cycle - 1, salt);
      const buffer = Math.min(8, Math.floor(N / 3));
      const recent = new Set(prev.slice(N - buffer));
      let swapIdx = N - 1;
      for (let i = 0; i < buffer; i++) {
        if (recent.has(arr[i])) {
          while (swapIdx >= buffer && recent.has(arr[swapIdx])) {
            swapIdx--;
          }
          if (swapIdx >= buffer) {
            [arr[i], arr[swapIdx]] = [arr[swapIdx], arr[i]];
            swapIdx--;
          }
        }
      }
    }

    if (cycleCache.size > 128) cycleCache.clear();
    cycleCache.set(key, arr);
    return arr;
  }

  function getSpacedDailyIndex(todayKey, poolLength, modeSalt) {
    if (poolLength <= 1) return 0;
    const [y, m, d] = todayKey.split("-").map(Number);
    const epoch2026 = Date.UTC(2026, 0, 1);
    const diffDays = Math.floor((Date.UTC(y, m - 1, d) - epoch2026) / 86400000);
    const dayNumber = Math.max(0, diffDays);
    const cycle = Math.floor(dayNumber / poolLength);
    const pos = dayNumber % poolLength;
    const perm = getPermutation(poolLength, cycle, modeSalt);
    return perm[pos];
  }

  // Calculate which letter indices to reveal (Hint 1 unlocks after 3 failed attempts)
  function getRevealedLetters(name, hintStep, seed) {
    const letterIndices = [];
    const wordStartIndices = [];
    let isWordStart = true;

    for (let i = 0; i < name.length; i++) {
      const ch = name[i];
      if (/[a-zA-Z]/.test(ch)) {
        letterIndices.push(i);
        if (isWordStart) {
          wordStartIndices.push(i);
          isWordStart = false;
        }
      } else {
        isWordStart = true;
      }
    }

    const total = letterIndices.length;
    if (hintStep <= 0) {
      return new Set();
    }
    if (hintStep >= 4 || isGameOver) {
      return new Set(letterIndices);
    }

    // hintStep 1: Initials (e.g. A, D, V in AB de Villiers)
    // hintStep 2: 45% of letters
    // hintStep 3: 80% of letters (almost all)
    const fractions = [0, 0.25, 0.50, 0.80];
    const targetCount = Math.min(total - 1, Math.max(wordStartIndices.length, Math.round(total * fractions[hintStep])));

    // Priority 1: Initials
    const priority = [...wordStartIndices];

    // Priority 2: Other letters deterministically shuffled
    const rng = mulberry32(seed);
    const remaining = letterIndices.filter((idx) => !priority.includes(idx));
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }

    const revealOrder = [...priority, ...remaining];
    return new Set(revealOrder.slice(0, targetCount));
  }

  // Render the interactive letter tiles (Only visible as Hint 1 after 3 failed attempts)
  function renderLetters() {
    if (!nameLettersWrap || !currentTarget) return;

    const attemptsCount = currentAttempts.length;
    const isHintUnlocked = attemptsCount >= 3 || isGameOver;

    if (!isHintUnlocked) {
      if (hintLockedBanner) {
        hintLockedBanner.style.display = "flex";
        const remaining = 3 - attemptsCount;
        if (hintLockDesc) {
          hintLockDesc.textContent = `Unlocks after 3 failed attempts (${remaining} ${remaining === 1 ? 'try' : 'tries'} remaining)`;
        }
      }
      nameLettersWrap.style.display = "none";
      if (clueHintText) {
        clueHintText.textContent = "Guess the player from their IPL teams & years above or skip to unlock letter hints!";
      }
      return;
    }

    if (hintLockedBanner) {
      hintLockedBanner.style.display = "none";
    }
    nameLettersWrap.style.display = "flex";

    nameLettersWrap.innerHTML = "";
    const name = currentTarget.name;
    const today = getTodayKey();
    const seed = hashString(today + "_" + currentTarget.id + "_letters");
    // hintStep: 1 at attempt 3, 2 at attempt 4, 3 at attempt 5, 4 on win
    const hintStep = isGameOver ? 4 : (attemptsCount - 2);
    const revealedSet = getRevealedLetters(name, hintStep, seed);

    const words = name.split(" ");
    let charOffset = 0;

    words.forEach((word) => {
      const wordContainer = document.createElement("div");
      wordContainer.className = "name-word";

      for (let i = 0; i < word.length; i++) {
        const fullIndex = charOffset + i;
        const ch = word[i];
        const tile = document.createElement("div");
        tile.className = "letter-tile";

        if (/[a-zA-Z]/.test(ch)) {
          if (revealedSet.has(fullIndex) || isGameOver) {
            tile.textContent = ch.toUpperCase();
            if (isGameOver) {
              tile.classList.add("solved");
            } else {
              tile.classList.add("revealed");
            }
          } else {
            tile.textContent = "_";
          }
        } else {
          tile.textContent = ch;
        }
        wordContainer.appendChild(tile);
      }

      nameLettersWrap.appendChild(wordContainer);
      charOffset += word.length + 1;
    });

    if (clueHintText) {
      if (isGameOver) {
        clueHintText.textContent = "Full name revealed!";
      } else {
        clueHintText.textContent = `💡 Hint 1 Unlocked: ${revealedSet.size} letters revealed!`;
      }
    }
  }

  // Render the franchise journey timeline with real official IPL team logos
  function renderTimeline() {
    if (!timelineTrail || !currentTarget) return;

    timelineTrail.innerHTML = "";
    const journey = currentTarget.journey || [];

    if (timelineSpan && journey.length > 0) {
      const firstYears = journey[0].years.split("–")[0].trim();
      const lastYears = journey[journey.length - 1].years.split("–").pop().trim();
      timelineSpan.textContent = `${firstYears} – ${lastYears}`;
    }

    journey.forEach((item, index) => {
      const code = item.team.toLowerCase();
      const logoSrc = `logos/ipl/${code}.png`;
      const fallbackConf = TEAM_CONFIG[item.team] || {
        name: item.teamName || item.team,
        border: "#0284c7"
      };

      const stepCard = document.createElement("div");
      stepCard.className = "trail-step";
      stepCard.innerHTML = `
        <div class="team-badge-icon">
          <img src="${logoSrc}" alt="${escapeHtml(item.teamName || item.team)} logo" loading="lazy" />
        </div>
        <div class="team-abbrev" style="color:${fallbackConf.border};">${escapeHtml(item.team)}</div>
        <div class="team-fullname" title="${escapeHtml(item.teamName || fallbackConf.name)}">${escapeHtml(item.teamName || fallbackConf.name)}</div>
        <div class="team-years">${escapeHtml(item.years)}</div>
      `;
      timelineTrail.appendChild(stepCard);

      if (index < journey.length - 1) {
        const arrow = document.createElement("div");
        arrow.className = "trail-arrow";
        arrow.innerHTML = "➔";
        timelineTrail.appendChild(arrow);
      }
    });

    if (metaCountryRole) {
      metaCountryRole.textContent = `${currentTarget.country} · ${currentTarget.role}`;
    }
    if (metaMatches) {
      metaMatches.textContent = `🏆 ${currentTarget.iplMatches} IPL Matches`;
    }
  }

  function updateTrack() {
    if (!track) return;
    const dots = track.querySelectorAll(".attempt-dot");
    dots.forEach((dot, idx) => {
      dot.className = "attempt-dot";
      if (idx < currentAttempts.length) {
        const a = currentAttempts[idx];
        if (a.isCorrect) dot.classList.add("used-correct");
        else dot.classList.add("used-wrong");
      } else if (idx === currentAttempts.length && !isGameOver) {
        dot.classList.add("current");
      }
    });
  }

  function renderHistory() {
    if (!historyList) return;
    historyList.innerHTML = "";
    currentAttempts.forEach((a) => {
      const el = document.createElement("div");
      el.className = `guess-item ${a.isCorrect ? "correct" : a.skipped ? "skipped" : ""}`;
      el.innerHTML = `
        <span>${a.skipped ? "<em>Skipped (Letter Revealed)</em>" : escapeHtml(a.name)}</span>
        <span style="font-weight:700;">${a.isCorrect ? "✅ Correct" : a.skipped ? "⏭️ Skipped" : "❌ Incorrect"}</span>
      `;
      historyList.appendChild(el);
    });
  }

  async function loadPuzzle() {
    try {
      const res = await fetch("datasets/ipl-journey.json");
      const list = await res.json();
      allPlayers = list;

      const pool = list.filter((p) => p.difficulty === currentMode);
      const activePool = pool.length ? pool : list;

      const today = getTodayKey();
      const targetIndex = getSpacedDailyIndex(today, activePool.length, "journey_" + currentMode);
      currentTarget = activePool[targetIndex];

      const saved = localStorage.getItem(`cricketle_journey_${today}_${currentMode}`);
      if (saved) {
        const data = JSON.parse(saved);
        currentAttempts = data.attempts || [];
        isGameOver = data.isGameOver || false;
      } else {
        currentAttempts = [];
        isGameOver = false;
      }

      renderTimeline();
      renderLetters();
      renderHistory();
      updateTrack();

      if (isGameOver) {
        finishGame(currentAttempts.some((a) => a.isCorrect));
      }
    } catch (err) {
      console.error("Failed to load IPL Journey puzzle:", err);
    }
  }

  const EXTRA_LEGENDS = [
    { name: "Brian Lara", country: "West Indies", role: "Batter" },
    { name: "Shane Warne", country: "Australia", role: "Bowler" },
    { name: "Sourav Ganguly", country: "India", role: "Batter" },
    { name: "VVS Laxman", country: "India", role: "Batter" },
    { name: "Robin Uthappa", country: "India", role: "Batter" },
    { name: "Jason Roy", country: "England", role: "Batter" },
    { name: "Liam Plunkett", country: "England", role: "Bowler" },
    { name: "Ambati Rayudu", country: "India", role: "Batter" },
    { name: "Mohammad Azharuddin", country: "India", role: "Batter" },
    { name: "Ajay Jadeja", country: "India", role: "Batter" },
    { name: "Hrishikesh Kanitkar", country: "India", role: "All-rounder" },
    { name: "Vivian Richards", country: "West Indies", role: "Batter" },
    { name: "Kapil Dev", country: "India", role: "All-rounder" },
    { name: "Imran Khan", country: "Pakistan", role: "All-rounder" },
    { name: "Wasim Akram", country: "Pakistan", role: "Bowler" },
    { name: "Waqar Younis", country: "Pakistan", role: "Bowler" },
    { name: "Curtly Ambrose", country: "West Indies", role: "Bowler" },
    { name: "Courtney Walsh", country: "West Indies", role: "Bowler" },
    { name: "Jacques Kallis", country: "South Africa", role: "All-rounder" },
    { name: "Glenn McGrath", country: "Australia", role: "Bowler" },
    { name: "Allan Border", country: "Australia", role: "Batter" },
    { name: "Sunil Gavaskar", country: "India", role: "Batter" },
    { name: "Ian Botham", country: "England", role: "All-rounder" },
    { name: "Mohammad Kaif", country: "India", role: "Batter" },
    { name: "Lance Klusener", country: "South Africa", role: "All-rounder" },
    { name: "Mohinder Amarnath", country: "India", role: "All-rounder" },
    { name: "Kris Srikkanth", country: "India", role: "Batter" },
    { name: "Madan Lal", country: "India", role: "Bowler" },
    { name: "Syed Kirmani", country: "India", role: "Wicketkeeper" },
    { name: "Balwinder Sandhu", country: "India", role: "Bowler" },
    { name: "Gary Kirsten", country: "South Africa", role: "Batter" },
    { name: "Herschelle Gibbs", country: "South Africa", role: "Batter" },
    { name: "Jonty Rhodes", country: "South Africa", role: "Batter" },
    { name: "Shaun Pollock", country: "South Africa", role: "All-rounder" },
    { name: "Allan Donald", country: "South Africa", role: "Bowler" }
  ];

  function getSearchPool() {
    const map = new Map();

    EXTRA_LEGENDS.forEach((p) => {
      map.set(p.name.toLowerCase(), p);
    });

    if (Array.isArray(allPlayers)) {
      allPlayers.forEach((p) => {
        map.set(p.name.toLowerCase(), { name: p.name, country: p.country, role: p.role });
      });
    }

    const list = (typeof window !== "undefined" && window.PLAYERS) || (typeof PLAYERS !== "undefined" ? PLAYERS : []);
    if (Array.isArray(list)) {
      list.forEach((p) => {
        const key = p.name.toLowerCase();
        if (!map.has(key)) {
          const cName = (window.COUNTRIES && window.COUNTRIES[p.country]) || p.country;
          map.set(key, { name: p.name, country: cName, role: p.role });
        }
      });
    }

    return Array.from(map.values());
  }

  function makeGuess(name, skipped = false) {
    if (!currentUser) {
      if (gateModal) gateModal.hidden = false;
      return;
    }
    if (isGameOver || !currentTarget) return;

    let clean = name.trim();
    if (!clean && !skipped) return;

    if (!skipped) {
      const guessLower = clean.toLowerCase();
      if (currentTarget.name.toLowerCase() === guessLower) {
        clean = currentTarget.name;
      } else if (
        currentTarget.name.toLowerCase().endsWith(" " + guessLower) ||
        currentTarget.name.toLowerCase().startsWith(guessLower + " ") ||
        currentTarget.name.toLowerCase().split(/\s+/).includes(guessLower)
      ) {
        clean = currentTarget.name;
      } else {
        const pool = getSearchPool();
        const found = pool.find(
          (p) =>
            p.name.toLowerCase() === guessLower ||
            p.name.toLowerCase().endsWith(" " + guessLower) ||
            p.name.toLowerCase().split(/\s+/).includes(guessLower)
        );
        if (found) clean = found.name;
      }
    }

    const isCorrect = !skipped && clean.toLowerCase() === currentTarget.name.toLowerCase();
    currentAttempts.push({ name: clean || "Skip", skipped, isCorrect });

    const today = getTodayKey();
    const won = isCorrect;
    const lost = !won && currentAttempts.length >= MAX_ATTEMPTS;

    if (won || lost) {
      isGameOver = true;
      finishGame(won);
    } else {
      renderLetters();
    }

    localStorage.setItem(
      `cricketle_journey_${today}_${currentMode}`,
      JSON.stringify({ attempts: currentAttempts, isGameOver })
    );

    renderHistory();
    updateTrack();
    if (input) input.value = "";
    hideSuggestions();
  }

  function finishGame(won) {
    renderLetters();

    if (guessControls) guessControls.style.display = "none";
    if (resultCard) {
      resultCard.style.display = "block";
      resultCard.className = `result-card ${won ? "won" : "lost"}`;
      if (resultStatus) {
        resultStatus.textContent = won ? "CHAMPION GUESS! 🏆" : "BOWLED OUT! 💔";
        resultStatus.style.color = won ? "#16a34a" : "var(--danger)";
      }
      if (resultName) {
        resultName.textContent = currentTarget.name + ` (${currentTarget.country})`;
      }
      if (resultStats) {
        resultStats.textContent = currentTarget.stats;
      }
      if (resultFunfact) {
        resultFunfact.textContent = currentTarget.funFact;
      }
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightMatch(name, q) {
    const i = name.toLowerCase().indexOf(q);
    if (i < 0) return escapeHtml(name);
    return (
      escapeHtml(name.slice(0, i)) +
      "<mark>" +
      escapeHtml(name.slice(i, i + q.length)) +
      "</mark>" +
      escapeHtml(name.slice(i + q.length))
    );
  }

  function hideSuggestions() {
    if (!suggestions) return;
    suggestions.hidden = true;
    suggestions.innerHTML = "";
    if (input) {
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
    highlighted = -1;
    currentMatches = [];
  }

  function showSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q || !suggestions || !input) {
      hideSuggestions();
      return;
    }

    const pool = getSearchPool();
    const starts = (pl) => pl.name.toLowerCase().startsWith(q);
    const hasWord = (pl) => pl.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q));

    currentMatches = pool
      .filter((pl) => pl.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = starts(a), bStarts = starts(b);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        const aWord = hasWord(a), bWord = hasWord(b);
        if (aWord !== bWord) return aWord ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);

    if (!currentMatches.length) {
      hideSuggestions();
      return;
    }

    highlighted = 0;
    suggestions.hidden = false;
    input.setAttribute("aria-expanded", "true");

    suggestions.innerHTML = currentMatches
      .map((pl, i) => {
        return `
          <li role="option" id="opt-${i}" class="${i === 0 ? "highlight" : ""}" data-name="${escapeHtml(pl.name)}">
            <span>${highlightMatch(pl.name, q)}</span>
            <span class="sub">${escapeHtml(pl.country)} · ${escapeHtml(pl.role)}</span>
          </li>
        `;
      })
      .join("");

    input.setAttribute("aria-activedescendant", "opt-0");
  }

  function moveHighlight(delta) {
    if (!currentMatches.length || !suggestions) return;
    highlighted = (highlighted + delta + currentMatches.length) % currentMatches.length;
    [...suggestions.children].forEach((li, i) => {
      li.classList.toggle("highlight", i === highlighted);
    });
    input.setAttribute("aria-activedescendant", `opt-${highlighted}`);
    suggestions.children[highlighted]?.scrollIntoView({ block: "nearest" });
  }

  function selectCurrent() {
    if (currentMatches.length > 0) {
      const idx = highlighted >= 0 && highlighted < currentMatches.length ? highlighted : 0;
      const chosen = currentMatches[idx].name;
      hideSuggestions();
      makeGuess(chosen);
    } else if (input && input.value.trim()) {
      const text = input.value.trim();
      hideSuggestions();
      makeGuess(text);
    }
  }

  function setupAutocomplete() {
    if (!input || !suggestions) return;

    input.addEventListener("input", () => {
      clearTimeout(blurTimer);
      showSuggestions(input.value);
    });

    input.addEventListener("keydown", (e) => {
      if (suggestions.hidden) {
        if (e.key === "Enter") {
          e.preventDefault();
          if (input.value.trim()) makeGuess(input.value.trim());
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveHighlight(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveHighlight(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        selectCurrent();
      } else if (e.key === "Escape") {
        hideSuggestions();
      }
    });

    suggestions.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-name]");
      if (li) {
        e.preventDefault();
        const name = li.getAttribute("data-name");
        hideSuggestions();
        makeGuess(name);
      }
    });

    input.addEventListener("blur", () => {
      blurTimer = setTimeout(hideSuggestions, 150);
    });
  }

  guessBtn?.addEventListener("click", () => {
    selectCurrent();
  });

  skipBtn?.addEventListener("click", () => {
    makeGuess("Skip", true);
  });

  document.getElementById("mode-easy")?.addEventListener("click", (e) => {
    if (currentMode === "easy") return;
    currentMode = "easy";
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    if (guessControls) guessControls.style.display = "block";
    if (resultCard) resultCard.style.display = "none";
    loadPuzzle();
  });

  document.getElementById("mode-hard")?.addEventListener("click", (e) => {
    if (currentMode === "hard") return;
    currentMode = "hard";
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    if (guessControls) guessControls.style.display = "block";
    if (resultCard) resultCard.style.display = "none";
    loadPuzzle();
  });

  async function checkAuth() {
    try {
      const res = await fetch("/api/me");
      const d = await res.json();
      if (d && d.user) {
        currentUser = d.user;
        const navProfile = document.getElementById("nav-profile-label");
        if (navProfile) navProfile.textContent = "@" + d.user.username;
        const topbarAuth = document.getElementById("topbar-auth-btn");
        if (topbarAuth) {
          topbarAuth.classList.add("signed-in");
          topbarAuth.title = `@${d.user.username} (Account)`;
          topbarAuth.setAttribute("aria-label", `Account for @${d.user.username}`);
        }
        if (gateModal) gateModal.hidden = true;
        if (input) {
          input.disabled = false;
          input.placeholder = "Type player name (e.g. Virat Kohli)...";
        }
        if (guessBtn) guessBtn.disabled = false;
        if (skipBtn) skipBtn.disabled = false;
        return true;
      }
    } catch (e) {}

    currentUser = null;
    if (gateModal) gateModal.hidden = false;
    if (input) {
      input.disabled = true;
      input.placeholder = "Member access only — Log in to play...";
    }
    if (guessBtn) guessBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;
    return false;
  }

  setupAutocomplete();
  checkAuth();
  loadPuzzle();
})();


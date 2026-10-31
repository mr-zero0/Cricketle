(function () {
  "use strict";

  const MAX_ATTEMPTS = 6;
  let allCards = [];
  let currentCard = null;
  let currentAttempts = [];
  let currentMode = "easy";
  let isGameOver = false;
  let currentUser = null;
  const gateModal = document.getElementById("member-gate-modal");

  const bodyEl = document.getElementById("scorecard-body");
  const metaCard = document.getElementById("match-meta");
  const metaTitle = document.getElementById("meta-title");
  const metaTeams = document.getElementById("meta-teams");
  const metaVenue = document.getElementById("meta-venue");
  const metaDate = document.getElementById("meta-date");
  const metaResult = document.getElementById("meta-result");
  const extrasEl = document.getElementById("scorecard-extras");
  const totalEl = document.getElementById("scorecard-total");
  const input = document.getElementById("guess-input");
  const guessBtn = document.getElementById("btn-guess");
  const suggestions = document.getElementById("suggestions");
  let highlighted = -1;
  let currentMatches = [];
  let blurTimer = null;
  const historyList = document.getElementById("guess-history");
  const track = document.getElementById("attempts-track");
  const hintBanner = document.getElementById("hint-banner");
  const hintText = document.getElementById("hint-text");
  const resultCard = document.getElementById("result-card");
  const resultStatus = document.getElementById("result-status");
  const resultName = document.getElementById("result-name");
  const resultDesc = document.getElementById("result-desc");
  const guessControls = document.getElementById("guess-controls");

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

  async function loadScorecard() {
    try {
      const res = await fetch("datasets/scorecards.json");
      allCards = await res.json();

      const pool = allCards.filter((c) => c.difficulty === currentMode);
      const activePool = pool.length ? pool : allCards;

      const today = getTodayKey();
      const seed = hashString(today + "_scorecard_" + currentMode);
      const idx = seed % activePool.length;
      currentCard = activePool[idx];

      // Restore saved progress
      const saved = localStorage.getItem(`cricketle_scorecard_${today}_${currentMode}`);
      if (saved) {
        const data = JSON.parse(saved);
        currentAttempts = data.attempts || [];
        isGameOver = data.isGameOver || false;
      } else {
        currentAttempts = [];
        isGameOver = false;
      }

      renderMatchInfo();
      renderTable();
      renderHistory();
      updateTrack();

      if (isGameOver) {
        finishGame(currentAttempts.some((a) => a.isCorrect));
      }
    } catch (err) {
      console.error("Failed to load scorecard:", err);
    }
  }

  function renderMatchInfo() {
    if (!currentCard) return;

    if (currentMode === "hard" && !isGameOver) {
      // In hard mode, completely hide the match metadata card
      if (metaCard) metaCard.style.display = "none";
    } else {
      // In easy mode or after game is over, show full details
      if (metaCard) {
        metaCard.style.display = "flex";
        metaTitle.textContent = currentCard.title;
        metaTeams.textContent = "📍 " + currentCard.teams;
        metaVenue.textContent = "🏟️ " + currentCard.venue;
        metaDate.textContent = "📅 " + currentCard.date;
        metaResult.textContent = "🏆 " + currentCard.result;
      }
    }

    if (extrasEl) extrasEl.textContent = "Extras: " + currentCard.innings.extras;
    if (totalEl) totalEl.textContent = "Total: " + currentCard.innings.total;
  }

  function renderTable() {
    if (!bodyEl || !currentCard) return;
    bodyEl.innerHTML = "";

    const batting = currentCard.innings.batting || [];
    batting.forEach((row) => {
      const tr = document.createElement("tr");
      const isTarget = row.isTarget;

      if (isTarget) {
        tr.className = "mystery-row";
        const displayName = isGameOver
          ? `<strong style="color:#60a5fa;">${currentCard.targetPlayer}</strong> <span style="font-size:11px;color:#22c55e;">(Revealed)</span>`
          : `<span class="mystery-badge">██████████</span>`;
        tr.innerHTML = `
          <td>${displayName}</td>
          <td>${row.dismissal}</td>
          <td style="text-align:right;font-weight:700;">${row.runs}</td>
          <td style="text-align:right;">${row.balls}</td>
          <td style="text-align:right;">${row.fours}</td>
          <td style="text-align:right;">${row.sixes}</td>
          <td style="text-align:right;">${row.sr.toFixed(1)}</td>
        `;
      } else {
        tr.innerHTML = `
          <td style="font-weight:500;">${row.player}</td>
          <td style="color:var(--text-muted, #94a3b8);">${row.dismissal}</td>
          <td style="text-align:right;font-weight:600;">${row.runs}</td>
          <td style="text-align:right;">${row.balls}</td>
          <td style="text-align:right;">${row.fours}</td>
          <td style="text-align:right;">${row.sixes}</td>
          <td style="text-align:right;">${row.sr.toFixed(1)}</td>
        `;
      }
      bodyEl.appendChild(tr);
    });
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

    // Show hint banner after 3 wrong attempts
    if (currentAttempts.length >= 3 && !isGameOver && currentCard) {
      if (hintBanner && hintText) {
        hintText.textContent = `Team: ${currentCard.targetTeam} | Role: ${currentCard.targetRole}`;
        hintBanner.style.display = "block";
      }
    }
  }

  function renderHistory() {
    if (!historyList) return;
    historyList.innerHTML = "";
    currentAttempts.forEach((a) => {
      const el = document.createElement("div");
      el.className = `guess-item ${a.isCorrect ? "correct" : ""}`;
      el.innerHTML = `
        <span>${a.name}</span>
        <span style="font-weight:700;">${a.isCorrect ? "✅ Match Winner!" : "❌ Incorrect"}</span>
      `;
      historyList.appendChild(el);
    });
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

    // 1. Target and batting players from scorecards
    if (Array.isArray(allCards)) {
      allCards.forEach((c) => {
        if (c.targetPlayer) {
          map.set(c.targetPlayer.toLowerCase(), { name: c.targetPlayer, country: c.targetTeam, role: c.targetRole });
        }
        if (c.innings && Array.isArray(c.innings.batting)) {
          c.innings.batting.forEach((b) => {
            if (b.player && !b.isTarget) {
              map.set(b.player.toLowerCase(), { name: b.player, country: c.innings.team, role: "Batter" });
            }
          });
        }
      });
    }

    // 2. Extra legends
    EXTRA_LEGENDS.forEach((p) => {
      map.set(p.name.toLowerCase(), p);
    });

    // 3. Full 425-player list from players.js
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

  function makeGuess(name) {
    if (!currentUser) {
      if (gateModal) gateModal.hidden = false;
      return;
    }
    if (isGameOver || !currentCard) return;

    let clean = name.trim();
    if (!clean) return;

    const guessLower = clean.toLowerCase();
    const targetLower = currentCard.targetPlayer.toLowerCase();

    // Smart resolution: e.g. "dhoni" -> "MS Dhoni", "maxwell" -> "Glenn Maxwell"
    if (targetLower === guessLower) {
      clean = currentCard.targetPlayer;
    } else if (
      targetLower.endsWith(" " + guessLower) ||
      targetLower.startsWith(guessLower + " ") ||
      targetLower.split(/\s+/).includes(guessLower)
    ) {
      clean = currentCard.targetPlayer;
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

    const isCorrect = clean.toLowerCase() === currentCard.targetPlayer.toLowerCase();
    currentAttempts.push({ name: clean, isCorrect });

    const today = getTodayKey();
    const won = isCorrect;
    const lost = !won && currentAttempts.length >= MAX_ATTEMPTS;

    if (won || lost) {
      isGameOver = true;
      finishGame(won);
    }

    localStorage.setItem(
      `cricketle_scorecard_${today}_${currentMode}`,
      JSON.stringify({ attempts: currentAttempts, isGameOver })
    );

    renderHistory();
    updateTrack();
    if (input) input.value = "";
    hideSuggestions();
  }

  function finishGame(won) {
    renderMatchInfo(); // reveals match info in hard mode too
    renderTable();     // replaces ████ with real player name

    if (hintBanner) hintBanner.style.display = "none";
    if (guessControls) guessControls.style.display = "none";

    if (resultCard) {
      resultCard.style.display = "block";
      resultCard.className = `result-card ${won ? "won" : "lost"}`;
      if (resultStatus) {
        resultStatus.textContent = won ? "BRILLIANT READ! 🎉" : "ALL OUT! 💔";
        resultStatus.style.color = won ? "#22c55e" : "#ef4444";
      }
      if (resultName) {
        resultName.textContent = currentCard.targetPlayer + ` (${currentCard.targetTeam})`;
      }
      if (resultDesc) {
        resultDesc.textContent = `${currentCard.title}: ${currentCard.hint}`;
      }
    }
  }

  // Autocomplete matching Classic Cricketle
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
    if (highlighted >= 0 && currentMatches[highlighted]) {
      const chosen = currentMatches[highlighted].name;
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

    input.addEventListener("focus", () => clearTimeout(blurTimer));

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
    if (!suggestions.hidden && highlighted >= 0 && currentMatches[highlighted]) {
      const chosen = currentMatches[highlighted].name;
      hideSuggestions();
      makeGuess(chosen);
    } else {
      const val = input ? input.value.trim() : "";
      if (val) {
        hideSuggestions();
        makeGuess(val);
      }
    }
  });

  document.getElementById("mode-easy")?.addEventListener("click", (e) => {
    if (currentMode === "easy") return;
    currentMode = "easy";
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    if (guessControls) guessControls.style.display = "block";
    if (resultCard) resultCard.style.display = "none";
    loadScorecard();
  });

  document.getElementById("mode-hard")?.addEventListener("click", (e) => {
    if (currentMode === "hard") return;
    currentMode = "hard";
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    if (guessControls) guessControls.style.display = "block";
    if (resultCard) resultCard.style.display = "none";
    loadScorecard();
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
          input.placeholder = "Type player name (e.g. MS Dhoni)...";
        }
        if (guessBtn) guessBtn.disabled = false;
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
    return false;
  }

  setupAutocomplete();
  checkAuth();
  loadScorecard();
})();

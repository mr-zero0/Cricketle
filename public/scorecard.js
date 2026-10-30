(function () {
  "use strict";

  const MAX_ATTEMPTS = 6;
  let allCards = [];
  let currentCard = null;
  let currentAttempts = [];
  let currentMode = "easy";
  let isGameOver = false;

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
  const autocomplete = document.getElementById("autocomplete-list");
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

      const today = getTodayKey();
      const seed = hashString(today + "_scorecard");
      const idx = seed % allCards.length;
      currentCard = allCards[idx];

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

  function makeGuess(name) {
    if (isGameOver || !currentCard) return;

    const clean = name.trim();
    if (!clean) return;

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
    closeAutocomplete();
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

  // Autocomplete
  function setupAutocomplete() {
    if (!input || !autocomplete) return;

    const names = Array.isArray(window.PLAYERS)
      ? window.PLAYERS.map((p) => ({ name: p.name, country: p.country }))
      : [];

    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) {
        closeAutocomplete();
        return;
      }

      const matches = names
        .filter((p) => p.name.toLowerCase().includes(q))
        .slice(0, 6);

      if (matches.length === 0) {
        closeAutocomplete();
        return;
      }

      autocomplete.innerHTML = "";
      matches.forEach((p) => {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        item.innerHTML = `<span>${p.name}</span><span style="color:#94a3b8;font-size:12px;">${p.country}</span>`;
        item.addEventListener("click", () => {
          input.value = p.name;
          closeAutocomplete();
          makeGuess(p.name);
        });
        autocomplete.appendChild(item);
      });
      autocomplete.style.display = "block";
    });

    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !autocomplete.contains(e.target)) {
        closeAutocomplete();
      }
    });
  }

  function closeAutocomplete() {
    if (autocomplete) {
      autocomplete.innerHTML = "";
      autocomplete.style.display = "none";
    }
  }

  guessBtn?.addEventListener("click", () => {
    const val = input ? input.value.trim() : "";
    if (val) makeGuess(val);
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = autocomplete?.querySelector(".autocomplete-item span");
      const val = first ? first.textContent : input.value.trim();
      if (val) makeGuess(val);
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

  setupAutocomplete();
  loadScorecard();
})();

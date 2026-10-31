(function () {
  "use strict";

  const MAX_ATTEMPTS = 6;
  let allStadiums = [];
  let currentTarget = null;
  let currentAttempts = [];
  let isGameOver = false;
  let currentUser = null;

  const cluesDeck = document.getElementById("clues-deck");
  const track = document.getElementById("attempts-track");
  const input = document.getElementById("guess-input");
  const guessBtn = document.getElementById("btn-guess");
  const skipBtn = document.getElementById("btn-skip");
  const suggestions = document.getElementById("suggestions");
  const historyList = document.getElementById("guess-history");
  const resultCard = document.getElementById("result-card");
  const resultStatus = document.getElementById("result-status");
  const resultName = document.getElementById("result-name");
  const resultDesc = document.getElementById("result-desc");
  const guessControls = document.getElementById("guess-controls");
  const shareBtn = document.getElementById("btn-share");
  const gateModal = document.getElementById("member-gate-modal");

  const svgStraightTop = document.getElementById("svg-dist-straight");
  const svgStraightBottom = document.getElementById("svg-dist-bottom");
  const svgSquareL = document.getElementById("svg-dist-square-l");
  const svgSquareR = document.getElementById("svg-dist-square-r");

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

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function checkAuth() {
    try {
      const res = await fetch("/api/me");
      const d = await res.json();
      if (d && d.user) {
        currentUser = d.user;
        const topbarAuth = document.getElementById("topbar-auth-btn");
        if (topbarAuth) {
          topbarAuth.classList.add("signed-in");
          topbarAuth.title = `@${d.user.username} (Account)`;
        }
        if (gateModal) gateModal.hidden = true;
        if (input) {
          input.disabled = false;
          input.placeholder = "Type stadium name (e.g. Wankhede Stadium)...";
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

  async function loadStadium() {
    try {
      const res = await fetch("datasets/stadiums.json");
      allStadiums = await res.json();
      if (!allStadiums || !allStadiums.length) return;

      const today = getTodayKey();
      const seed = hashString(today + "_stadium_mystery");
      const sIdx = seed % allStadiums.length;
      currentTarget = allStadiums[sIdx];

      // Update SVG boundary callouts
      const b = currentTarget.boundaries || { straight: 75, square: 66 };
      if (svgStraightTop) svgStraightTop.textContent = `Straight: ${b.straight}m`;
      if (svgStraightBottom) svgStraightBottom.textContent = `Straight: ${b.straight}m`;
      if (svgSquareL) svgSquareL.textContent = `${b.square}m`;
      if (svgSquareR) svgSquareR.textContent = `${b.square}m`;

      renderClues();
      renderAttempts();
    } catch (e) {
      console.error("Failed to load stadium puzzle", e);
    }
  }

  function renderClues() {
    if (!cluesDeck || !currentTarget) return;
    cluesDeck.innerHTML = "";

    const attemptCount = currentAttempts.length;

    const cluesConfig = [
      {
        level: 0,
        icon: "📍",
        label: "Location & Capacity",
        text: `${currentTarget.country} · ${currentTarget.continent} | Capacity: ${currentTarget.capacity} spectators | Est. ${currentTarget.established}`
      },
      {
        level: 1,
        icon: "🌱",
        label: "Pitch & Soil Characteristics",
        text: currentTarget.pitchType
      },
      {
        level: 2,
        icon: "🎯",
        label: "Bowling End Names",
        text: `${currentTarget.ends[0]} & ${currentTarget.ends[1]}`
      },
      {
        level: 3,
        icon: "🏆",
        label: "Historic Cricket Moment",
        text: currentTarget.historicMoment
      },
      {
        level: 4,
        icon: "🏏",
        label: "Home Franchise / Domestic Team",
        text: currentTarget.homeTeam
      },
      {
        level: 5,
        icon: "🏙️",
        label: "City & Initial Clue",
        text: `City: ${currentTarget.city} | Name starts with: '${currentTarget.name.charAt(0)}'`
      }
    ];

    cluesConfig.forEach((c) => {
      const isUnlocked = attemptCount >= c.level || isGameOver;
      const el = document.createElement("div");
      el.className = `clue-pill ${isUnlocked ? "unlocked" : "locked"}`;
      el.innerHTML = `
        <div class="clue-icon-box">${isUnlocked ? c.icon : "🔒"}</div>
        <div class="clue-body">
          <div class="clue-label">${escapeHtml(c.label)} ${isUnlocked ? "" : `(Unlocks after ${c.level} wrong ${c.level === 1 ? "try" : "tries"})`}</div>
          <div class="clue-text">${isUnlocked ? escapeHtml(c.text) : "Clue hidden — submit a guess or skip to unlock"}</div>
        </div>
      `;
      cluesDeck.appendChild(el);
    });
  }

  function renderAttempts() {
    if (!track) return;
    const dots = track.querySelectorAll(".attempt-dot");
    const count = currentAttempts.length;

    dots.forEach((dot, i) => {
      dot.className = "attempt-dot";
      if (i < count) {
        const att = currentAttempts[i];
        if (att.isCorrect) dot.classList.add("correct");
        else if (att.skipped) dot.classList.add("skipped");
        else dot.classList.add("wrong");
      } else if (i === count && !isGameOver) {
        dot.classList.add("current");
      }
    });
  }

  function renderHistory() {
    if (!historyList) return;
    historyList.innerHTML = "";

    currentAttempts.forEach((a) => {
      const item = document.createElement("div");
      item.className = `guess-item ${a.isCorrect ? "correct" : a.skipped ? "skipped" : ""}`;
      item.innerHTML = `
        <span>${a.skipped ? "<em>Skipped</em>" : escapeHtml(a.name)}</span>
        <span style="font-weight:700;">${a.isCorrect ? "✅ Correct" : a.skipped ? "⏭️ Skipped" : "❌ Incorrect"}</span>
      `;
      historyList.appendChild(item);
    });
  }

  function makeGuess(stadiumName, skipped = false) {
    if (!currentUser) {
      if (gateModal) gateModal.hidden = false;
      return;
    }
    if (isGameOver || !currentTarget) return;

    const clean = stadiumName.trim();
    if (!clean && !skipped) return;

    let isCorrect = false;
    if (!skipped) {
      const guessLower = clean.toLowerCase();
      const targetLower = currentTarget.name.toLowerCase();
      const cityLower = currentTarget.city.toLowerCase();

      if (
        guessLower === targetLower ||
        targetLower.includes(guessLower) ||
        guessLower.includes(targetLower) ||
        (guessLower.includes(cityLower) && guessLower.includes(currentTarget.name.split(" ")[0].toLowerCase()))
      ) {
        isCorrect = true;
      }
    }

    currentAttempts.push({
      name: clean || "Skip",
      isCorrect,
      skipped
    });

    if (input) input.value = "";
    renderAttempts();
    renderHistory();
    renderClues();

    if (isCorrect) {
      endGame(true);
    } else if (currentAttempts.length >= MAX_ATTEMPTS) {
      endGame(false);
    }
  }

  function endGame(won) {
    isGameOver = true;
    renderClues();
    renderAttempts();

    if (guessControls) guessControls.style.display = "none";
    if (resultCard) {
      resultCard.className = `result-card ${won ? "won" : "lost"}`;
      resultCard.style.display = "block";
      if (resultStatus) {
        resultStatus.textContent = won ? "STADIUM IDENTIFIED! 🏆" : "OUT OF ATTEMPTS! 🏟️";
      }
      if (resultName) {
        resultName.textContent = `${currentTarget.name} (${currentTarget.city}, ${currentTarget.country})`;
      }
      if (resultDesc) {
        resultDesc.textContent = won
          ? `Spectacular! You recognized ${currentTarget.name} in ${currentAttempts.length} attempt${currentAttempts.length === 1 ? "" : "s"}.`
          : `The mystery venue was ${currentTarget.name}. ${currentTarget.historicMoment}`;
      }
      resultCard.scrollIntoView({ behavior: "smooth" });
    }
  }

  // Autocomplete Setup
  function setupAutocomplete() {
    if (!input || !suggestions) return;

    function hideSuggestions() {
      suggestions.hidden = true;
      suggestions.innerHTML = "";
      highlighted = -1;
      currentMatches = [];
      input.setAttribute("aria-expanded", "false");
    }

    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      if (!query || query.length < 2) {
        hideSuggestions();
        return;
      }

      currentMatches = allStadiums.filter((s) => {
        const full = `${s.name} ${s.city} ${s.country}`.toLowerCase();
        return full.includes(query);
      }).slice(0, 6);

      if (currentMatches.length === 0) {
        hideSuggestions();
        return;
      }

      suggestions.innerHTML = "";
      currentMatches.forEach((s, idx) => {
        const li = document.createElement("li");
        li.role = "option";
        li.setAttribute("data-name", s.name);

        const label = `${s.name} (${s.city}, ${s.country})`;
        const qIdx = label.toLowerCase().indexOf(query);
        if (qIdx >= 0) {
          const before = escapeHtml(label.slice(0, qIdx));
          const match = escapeHtml(label.slice(qIdx, qIdx + query.length));
          const after = escapeHtml(label.slice(qIdx + query.length));
          li.innerHTML = `<span>${before}<mark>${match}</mark>${after}</span> <span style="font-size:12px;color:var(--muted);">${s.capacity}</span>`;
        } else {
          li.innerHTML = `<span>${escapeHtml(label)}</span> <span style="font-size:12px;color:var(--muted);">${s.capacity}</span>`;
        }

        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          hideSuggestions();
          makeGuess(s.name);
        });

        suggestions.appendChild(li);
      });

      suggestions.hidden = false;
      highlighted = -1;
      input.setAttribute("aria-expanded", "true");
    });

    input.addEventListener("keydown", (e) => {
      if (suggestions.hidden) {
        if (e.key === "Enter") {
          e.preventDefault();
          const val = input.value.trim();
          if (val) makeGuess(val);
        }
        return;
      }

      const items = suggestions.querySelectorAll("li");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlighted = (highlighted + 1) % items.length;
        items.forEach((it, i) => it.classList.toggle("highlighted", i === highlighted));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlighted = (highlighted - 1 + items.length) % items.length;
        items.forEach((it, i) => it.classList.toggle("highlighted", i === highlighted));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlighted >= 0 && currentMatches[highlighted]) {
          const name = currentMatches[highlighted].name;
          hideSuggestions();
          makeGuess(name);
        } else {
          const val = input.value.trim();
          hideSuggestions();
          if (val) makeGuess(val);
        }
      } else if (e.key === "Escape") {
        hideSuggestions();
      }
    });

    input.addEventListener("blur", () => {
      blurTimer = setTimeout(hideSuggestions, 150);
    });
  }

  // Button Listeners
  guessBtn?.addEventListener("click", () => {
    const val = input ? input.value.trim() : "";
    if (val) makeGuess(val);
  });

  skipBtn?.addEventListener("click", () => {
    makeGuess("Skip", true);
  });

  shareBtn?.addEventListener("click", () => {
    const today = getTodayKey();
    let shareText = `Stadium Mystery · ${today}\n`;
    currentAttempts.forEach((a) => {
      if (a.isCorrect) shareText += "🟩 ";
      else if (a.skipped) shareText += "⬛ ";
      else shareText += "🟥 ";
    });
    shareText += `\nPlay: https://playcricketle.onrender.com/stadium.html`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText.trim()).then(() => {
        alert("Results copied to clipboard! 📋");
      }).catch(() => {});
    }
  });

  // Init
  setupAutocomplete();
  checkAuth();
  loadStadium();
})();

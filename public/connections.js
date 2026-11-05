(function () {
  "use strict";

  const MAX_MISTAKES = 4;
  let allPuzzles = [];
  let currentPuzzle = null;
  let activeItems = [];
  let selectedItems = [];
  let solvedGroups = [];
  let mistakesLeft = MAX_MISTAKES;
  let guessHistory = [];
  let pastGuesses = new Set();
  let isGameOver = false;
  let puzzleStartTime = Date.now();
  let currentUser = null;

  const gridEl = document.getElementById("connections-grid");
  const solvedEl = document.getElementById("solved-categories");
  const dotsEl = document.getElementById("mistake-dots");
  const shuffleBtn = document.getElementById("btn-shuffle");
  const deselectBtn = document.getElementById("btn-deselect");
  const submitBtn = document.getElementById("btn-submit");
  const toastEl = document.getElementById("conn-toast");
  const resultCard = document.getElementById("result-card");
  const resultStatus = document.getElementById("result-status");
  const resultDesc = document.getElementById("result-desc");
  const resultGridShare = document.getElementById("result-grid-share");
  const shareBtn = document.getElementById("btn-share");
  const dayLabel = document.getElementById("conn-day-label");
  const gateModal = document.getElementById("member-gate-modal");

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

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  let toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2200);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
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
        return true;
      }
    } catch (e) {}

    currentUser = null;
    if (gateModal) gateModal.hidden = false;
    return false;
  }

  const cycleCache = new Map();

  function getMulberryRng(seed) {
    let s = (seed + 0x6d2b79f5) | 0;
    return function() {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function getPermutation(length, cycle, modeSalt, minGap) {
    const gap = minGap || Math.min(20, Math.max(1, length - 8));
    const key = `${length}_${cycle}_${modeSalt}_${gap}`;
    if (cycleCache.has(key)) return cycleCache.get(key);

    const rng = getMulberryRng(hashString(modeSalt + "_c_" + cycle));
    let arr;

    if (cycle === 0) {
      arr = Array.from({ length }, (_, i) => i);
      for (let i = length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    } else {
      const prevPerm = getPermutation(length, cycle - 1, modeSalt, gap);
      const prevPos = new Map();
      prevPerm.forEach((item, pos) => prevPos.set(item, pos));

      const remaining = new Set(Array.from({ length }, (_, i) => i));
      arr = new Array(length);

      for (let pos = 0; pos < length; pos++) {
        const maxAllowedPrevPos = length - gap + pos;
        const candidates = Array.from(remaining).filter((item) => prevPos.get(item) <= maxAllowedPrevPos);
        if (candidates.length === 0) {
          let bestItem = null, maxDist = -1;
          for (const item of remaining) {
            const dist = (length - prevPos.get(item)) + pos;
            if (dist > maxDist) { maxDist = dist; bestItem = item; }
          }
          arr[pos] = bestItem;
          remaining.delete(bestItem);
        } else {
          const idx = Math.floor(rng() * candidates.length);
          const chosen = candidates[idx];
          arr[pos] = chosen;
          remaining.delete(chosen);
        }
      }
    }

    if (cycleCache.size > 128) cycleCache.clear();
    cycleCache.set(key, arr);
    return arr;
  }

  function getSpacedDailyIndex(todayKey, poolLength, modeSalt, minGap) {
    if (poolLength <= 1) return 0;
    const [y, m, d] = todayKey.split("-").map(Number);
    const epoch2026 = Date.UTC(2026, 0, 1);
    const diffDays = Math.floor((Date.UTC(y, m - 1, d) - epoch2026) / 86400000);
    const dayNumber = Math.max(0, diffDays);
    const cycle = Math.floor(dayNumber / poolLength);
    const pos = dayNumber % poolLength;
    const gap = minGap || Math.min(20, Math.max(1, poolLength - 8));
    const perm = getPermutation(poolLength, cycle, modeSalt, gap);
    return perm[pos];
  }

  async function loadPuzzle() {
    try {
      const res = await fetch("datasets/connections.json");
      allPuzzles = await res.json();
      if (!allPuzzles || !allPuzzles.length) return;

      const today = getTodayKey();
      if (dayLabel) {
        dayLabel.textContent = `Daily Puzzle · ${today}`;
      }

      const seed = hashString(today + "_connections");
      const pIdx = seed % allPuzzles.length;
      currentPuzzle = allPuzzles[pIdx];

      // Collect all 16 items
      const items = [];
      currentPuzzle.groups.forEach((g) => {
        g.members.forEach((m) => {
          items.push({ name: m, group: g });
        });
      });

      // Deterministic initial shuffle
      const rng = mulberry32(seed);
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }

      activeItems = items;
      selectedItems = [];
      solvedGroups = [];
      mistakesLeft = MAX_MISTAKES;
      guessHistory = [];
      pastGuesses.clear();
      isGameOver = false;

      renderMistakes();
      renderSolved();
      renderGrid();
      updateButtons();
    } catch (e) {
      console.error("Failed to load connections puzzle", e);
    }
  }

  function renderMistakes() {
    if (!dotsEl) return;
    dotsEl.innerHTML = "";
    for (let i = 0; i < MAX_MISTAKES; i++) {
      const dot = document.createElement("span");
      dot.className = `mistake-dot ${i >= mistakesLeft ? "lost" : ""}`;
      dotsEl.appendChild(dot);
    }
  }

  function renderSolved() {
    if (!solvedEl) return;
    solvedEl.innerHTML = "";
    solvedGroups.forEach((g) => {
      const card = document.createElement("div");
      card.className = `solved-card level-${g.level}`;
      card.innerHTML = `
        <div class="solved-title">${escapeHtml(g.category)}</div>
        <div class="solved-members">${escapeHtml(g.members.join(", "))}</div>
      `;
      solvedEl.appendChild(card);
    });
  }

  function renderGrid() {
    if (!gridEl) return;
    gridEl.innerHTML = "";

    activeItems.forEach((item) => {
      const isSelected = selectedItems.some((s) => s.name === item.name);
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = `conn-tile ${isSelected ? "selected" : ""}`;
      tile.textContent = item.name;
      tile.setAttribute("data-name", item.name);

      tile.addEventListener("click", () => {
        if (!currentUser) {
          if (gateModal) gateModal.hidden = false;
          return;
        }
        if (isGameOver) return;
        toggleSelect(item);
      });

      gridEl.appendChild(tile);
    });
  }

  function toggleSelect(item) {
    if (!currentUser) { if (gateModal) gateModal.hidden = false; return; }
    const idx = selectedItems.findIndex((s) => s.name === item.name);
    if (idx >= 0) {
      selectedItems.splice(idx, 1);
    } else {
      if (selectedItems.length >= 4) {
        showToast("You can only select 4 items!");
        return;
      }
      selectedItems.push(item);
    }
    renderGrid();
    updateButtons();
  }

  function updateButtons() {
    if (deselectBtn) {
      deselectBtn.disabled = selectedItems.length === 0 || isGameOver;
    }
    if (submitBtn) {
      submitBtn.disabled = selectedItems.length !== 4 || isGameOver;
    }
    if (shuffleBtn) {
      shuffleBtn.disabled = activeItems.length <= 1 || isGameOver;
    }
  }

  function getLevelEmoji(level) {
    if (level === 0) return "🟨";
    if (level === 1) return "🟩";
    if (level === 2) return "🟦";
    return "🟪";
  }

  function checkSubmit() {
    if (selectedItems.length !== 4 || isGameOver) return;

    // Sort to create a consistent set key
    const sortedNames = selectedItems.map((s) => s.name).sort();
    const guessKey = sortedNames.join("|||");

    if (pastGuesses.has(guessKey)) {
      showToast("Already guessed!");
      return;
    }
    pastGuesses.add(guessKey);

    // Record guess history for share grid
    const guessLevels = selectedItems.map((s) => s.group.level);
    guessHistory.push(guessLevels);

    // Count how many selected items belong to each remaining category
    const remainingGroups = currentPuzzle.groups.filter(
      (g) => !solvedGroups.some((sg) => sg.category === g.category)
    );

    let matchedGroup = null;
    let oneAway = false;

    for (const g of remainingGroups) {
      const matchCount = selectedItems.filter((s) => s.group.category === g.category).length;
      if (matchCount === 4) {
        matchedGroup = g;
        break;
      } else if (matchCount === 3) {
        oneAway = true;
      }
    }

    if (matchedGroup) {
      // Correct!
      solvedGroups.push(matchedGroup);
      const solvedNames = new Set(matchedGroup.members);
      activeItems = activeItems.filter((item) => !solvedNames.has(item.name));
      selectedItems = [];

      renderSolved();
      renderGrid();
      updateButtons();

      if (solvedGroups.length === 4) {
        handleGameOver(true);
      }
    } else {
      // Wrong guess
      mistakesLeft = Math.max(0, mistakesLeft - 1);
      renderMistakes();

      // Shake selected tiles
      document.querySelectorAll(".conn-tile.selected").forEach((tile) => {
        tile.classList.add("shake");
        setTimeout(() => tile.classList.remove("shake"), 400);
      });

      if (oneAway) {
        showToast("One away... 🤏");
      } else {
        showToast("Incorrect guess");
      }

      if (mistakesLeft === 0) {
        handleGameOver(false);
      }
    }
  }

  function handleGameOver(won) {
    isGameOver = true;
    updateButtons();

    const elapsedMs = Math.max(1000, Date.now() - puzzleStartTime);
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const speedBonus = Math.max(0, 30 - Math.floor(elapsedSec / 10));
    const calculatedScore = won ? (80 + (mistakesLeft * 5) + speedBonus) : (solvedGroups.length * 10);

    fetch("/api/variant/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: "connections",
        score: calculatedScore,
        status: won ? "solved" : "gaveUp",
        durationMs: elapsedMs,
        guesses: guessHistory,
      }),
    }).catch(() => {});

    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: "connections",
        action: "game_completed",
        details: { won, score: calculatedScore, mistakesLeft },
        durationMs: elapsedMs,
        score: calculatedScore,
      }),
    }).catch(() => {});

    if (!won) {
      // Reveal remaining groups
      const remaining = currentPuzzle.groups.filter(
        (g) => !solvedGroups.some((sg) => sg.category === g.category)
      );
      remaining.forEach((g) => solvedGroups.push(g));
      activeItems = [];
      renderSolved();
      renderGrid();
    }

    // Build share grid string
    let shareMatrix = "";
    guessHistory.forEach((row) => {
      shareMatrix += row.map(getLevelEmoji).join("") + "\n";
    });

    if (resultCard) {
      resultCard.className = `result-card ${won ? "won" : "lost"}`;
      resultCard.style.display = "block";
      if (resultStatus) {
        resultStatus.textContent = won ? "CRICKET GENIUS! 🏆" : "OUT! NEXT TIME 🏏";
      }
      if (resultDesc) {
        resultDesc.textContent = won
          ? `Brilliant! You found all 4 cricket connections with ${mistakesLeft} mistake${mistakesLeft === 1 ? "" : "s"} left.`
          : `All mistakes used up! The correct cricket categories have been revealed above.`;
      }
      if (resultGridShare) {
        resultGridShare.innerHTML = shareMatrix.trim().replace(/\n/g, "<br>");
      }
      resultCard.scrollIntoView({ behavior: "smooth" });
    }
  }

  // Setup Event Listeners
  deselectBtn?.addEventListener("click", () => {
    selectedItems = [];
    renderGrid();
    updateButtons();
  });

  shuffleBtn?.addEventListener("click", () => {
    shuffle(activeItems);
    renderGrid();
  });

  submitBtn?.addEventListener("click", () => {
    checkSubmit();
  });

  shareBtn?.addEventListener("click", () => {
    const today = getTodayKey();
    let shareText = `Cricket Connections · ${today}\n`;
    guessHistory.forEach((row) => {
      shareText += row.map(getLevelEmoji).join("") + "\n";
    });
    shareText += `Play: https://playcricketle.onrender.com/connections.html`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText.trim()).then(() => {
        showToast("Results copied to clipboard! 📋");
      }).catch(() => {
        showToast("Share text generated!");
      });
    } else {
      showToast("Results ready!");
    }
  });

  // Init
  checkAuth();
  loadPuzzle();
})();


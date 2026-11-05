(function () {
  "use strict";

  const TOTAL_ROUNDS = 1;
  let allSets = [];
  let dailySets = [];
  let currentRoundIndex = 0;
  let currentRoundSet = null;
  let userChoices = {}; // factId -> 'real' | 'fake'
  let roundResults = []; // array of results for daily challenge
  let isRoundSubmitted = false;
  let currentUser = null;
  let puzzleStartTime = Date.now();

  // DOM elements
  const gameView = document.getElementById("game-view");
  const finishedView = document.getElementById("finished-view");
  const factsListEl = document.getElementById("facts-list");
  const themeTagEl = document.getElementById("facts-theme-tag");
  const themeTitleEl = document.getElementById("facts-theme-title");
  const countRealEl = document.getElementById("count-real-num");
  const countFakeEl = document.getElementById("count-fake-num");
  const counterRealPill = document.getElementById("counter-real");
  const counterFakePill = document.getElementById("counter-fake");
  const btnSubmit = document.getElementById("btn-submit-round");
  const btnNext = document.getElementById("btn-next-round");
  const roundBanner = document.getElementById("round-score-banner");
  const roundBannerTitle = document.getElementById("round-score-title");
  const roundBannerDesc = document.getElementById("round-score-desc");
  const gateModal = document.getElementById("member-gate-modal");
  const toastEl = document.getElementById("facts-toast");

  // Summary elements
  const finalScoreDisplay = document.getElementById("final-score-display");
  const finalScoreRating = document.getElementById("final-score-rating");
  const summaryGridPreview = document.getElementById("summary-grid-preview");
  const btnShareWhatsapp = document.getElementById("btn-share-whatsapp");
  const btnCopyScore = document.getElementById("btn-copy-score");
  const countdownTimer = document.getElementById("countdown-timer");

  function getTodayKey() {
    const d = new Date();
    // Use IST (UTC + 5:30)
    const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
    const ist = new Date(istMs);
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
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
    }, 2400);
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

  function saveState() {
    const today = getTodayKey();
    const state = {
      roundIndex: 0,
      roundResults: roundResults,
      userChoices: userChoices,
      isRoundSubmitted: isRoundSubmitted
    };
    try {
      localStorage.setItem(`cricketle_facts_${today}`, JSON.stringify(state));
    } catch (e) {}
  }

  function loadSavedState() {
    const today = getTodayKey();
    try {
      const raw = localStorage.getItem(`cricketle_facts_${today}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
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


  function selectDailySets(todayKey) {
    if (!allSets || allSets.length === 0) return [];
    // Non-repeating calendar day progression: every day gets a unique set from the library
    const epoch = new Date("2026-01-01T00:00:00Z").getTime();
    const current = new Date(`${todayKey}T00:00:00Z`).getTime();
    const dayNumber = Math.max(0, Math.floor((current - epoch) / 86400000));
    const idx = getSpacedDailyIndex(todayKey, allSets.length, "facts_daily");
    return [allSets[idx]];
  }

  function updateRoundPills() {
    const pill0 = document.getElementById("step-pill-0");
    if (pill0) {
      pill0.classList.add("active");
      if (isRoundSubmitted) {
        pill0.classList.add("completed");
        pill0.innerHTML = "<span>✓ Completed</span>";
      } else {
        pill0.innerHTML = "<span>Daily Challenge</span>";
      }
    }
  }

  function updateCounters() {
    let realCount = 0;
    let fakeCount = 0;
    Object.values(userChoices).forEach((choice) => {
      if (choice === "real") realCount++;
      if (choice === "fake") fakeCount++;
    });

    if (countRealEl) countRealEl.textContent = String(realCount);
    if (countFakeEl) countFakeEl.textContent = String(fakeCount);

    if (counterRealPill) {
      counterRealPill.classList.toggle("filled", realCount === 3);
    }
    if (counterFakePill) {
      counterFakePill.classList.toggle("filled", fakeCount === 3);
    }

    const totalMarked = realCount + fakeCount;
    if (btnSubmit && !isRoundSubmitted) {
      btnSubmit.disabled = totalMarked < 6;
      const label = totalMarked === 6 ? "SUBMIT DECISIONS (Ready!)" : `Submit Decisions (${totalMarked}/6)`;
      const btnSpan = btnSubmit.querySelector("span");
      if (btnSpan) btnSpan.textContent = label;
    }
  }

  function renderRound(alreadySubmitted = false) {
    if (!currentRoundSet) return;

    if (!alreadySubmitted) {
      userChoices = {};
      isRoundSubmitted = false;
    }

    updateRoundPills();
    if (roundBanner && !alreadySubmitted) roundBanner.hidden = true;
    if (btnNext) btnNext.style.display = "none";
    if (btnSubmit) {
      if (alreadySubmitted) {
        btnSubmit.style.display = "none";
      } else {
        btnSubmit.style.display = "inline-flex";
        btnSubmit.disabled = true;
      }
    }

    if (themeTagEl) themeTagEl.textContent = "Daily Trivia";
    if (themeTitleEl) themeTitleEl.textContent = currentRoundSet.theme || "Cricket Trivia";

    // Shuffle facts deterministically for today
    const seed = hashString(`${getTodayKey()}_daily_order`);
    const rng = mulberry32(seed);
    const facts = [...currentRoundSet.facts];
    for (let i = facts.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [facts[i], facts[j]] = [facts[j], facts[i]];
    }

    factsListEl.innerHTML = "";

    facts.forEach((f, idx) => {
      const card = document.createElement("div");
      card.className = "fact-card";
      card.id = `card-${f.id}`;
      card.setAttribute("data-fact-id", f.id);

      const existingChoice = userChoices[f.id];
      const isCorrect = alreadySubmitted && ((existingChoice === "real" && f.isReal) || (existingChoice === "fake" && !f.isReal));

      if (alreadySubmitted) {
        card.classList.add(isCorrect ? "reveal-correct" : "reveal-wrong");
      } else if (existingChoice === "real") {
        card.classList.add("selected-real");
      } else if (existingChoice === "fake") {
        card.classList.add("selected-fake");
      }

      card.innerHTML = `
        <div class="fact-card-body">
          <div class="fact-statement">${escapeHtml(f.statement)}</div>
          <div class="fact-actions">
            <button type="button" class="choice-btn choice-real${existingChoice === "real" ? " active-real" : ""}" data-fact-id="${f.id}" data-choice="real" aria-label="Mark statement ${idx + 1} as Real"${alreadySubmitted ? " disabled" : ""}>
              <span>✅ Real</span>
            </button>
            <button type="button" class="choice-btn choice-fake${existingChoice === "fake" ? " active-fake" : ""}" data-fact-id="${f.id}" data-choice="fake" aria-label="Mark statement ${idx + 1} as Fake"${alreadySubmitted ? " disabled" : ""}>
              <span>❌ Fake</span>
            </button>
          </div>
        </div>
        <div class="fact-explanation-box" id="explain-${f.id}" style="${alreadySubmitted ? "display:block;" : "display:none;"}">
          ${alreadySubmitted ? `
            <div class="verdict-header">
              <span>${f.isReal ? "🟢 REAL (VERIFIED)" : "🔴 FAKE (MYTH)"}</span>
              <span>${isCorrect ? "✅ YOU GOT IT!" : `❌ MISSED (You guessed ${(existingChoice || "").toUpperCase()})`}</span>
            </div>
            <div class="verdict-text">${escapeHtml(f.explanation)}</div>
          ` : ""}
        </div>
      `;

      factsListEl.appendChild(card);
    });

    updateCounters();
  }

  function handleChoiceClick(factId, choice) {
    if (isRoundSubmitted) return;

    const card = document.getElementById(`card-${factId}`);
    if (!card) return;

    const btnReal = card.querySelector(".choice-real");
    const btnFake = card.querySelector(".choice-fake");

    if (userChoices[factId] === choice) {
      // Toggle off
      delete userChoices[factId];
      card.classList.remove("selected-real", "selected-fake");
      if (btnReal) btnReal.classList.remove("active-real");
      if (btnFake) btnFake.classList.remove("active-fake");
    } else {
      userChoices[factId] = choice;
      card.classList.remove("selected-real", "selected-fake");
      if (btnReal) btnReal.classList.remove("active-real");
      if (btnFake) btnFake.classList.remove("active-fake");

      if (choice === "real") {
        card.classList.add("selected-real");
        if (btnReal) btnReal.classList.add("active-real");
      } else {
        card.classList.add("selected-fake");
        if (btnFake) btnFake.classList.add("active-fake");
      }
    }

    updateCounters();
  }

  function submitRound() {
    if (isRoundSubmitted) return;
    if (Object.keys(userChoices).length < 6) {
      showToast("Please mark all 6 facts as Real or Fake before submitting!");
      return;
    }

    isRoundSubmitted = true;
    if (btnSubmit) btnSubmit.style.display = "none";

    let correctCount = 0;
    const roundDetails = [];

    currentRoundSet.facts.forEach((f) => {
      const userChoice = userChoices[f.id];
      const isCorrect = (userChoice === "real" && f.isReal) || (userChoice === "fake" && !f.isReal);
      if (isCorrect) correctCount++;

      roundDetails.push({
        id: f.id,
        statement: f.statement,
        isReal: f.isReal,
        userChoice: userChoice,
        isCorrect: isCorrect,
        explanation: f.explanation
      });

      const card = document.getElementById(`card-${f.id}`);
      if (card) {
        const btnReal = card.querySelector(".choice-real");
        const btnFake = card.querySelector(".choice-fake");
        if (btnReal) btnReal.disabled = true;
        if (btnFake) btnFake.disabled = true;

        card.classList.remove("selected-real", "selected-fake");
        card.classList.add(isCorrect ? "reveal-correct" : "reveal-wrong");

        const explainBox = document.getElementById(`explain-${f.id}`);
        if (explainBox) {
          const truthBadge = f.isReal ? "🟢 REAL (VERIFIED)" : "🔴 FAKE (MYTH)";
          const statusText = isCorrect ? "✅ YOU GOT IT!" : `❌ MISSED (You guessed ${userChoice.toUpperCase()})`;
          explainBox.innerHTML = `
            <div class="verdict-header">
              <span>${truthBadge}</span>
              <span>${statusText}</span>
            </div>
            <div class="verdict-text">${escapeHtml(f.explanation)}</div>
          `;
          explainBox.style.display = "block";
        }
      }
    });

    roundResults[0] = {
      roundIndex: 0,
      theme: currentRoundSet.theme,
      score: correctCount,
      details: roundDetails
    };

    const elapsedMs = Math.max(1000, Date.now() - puzzleStartTime);
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const speedBonus = correctCount > 0 ? Math.max(0, 25 - Math.floor(elapsedSec / 15)) : 0;
    const calculatedScore = (correctCount * 15) + speedBonus;

    fetch("/api/variant/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: "facts",
        score: calculatedScore,
        status: correctCount >= 4 ? "solved" : "gaveUp",
        durationMs: elapsedMs,
        guesses: roundDetails,
      }),
    }).catch(() => {});

    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: "facts",
        action: "game_completed",
        details: { correctCount, score: calculatedScore },
        durationMs: elapsedMs,
        score: calculatedScore,
      }),
    }).catch(() => {});

    saveState();
    updateRoundPills();

    // Show round banner
    if (roundBanner) {
      roundBanner.hidden = false;
      const feedback = correctCount === 6 ? "PERFECT! Flawless cricket intuition!" :
                       correctCount >= 5 ? "GREAT EYE! Exceptional cricket knowledge!" :
                       correctCount >= 4 ? "SOLID EFFORT! Tricky ones in there!" :
                       "DECEIVING! These myths fooled you!";
      roundBannerTitle.textContent = `${correctCount} / 6 CORRECT!`;
      roundBannerDesc.textContent = feedback;
    }

    showFinalSummary();
  }

  function showFinalSummary() {
    if (finishedView) finishedView.style.display = "block";
    if (btnSubmit) btnSubmit.style.display = "none";

    const result = roundResults[0] || { score: 0, details: [] };
    const totalScore = result.score || 0;
    const maxScore = 6;
    if (totalScore >= 4) {
      try { window.CricketleFX?.burst?.(); } catch (_) {}
    }
    let gridText = "";

    if (result.details && result.details.length > 0) {
      let rowEmojis = "";
      result.details.forEach((d) => {
        rowEmojis += d.isCorrect ? "🟢" : "🔴";
      });
      gridText = `${rowEmojis} (${totalScore}/6)`;
    }

    if (finalScoreDisplay) {
      finalScoreDisplay.textContent = `${totalScore} / ${maxScore}`;
    }

    if (finalScoreRating) {
      let title = "Cricket Fan";
      if (totalScore === 6) title = "🏆 Cricket Trivia Grandmaster (Flawless 6/6!)";
      else if (totalScore === 5) title = "🧠 Trivia Mastermind (5/6)";
      else if (totalScore === 4) title = "🏏 Sharp Cricket Connoisseur (4/6)";
      else if (totalScore === 3) title = "⚖️ Balanced Guessing (3/6)";
      else title = "📚 Clever Myths Won Today!";
      finalScoreRating.textContent = title;
    }

    if (summaryGridPreview) {
      summaryGridPreview.textContent = gridText || `${totalScore}/6`;
    }

    const shareText = `Cricketle · Fact or Fiction ⚖️\nDaily Challenge · ${getTodayKey()}\nScore: ${totalScore}/${maxScore}\n\n${gridText}\n\nCan you separate cricket truth from clever fiction?\nhttps://cricketle.onrender.com/facts.html`;

    if (btnShareWhatsapp) {
      btnShareWhatsapp.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    }

    if (btnCopyScore) {
      btnCopyScore.onclick = async () => {
        try {
          await navigator.clipboard.writeText(shareText);
          showToast("Score copied to clipboard!");
        } catch (e) {
          showToast("Unable to copy to clipboard.");
        }
      };
    }

    startMidnightCountdown();
  }

  function startMidnightCountdown() {
    function tick() {
      const now = new Date();
      const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
      const ist = new Date(istMs);

      const nextMidnightIst = new Date(Date.UTC(
        ist.getUTCFullYear(),
        ist.getUTCMonth(),
        ist.getUTCDate() + 1,
        0, 0, 0
      ));
      const diffMs = nextMidnightIst.getTime() - istMs;

      if (diffMs <= 0) {
        if (countdownTimer) countdownTimer.textContent = "New facts live! Refresh.";
        return;
      }

      const h = Math.floor(diffMs / (1000 * 60 * 60));
      const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diffMs % (1000 * 60)) / 1000);

      if (countdownTimer) {
        countdownTimer.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }
    }
    tick();
    setInterval(tick, 1000);
  }

  async function init() {
    await checkAuth();

    try {
      const res = await fetch("datasets/facts.json");
      allSets = await res.json();
    } catch (e) {
      console.error("Failed to load facts dataset", e);
      return;
    }

    const today = getTodayKey();
    dailySets = selectDailySets(today);
    if (!dailySets || dailySets.length === 0) return;

    currentRoundIndex = 0;
    currentRoundSet = dailySets[0];

    const saved = loadSavedState();
    if (saved && saved.isRoundSubmitted && saved.roundResults && saved.roundResults.length > 0) {
      // Completed today
      roundResults = saved.roundResults;
      userChoices = saved.userChoices || {};
      isRoundSubmitted = true;
      renderRound(true);
      showFinalSummary();
      return;
    }

    if (saved && saved.userChoices) {
      userChoices = saved.userChoices;
    }

    renderRound(false);

    // Event Delegation for choice clicks
    if (factsListEl) {
      factsListEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".choice-btn");
        if (!btn) return;
        const factId = btn.getAttribute("data-fact-id");
        const choice = btn.getAttribute("data-choice");
        if (factId && choice) {
          handleChoiceClick(factId, choice);
        }
      });
    }

    if (btnSubmit) {
      btnSubmit.addEventListener("click", submitRound);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

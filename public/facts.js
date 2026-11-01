(function () {
  "use strict";

  const TOTAL_ROUNDS = 3;
  let allSets = [];
  let dailySets = [];
  let currentRoundIndex = 0;
  let currentRoundSet = null;
  let userChoices = {}; // factId -> 'real' | 'fake'
  let roundResults = []; // array of results for each completed round
  let isRoundSubmitted = false;
  let currentUser = null;

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
      roundIndex: currentRoundIndex,
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

  function selectDailySets(todayKey) {
    if (!allSets || allSets.length === 0) return [];
    const pool = [...allSets];
    const picked = [];

    for (let r = 0; r < TOTAL_ROUNDS; r++) {
      const seed = hashString(`${todayKey}_facts_round_${r}`);
      const idx = seed % pool.length;
      picked.push(pool[idx]);
      pool.splice(idx, 1);
    }

    return picked;
  }

  function updateRoundPills() {
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      const pill = document.getElementById(`step-pill-${i}`);
      if (!pill) continue;
      pill.classList.remove("active", "completed");
      if (i < currentRoundIndex) {
        pill.classList.add("completed");
        pill.innerHTML = `<span>✓ Round ${i + 1}</span>`;
      } else if (i === currentRoundIndex) {
        pill.classList.add("active");
        pill.innerHTML = `<span>Round ${i + 1}</span>`;
      } else {
        pill.innerHTML = `<span>Round ${i + 1}</span>`;
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
      btnSubmit.querySelector("span").textContent = label;
    }
  }

  function renderRound() {
    if (!currentRoundSet) return;

    userChoices = {};
    isRoundSubmitted = false;

    updateRoundPills();
    if (roundBanner) roundBanner.hidden = true;
    if (btnNext) btnNext.style.display = "none";
    if (btnSubmit) {
      btnSubmit.style.display = "inline-flex";
      btnSubmit.disabled = true;
    }

    if (themeTagEl) themeTagEl.textContent = `Round ${currentRoundIndex + 1}`;
    if (themeTitleEl) themeTitleEl.textContent = currentRoundSet.theme || "Cricket Trivia";

    // Shuffle facts deterministically for this round
    const seed = hashString(`${getTodayKey()}_round_${currentRoundIndex}_order`);
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

      card.innerHTML = `
        <div class="fact-card-body">
          <div class="fact-statement">${escapeHtml(f.statement)}</div>
          <div class="fact-actions">
            <button type="button" class="choice-btn choice-real" data-fact-id="${f.id}" data-choice="real" aria-label="Mark statement ${idx + 1} as Real">
              <span>✅ Real</span>
            </button>
            <button type="button" class="choice-btn choice-fake" data-fact-id="${f.id}" data-choice="fake" aria-label="Mark statement ${idx + 1} as Fake">
              <span>❌ Fake</span>
            </button>
          </div>
        </div>
        <div class="fact-explanation-box" id="explain-${f.id}" style="display:none;"></div>
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
      btnReal.classList.remove("active-real");
      btnFake.classList.remove("active-fake");
    } else {
      userChoices[factId] = choice;
      card.classList.remove("selected-real", "selected-fake");
      btnReal.classList.remove("active-real");
      btnFake.classList.remove("active-fake");

      if (choice === "real") {
        card.classList.add("selected-real");
        btnReal.classList.add("active-real");
      } else {
        card.classList.add("selected-fake");
        btnFake.classList.add("active-fake");
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
    btnSubmit.style.display = "none";

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
        btnReal.disabled = true;
        btnFake.disabled = true;

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

    roundResults[currentRoundIndex] = {
      roundIndex: currentRoundIndex,
      theme: currentRoundSet.theme,
      score: correctCount,
      details: roundDetails
    };

    saveState();

    // Show round banner
    if (roundBanner) {
      roundBanner.hidden = false;
      const feedback = correctCount === 6 ? "PERFECT! Flawless intuition!" :
                       correctCount >= 5 ? "GREAT EYE! Exceptional knowledge!" :
                       correctCount >= 4 ? "SOLID EFFORT! Tricky ones in there!" :
                       "DECEIVING! These myths fooled you!";
      roundBannerTitle.textContent = `${correctCount} / 6 CORRECT!`;
      roundBannerDesc.textContent = feedback;
    }

    // Show Next or Finish button
    if (currentRoundIndex < TOTAL_ROUNDS - 1) {
      if (btnNext) {
        btnNext.querySelector("span").textContent = `Continue to Round ${currentRoundIndex + 2} →`;
        btnNext.style.display = "inline-flex";
      }
    } else {
      setTimeout(() => {
        showFinalSummary();
      }, 1500);
    }
  }

  function advanceToNextRound() {
    if (currentRoundIndex < TOTAL_ROUNDS - 1) {
      currentRoundIndex++;
      currentRoundSet = dailySets[currentRoundIndex];
      renderRound();
      window.scrollTo({ top: 0, behavior: "smooth" });
      saveState();
    }
  }

  function showFinalSummary() {
    if (gameView) gameView.style.display = "none";
    if (finishedView) finishedView.style.display = "block";

    let totalScore = 0;
    const maxScore = TOTAL_ROUNDS * 6;
    let gridText = "";

    roundResults.forEach((r, idx) => {
      totalScore += r.score;
      let rowEmojis = "";
      r.details.forEach((d) => {
        rowEmojis += d.isCorrect ? "🟢" : "🔴";
      });
      gridText += `R${idx + 1}: ${rowEmojis} (${r.score}/6)\n`;
    });

    if (finalScoreDisplay) {
      finalScoreDisplay.textContent = `${totalScore} / ${maxScore}`;
    }

    if (finalScoreRating) {
      const pct = (totalScore / maxScore) * 100;
      let title = "Cricket Fan";
      if (pct === 100) title = "🏆 Cricket Trivia Grandmaster (Flawless 18/18!)";
      else if (pct >= 80) title = "🧠 Trivia Mastermind";
      else if (pct >= 60) title = "🏏 Sharp Cricket Connoisseur";
      else title = "📚 Clever Myths Won Today!";
      finalScoreRating.textContent = title;
    }

    if (summaryGridPreview) {
      summaryGridPreview.textContent = gridText.trim();
    }

    const shareText = `Cricketle · Fact or Fiction ⚖️\nDaily Challenge · ${getTodayKey()}\nScore: ${totalScore}/${maxScore}\n\n${gridText.trim()}\nPlay at: https://cricketle.onrender.com/facts.html`;

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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        if (countdownTimer) countdownTimer.textContent = "New puzzles live! Refresh.";
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

    const saved = loadSavedState();
    if (saved && saved.roundResults && saved.roundResults.length === TOTAL_ROUNDS) {
      // Completed all 3 rounds today
      roundResults = saved.roundResults;
      showFinalSummary();
      return;
    }

    if (saved && typeof saved.roundIndex === "number") {
      currentRoundIndex = Math.min(saved.roundIndex, TOTAL_ROUNDS - 1);
      roundResults = saved.roundResults || [];
    } else {
      currentRoundIndex = 0;
      roundResults = [];
    }

    currentRoundSet = dailySets[currentRoundIndex];
    renderRound();

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

    if (btnNext) {
      btnNext.addEventListener("click", advanceToNextRound);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

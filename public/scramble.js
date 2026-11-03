(function () {
  "use strict";

  const MAX_GUESSES = 6;

  // Curated household cricket legends pool (all exist in PLAYERS)
  const SCRAMBLE_POOL = [
    "Virat Kohli", "Rohit Sharma", "MS Dhoni", "Sachin Tendulkar", "Jasprit Bumrah",
    "Ravindra Jadeja", "Ravichandran Ashwin", "Hardik Pandya", "KL Rahul", "Shubman Gill",
    "Yuvraj Singh", "Virender Sehwag", "Rahul Dravid", "Zaheer Khan", "Harbhajan Singh",
    "Mohammed Shami", "Rishabh Pant", "Suryakumar Yadav", "Gautam Gambhir", "Shikhar Dhawan",
    "Kuldeep Yadav", "Yuzvendra Chahal", "Bhuvneshwar Kumar", "Mohammed Siraj", "Ajinkya Rahane",
    "Babar Azam", "Shaheen Afridi", "Shahid Afridi", "Shoaib Akhtar", "Inzamam-ul-Haq",
    "Younis Khan", "Mohammad Rizwan", "Mohammad Amir", "Fakhar Zaman", "Shoaib Malik",
    "Ricky Ponting", "Steve Smith", "David Warner", "Glenn McGrath", "Adam Gilchrist",
    "Pat Cummins", "Mitchell Starc", "Glenn Maxwell", "Travis Head", "Brett Lee",
    "Matthew Hayden", "Mitchell Johnson", "Aaron Finch", "Josh Hazlewood", "Shane Watson",
    "Ben Stokes", "Joe Root", "Jos Buttler", "James Anderson", "Stuart Broad",
    "Kevin Pietersen", "Andrew Flintoff", "Alastair Cook", "Jofra Archer", "Moeen Ali",
    "AB de Villiers", "Jacques Kallis", "Dale Steyn", "Kagiso Rabada", "Quinton de Kock",
    "Faf du Plessis", "Hashim Amla", "Graeme Smith", "Shaun Pollock", "Aiden Markram",
    "Kane Williamson", "Brendon McCullum", "Trent Boult", "Daniel Vettori", "Ross Taylor",
    "Tim Southee", "Martin Guptill", "Rachin Ravindra", "Mitchell Santner", "Devon Conway",
    "Kumar Sangakkara", "Mahela Jayawardene", "Muttiah Muralitharan", "Lasith Malinga",
    "Sanath Jayasuriya", "Chaminda Vaas", "Tillakaratne Dilshan", "Angelo Mathews",
    "Chris Gayle", "Dwayne Bravo", "Andre Russell", "Sunil Narine", "Shai Hope",
    "Shivnarine Chanderpaul", "Kieron Pollard", "Nicholas Pooran", "Jason Holder",
    "Shakib Al Hasan", "Tamim Iqbal", "Mushfiqur Rahim", "Mustafizur Rahman", "Rashid Khan",
    "Mohammad Nabi", "Mujeeb Ur Rahman", "Sikandar Raza", "Paul Stirling"
  ];

  let targetPlayer = null;
  let targetName = "";
  let userGuesses = []; // array of strings
  let isGameOver = false;
  let puzzleStartTime = Date.now();
  let isWon = false;
  let keyStatuses = {}; // letter/'SPACE' -> 'correct' | 'present' | 'absent'

  // Autocomplete State
  let highlightedIndex = -1;
  let currentMatches = [];

  // DOM Elements
  const gameView = document.getElementById("game-view");
  const finishedView = document.getElementById("finished-view");
  const scrambledWrap = document.getElementById("scrambled-tiles-wrap");
  const scramblePatternText = document.getElementById("scramble-pattern-text");
  const boardEl = document.getElementById("wordle-board");
  const guessInput = document.getElementById("guess-input");
  const btnSubmitGuess = document.getElementById("btn-submit-guess");
  const suggestionsEl = document.getElementById("suggestions");
  const clueCountry = document.getElementById("clue-country");
  const clueRole = document.getElementById("clue-role");
  const clueDebut = document.getElementById("clue-debut");
  const kbRow1 = document.getElementById("kb-row-1");
  const kbRow2 = document.getElementById("kb-row-2");
  const kbRow3 = document.getElementById("kb-row-3");
  const kbRow4 = document.getElementById("kb-row-4");
  const gateModal = document.getElementById("member-gate-modal");
  const toastEl = document.getElementById("scramble-toast");

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Finished View Elements
  const summaryTitle = document.getElementById("summary-title");
  const summarySub = document.getElementById("summary-sub");
  const summaryIcon = document.getElementById("summary-icon");
  const playerRevealName = document.getElementById("player-reveal-name");
  const playerRevealMeta = document.getElementById("player-reveal-meta");
  const playerRevealFlag = document.getElementById("player-reveal-flag");
  const summaryGridPreview = document.getElementById("summary-grid-preview");
  const btnShareWhatsapp = document.getElementById("btn-share-whatsapp");
  const btnCopyScore = document.getElementById("btn-copy-score");
  const countdownTimer = document.getElementById("countdown-timer");

  function getTodayKey() {
    const d = new Date();
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
        const topbarAuth = document.getElementById("topbar-auth-btn");
        if (topbarAuth) {
          topbarAuth.classList.add("signed-in");
          topbarAuth.title = `@${d.user.username} (Account)`;
        }
        if (gateModal) gateModal.hidden = true;
        if (guessInput) guessInput.disabled = false;
        if (btnSubmitGuess) btnSubmitGuess.disabled = false;
        return true;
      }
    } catch (e) {}

    if (gateModal) gateModal.hidden = false;
    if (guessInput) guessInput.disabled = true;
    if (btnSubmitGuess) btnSubmitGuess.disabled = true;
    return false;
  }

  function saveState() {
    const today = getTodayKey();
    const state = {
      guesses: userGuesses,
      isGameOver: isGameOver,
      isWon: isWon
    };
    try {
      localStorage.setItem(`cricketle_scramble_${today}`, JSON.stringify(state));
    } catch (e) {}
  }

  function loadSavedState() {
    const today = getTodayKey();
    try {
      const raw = localStorage.getItem(`cricketle_scramble_${today}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function getCountryFlag(code) {
    const flags = {
      IND: "🇮🇳", PAK: "🇵🇰", AUS: "🇦🇺", ENG: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", SA: "🇿🇦",
      NZ: "🇳🇿", SL: "🇱🇰", WI: "🌴", BAN: "🇧🇩", AFG: "🇦🇫",
      ZIM: "🇿🇼", IRE: "🇮🇪"
    };
    return flags[code] || "🏏";
  }

  function findPlayerData(name) {
    if (typeof PLAYERS !== "undefined" && Array.isArray(PLAYERS)) {
      const found = PLAYERS.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (found) return found;
    }
    return { name, country: "IND", role: "Cricket Legend", debut: 2008, matches: 300, runs: 10000, wkts: 50 };
  }

  function initDailyPlayer() {
    const today = getTodayKey();
    const seed = hashString(`${today}_scramble_challenge_v1`);
    const idx = seed % SCRAMBLE_POOL.length;
    const name = SCRAMBLE_POOL[idx];

    targetPlayer = findPlayerData(name);
    targetName = targetPlayer.name.toUpperCase();
    if (window.CricketleInaccuracy) {
      window.CricketleInaccuracy.setTargetProvider(() => targetPlayer ? { name: targetPlayer.name, id: targetPlayer.id } : null);
    }
  }

  /**
   * Render Mystery Cricketer Pattern Card
   * Shows total character slots (letters + space) as blank dashes '_'.
   * Any letter or space correctly guessed in green is revealed in its slot!
   */
  function renderPatternCard() {
    if (!scrambledWrap) return;
    scrambledWrap.innerHTML = "";

    // Identify all characters (letters & space) correctly positioned (Green) in previous guesses
    const solvedPositions = new Array(targetName.length).fill(null);
    userGuesses.forEach(g => {
      const evalResult = evaluateGuess(g);
      evalResult.forEach((item, idx) => {
        if (idx < targetName.length && item && item.status === "correct") {
          solvedPositions[idx] = item.char;
        }
      });
    });

    for (let i = 0; i < targetName.length; i++) {
      const tile = document.createElement("span");
      const solvedChar = solvedPositions[i];
      if (solvedChar !== null) {
        tile.className = "scramble-letter-tile revealed-green";
        if (solvedChar === " ") {
          tile.classList.add("space-tile");
          tile.textContent = "␣";
        } else {
          tile.textContent = solvedChar;
        }
      } else {
        tile.className = "scramble-letter-tile mystery-dash";
        tile.textContent = "_";
      }
      scrambledWrap.appendChild(tile);
    }

    if (scramblePatternText) {
      scramblePatternText.textContent = `Total: ${targetName.length} Characters (Letters & Space)`;
    }
  }

  /**
   * Wordle Character Evaluation Algorithm (with Space Support)
   * Evaluates guess against targetName:
   * Pass 1: exact character & position match -> 'correct' (GREEN)
   * Pass 2: character present elsewhere in target -> 'present' (YELLOW)
   * Otherwise -> 'absent' (RED)
   */
  function evaluateGuess(guessStr) {
    const guess = (guessStr || "").toUpperCase();
    const target = targetName;

    const guessChars = Array.from(guess);
    const targetChars = Array.from(target);

    const result = new Array(guessChars.length);
    const targetCounts = {};

    // Count all characters in target, including space
    for (let i = 0; i < targetChars.length; i++) {
      const ch = targetChars[i];
      targetCounts[ch] = (targetCounts[ch] || 0) + 1;
    }

    // Pass 1: Exact matches (Green)
    for (let i = 0; i < guessChars.length; i++) {
      const g = guessChars[i];
      const t = i < targetChars.length ? targetChars[i] : null;

      if (g === t) {
        result[i] = { char: g, status: "correct" };
        targetCounts[g]--;
      }
    }

    // Pass 2: Present elsewhere (Yellow) & Absent (Red)
    for (let i = 0; i < guessChars.length; i++) {
      if (result[i]) continue;

      const g = guessChars[i];
      if (targetCounts[g] && targetCounts[g] > 0) {
        result[i] = { char: g, status: "present" };
        targetCounts[g]--;
      } else {
        result[i] = { char: g, status: "absent" };
      }
    }

    return result;
  }

  function updateKeyStatuses(evalResult) {
    evalResult.forEach(({ char, status }) => {
      if (!char) return;
      const key = char === " " ? "SPACE" : char;
      const cur = keyStatuses[key];
      if (status === "correct") {
        keyStatuses[key] = "correct";
      } else if (status === "present") {
        if (cur !== "correct") keyStatuses[key] = "present";
      } else if (status === "absent") {
        if (!cur) keyStatuses[key] = "absent";
      }
    });
    renderVirtualKeyboard();
  }

  function renderClues() {
    const count = userGuesses.length;
    const countryName = targetPlayer.country || "International";
    const countryFlag = getCountryFlag(targetPlayer.country);

    if (clueCountry) {
      clueCountry.className = "clue-pill unlocked";
      clueCountry.innerHTML = `<span>${countryFlag} Country: <strong>${countryName}</strong></span>`;
    }

    if (clueRole) {
      if (count >= 2 || isGameOver) {
        clueRole.className = "clue-pill unlocked";
        clueRole.innerHTML = `<span>🏏 Role: <strong>${targetPlayer.role || "Player"}</strong></span>`;
      } else {
        clueRole.className = "clue-pill locked";
        clueRole.innerHTML = "<span>🔒 Role: Unlocks after guess 2</span>";
      }
    }

    if (clueDebut) {
      if (count >= 4 || isGameOver) {
        clueDebut.className = "clue-pill unlocked";
        const status = targetPlayer.active ? "Still active" : "Retired";
        clueDebut.innerHTML = `<span>📅 Debut: <strong>${targetPlayer.debut || "2000"} (${status})</strong></span>`;
      } else {
        clueDebut.className = "clue-pill locked";
        clueDebut.innerHTML = "<span>🔒 Debut: Unlocks after guess 4</span>";
      }
    }
  }

  function renderBoard(typingValue) {
    if (!boardEl) return;
    boardEl.innerHTML = "";

    // 1. Render evaluated guesses
    userGuesses.forEach((guessStr) => {
      const row = document.createElement("div");
      row.className = "wordle-row";
      const evaluated = evaluateGuess(guessStr);

      evaluated.forEach(({ char, status }) => {
        const tile = document.createElement("span");
        tile.className = `wordle-tile ${status}`;
        if (char === " ") {
          tile.classList.add("space-tile");
          tile.textContent = "␣";
        } else {
          tile.textContent = char;
        }
        row.appendChild(tile);
      });

      boardEl.appendChild(row);
    });

    // 2. Render active row (if game still active)
    if (!isGameOver && userGuesses.length < MAX_GUESSES) {
      const row = document.createElement("div");
      row.className = "wordle-row active-row";
      const typed = (typingValue !== undefined ? typingValue : (guessInput ? guessInput.value : "")).toUpperCase();

      const activeLength = Math.max(targetName.length, typed.length);
      for (let i = 0; i < activeLength; i++) {
        const tile = document.createElement("span");
        if (i < typed.length) {
          tile.className = "wordle-tile typing";
          if (typed[i] === " ") {
            tile.classList.add("space-tile");
            tile.textContent = "␣";
          } else {
            tile.textContent = typed[i];
          }
        } else {
          tile.className = "wordle-tile empty";
          tile.textContent = "_";
        }
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
    }

    // 3. Render remaining empty rows
    const usedRows = userGuesses.length + (isGameOver || userGuesses.length >= MAX_GUESSES ? 0 : 1);
    const remaining = MAX_GUESSES - usedRows;
    for (let r = 0; r < remaining; r++) {
      const row = document.createElement("div");
      row.className = "wordle-row";

      for (let i = 0; i < targetName.length; i++) {
        const tile = document.createElement("span");
        tile.className = "wordle-tile empty";
        tile.textContent = "_";
        row.appendChild(tile);
      }

      boardEl.appendChild(row);
    }

    if (btnSubmitGuess) {
      const nextNum = Math.min(userGuesses.length + 1, MAX_GUESSES);
      const span = btnSubmitGuess.querySelector("span");
      if (span) span.textContent = `Guess (${nextNum}/${MAX_GUESSES})`;
      btnSubmitGuess.disabled = isGameOver;
    }
  }

  function renderVirtualKeyboard() {
    const layout = [
      ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
      ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
      ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "⌫"],
      ["SPACE"]
    ];

    [kbRow1, kbRow2, kbRow3, kbRow4].forEach((rowEl, rowIdx) => {
      if (!rowEl) return;
      rowEl.innerHTML = "";

      layout[rowIdx].forEach(key => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "key-btn";
        btn.setAttribute("data-key", key);

        if (key === "ENTER" || key === "⌫") {
          btn.classList.add("key-wide");
        } else if (key === "SPACE") {
          btn.classList.add("key-space");
        }

        const status = keyStatuses[key];
        if (status) {
          btn.classList.add(`key-${status}`);
        }

        btn.textContent = key;
        rowEl.appendChild(btn);
      });
    });
  }

  function handleKeyInput(key) {
    if (isGameOver || !guessInput) return;

    if (key === "ENTER") {
      hideSuggestions();
      submitGuess(guessInput.value);
    } else if (key === "⌫" || key === "BACKSPACE") {
      guessInput.value = guessInput.value.slice(0, -1);
      renderBoard(guessInput.value);
      updateSuggestions(guessInput.value);
    } else if (key === "SPACE") {
      guessInput.value += " ";
      renderBoard(guessInput.value);
      updateSuggestions(guessInput.value);
    } else if (/^[A-Z]$/i.test(key)) {
      guessInput.value += key.toUpperCase();
      renderBoard(guessInput.value);
      updateSuggestions(guessInput.value);
    }
  }

  /* ---------------- Autocomplete Dropdown & Auto-fill ---------------- */

  function hideSuggestions() {
    if (!suggestionsEl) return;
    suggestionsEl.hidden = true;
    suggestionsEl.innerHTML = "";
    highlightedIndex = -1;
    currentMatches = [];
    if (guessInput) guessInput.setAttribute("aria-expanded", "false");
  }

  function updateSuggestions(query) {
    if (!suggestionsEl || !guessInput) return;
    const q = (query || "").trim().toLowerCase();
    if (!q || q.length < 1 || typeof PLAYERS === "undefined" || !Array.isArray(PLAYERS)) {
      hideSuggestions();
      return;
    }

    const startsWith = [];
    const wordStartsWith = [];
    const contains = [];

    for (const p of PLAYERS) {
      const pLower = p.name.toLowerCase();
      if (pLower.startsWith(q)) {
        startsWith.push(p);
      } else {
        const words = pLower.split(" ");
        if (words.some(w => w.startsWith(q))) {
          wordStartsWith.push(p);
        } else if (pLower.includes(q)) {
          contains.push(p);
        }
      }
      if (startsWith.length + wordStartsWith.length + contains.length >= 25) break;
    }

    currentMatches = [...startsWith, ...wordStartsWith, ...contains].slice(0, 6);
    if (currentMatches.length === 0) {
      hideSuggestions();
      return;
    }

    suggestionsEl.innerHTML = "";
    currentMatches.forEach((p, idx) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("data-name", p.name);

      const flag = getCountryFlag(p.country);
      const pName = p.name;
      const matchStart = pName.toLowerCase().indexOf(q);
      let highlightedName = escapeHtml(pName);
      if (matchStart !== -1) {
        const before = escapeHtml(pName.slice(0, matchStart));
        const match = escapeHtml(pName.slice(matchStart, matchStart + q.length));
        const after = escapeHtml(pName.slice(matchStart + q.length));
        highlightedName = `${before}<mark>${match}</mark>${after}`;
      }

      li.innerHTML = `
        <span>${flag} <strong>${highlightedName}</strong> <span class="sub">(${escapeHtml(p.country)})</span></span>
        <span class="sub">${escapeHtml(p.role)}</span>
      `;

      // Use mousedown to prevent input blur before selection
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choosePlayer(p.name);
      });

      suggestionsEl.appendChild(li);
    });

    suggestionsEl.hidden = false;
    highlightedIndex = -1;
    guessInput.setAttribute("aria-expanded", "true");
  }

  function choosePlayer(name) {
    if (!guessInput) return;
    guessInput.value = name;
    hideSuggestions();
    renderBoard(name);
    submitGuess(name);
  }

  function submitGuess(rawGuess) {
    if (isGameOver) return;
    const guess = (rawGuess || "").trim();

    if (guess.length < 2) {
      showToast("Please enter at least 2 characters for your guess!");
      return;
    }

    hideSuggestions();

    userGuesses.push(guess);
    const evalResult = evaluateGuess(guess);
    updateKeyStatuses(evalResult);

    // Check Win
    const cleanGuess = guess.toUpperCase().replace(/[^A-Z]/g, "");
    const cleanTarget = targetName.replace(/[^A-Z]/g, "");

    if (cleanGuess === cleanTarget) {
      isWon = true;
      isGameOver = true;
    } else if (userGuesses.length >= MAX_GUESSES) {
      isWon = false;
      isGameOver = true;
    }

    saveState();
    renderPatternCard();
    renderBoard();
    renderClues();

    if (guessInput) {
      guessInput.value = "";
    }

    if (isGameOver) {
      setTimeout(() => {
        showFinalSummary();
      }, 700);
    }
  }

  function generateEmojiGrid() {
    let grid = "";
    userGuesses.forEach(g => {
      const evaluated = evaluateGuess(g);
      evaluated.forEach(({ status }) => {
        if (status === "correct") grid += "🟩";
        else if (status === "present") grid += "🟨";
        else if (status === "absent") grid += "🟥";
        else grid += "⬜";
      });
      grid += "\n";
    });
    return grid.trim();
  }

  function showFinalSummary() {
    if (finishedView) finishedView.style.display = "block";
    if (guessInput) guessInput.disabled = true;
    if (btnSubmitGuess) btnSubmitGuess.disabled = true;

    const flag = getCountryFlag(targetPlayer.country);
    if (playerRevealFlag) playerRevealFlag.textContent = flag;
    if (playerRevealName) playerRevealName.textContent = targetPlayer.name;
    if (playerRevealMeta) {
      const activeText = targetPlayer.active ? "Active" : "Retired";
      playerRevealMeta.textContent = `${targetPlayer.country || ""} · ${targetPlayer.role || "Cricketer"} · Debut ${targetPlayer.debut || "2000"} (${activeText})`;
    }

    const elapsedMs = Math.max(1000, Date.now() - puzzleStartTime);
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const speedBonus = Math.max(0, 25 - Math.floor(elapsedSec / 15));
    const guessPen = Math.max(0, (userGuesses.length - 1) * 8);
    const revealedCount = userGuesses.length >= 4 ? 3 : (userGuesses.length >= 2 ? 2 : 1);
    const hintPen = Math.max(0, (revealedCount - 1) * 10);
    const calculatedScore = isWon ? Math.max(20, 100 - guessPen - hintPen + speedBonus) : 0;

    fetch("/api/variant/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: "scramble",
        score: calculatedScore,
        status: isWon ? "solved" : "gaveUp",
        durationMs: elapsedMs,
        guesses: userGuesses,
      }),
    }).catch(() => {});

    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: "scramble",
        action: "game_completed",
        details: { won: isWon, score: calculatedScore, guessesCount: userGuesses.length },
        durationMs: elapsedMs,
        score: calculatedScore,
      }),
    }).catch(() => {});

    if (isWon) {
      if (summaryIcon) summaryIcon.textContent = "🏆";
      if (summaryTitle) summaryTitle.textContent = "SCRAMBLE SOLVED!";
      if (summarySub) summarySub.textContent = `Incredible deduction! Solved in ${attemptsCount}/${MAX_GUESSES} attempts.`;
    } else {
      if (summaryIcon) summaryIcon.textContent = "💔";
      if (summaryTitle) summaryTitle.textContent = "OUT OF ATTEMPTS!";
      if (summarySub) summarySub.textContent = "Tough one today! Here is the cricketer you were looking for:";
    }

    const emojiGrid = generateEmojiGrid();
    if (summaryGridPreview) {
      summaryGridPreview.textContent = emojiGrid;
    }

    const outcomeText = isWon ? `Solved in ${attemptsCount}/${MAX_GUESSES}!` : `X/${MAX_GUESSES}`;
    const shareText = `Cricketle · Scramble 🔀\nDaily Challenge · ${getTodayKey()}\n${outcomeText}\n\n${emojiGrid}\n\nCan you unscramble the cricket legend?\nhttps://cricketle.onrender.com/scramble.html`;

    if (btnShareWhatsapp) {
      btnShareWhatsapp.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    }

    if (btnCopyScore) {
      btnCopyScore.onclick = async () => {
        try {
          await navigator.clipboard.writeText(shareText);
          showToast("Result copied to clipboard!");
        } catch (e) {
          showToast("Unable to copy to clipboard.");
        }
      };
    }

    startMidnightCountdown();
    finishedView.scrollIntoView({ behavior: "smooth", block: "start" });
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
        if (countdownTimer) countdownTimer.textContent = "New scramble live! Refresh.";
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
    const isAuthed = await checkAuth();
    if (!isAuthed) return;
    initDailyPlayer();
    renderPatternCard();
    renderVirtualKeyboard();

    const saved = loadSavedState();
    if (saved && Array.isArray(saved.guesses)) {
      userGuesses = saved.guesses;
      isGameOver = Boolean(saved.isGameOver);
      isWon = Boolean(saved.isWon);

      // Replay key statuses
      userGuesses.forEach(g => {
        updateKeyStatuses(evaluateGuess(g));
      });
    }

    renderBoard();
    renderClues();

    if (isGameOver) {
      showFinalSummary();
    }

    // Event Listeners
    if (btnSubmitGuess) {
      btnSubmitGuess.addEventListener("click", () => {
        if (guessInput) submitGuess(guessInput.value);
      });
    }

    if (guessInput) {
      guessInput.addEventListener("input", (e) => {
        renderBoard(e.target.value);
        updateSuggestions(e.target.value);
      });

      guessInput.addEventListener("keydown", (e) => {
        if (suggestionsEl && !suggestionsEl.hidden && currentMatches.length > 0) {
          const items = suggestionsEl.querySelectorAll("li");
          if (e.key === "ArrowDown") {
            e.preventDefault();
            highlightedIndex = (highlightedIndex + 1) % items.length;
            items.forEach((it, i) => it.classList.toggle("highlighted", i === highlightedIndex));
            if (highlightedIndex >= 0 && currentMatches[highlightedIndex]) {
              guessInput.value = currentMatches[highlightedIndex].name;
              renderBoard(guessInput.value);
            }
            return;
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            highlightedIndex = (highlightedIndex - 1 + items.length) % items.length;
            items.forEach((it, i) => it.classList.toggle("highlighted", i === highlightedIndex));
            if (highlightedIndex >= 0 && currentMatches[highlightedIndex]) {
              guessInput.value = currentMatches[highlightedIndex].name;
              renderBoard(guessInput.value);
            }
            return;
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (highlightedIndex >= 0 && currentMatches[highlightedIndex]) {
              choosePlayer(currentMatches[highlightedIndex].name);
            } else {
              const val = guessInput.value.trim();
              hideSuggestions();
              if (val) submitGuess(val);
            }
            return;
          } else if (e.key === "Escape") {
            hideSuggestions();
            return;
          }
        }

        if (e.key === "Enter") {
          e.preventDefault();
          hideSuggestions();
          if (guessInput.value.trim()) submitGuess(guessInput.value.trim());
        }
      });

      guessInput.addEventListener("blur", () => {
        // Small delay so mousedown on suggestion item can trigger
        setTimeout(hideSuggestions, 160);
      });
    }

    // Virtual keyboard click delegation
    const kbContainer = document.getElementById("virtual-keyboard");
    if (kbContainer) {
      kbContainer.addEventListener("click", (e) => {
        const btn = e.target.closest(".key-btn");
        if (!btn) return;
        const key = btn.getAttribute("data-key");
        if (key) handleKeyInput(key);
      });
    }

    // Physical keyboard input listener (when focus is not explicitly in another input)
    document.addEventListener("keydown", (e) => {
      if (document.activeElement === guessInput) return;
      if (isGameOver) return;
      if (e.key === "Enter") {
        handleKeyInput("ENTER");
      } else if (e.key === "Backspace") {
        handleKeyInput("⌫");
      } else if (e.key === " " || e.code === "Space") {
        handleKeyInput("SPACE");
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        handleKeyInput(e.key.toUpperCase());
      }
    });

    // Close suggestions on outside click
    document.addEventListener("click", (e) => {
      if (suggestionsEl && !e.target.closest(".guess-box")) {
        hideSuggestions();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

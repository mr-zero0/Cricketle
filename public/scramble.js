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
  let targetWords = [];
  let scrambledLetters = [];
  let userGuesses = []; // array of strings
  let isGameOver = false;
  let isWon = false;
  let keyStatuses = {}; // letter -> 'correct' | 'present' | 'absent'

  // DOM Elements
  const gameView = document.getElementById("game-view");
  const finishedView = document.getElementById("finished-view");
  const scrambledWrap = document.getElementById("scrambled-tiles-wrap");
  const scramblePatternText = document.getElementById("scramble-pattern-text");
  const btnReshuffle = document.getElementById("btn-reshuffle");
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
  const gateModal = document.getElementById("member-gate-modal");
  const toastEl = document.getElementById("scramble-toast");

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

  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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

  function scrambleWord(word, rng) {
    const letters = word.toUpperCase().split("");
    if (letters.length <= 1) return letters;

    let shuffled = [...letters];
    let attempts = 0;
    while (attempts < 20) {
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      if (shuffled.join("") !== word.toUpperCase()) break;
      attempts++;
    }
    return shuffled;
  }

  function initDailyPlayer() {
    const today = getTodayKey();
    const seed = hashString(`${today}_scramble_challenge_v1`);
    const idx = seed % SCRAMBLE_POOL.length;
    const name = SCRAMBLE_POOL[idx];

    targetPlayer = findPlayerData(name);
    targetName = targetPlayer.name.toUpperCase();
    targetWords = targetName.split(" ");

    // Scramble letters per word
    const rng = mulberry32(seed + 99);
    scrambledLetters = targetWords.map(w => scrambleWord(w, rng));
  }

  function renderScrambledCard() {
    if (!scrambledWrap) return;
    scrambledWrap.innerHTML = "";

    scrambledLetters.forEach((wordLetters) => {
      const group = document.createElement("div");
      group.className = "scramble-word-group";

      wordLetters.forEach(ch => {
        const tile = document.createElement("span");
        tile.className = "scramble-letter-tile";
        tile.textContent = ch;
        group.appendChild(tile);
      });

      scrambledWrap.appendChild(group);
    });

    if (scramblePatternText) {
      const patternDesc = targetWords.map(w => `${w.length} Letters`).join(" + ");
      scramblePatternText.textContent = `Word pattern: ${patternDesc} (${targetName.replace(/ /g, "").length} letters total)`;
    }
  }

  function reshuffleTiles() {
    const rng = mulberry32(Date.now());
    scrambledLetters = targetWords.map(w => scrambleWord(w, rng));
    renderScrambledCard();
  }

  /**
   * Wordle Letter Evaluation Algorithm
   * Evaluates guess against targetName:
   * Pass 1: exact letter & position match -> 'correct' (GREEN)
   * Pass 2: letter present elsewhere in target -> 'present' (YELLOW)
   * Otherwise -> 'absent' (RED)
   */
  function evaluateGuess(guessStr) {
    const guess = guessStr.toUpperCase().trim();
    const target = targetName;

    const guessChars = Array.from(guess);
    const targetChars = Array.from(target);

    const result = new Array(guessChars.length);
    const targetCounts = {};

    for (let i = 0; i < targetChars.length; i++) {
      const ch = targetChars[i];
      if (ch !== " ") {
        targetCounts[ch] = (targetCounts[ch] || 0) + 1;
      }
    }

    // Pass 1: Exact matches (Green) & spaces
    for (let i = 0; i < guessChars.length; i++) {
      const g = guessChars[i];
      const t = i < targetChars.length ? targetChars[i] : null;

      if (g === " ") {
        result[i] = { char: " ", status: "space" };
      } else if (t === g) {
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
      if (!char || status === "space") return;
      const cur = keyStatuses[char];
      if (status === "correct") {
        keyStatuses[char] = "correct";
      } else if (status === "present") {
        if (cur !== "correct") keyStatuses[char] = "present";
      } else if (status === "absent") {
        if (!cur) keyStatuses[char] = "absent";
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

  function renderBoard() {
    if (!boardEl) return;
    boardEl.innerHTML = "";

    // Render evaluated guesses
    userGuesses.forEach((guessStr) => {
      const row = document.createElement("div");
      row.className = "wordle-row";
      const evaluated = evaluateGuess(guessStr);

      evaluated.forEach(({ char, status }) => {
        const tile = document.createElement("span");
        if (status === "space") {
          tile.className = "wordle-tile space-sep";
          tile.innerHTML = "•";
        } else {
          tile.className = `wordle-tile ${status}`;
          tile.textContent = char;
        }
        row.appendChild(tile);
      });

      boardEl.appendChild(row);
    });

    // Render remaining empty rows
    const remaining = MAX_GUESSES - userGuesses.length;
    for (let r = 0; r < remaining; r++) {
      const row = document.createElement("div");
      row.className = "wordle-row";

      // Render slots matching target length
      for (let i = 0; i < targetName.length; i++) {
        const tile = document.createElement("span");
        if (targetName[i] === " ") {
          tile.className = "wordle-tile space-sep";
          tile.innerHTML = "•";
        } else {
          tile.className = "wordle-tile empty";
          tile.textContent = "";
        }
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
      ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "⌫"]
    ];

    [kbRow1, kbRow2, kbRow3].forEach((rowEl, rowIdx) => {
      if (!rowEl) return;
      rowEl.innerHTML = "";

      layout[rowIdx].forEach(key => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "key-btn";
        btn.setAttribute("data-key", key);

        if (key === "ENTER" || key === "⌫") {
          btn.classList.add("key-wide");
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
      submitGuess(guessInput.value);
    } else if (key === "⌫" || key === "BACKSPACE") {
      guessInput.value = guessInput.value.slice(0, -1);
      updateSuggestions(guessInput.value);
    } else if (/^[A-Z ]$/i.test(key)) {
      guessInput.value += key.toUpperCase();
      updateSuggestions(guessInput.value);
    }
  }

  function updateSuggestions(query) {
    if (!suggestionsEl) return;
    const q = (query || "").trim().toLowerCase();
    if (q.length < 2 || typeof PLAYERS === "undefined" || !Array.isArray(PLAYERS)) {
      suggestionsEl.hidden = true;
      suggestionsEl.innerHTML = "";
      return;
    }

    const matches = PLAYERS.filter(p => p.name.toLowerCase().includes(q)).slice(0, 5);
    if (matches.length === 0) {
      suggestionsEl.hidden = true;
      suggestionsEl.innerHTML = "";
      return;
    }

    suggestionsEl.innerHTML = "";
    matches.forEach(p => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.innerHTML = `
        <span><strong>${p.name}</strong> <span class="sub">(${p.country})</span></span>
        <span class="sub">${p.role}</span>
      `;
      li.addEventListener("click", () => {
        guessInput.value = p.name;
        suggestionsEl.hidden = true;
        submitGuess(p.name);
      });
      suggestionsEl.appendChild(li);
    });
    suggestionsEl.hidden = false;
  }

  function submitGuess(rawGuess) {
    if (isGameOver) return;
    const guess = (rawGuess || "").trim();

    if (guess.length < 2) {
      showToast("Please enter at least 2 letters for your guess!");
      return;
    }

    if (suggestionsEl) suggestionsEl.hidden = true;

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
        else if (status === "space") grid += " ";
      });
      grid += "\n";
    });
    return grid.trim();
  }

  function showFinalSummary() {
    if (finishedView) finishedView.style.display = "block";
    if (guessInput) guessInput.disabled = true;
    if (btnSubmitGuess) btnSubmitGuess.disabled = true;

    const attemptsCount = userGuesses.length;
    const flag = getCountryFlag(targetPlayer.country);

    if (playerRevealFlag) playerRevealFlag.textContent = flag;
    if (playerRevealName) playerRevealName.textContent = targetPlayer.name;
    if (playerRevealMeta) {
      const activeText = targetPlayer.active ? "Active" : "Retired";
      playerRevealMeta.textContent = `${targetPlayer.country || ""} · ${targetPlayer.role || "Cricketer"} · Debut ${targetPlayer.debut || "2000"} (${activeText})`;
    }

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
    renderScrambledCard();
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
    if (btnReshuffle) {
      btnReshuffle.addEventListener("click", reshuffleTiles);
    }

    if (btnSubmitGuess) {
      btnSubmitGuess.addEventListener("click", () => {
        if (guessInput) submitGuess(guessInput.value);
      });
    }

    if (guessInput) {
      guessInput.addEventListener("input", (e) => {
        updateSuggestions(e.target.value);
      });

      guessInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitGuess(guessInput.value);
        }
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
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        handleKeyInput(e.key.toUpperCase());
      }
    });

    // Close suggestions on outside click
    document.addEventListener("click", (e) => {
      if (suggestionsEl && !e.target.closest(".guess-box")) {
        suggestionsEl.hidden = true;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

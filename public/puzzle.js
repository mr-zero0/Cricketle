(function () {
  "use strict";

  // Puzzle progression: number of pieces correctly placed at each step (0 to 6)
  // 4x4 grid = 16 pieces total.
  // Step 0 (start): 2 pieces in place (14 scrambled)
  // Step 1: 5 pieces in place
  // Step 2: 8 pieces in place
  // Step 3: 10 pieces in place
  // Step 4: 12 pieces in place
  // Step 5: 14 pieces in place
  // Step 6 (Victory / Finished): All 16 pieces in place!
  const STEPS = [2, 5, 8, 10, 12, 14, 16];
  const MAX_ATTEMPTS = 6;
  const GRID_COLS = 4;
  const GRID_ROWS = 4;
  const TOTAL_TILES = GRID_COLS * GRID_ROWS;

  let allPlayers = [];
  let currentTarget = null;
  let currentAttempts = [];
  let currentMode = "easy";
  let loadedImage = null;
  let isGameOver = false;
  let currentPhotoUrl = "";

  const canvas = document.getElementById("puzzle-canvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const input = document.getElementById("guess-input");
  const guessBtn = document.getElementById("btn-guess");
  const skipBtn = document.getElementById("btn-skip");
  const suggestions = document.getElementById("suggestions");
  const historyList = document.getElementById("guess-history");
  const track = document.getElementById("attempts-track");
  const resultCard = document.getElementById("result-card");
  const resultStatus = document.getElementById("result-status");
  const resultName = document.getElementById("result-name");
  const resultHint = document.getElementById("result-hint");
  const guessControls = document.getElementById("guess-controls");
  const progressText = document.getElementById("puzzle-progress-text");
  const progressPercent = document.getElementById("puzzle-progress-percent");
  const progressBar = document.getElementById("puzzle-progress-bar");

  let highlighted = -1;
  let currentMatches = [];
  let blurTimer = null;

  // Format today's date key: YYYY-MM-DD
  function getTodayKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  // String hash for deterministic daily seed
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // Mulberry32 deterministic 32-bit PRNG
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Generate a non-repeating cycle permutation of length N for cycle number `cycle`
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

  // Deterministic order of tile resolution for today's player
  function getTileOrder(todayKey, playerId) {
    const seed = hashString(todayKey + "_" + playerId + "_puzzle_order");
    const rng = mulberry32(seed);
    const order = Array.from({ length: TOTAL_TILES }, (_, i) => i);
    for (let i = TOTAL_TILES - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  // Calculate board arrangement: which tiles are placed correctly and which are scrambled
  function getBoardSlots(order, count, seed) {
    const board = new Array(TOTAL_TILES);
    const placed = new Set(order.slice(0, count));

    // Placed tiles are in their true slots
    for (const t of placed) {
      board[t] = t;
    }

    // Unplaced slots
    const unplacedSlots = order.slice(count);
    if (unplacedSlots.length === 1) {
      board[unplacedSlots[0]] = unplacedSlots[0];
    } else if (unplacedSlots.length > 1) {
      const subRng = mulberry32(seed + count * 7919);
      let shuffled = [...unplacedSlots];
      let attempts = 0;
      let valid = false;
      while (!valid && attempts < 30) {
        attempts++;
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(subRng() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        valid = shuffled.every((tile, i) => tile !== unplacedSlots[i]);
      }
      if (!valid) {
        // Deterministic cyclic shift if derangement loop exhausted
        shuffled = [...unplacedSlots.slice(1), unplacedSlots[0]];
      }
      for (let i = 0; i < unplacedSlots.length; i++) {
        board[unplacedSlots[i]] = shuffled[i];
      }
    }

    return { board, placed };
  }

  // Render jigsaw puzzle canvas
  function renderPuzzle() {
    if (!ctx || !loadedImage || !currentTarget) return;

    const w = canvas.width;
    const h = canvas.height;

    // Headshot-focused center crop
    const imgRatio = loadedImage.width / loadedImage.height;
    const canvasRatio = w / h;
    let sx = 0, sy = 0, sw = loadedImage.width, sh = loadedImage.height;

    if (imgRatio > canvasRatio) {
      sw = loadedImage.height * canvasRatio;
      sx = (loadedImage.width - sw) / 2;
    } else {
      sh = loadedImage.width / canvasRatio;
      sy = 0; // Preserve hair and top of head
    }

    ctx.clearRect(0, 0, w, h);

    const today = getTodayKey();
    const order = getTileOrder(today, currentTarget.id);
    const stepIndex = isGameOver ? STEPS.length - 1 : Math.min(currentAttempts.length, STEPS.length - 2);
    const count = STEPS[stepIndex];
    const seed = hashString(today + "_" + currentTarget.id + "_jigsaw_board");
    const { board, placed } = getBoardSlots(order, count, seed);

    const tileW = w / GRID_COLS;
    const tileH = h / GRID_ROWS;
    const srcTileW = sw / GRID_COLS;
    const srcTileH = sh / GRID_ROWS;

    // 1. Draw each tile into its slot
    for (let slot = 0; slot < TOTAL_TILES; slot++) {
      const tileId = board[slot];

      // Destination coordinates on canvas
      const destCol = slot % GRID_COLS;
      const destRow = Math.floor(slot / GRID_COLS);
      const dx = destCol * tileW;
      const dy = destRow * tileH;

      // Source coordinates from original headshot
      const srcCol = tileId % GRID_COLS;
      const srcRow = Math.floor(tileId / GRID_COLS);
      const tileSx = sx + srcCol * srcTileW;
      const tileSy = sy + srcRow * srcTileH;

      ctx.drawImage(
        loadedImage,
        tileSx,
        tileSy,
        srcTileW,
        srcTileH,
        dx,
        dy,
        tileW,
        tileH
      );
    }

    // 2. If game is active, draw puzzle overlays and grid borders
    if (!isGameOver) {
      for (let slot = 0; slot < TOTAL_TILES; slot++) {
        const tileId = board[slot];
        const isSolved = placed.has(tileId);

        const destCol = slot % GRID_COLS;
        const destRow = Math.floor(slot / GRID_COLS);
        const dx = destCol * tileW;
        const dy = destRow * tileH;

        if (isSolved) {
          // Solved tile: subtle green/gold border and clean checkmark badge
          ctx.strokeStyle = "rgba(34, 197, 94, 0.7)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(dx + 0.75, dy + 0.75, tileW - 1.5, tileH - 1.5);

          // Subtle lock/check badge in corner
          ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
          ctx.beginPath();
          ctx.arc(dx + 12, dy + 12, 8, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#22c55e";
          ctx.font = "bold 9px 'Source Sans 3', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✓", dx + 12, dy + 12);
        } else {
          // Scrambled tile: subtle dashed amber border and tile identifier
          ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(dx + 0.75, dy + 0.75, tileW - 1.5, tileH - 1.5);
          ctx.setLineDash([]);

          // Tile badge
          ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
          ctx.beginPath();
          ctx.arc(dx + 13, dy + 13, 9, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#f59e0b";
          ctx.font = "bold 9px 'Source Sans 3', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(tileId + 1), dx + 13, dy + 13);
        }
      }
    }

    // 3. Update Progress Bar
    const actualSolved = isGameOver ? TOTAL_TILES : count;
    const percent = Math.round((actualSolved / TOTAL_TILES) * 100);
    if (progressText) {
      progressText.textContent = `🧩 ${actualSolved} of ${TOTAL_TILES} pieces in place`;
    }
    if (progressPercent) {
      progressPercent.textContent = `${percent}%`;
    }
    if (progressBar) {
      progressBar.style.width = `${percent}%`;
    }
  }

  // Update dots indicator
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

  // Load target for current mode and date
  async function loadPuzzle() {
    try {
      const res = await fetch("datasets/pixel-players.json");
      const list = await res.json();
      allPlayers = list;

      const pool = list.filter((p) => p.difficulty === currentMode);
      const activePool = pool.length ? pool : list;

      const today = getTodayKey();
      const targetIndex = getSpacedDailyIndex(today, activePool.length, "puzzle_" + currentMode);
      currentTarget = activePool[targetIndex];

      // Select variant deterministically
      const variants = Array.isArray(currentTarget.images) && currentTarget.images.length > 0
        ? currentTarget.images
        : [currentTarget.imageUrl];
      const variantSeed = hashString(today + "_" + currentTarget.id + "_puzzle_var");
      currentPhotoUrl = variants[variantSeed % variants.length];

      // Restore saved progress for today if any
      const saved = localStorage.getItem(`cricketle_puzzle_${today}_${currentMode}`);
      if (saved) {
        const data = JSON.parse(saved);
        currentAttempts = data.attempts || [];
        isGameOver = data.isGameOver || false;
        if (data.photoUrl) currentPhotoUrl = data.photoUrl;
      } else {
        currentAttempts = [];
        isGameOver = false;
      }

      loadImage(currentPhotoUrl);
      renderHistory();
      updateTrack();

      if (isGameOver) {
        finishGame(currentAttempts.some((a) => a.isCorrect));
      }
    } catch (err) {
      console.error("Failed to load puzzle:", err);
    }
  }

  function loadImage(url) {
    const img = new Image();
    img.onload = () => {
      loadedImage = img;
      renderPuzzle();
    };
    img.onerror = (err) => {
      console.error("Failed to load image at:", url, err);
      if (!ctx) return;
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 20px 'Source Sans 3', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Puzzle Preview", canvas.width / 2, canvas.height / 2);
    };
    img.src = url;
  }

  function renderHistory() {
    if (!historyList) return;
    historyList.innerHTML = "";
    currentAttempts.forEach((a) => {
      const el = document.createElement("div");
      el.className = `guess-item ${a.isCorrect ? "correct" : a.skipped ? "skipped" : ""}`;
      el.innerHTML = `
        <span>${a.skipped ? "<em>Skipped</em>" : escapeHtml(a.name)}</span>
        <span style="font-weight:700;">${a.isCorrect ? "✅ Correct" : a.skipped ? "⏭️ Skipped" : "❌ Incorrect"}</span>
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

    // 1. Extra legends fallback
    EXTRA_LEGENDS.forEach((p) => {
      map.set(p.name.toLowerCase(), p);
    });

    // 2. Add all players from datasets/pixel-players.json
    if (Array.isArray(allPlayers)) {
      allPlayers.forEach((p) => {
        map.set(p.name.toLowerCase(), { name: p.name, country: p.country, role: p.role });
      });
    }

    // 3. Add full 425-player list from players.js
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
    if (isGameOver || !currentTarget) return;

    let clean = name.trim();
    if (!clean && !skipped) return;

    if (!skipped) {
      const guessLower = clean.toLowerCase();
      // Smart resolution: typing partial name like "lara" resolves to full name
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

    // Save state
    const today = getTodayKey();
    const won = isCorrect;
    const lost = !won && currentAttempts.length >= MAX_ATTEMPTS;

    if (won || lost) {
      isGameOver = true;
      finishGame(won);
    } else {
      renderPuzzle();
    }

    localStorage.setItem(
      `cricketle_puzzle_${today}_${currentMode}`,
      JSON.stringify({ attempts: currentAttempts, isGameOver, photoUrl: currentPhotoUrl })
    );

    renderHistory();
    updateTrack();
    if (input) input.value = "";
    hideSuggestions();
  }

  function finishGame(won) {
    renderPuzzle();

    if (guessControls) guessControls.style.display = "none";
    if (resultCard) {
      resultCard.style.display = "block";
      resultCard.className = `result-card ${won ? "won" : "lost"}`;
      if (resultStatus) {
        resultStatus.textContent = won ? "VICTORY! 🎉" : "OUT! 💔";
        resultStatus.style.color = won ? "#16a34a" : "var(--danger)";
      }
      if (resultName) {
        resultName.textContent = currentTarget.name + ` (${currentTarget.country})`;
      }
      if (resultHint) {
        resultHint.textContent = currentTarget.hint;
      }
    }
  }

  // ---------- Autocomplete ----------

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

  // Event listeners
  guessBtn?.addEventListener("click", () => {
    selectCurrent();
  });

  skipBtn?.addEventListener("click", () => {
    makeGuess("Skip", true);
  });

  // Mode toggles
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

  // Initialize
  setupAutocomplete();
  loadPuzzle();
})();


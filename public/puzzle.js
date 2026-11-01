(function () {
  "use strict";

  // 3x3 Grid = 9 interactive rearrangeable puzzle pieces
  const GRID_COLS = 3;
  const GRID_ROWS = 3;
  const TOTAL_TILES = GRID_COLS * GRID_ROWS;
  const MAX_ATTEMPTS = 3;

  let allPlayers = [];
  let currentTarget = null;
  let currentAttempts = [];
  let currentMode = "easy";
  let loadedImage = null;
  let isGameOver = false;
  let currentPhotoUrl = "";
  let initialScramble = [];
  let board = [];
  let selectedSlot = -1;
  let dragStartSlot = -1;

  const canvas = document.getElementById("puzzle-canvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const input = document.getElementById("guess-input");
  const guessBtn = document.getElementById("btn-guess");
  const resetBtn = document.getElementById("btn-reset-scramble");
  const suggestions = document.getElementById("suggestions");
  const historyList = document.getElementById("guess-history");
  const track = document.getElementById("attempts-track");
  const attemptsLabel = document.getElementById("attempts-label");
  const resultCard = document.getElementById("result-card");
  const resultStatus = document.getElementById("result-status");
  const resultName = document.getElementById("result-name");
  const resultRole = document.getElementById("result-role");
  const resultScore = document.getElementById("result-score");
  const guessControls = document.getElementById("guess-controls");
  const progressText = document.getElementById("puzzle-progress-text");
  const progressPercent = document.getElementById("puzzle-progress-percent");
  const progressBar = document.getElementById("puzzle-progress-bar");
  const assembledBanner = document.getElementById("puzzle-assembled-banner");

  let highlighted = -1;
  let currentMatches = [];
  let blurTimer = null;

  // Format today's date key: YYYY-MM-DD
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

  function getSpacedDailyIndex(todayKey, poolLength, modeSalt) {
    if (poolLength <= 1) return 0;
    const [y, m, d] = todayKey.split("-").map(Number);
    const dayNumber = y * 365 + m * 31 + d;
    const cycle = Math.floor(dayNumber / poolLength);
    const dayInCycle = dayNumber % poolLength;
    const arr = Array.from({ length: poolLength }, (_, i) => i);
    const rng = mulberry32(hashString(modeSalt + "_cycle_" + cycle));
    for (let i = poolLength - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr[dayInCycle];
  }

  // Generate a non-trivial scramble (at least 7 of 9 tiles displaced)
  function generateScramble(seedStr) {
    const rng = mulberry32(hashString(seedStr));
    let perm = Array.from({ length: TOTAL_TILES }, (_, i) => i);
    let attempts = 0;
    let valid = false;

    while (!valid && attempts < 50) {
      attempts++;
      for (let i = TOTAL_TILES - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      let displaced = 0;
      for (let i = 0; i < TOTAL_TILES; i++) {
        if (perm[i] !== i) displaced++;
      }
      if (displaced >= 7) valid = true;
    }
    return perm;
  }

  function saveProgress() {
    if (!currentTarget) return;
    const today = getTodayKey();
    const data = {
      attempts: currentAttempts,
      isGameOver: isGameOver,
      board: board,
      initialScramble: initialScramble,
      photoUrl: currentPhotoUrl
    };
    try {
      localStorage.setItem(`cricketle_puzzle_${today}_${currentMode}`, JSON.stringify(data));
    } catch (e) {
      // LocalStorage errors ignored
    }
  }

  function renderBoard() {
    if (!ctx || !loadedImage) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const imgW = loadedImage.naturalWidth || loadedImage.width;
    const imgH = loadedImage.naturalHeight || loadedImage.height;

    // Center-crop to 280:340 portrait aspect ratio
    const targetAspect = w / h;
    const imgAspect = imgW / imgH;
    let sx = 0, sy = 0, sw = imgW, sh = imgH;
    if (imgAspect > targetAspect) {
      sw = imgH * targetAspect;
      sx = (imgW - sw) / 2;
    } else {
      sh = imgW / targetAspect;
      sy = (imgH - sh) / 2;
    }

    const tileW = w / GRID_COLS;
    const tileH = h / GRID_ROWS;
    const srcTileW = sw / GRID_COLS;
    const srcTileH = sh / GRID_ROWS;

    // 1. Draw each tile
    for (let slot = 0; slot < TOTAL_TILES; slot++) {
      // If game over, show solved order (0..8), else current board permutation
      const tileId = isGameOver ? slot : board[slot];

      const destCol = slot % GRID_COLS;
      const destRow = Math.floor(slot / GRID_COLS);
      const dx = destCol * tileW;
      const dy = destRow * tileH;

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

    // 2. Draw borders & overlays if game active
    let correctCount = 0;
    if (!isGameOver) {
      for (let slot = 0; slot < TOTAL_TILES; slot++) {
        const tileId = board[slot];
        const isSolved = (tileId === slot);
        if (isSolved) correctCount++;

        const destCol = slot % GRID_COLS;
        const destRow = Math.floor(slot / GRID_COLS);
        const dx = destCol * tileW;
        const dy = destRow * tileH;

        if (slot === selectedSlot) {
          // Selected tile: Bright glowing gold border + translucent amber wash
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 3;
          ctx.strokeRect(dx + 1.5, dy + 1.5, tileW - 3, tileH - 3);

          ctx.fillStyle = "rgba(245, 158, 11, 0.28)";
          ctx.fillRect(dx + 1.5, dy + 1.5, tileW - 3, tileH - 3);

          // Glowing badge
          ctx.fillStyle = "#f59e0b";
          ctx.beginPath();
          ctx.arc(dx + 15, dy + 15, 10, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#000000";
          ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("★", dx + 15, dy + 15);
        } else if (isSolved) {
          // Correctly placed: Clean subtle green border + checkmark
          ctx.strokeStyle = "rgba(34, 197, 94, 0.85)";
          ctx.lineWidth = 1.8;
          ctx.strokeRect(dx + 1, dy + 1, tileW - 2, tileH - 2);

          // Checkmark badge in corner
          ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
          ctx.beginPath();
          ctx.arc(dx + 14, dy + 14, 9, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#22c55e";
          ctx.font = "bold 10px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✓", dx + 14, dy + 14);
        } else {
          // Scrambled tile: Subtle dashed border + tile number
          ctx.strokeStyle = "rgba(245, 158, 11, 0.35)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(dx + 0.5, dy + 0.5, tileW - 1, tileH - 1);
          ctx.setLineDash([]);

          // Tile number badge
          ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
          ctx.beginPath();
          ctx.arc(dx + 14, dy + 14, 9, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "rgba(245, 158, 11, 0.9)";
          ctx.font = "bold 10px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(tileId + 1), dx + 14, dy + 14);
        }
      }
    } else {
      correctCount = TOTAL_TILES;
    }

    // 3. Update Progress Bar
    const percent = Math.round((correctCount / TOTAL_TILES) * 100);
    if (progressText) {
      progressText.textContent = `🧩 ${correctCount} of ${TOTAL_TILES} pieces in place`;
    }
    if (progressPercent) {
      progressPercent.textContent = `${percent}%`;
    }
    if (progressBar) {
      progressBar.style.width = `${percent}%`;
    }

    // 4. Update Assembled Banner
    if (assembledBanner) {
      if (!isGameOver && correctCount === TOTAL_TILES) {
        assembledBanner.style.display = "block";
      } else {
        assembledBanner.style.display = "none";
      }
    }
  }

  function getSlotFromCoords(clientX, clientY) {
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return -1;

    const col = Math.floor(x / (canvas.width / GRID_COLS));
    const row = Math.floor(y / (canvas.height / GRID_ROWS));
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return -1;
    return row * GRID_COLS + col;
  }

  function handleTileTap(slot) {
    if (isGameOver || slot < 0 || slot >= TOTAL_TILES) return;

    if (selectedSlot === -1) {
      selectedSlot = slot;
      renderBoard();
    } else if (selectedSlot === slot) {
      selectedSlot = -1;
      renderBoard();
    } else {
      const temp = board[selectedSlot];
      board[selectedSlot] = board[slot];
      board[slot] = temp;
      selectedSlot = -1;
      saveProgress();
      renderBoard();
    }
  }

  // Pointer events for drag and tap
  if (canvas) {
    canvas.addEventListener("pointerdown", (e) => {
      if (isGameOver) return;
      dragStartSlot = getSlotFromCoords(e.clientX, e.clientY);
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });

    canvas.addEventListener("pointerup", (e) => {
      if (isGameOver) return;
      const endSlot = getSlotFromCoords(e.clientX, e.clientY);
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}

      if (dragStartSlot !== -1 && endSlot !== -1 && dragStartSlot !== endSlot) {
        // Drag-swapped between two different slots!
        const temp = board[dragStartSlot];
        board[dragStartSlot] = board[endSlot];
        board[endSlot] = temp;
        selectedSlot = -1;
        dragStartSlot = -1;
        saveProgress();
        renderBoard();
      } else if (dragStartSlot !== -1 && dragStartSlot === endSlot) {
        // Single tap on a slot
        handleTileTap(dragStartSlot);
        dragStartSlot = -1;
      } else {
        dragStartSlot = -1;
      }
    });

    canvas.addEventListener("pointercancel", () => {
      dragStartSlot = -1;
    });
  }

  // Reset Scramble Button
  resetBtn?.addEventListener("click", () => {
    if (isGameOver || initialScramble.length !== TOTAL_TILES) return;
    board = [...initialScramble];
    selectedSlot = -1;
    saveProgress();
    renderBoard();
  });

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

    if (attemptsLabel) {
      const remaining = Math.max(0, MAX_ATTEMPTS - currentAttempts.length);
      if (isGameOver) {
        attemptsLabel.textContent = currentAttempts.some((a) => a.isCorrect)
          ? `Solved in ${currentAttempts.length} of ${MAX_ATTEMPTS} guesses!`
          : "All 3 attempts used";
      } else {
        attemptsLabel.textContent = `${remaining} guess${remaining === 1 ? "" : "es"} remaining`;
      }
    }
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
      const targetIndex = getSpacedDailyIndex(today, activePool.length, "portrait_puzzle_" + currentMode);
      currentTarget = activePool[targetIndex];

      const variants = Array.isArray(currentTarget.images) && currentTarget.images.length > 0
        ? currentTarget.images
        : [currentTarget.imageUrl];
      const variantSeed = hashString(today + "_" + currentTarget.id + "_jigsaw_variant");
      currentPhotoUrl = variants[variantSeed % variants.length];

      // Daily scramble seed
      const scrambleSeed = today + "_" + currentTarget.id + "_puzzle_scramble";
      initialScramble = generateScramble(scrambleSeed);

      // Restore saved progress if any
      const saved = localStorage.getItem(`cricketle_puzzle_${today}_${currentMode}`);
      if (saved) {
        const data = JSON.parse(saved);
        currentAttempts = data.attempts || [];
        isGameOver = data.isGameOver || false;
        if (Array.isArray(data.board) && data.board.length === TOTAL_TILES) {
          board = data.board;
        } else {
          board = [...initialScramble];
        }
        if (data.photoUrl) currentPhotoUrl = data.photoUrl;
      } else {
        currentAttempts = [];
        isGameOver = false;
        board = [...initialScramble];
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
      renderBoard();
    };
    img.onerror = (err) => {
      console.error("Failed to load image at:", url, err);
      if (!ctx) return;
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Photo Preview", canvas.width / 2, canvas.height / 2);
    };
    img.src = url;
  }

  function renderHistory() {
    if (!historyList) return;
    historyList.innerHTML = "";
    currentAttempts.forEach((a) => {
      const el = document.createElement("div");
      el.className = `guess-item ${a.isCorrect ? "correct" : ""}`;
      el.innerHTML = `
        <span>${escapeHtml(a.name)}</span>
        <span style="font-weight:700;">${a.isCorrect ? "✅ Correct" : "❌ Incorrect"}</span>
      `;
      historyList.appendChild(el);
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function finishGame(won) {
    isGameOver = true;
    selectedSlot = -1;

    // Reveal all pieces in solved order
    for (let i = 0; i < TOTAL_TILES; i++) board[i] = i;
    renderBoard();
    updateTrack();

    if (guessControls) guessControls.style.display = "none";
    if (resetBtn) resetBtn.style.display = "none";

    if (resultCard) {
      resultCard.style.display = "block";
      resultCard.className = `result-card ${won ? "won" : "lost"}`;
    }
    if (resultStatus) {
      resultStatus.textContent = won ? "HOWZAT! SOLVED!" : "OUT!";
    }
    if (resultName && currentTarget) {
      resultName.textContent = currentTarget.name;
    }
    if (resultRole && currentTarget) {
      resultRole.textContent = `${currentTarget.country} • ${currentTarget.role}`;
    }
    if (resultScore) {
      resultScore.textContent = won
        ? `Solved in ${currentAttempts.length} of ${MAX_ATTEMPTS} guesses!`
        : `The cricketer was ${currentTarget ? currentTarget.name : ""}`;
    }

    saveProgress();
  }

  // Combined Search Pool
  function getSearchPool() {
    const map = new Map();

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

  function makeGuess(name) {
    if (isGameOver || !currentTarget) return;

    let clean = name.trim();
    if (!clean) return;

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
      const match = pool.find((p) => p.name.toLowerCase() === guessLower);
      if (match) clean = match.name;
    }

    // Check duplicate
    if (currentAttempts.some((a) => a.name.toLowerCase() === clean.toLowerCase())) {
      input.classList.add("shake");
      setTimeout(() => input.classList.remove("shake"), 400);
      return;
    }

    const isCorrect = (clean.toLowerCase() === currentTarget.name.toLowerCase());
    currentAttempts.push({ name: clean, isCorrect: isCorrect });

    if (input) input.value = "";
    closeSuggestions();
    renderHistory();
    updateTrack();

    if (isCorrect) {
      finishGame(true);
    } else if (currentAttempts.length >= MAX_ATTEMPTS) {
      finishGame(false);
    } else {
      saveProgress();
    }
  }

  // Autocomplete
  function setupAutocomplete() {
    if (!input || !suggestions) return;

    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 1) {
        closeSuggestions();
        return;
      }
      const pool = getSearchPool();
      currentMatches = pool
        .filter((p) => p.name.toLowerCase().includes(q))
        .slice(0, 7);

      renderSuggestions(q);
    });

    input.addEventListener("keydown", (e) => {
      if (!suggestions || suggestions.hidden) {
        if (e.key === "Enter") {
          e.preventDefault();
          selectCurrent();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlighted = Math.min(highlighted + 1, currentMatches.length - 1);
        updateHighlight();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlighted = Math.max(highlighted - 1, -1);
        updateHighlight();
      } else if (e.key === "Enter") {
        e.preventDefault();
        selectCurrent();
      } else if (e.key === "Escape") {
        closeSuggestions();
      }
    });

    input.addEventListener("focus", () => {
      if (input.value.trim().length >= 1) {
        input.dispatchEvent(new Event("input"));
      }
    });

    input.addEventListener("blur", () => {
      blurTimer = setTimeout(() => closeSuggestions(), 250);
    });
  }

  function renderSuggestions(q) {
    if (!suggestions) return;
    if (currentMatches.length === 0) {
      closeSuggestions();
      return;
    }

    suggestions.innerHTML = "";
    highlighted = -1;

    currentMatches.forEach((p, idx) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.index = String(idx);

      const reg = new RegExp("(" + q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + ")", "gi");
      const highlightedName = p.name.replace(reg, "<mark>$1</mark>");

      li.innerHTML = `
        <span class="sug-name">${highlightedName}</span>
        <span class="sug-meta">${p.country} • ${p.role}</span>
      `;

      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (blurTimer) clearTimeout(blurTimer);
        input.value = p.name;
        closeSuggestions();
        makeGuess(p.name);
      });

      suggestions.appendChild(li);
    });

    suggestions.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function updateHighlight() {
    if (!suggestions) return;
    const items = suggestions.querySelectorAll("li");
    items.forEach((item, idx) => {
      if (idx === highlighted) {
        item.classList.add("selected");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("selected");
      }
    });
  }

  function selectCurrent() {
    if (!suggestions || suggestions.hidden || highlighted === -1) {
      if (input && input.value.trim()) {
        makeGuess(input.value.trim());
      }
      return;
    }
    if (currentMatches[highlighted]) {
      const p = currentMatches[highlighted];
      if (input) input.value = p.name;
      closeSuggestions();
      makeGuess(p.name);
    }
  }

  function closeSuggestions() {
    if (!suggestions) return;
    suggestions.hidden = true;
    suggestions.innerHTML = "";
    highlighted = -1;
    if (input) input.setAttribute("aria-expanded", "false");
  }

  // Event listeners
  guessBtn?.addEventListener("click", () => {
    selectCurrent();
  });

  // Mode toggles
  document.getElementById("mode-easy")?.addEventListener("click", (e) => {
    if (currentMode === "easy") return;
    currentMode = "easy";
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    if (guessControls) guessControls.style.display = "block";
    if (resetBtn) resetBtn.style.display = "inline-flex";
    if (resultCard) resultCard.style.display = "none";
    loadPuzzle();
  });

  document.getElementById("mode-hard")?.addEventListener("click", (e) => {
    if (currentMode === "hard") return;
    currentMode = "hard";
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    if (guessControls) guessControls.style.display = "block";
    if (resetBtn) resetBtn.style.display = "inline-flex";
    if (resultCard) resultCard.style.display = "none";
    loadPuzzle();
  });

  // Auth button check
  fetch("/api/me")
    .then((r) => r.json())
    .then((d) => {
      if (d && d.user) {
        const topbarAuth = document.getElementById("topbar-auth-btn");
        if (topbarAuth) {
          topbarAuth.classList.add("signed-in");
          topbarAuth.title = `@${d.user.username} (Account)`;
          topbarAuth.setAttribute("aria-label", `Account for @${d.user.username}`);
        }
      }
    })
    .catch(() => {});

  // Initialize
  setupAutocomplete();
  loadPuzzle();
})();

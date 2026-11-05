(function () {
  "use strict";

  // Grid configs: Easy mode = 3x3 (9 pieces), Hard mode = 4x6 (24 pieces)
  const GRID_CONFIG = {
    easy: { cols: 3, rows: 3, total: 9, minDisplaced: 7 },
    hard: { cols: 4, rows: 6, total: 24, minDisplaced: 24 }
  };

  const MAX_ATTEMPTS = 3;

  let gridCols = 3;
  let gridRows = 3;
  let totalTiles = 9;

  let allPlayers = [];
  let currentTarget = null;
  let currentAttempts = [];
  let currentMode = "easy";
  let loadedImage = null;
  let isGameOver = false;
  let puzzleStartTime = Date.now();
  let currentUser = null;
  const gateModal = document.getElementById("member-gate-modal");
  let currentPhotoUrl = "";
  let initialScramble = [];
  let initialRotations = [];
  let board = [];
  let rotations = [];
  let selectedSlot = -1;
  let dragStartSlot = -1;

  const canvas = document.getElementById("puzzle-canvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const input = document.getElementById("guess-input");
  const guessBtn = document.getElementById("btn-guess");
  const resetBtn = document.getElementById("btn-reset-scramble");
  const rotateBtn = document.getElementById("btn-rotate-tile");
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


  // Generate a non-trivial scramble (minDisplaced tiles displaced)
  function generateScramble(seedStr, numTiles, minDisplaced) {
    const rng = mulberry32(hashString(seedStr));
    let perm = Array.from({ length: numTiles }, (_, i) => i);
    let attempts = 0;
    let valid = false;

    const targetDisplaced = Math.min(minDisplaced, numTiles);
    while (!valid && attempts < 100) {
      attempts++;
      for (let i = numTiles - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      let displaced = 0;
      for (let i = 0; i < numTiles; i++) {
        if (perm[i] !== i) displaced++;
      }
      if (displaced >= targetDisplaced || (targetDisplaced === 24 && displaced >= 22)) {
        valid = true;
      }
    }
    return perm;
  }

  // Generate randomized piece rotations: 0 = 0° (up), 1 = 90° (right), 2 = 180° (down), 3 = 270° (left)
  function generateRotations(seedStr, numTiles) {
    const rng = mulberry32(hashString(seedStr + "_rotations"));
    const rots = [];
    let nonZero = 0;
    for (let i = 0; i < numTiles; i++) {
      const r = Math.floor(rng() * 4);
      rots.push(r);
      if (r !== 0) nonZero++;
    }
    // Guarantee that at least 60% of pieces are rotated
    if (nonZero < Math.ceil(numTiles * 0.6)) {
      for (let i = 0; i < numTiles; i++) {
        if (rots[i] === 0 && Math.floor(rng() * 3) !== 0) {
          rots[i] = Math.floor(rng() * 3) + 1;
        }
      }
    }
    return rots;
  }

  function updateRotateBtn() {
    if (!rotateBtn) return;
    if (isGameOver) {
      rotateBtn.style.display = "none";
      return;
    }
    rotateBtn.style.display = "inline-flex";
    if (selectedSlot !== -1) {
      rotateBtn.classList.add("active");
      const currentRot = (rotations[selectedSlot] || 0) * 90;
      rotateBtn.textContent = `↷ Rotate Piece (${currentRot}°)`;
      rotateBtn.title = `Rotate piece in slot ${selectedSlot + 1} (currently ${currentRot}°)`;
    } else {
      rotateBtn.classList.remove("active");
      rotateBtn.textContent = "↷ Rotate Piece (90°)";
      rotateBtn.title = "Tap a tile to select, then click to rotate";
    }
  }

  function saveProgress() {
    if (!currentTarget) return;
    const today = getTodayKey();
    const data = {
      attempts: currentAttempts,
      isGameOver: isGameOver,
      board: board,
      rotations: rotations,
      initialScramble: initialScramble,
      initialRotations: initialRotations,
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

    const isHard = (totalTiles > 9);
    const badgeRadius = isHard ? 7.5 : 9;
    const badgeOffset = isHard ? 10.5 : 13;
    const badgeFont = isHard ? "bold 8.5px sans-serif" : "bold 10px sans-serif";

    // 1. Draw each tile
    for (let slot = 0; slot < totalTiles; slot++) {
      // If game over, show solved order (0..totalTiles-1) upright (rot = 0), else current permutation
      const tileId = isGameOver ? slot : board[slot];
      const rot = isGameOver ? 0 : (rotations[slot] || 0);

      const destCol = slot % gridCols;
      const destRow = Math.floor(slot / gridCols);
      const dx = Math.round((destCol * w) / gridCols);
      const nextDx = Math.round(((destCol + 1) * w) / gridCols);
      const tileW = nextDx - dx;

      const dy = Math.round((destRow * h) / gridRows);
      const nextDy = Math.round(((destRow + 1) * h) / gridRows);
      const tileH = nextDy - dy;

      const srcCol = tileId % gridCols;
      const srcRow = Math.floor(tileId / gridCols);
      const srcX0 = sx + (srcCol * sw) / gridCols;
      const srcX1 = sx + ((srcCol + 1) * sw) / gridCols;
      const srcTileW = srcX1 - srcX0;

      const srcY0 = sy + (srcRow * sh) / gridRows;
      const srcY1 = sy + ((srcRow + 1) * sh) / gridRows;
      const srcTileH = srcY1 - srcY0;

      ctx.save();
      // Clip to tile slot boundary to prevent edge bleeding
      ctx.beginPath();
      ctx.rect(dx, dy, tileW, tileH);
      ctx.clip();

      const cx = dx + tileW / 2;
      const cy = dy + tileH / 2;
      ctx.translate(cx, cy);

      if (rot !== 0) {
        ctx.rotate(rot * (Math.PI / 2));
      }

      const isSideways = (rot === 1 || rot === 3);
      const drawW = isSideways ? tileH : tileW;
      const drawH = isSideways ? tileW : tileH;

      ctx.drawImage(
        loadedImage,
        srcX0,
        srcY0,
        srcTileW,
        srcTileH,
        -drawW / 2,
        -drawH / 2,
        drawW,
        drawH
      );
      ctx.restore();
    }

    // 2. Draw borders & overlays if game active
    let correctCount = 0;
    if (!isGameOver) {
      for (let slot = 0; slot < totalTiles; slot++) {
        const tileId = board[slot];
        const rot = rotations[slot] || 0;
        const isSolved = (tileId === slot && rot === 0);
        if (isSolved) correctCount++;

        const destCol = slot % gridCols;
        const destRow = Math.floor(slot / gridCols);
        const dx = Math.round((destCol * w) / gridCols);
        const nextDx = Math.round(((destCol + 1) * w) / gridCols);
        const tileW = nextDx - dx;

        const dy = Math.round((destRow * h) / gridRows);
        const nextDy = Math.round(((destRow + 1) * h) / gridRows);
        const tileH = nextDy - dy;

        if (slot === selectedSlot) {
          // Selected tile: Bright glowing gold border + translucent amber wash
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = isHard ? 2.5 : 3;
          ctx.strokeRect(dx + 1.5, dy + 1.5, tileW - 3, tileH - 3);

          ctx.fillStyle = "rgba(245, 158, 11, 0.28)";
          ctx.fillRect(dx + 1.5, dy + 1.5, tileW - 3, tileH - 3);

          // Glowing badge
          ctx.fillStyle = "#f59e0b";
          ctx.beginPath();
          ctx.arc(dx + badgeOffset, dy + badgeOffset, badgeRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#000000";
          ctx.font = badgeFont;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("★", dx + badgeOffset, dy + badgeOffset);

          // Rotation badge in bottom right corner if rotated
          if (rot !== 0) {
            ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
            ctx.beginPath();
            ctx.arc(dx + tileW - badgeOffset, dy + tileH - badgeOffset, badgeRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#f59e0b";
            ctx.font = badgeFont;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("↻", dx + tileW - badgeOffset, dy + tileH - badgeOffset);
          }
        } else if (isSolved) {
          // Correctly placed and upright: Clean subtle green border + checkmark
          ctx.strokeStyle = "rgba(34, 197, 94, 0.85)";
          ctx.lineWidth = isHard ? 1.5 : 1.8;
          ctx.strokeRect(dx + 1, dy + 1, tileW - 2, tileH - 2);

          // Checkmark badge in corner
          ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
          ctx.beginPath();
          ctx.arc(dx + badgeOffset, dy + badgeOffset, badgeRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#22c55e";
          ctx.font = badgeFont;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("✓", dx + badgeOffset, dy + badgeOffset);
        } else if (tileId === slot && rot !== 0) {
          // Correct slot but rotated: subtle amber dashed border + rotate indicator
          ctx.strokeStyle = "rgba(245, 158, 11, 0.85)";
          ctx.lineWidth = isHard ? 1.5 : 1.8;
          ctx.setLineDash(isHard ? [2, 2] : [3, 3]);
          ctx.strokeRect(dx + 1, dy + 1, tileW - 2, tileH - 2);
          ctx.setLineDash([]);

          ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
          ctx.beginPath();
          ctx.arc(dx + badgeOffset, dy + badgeOffset, badgeRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#f59e0b";
          ctx.font = badgeFont;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("↻", dx + badgeOffset, dy + badgeOffset);
        } else {
          // Scrambled tile: Subtle dashed border + tile number
          ctx.strokeStyle = "rgba(245, 158, 11, 0.35)";
          ctx.lineWidth = 1;
          ctx.setLineDash(isHard ? [2, 2] : [3, 3]);
          ctx.strokeRect(dx + 0.5, dy + 0.5, tileW - 1, tileH - 1);
          ctx.setLineDash([]);

          // Tile number badge
          ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
          ctx.beginPath();
          ctx.arc(dx + badgeOffset, dy + badgeOffset, badgeRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "rgba(245, 158, 11, 0.9)";
          ctx.font = badgeFont;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(tileId + 1), dx + badgeOffset, dy + badgeOffset);

          // If rotated, show small rotate symbol in bottom right
          if (rot !== 0) {
            ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
            ctx.beginPath();
            ctx.arc(dx + tileW - badgeOffset, dy + tileH - badgeOffset, badgeRadius * 0.9, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "rgba(245, 158, 11, 0.75)";
            ctx.font = badgeFont;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("↷", dx + tileW - badgeOffset, dy + tileH - badgeOffset);
          }
        }
      }
    } else {
      correctCount = totalTiles;
    }

    // 3. Update Progress Bar
    const percent = Math.round((correctCount / totalTiles) * 100);
    if (progressText) {
      progressText.textContent = `🧩 ${correctCount} of ${totalTiles} pieces in place`;
    }
    if (progressPercent) {
      progressPercent.textContent = `${percent}%`;
    }
    if (progressBar) {
      progressBar.style.width = `${percent}%`;
    }

    // 4. Update Assembled Banner
    if (assembledBanner) {
      if (!isGameOver && correctCount === totalTiles) {
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

    const col = Math.floor(x / (canvas.width / gridCols));
    const row = Math.floor(y / (canvas.height / gridRows));
    if (col < 0 || col >= gridCols || row < 0 || row >= gridRows) return -1;
    return row * gridCols + col;
  }

  function handleTileTap(slot) {
    if (isGameOver || slot < 0 || slot >= totalTiles) return;

    if (selectedSlot === -1) {
      selectedSlot = slot;
      updateRotateBtn();
      renderBoard();
    } else if (selectedSlot === slot) {
      // Tapping already-selected piece spins it 90° clockwise!
      rotations[slot] = ((rotations[slot] || 0) + 1) % 4;
      saveProgress();
      renderBoard();
      updateRotateBtn();
    } else {
      // Swapping two tiles: swap tile IDs and their orientations
      const tempTile = board[selectedSlot];
      const tempRot = rotations[selectedSlot];
      board[selectedSlot] = board[slot];
      rotations[selectedSlot] = rotations[slot];
      board[slot] = tempTile;
      rotations[slot] = tempRot;
      selectedSlot = -1;
      saveProgress();
      renderBoard();
      updateRotateBtn();
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
        const tempTile = board[dragStartSlot];
        const tempRot = rotations[dragStartSlot];
        board[dragStartSlot] = board[endSlot];
        rotations[dragStartSlot] = rotations[endSlot];
        board[endSlot] = tempTile;
        rotations[endSlot] = tempRot;
        selectedSlot = -1;
        dragStartSlot = -1;
        saveProgress();
        renderBoard();
        updateRotateBtn();
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

    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (isGameOver) return;
      const slot = getSlotFromCoords(e.clientX, e.clientY);
      if (slot !== -1) {
        selectedSlot = slot;
        rotations[slot] = ((rotations[slot] || 0) + 1) % 4;
        saveProgress();
        renderBoard();
        updateRotateBtn();
      }
    });
  }

  // Rotate Selected Tile Button
  rotateBtn?.addEventListener("click", () => {
    if (isGameOver) return;
    if (selectedSlot === -1) {
      const candidate = board.findIndex((t, idx) => t !== idx || (rotations[idx] || 0) !== 0);
      selectedSlot = candidate !== -1 ? candidate : 0;
    }
    rotations[selectedSlot] = ((rotations[selectedSlot] || 0) + 1) % 4;
    saveProgress();
    renderBoard();
    updateRotateBtn();
  });

  // Reset Scramble Button
  resetBtn?.addEventListener("click", () => {
    if (isGameOver || initialScramble.length !== totalTiles) return;
    board = [...initialScramble];
    rotations = [...initialRotations];
    selectedSlot = -1;
    saveProgress();
    renderBoard();
    updateRotateBtn();
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

      if (window.CricketleInaccuracy) {
        window.CricketleInaccuracy.setTargetProvider(() => currentTarget ? { name: currentTarget.name, id: currentTarget.id } : null);
      }

      const variants = Array.isArray(currentTarget.images) && currentTarget.images.length > 0
        ? currentTarget.images
        : [currentTarget.imageUrl];
      const variantSeed = hashString(today + "_" + currentTarget.id + "_jigsaw_variant");
      currentPhotoUrl = variants[variantSeed % variants.length];

      // Update grid dimensions for current mode
      const cfg = GRID_CONFIG[currentMode] || GRID_CONFIG.easy;
      gridCols = cfg.cols;
      gridRows = cfg.rows;
      totalTiles = cfg.total;

      // Scramble seed specific to mode and target
      const scrambleSeed = today + "_" + currentTarget.id + "_puzzle_scramble_" + currentMode;
      initialScramble = generateScramble(scrambleSeed, totalTiles, cfg.minDisplaced);
      initialRotations = generateRotations(scrambleSeed, totalTiles);

      selectedSlot = -1;
      dragStartSlot = -1;

      // Restore saved progress if any
      const saved = localStorage.getItem(`cricketle_puzzle_${today}_${currentMode}`);
      if (saved) {
        const data = JSON.parse(saved);
        currentAttempts = data.attempts || [];
        isGameOver = data.isGameOver || false;
        if (Array.isArray(data.board) && data.board.length === totalTiles) {
          board = data.board;
        } else {
          board = [...initialScramble];
        }
        if (Array.isArray(data.rotations) && data.rotations.length === totalTiles) {
          rotations = data.rotations;
        } else {
          rotations = [...initialRotations];
        }
        if (Array.isArray(data.initialRotations) && data.initialRotations.length === totalTiles) {
          initialRotations = data.initialRotations;
        }
        if (data.photoUrl) currentPhotoUrl = data.photoUrl;
      } else {
        currentAttempts = [];
        isGameOver = false;
        board = [...initialScramble];
        rotations = [...initialRotations];
      }

      loadImage(currentPhotoUrl);
      renderHistory();
      updateTrack();
      updateRotateBtn();

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

    // Reveal all pieces in solved order and upright (0° rotation)
    for (let i = 0; i < totalTiles; i++) {
      board[i] = i;
      rotations[i] = 0;
    }
    renderBoard();
    updateTrack();

    if (guessControls) guessControls.style.display = "none";
    if (resetBtn) resetBtn.style.display = "none";
    if (rotateBtn) rotateBtn.style.display = "none";

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

    const elapsedMs = Math.max(1000, Date.now() - puzzleStartTime);
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const speedBonus = Math.max(0, 25 - Math.floor(elapsedSec / 15));
    const stagePen = Math.max(0, (currentAttempts.length - 1) * 12);
    const calculatedScore = won ? Math.max(25, 100 - stagePen + speedBonus) : 0;

    fetch("/api/variant/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: "puzzle_" + currentMode,
        score: calculatedScore,
        status: won ? "solved" : "gaveUp",
        durationMs: elapsedMs,
        guesses: currentAttempts,
      }),
    }).catch(() => {});

    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant: "puzzle_" + currentMode,
        action: "game_completed",
        details: { won, score: calculatedScore, attempts: currentAttempts.length },
        durationMs: elapsedMs,
        score: calculatedScore,
      }),
    }).catch(() => {});

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
    e.currentTarget.classList.add("active");
    if (guessControls) guessControls.style.display = "block";
    if (resetBtn) resetBtn.style.display = "inline-flex";
    if (rotateBtn) rotateBtn.style.display = "inline-flex";
    if (resultCard) resultCard.style.display = "none";
    loadPuzzle();
  });

  document.getElementById("mode-hard")?.addEventListener("click", (e) => {
    if (currentMode === "hard") return;
    currentMode = "hard";
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    e.currentTarget.classList.add("active");
    if (guessControls) guessControls.style.display = "block";
    if (resetBtn) resetBtn.style.display = "inline-flex";
    if (rotateBtn) rotateBtn.style.display = "inline-flex";
    if (resultCard) resultCard.style.display = "none";
    loadPuzzle();
  });

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
          topbarAuth.setAttribute("aria-label", `Account for @${d.user.username}`);
        }
        if (gateModal) gateModal.hidden = true;
        if (input) {
          input.disabled = false;
          input.placeholder = "Type player name (e.g. Virat Kohli)...";
        }
        if (guessBtn) guessBtn.disabled = false;
        return true;
      }
    } catch (_) {}
    currentUser = null;
    if (gateModal) gateModal.hidden = false;
    if (input) {
      input.disabled = true;
      input.placeholder = "Member access only — Log in to play...";
    }
    if (guessBtn) guessBtn.disabled = true;
    return false;
  }
  checkAuth();

  // Initialize
  setupAutocomplete();
  loadPuzzle();
})();

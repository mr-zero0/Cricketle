(function () {
  "use strict";

  // Pixelation block sizes per attempt (attempt 0 to 5, then revealed)
  const PIXEL_SIZES = [36, 26, 18, 12, 7, 4];
  const MAX_ATTEMPTS = 6;

  let allPlayers = [];
  let currentTarget = null;
  let currentAttempts = [];
  let currentMode = "easy";
  let loadedImage = null;
  let isGameOver = false;

  const canvas = document.getElementById("pixel-canvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const input = document.getElementById("guess-input");
  const guessBtn = document.getElementById("btn-guess");
  const skipBtn = document.getElementById("btn-skip");
  const autocomplete = document.getElementById("autocomplete-list");
  const historyList = document.getElementById("guess-history");
  const track = document.getElementById("attempts-track");
  const resultCard = document.getElementById("result-card");
  const resultStatus = document.getElementById("result-status");
  const resultName = document.getElementById("result-name");
  const resultHint = document.getElementById("result-hint");
  const guessControls = document.getElementById("guess-controls");

  // Format today's date key: YYYY-MM-DD
  function getTodayKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  // Simple string hash for deterministic daily seed
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // Draw pixelated image on canvas with center crop
  function renderPixelated(pixelSize) {
    if (!ctx || !loadedImage) return;

    const w = canvas.width;
    const h = canvas.height;

    // Calculate center-crop coordinates
    const imgRatio = loadedImage.width / loadedImage.height;
    const canvasRatio = w / h;
    let sx = 0, sy = 0, sw = loadedImage.width, sh = loadedImage.height;
    if (imgRatio > canvasRatio) {
      sw = loadedImage.height * canvasRatio;
      sx = (loadedImage.width - sw) / 2;
    } else {
      sh = loadedImage.width / canvasRatio;
      sy = (loadedImage.height - sh) / 2;
    }

    if (pixelSize <= 1) {
      // Draw pristine image directly
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(loadedImage, sx, sy, sw, sh, 0, 0, w, h);
      return;
    }

    // Downscale and upscale on an offscreen canvas to create true pixel blocks
    const offW = Math.max(1, Math.floor(w / pixelSize));
    const offH = Math.max(1, Math.floor(h / pixelSize));

    const offscreen = document.createElement("canvas");
    offscreen.width = offW;
    offscreen.height = offH;
    const offCtx = offscreen.getContext("2d");

    // Draw downscaled with center crop
    offCtx.drawImage(loadedImage, sx, sy, sw, sh, 0, 0, offW, offH);

    // Draw back upscaled with pixelated smoothing disabled
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(offscreen, 0, 0, offW, offH, 0, 0, w, h);
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

      const pool = list.filter((p) => {
        if (currentMode === "easy") return p.difficulty === "easy";
        return true; // hard mode includes all (active + legends)
      });

      const today = getTodayKey();
      const seed = hashString(today + "_" + currentMode);
      const targetIndex = seed % pool.length;
      currentTarget = pool[targetIndex];

      // Restore saved progress for today if any
      const saved = localStorage.getItem(`cricketle_pixel_${today}_${currentMode}`);
      if (saved) {
        const data = JSON.parse(saved);
        currentAttempts = data.attempts || [];
        isGameOver = data.isGameOver || false;
      } else {
        currentAttempts = [];
        isGameOver = false;
      }

      // Load image
      loadImage(currentTarget.imageUrl);
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
      const sizeIndex = Math.min(currentAttempts.length, PIXEL_SIZES.length - 1);
      const pixelSize = isGameOver ? 1 : PIXEL_SIZES[sizeIndex];
      renderPixelated(pixelSize);
    };
    img.onerror = (err) => {
      console.error("Failed to load image at:", url, err);
      if (!ctx) return;
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 20px 'Source Sans 3', sans-serif";
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
      el.className = `guess-item ${a.isCorrect ? "correct" : a.skipped ? "skipped" : ""}`;
      el.innerHTML = `
        <span>${a.skipped ? "<em>Skipped</em>" : a.name}</span>
        <span style="font-weight:700;">${a.isCorrect ? "✅ Correct" : a.skipped ? "⏭️ Skipped" : "❌ Incorrect"}</span>
      `;
      historyList.appendChild(el);
    });
  }

  function makeGuess(name, skipped = false) {
    if (isGameOver || !currentTarget) return;

    const isCorrect = !skipped && name.trim().toLowerCase() === currentTarget.name.toLowerCase();
    currentAttempts.push({ name: name.trim(), skipped, isCorrect });

    // Save state
    const today = getTodayKey();
    const won = isCorrect;
    const lost = !won && currentAttempts.length >= MAX_ATTEMPTS;

    if (won || lost) {
      isGameOver = true;
      finishGame(won);
    } else {
      const nextSize = PIXEL_SIZES[currentAttempts.length];
      renderPixelated(nextSize);
    }

    localStorage.setItem(
      `cricketle_pixel_${today}_${currentMode}`,
      JSON.stringify({ attempts: currentAttempts, isGameOver })
    );

    renderHistory();
    updateTrack();
    if (input) input.value = "";
    closeAutocomplete();
  }

  function finishGame(won) {
    // Reveal full photo!
    renderPixelated(1);

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

  // Autocomplete logic using PLAYERS from players.js
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
        item.innerHTML = `<span>${p.name}</span><span class="autocomplete-country">${p.country}</span>`;
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

  // Event listeners
  guessBtn?.addEventListener("click", () => {
    const val = input ? input.value.trim() : "";
    if (val) makeGuess(val);
  });

  skipBtn?.addEventListener("click", () => {
    makeGuess("Skip", true);
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = autocomplete?.querySelector(".autocomplete-item span");
      const val = first ? first.textContent : input.value.trim();
      if (val) makeGuess(val);
    }
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

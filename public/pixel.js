(function () {
  "use strict";

  // Pixelation block sizes per attempt (attempt 0 to 5, then revealed)
  // Tuned to be fair and fun: face structure, hair, eyes & beard are recognizable!
  const PIXEL_SIZES = [10, 7, 5, 3, 2, 1];
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
  const suggestions = document.getElementById("suggestions");
  const historyList = document.getElementById("guess-history");
  const track = document.getElementById("attempts-track");
  const resultCard = document.getElementById("result-card");
  const resultStatus = document.getElementById("result-status");
  const resultName = document.getElementById("result-name");
  const resultHint = document.getElementById("result-hint");
  const guessControls = document.getElementById("guess-controls");

  let highlighted = -1;
  let currentMatches = [];
  let blurTimer = null;

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

  // Draw pixelated image on canvas with headshot-focused center crop
  function renderPixelated(pixelSize) {
    if (!ctx || !loadedImage) return;

    const w = canvas.width;
    const h = canvas.height;

    // Headshot-focused crop (keeps eyes/face centered)
    const imgRatio = loadedImage.width / loadedImage.height;
    const canvasRatio = w / h;
    let sx = 0, sy = 0, sw = loadedImage.width, sh = loadedImage.height;
    if (imgRatio > canvasRatio) {
      sw = loadedImage.height * canvasRatio;
      sx = (loadedImage.width - sw) / 2;
    } else {
      sh = loadedImage.width / canvasRatio;
      // Focus on upper portion (head and shoulders)
      sy = Math.max(0, (loadedImage.height - sh) * 0.15);
    }

    if (pixelSize <= 1) {
      // Draw pristine image directly
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(loadedImage, sx, sy, sw, sh, 0, 0, w, h);
      return;
    }

    // Downscale and upscale on an offscreen canvas to create crisp mosaic blocks
    const offW = Math.max(1, Math.floor(w / pixelSize));
    const offH = Math.max(1, Math.floor(h / pixelSize));

    const offscreen = document.createElement("canvas");
    offscreen.width = offW;
    offscreen.height = offH;
    const offCtx = offscreen.getContext("2d");

    // Draw downscaled with headshot crop
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

      const pool = list.filter((p) => p.difficulty === currentMode);
      const activePool = pool.length ? pool : list;

      const today = getTodayKey();
      const seed = hashString(today + "_pixel_" + currentMode);
      const targetIndex = seed % activePool.length;
      currentTarget = activePool[targetIndex];

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

  // Combined Search Pool ensuring legends like Brian Lara and Shane Warne are always present
  function getSearchPool() {
    const map = new Map();

    // 1. Extra legends fallback (synchronous, instant availability)
    EXTRA_LEGENDS.forEach((p) => {
      map.set(p.name.toLowerCase(), p);
    });

    // 2. Add all players from datasets/pixel-players.json (includes all pixel targets)
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
      // Smart resolution: if player typed "lara" or "dhoni" or "kohli", resolve to full name
      if (currentTarget.name.toLowerCase() === guessLower) {
        clean = currentTarget.name;
      } else if (
        currentTarget.name.toLowerCase().endsWith(" " + guessLower) ||
        currentTarget.name.toLowerCase().startsWith(guessLower + " ") ||
        currentTarget.name.toLowerCase().split(/\s+/).includes(guessLower)
      ) {
        clean = currentTarget.name; // Smart match for target!
      } else {
        // Resolve from general player pool
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
    hideSuggestions();
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

  // ---------- Autocomplete (Matches Classic Cricketle) ----------

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
        // Priority 1: Full name starts with q (e.g. "vir" -> "Virat Kohli")
        const aStarts = starts(a), bStarts = starts(b);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        // Priority 2: Any word starts with q (e.g. "lara" -> "Brian Lara")
        const aWord = hasWord(a), bWord = hasWord(b);
        if (aWord !== bWord) return aWord ? -1 : 1;
        // Priority 3: Alphabetical
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
    if (highlighted >= 0 && currentMatches[highlighted]) {
      const chosen = currentMatches[highlighted].name;
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
    const val = input ? input.value.trim() : "";
    if (val) makeGuess(val);
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

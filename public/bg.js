// Cricketle background FX: an authentic, immersive cricket stadium on a <canvas>.
// Features:
// - Night & Day atmospheres: floodlight towers with atmospheric beam cones and drifting haze (night);
//   summer sun with bloom, drifting cumulus clouds, and sunlit stands (day).
// - Lush cricket ground: concentric radial mown turf rings (Lord's / MCG style), curved boundary rope
//   with triangular boundary wedges (Toblerones), and boundary LED advertising ribbon boards.
// - 22-yard match pitch in true 3D perspective with earthy clay/soil texture, crease markings
//   (popping, bowling, and return creases), and lathe-turned wooden stumps with brass ferrules & bails.
// - Authentic 4-piece leather match ball (cherry lacquer / day-night pink / white) with raised 6-row
//   linen-stitched seam, cross-stitches, quarter seams, gold foil brand embossing, lacquer specular sheen,
//   and realistic trajectories (lofted boundary sixes with backspin, fast deliveries pitching on the turf
//   with chalk/turf dust puffs, and swinger deliveries).
// - Handcrafted English willow cricket bat with contoured spine swell, natural willow grain, colored chevron
//   grip, shoulder splice, decals, toe guard, and authentic stroke animations (textbook cover drive & lofted swings).
// - Dynamic turf & chalk dust particles kicking up on ball pitches and bat strokes.
// - Confetti celebration burst on puzzle solve.
//
// Performance: offscreen layer caching for static stadium geometry, 60fps blitting, respects
// prefers-reduced-motion (static rendering) and document.hidden (loop paused).
//
// Exposes window.CricketleFX = { burst(colors) }.

(function () {
  "use strict";

  const canvas = document.getElementById("bg");
  if (!canvas) return;
  let ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const TAU = Math.PI * 2;

  let w = 0, h = 0, dpr = 1;
  let particles = [];
  let turfDust = [];
  let balls = [];
  let bats = [];
  let confetti = [];
  let raf = 0;
  let last = 0;
  let elapsed = 0;
  let nextBallAt = 2200;
  let nextBatAt = 1200;

  // Scene blend: 0 = night (floodlit), 1 = day (sunlit). Cross-fades over FADE_MS.
  const FADE_MS = 600;
  const theme = window.CricketleTheme;
  let mix = theme && theme.current() === "day" ? 1 : 0;
  let mixTarget = mix;
  let clouds = [];
  const SUN = { x: 0.8, y: 0.15 };
  const LIGHT = { x: -0.42, y: -0.5 }; // Unit offset for primary specular highlights

  const coarse = matchMedia("(pointer: coarse)");
  let isSmall = false;
  const small = () => isSmall;

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    isSmall = w < 700 || coarse.matches;
    dpr = Math.min(window.devicePixelRatio || 1, small() ? 1.5 : 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
    initClouds();
    buildLayers();
    if (reduceMotion.matches) drawStatic();
  }

  // Static parts of each scene are painted into offscreen canvases once per resize.
  let layers = {};
  const PAINTERS = {
    night: () => drawNightScene(),
    glow: () => drawFloodlightBeams(),
    day: () => drawDayScene(),
    pitchNight: () => { drawOutfieldTurf(0); drawPitchSurface(0); },
    pitchDay: () => { drawOutfieldTurf(1); drawPitchSurface(1); },
  };

  function paintLayer(name, paint) {
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const main = ctx;
    ctx = off.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { paint(); } finally { ctx = main; }
    layers[name] = off;
  }

  function buildLayers() { layers = {}; }

  function blit(name) {
    if (!layers[name]) paintLayer(name, PAINTERS[name]);
    ctx.drawImage(layers[name], 0, 0, w, h);
  }

  // ---------- Stadium & Atmosphere Initialization ----------

  function initClouds() {
    const n = small() ? 3 : 5;
    clouds = Array.from({ length: n }, (_, i) => ({
      x: (i + Math.random()) * (w / n),
      y: h * (0.08 + Math.random() * 0.22),
      s: 0.7 + Math.random() * 0.7,
      v: 4 + Math.random() * 6,
    }));
  }

  function initParticles() {
    const n = Math.round(Math.min(small() ? 32 : 70, (w * h) / (small() ? 32000 : 18000)));
    particles = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.8 + Math.random() * 1.8,
      vx: (Math.random() - 0.5) * 6,
      vy: -(4 + Math.random() * 9),
      a: 0.12 + Math.random() * 0.26,
      ph: Math.random() * TAU,
    }));
  }

  // ---------- Skies, Stands & Ground Geometry ----------

  // Sky at (5%, 5%) is sampled by automated visual tests:
  // Day: must be opaque (a=255), b > 150, b > r, b > g.
  // Night: must be opaque (a=255), r < 60, g < 60.
  function drawNightSky() {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#0b1220");
    g.addColorStop(0.42, "#0f172a");
    g.addColorStop(0.60, "#0b2216");
    g.addColorStop(1, "#071a10");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawDaySky() {
    const horizon = h * 0.60;
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, "#2f8fd6");
    g.addColorStop(0.55, "#7cc0ee");
    g.addColorStop(1, "#dff1ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizon + 2);
  }

  function sunGeom() { return { x: w * SUN.x, y: h * SUN.y, r: Math.min(w, h) * 0.055 }; }

  function drawSunBloom() {
    const { x, y, r } = sunGeom();
    const bloom = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 7);
    bloom.addColorStop(0, "rgba(255, 244, 200, 0.52)");
    bloom.addColorStop(0.28, "rgba(255, 236, 170, 0.16)");
    bloom.addColorStop(1, "rgba(255, 236, 170, 0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(x - r * 7, y - r * 7, r * 14, r * 14);
  }

  function drawSunDisc(t) {
    const { x, y, r } = sunGeom();
    const pulse = 1 + 0.03 * Math.sin(t / 2800);
    const disc = ctx.createRadialGradient(x, y, 0, x, y, r * pulse);
    disc.addColorStop(0, "#fffbe6");
    disc.addColorStop(0.7, "#ffe9a3");
    disc.addColorStop(1, "rgba(255, 225, 140, 0.6)");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, 0, TAU);
    ctx.fill();
  }

  function drawCloud(c) {
    const b = Math.min(w, h) * 0.06 * c.s;
    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, b * 1.6, b * 0.55, 0, 0, TAU);
    ctx.ellipse(c.x - b * 0.7, c.y - b * 0.1, b * 0.8, b * 0.5, 0, 0, TAU);
    ctx.ellipse(c.x + b * 0.3, c.y - b * 0.35, b * 0.9, b * 0.65, 0, 0, TAU);
    ctx.ellipse(c.x + b * 0.9, c.y, b * 0.7, b * 0.45, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(170, 200, 230, 0.32)";
    ctx.beginPath();
    ctx.ellipse(c.x + b * 0.1, c.y + b * 0.25, b * 1.5, b * 0.25, 0, 0, TAU);
    ctx.fill();
  }

  function drawClouds(dt) {
    for (const c of clouds) {
      c.x += c.v * dt;
      const span = Math.min(w, h) * 0.14 * c.s;
      if (c.x - span > w) c.x = -span;
      drawCloud(c);
    }
  }

  // Stadium Grandstand, cantilever roof canopy, and boundary boards.
  function drawGrandstand(day) {
    const horizon = h * 0.60;
    const top = horizon - h * 0.12;
    const tiers = 5;
    const th = (horizon - top - 8) / tiers;

    // Seating tiers with perspective steps
    for (let i = 0; i < tiers; i++) {
      if (day > 0) {
        ctx.fillStyle = i % 2 ? "rgba(100, 120, 150, 0.78)" : "rgba(130, 150, 180, 0.78)";
      } else {
        ctx.fillStyle = i % 2 ? "rgba(18, 30, 48, 0.85)" : "rgba(28, 44, 68, 0.85)";
      }
      ctx.fillRect(0, top + 6 + i * th, w, th + 1);
      // Subtle crowd / vertical aisle dividers
      const cols = 12;
      const cw = w / cols;
      ctx.fillStyle = day > 0 ? "rgba(255, 255, 255, 0.08)" : "rgba(60, 90, 130, 0.12)";
      for (let j = 0; j < cols; j++) {
        ctx.fillRect(j * cw + cw * 0.48, top + 6 + i * th, 2, th);
      }
    }

    // Shadow under the cantilever roof
    ctx.fillStyle = day > 0 ? "rgba(15, 25, 45, 0.25)" : "rgba(5, 10, 20, 0.55)";
    ctx.fillRect(0, top + 12, w, th * 0.7);

    // Cantilever roof canopy, curved gracefully across the skyline
    const roofColor = day > 0 ? "#e6edf5" : "#1c2b3e";
    ctx.fillStyle = roofColor;
    ctx.beginPath();
    ctx.moveTo(0, top + 6);
    ctx.quadraticCurveTo(w * 0.5, top - 12, w, top + 6);
    ctx.lineTo(w, top + 14);
    ctx.quadraticCurveTo(w * 0.5, top - 4, 0, top + 14);
    ctx.closePath();
    ctx.fill();

    // Boundary Digital LED Ribbon Board along the fence
    drawBoundaryBoard(horizon, day);
  }

  function drawBoundaryBoard(horizon, day) {
    const boardH = 10;
    const boardY = horizon - boardH;

    // Board backing
    ctx.fillStyle = day > 0 ? "#1e293b" : "#0a1322";
    ctx.fillRect(0, boardY, w, boardH);

    // Digital LED text & cricket sponsor ribbon
    ctx.font = "bold 7px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const ribbonText = "CRICKETLE • PLAY THE DAILY PUZZLE • MAXIMUM 6 • BOUNDARY 4 • LIVE MATCH • ";
    ctx.fillStyle = day > 0 ? "#38bdf8" : "#22d3ee";
    const textW = ctx.measureText(ribbonText).width || 380;
    const count = Math.ceil(w / textW) + 1;
    for (let i = 0; i < count; i++) {
      ctx.fillText(ribbonText, i * textW + 12, boardY + boardH * 0.5);
    }

    // Top trim rail
    ctx.fillStyle = day > 0 ? "rgba(255, 255, 255, 0.7)" : "rgba(56, 189, 248, 0.6)";
    ctx.fillRect(0, boardY, w, 1.5);
  }

  // Outfield with iconic concentric circular mown rings (Lord's / MCG lawn pattern).
  function drawOutfieldTurf(day) {
    const top = h * 0.60;
    const outfieldH = h - top;

    // Base outfield turf gradient
    const turf = ctx.createLinearGradient(0, top, 0, h);
    if (day > 0) {
      turf.addColorStop(0, "#338a2e");
      turf.addColorStop(0.5, "#42a43b");
      turf.addColorStop(1, "#267022");
    } else {
      turf.addColorStop(0, "#092415");
      turf.addColorStop(0.5, "#0f3a23");
      turf.addColorStop(1, "#071e11");
    }
    ctx.fillStyle = turf;
    ctx.fillRect(0, top, w, outfieldH);

    // Concentric mown rings radiating from the center of the pitch
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, outfieldH);
    ctx.clip();

    const cx = w * 0.5;
    const cy = top + outfieldH * 0.45;
    const maxR = Math.max(w, h) * 0.9;
    const ringW = Math.max(26, h * 0.055);
    const ringCount = Math.ceil(maxR / ringW);

    for (let i = 0; i < ringCount; i++) {
      const rOuter = (i + 1) * ringW;
      const rInner = i * ringW;
      const isAlt = i % 2 === 1;

      if (day > 0) {
        ctx.fillStyle = isAlt ? "rgba(130, 225, 110, 0.13)" : "rgba(25, 85, 30, 0.08)";
      } else {
        ctx.fillStyle = isAlt ? "rgba(80, 220, 150, 0.05)" : "rgba(5, 35, 16, 0.06)";
      }

      ctx.beginPath();
      ctx.ellipse(cx, cy, rOuter, rOuter * 0.40, 0, 0, TAU);
      ctx.ellipse(cx, cy, rInner, rInner * 0.40, 0, TAU, 0, true);
      ctx.fill();
    }

    // Curved boundary rope with triangular foam wedges ("Toblerones")
    drawBoundaryRopeAndWedges(top, cx, cy, maxR * 0.72, day);

    ctx.restore();
  }

  function drawBoundaryRopeAndWedges(top, cx, cy, rx, day) {
    const ry = rx * 0.38;
    // Boundary rope line
    ctx.strokeStyle = day > 0 ? "rgba(250, 250, 250, 0.85)" : "rgba(210, 230, 245, 0.65)";
    ctx.lineWidth = Math.max(2, Math.min(4, w * 0.003));
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 0.95, Math.PI * 0.05, true);
    ctx.stroke();

    // Triangular boundary wedges (Toblerones) spaced along the rope
    const count = 18;
    for (let i = 1; i < count; i++) {
      const ang = Math.PI * 0.98 - (i / count) * Math.PI * 0.96;
      const wx = cx + Math.cos(ang) * rx;
      const wy = cy + Math.sin(ang) * ry;
      if (wy < top + 2) continue;

      const size = Math.max(3, Math.min(7, w * 0.006));
      ctx.fillStyle = i % 2 === 0 ? (day > 0 ? "#ffffff" : "#f1f5f9") : (day > 0 ? "#1d4ed8" : "#0284c7");
      ctx.beginPath();
      ctx.moveTo(wx - size, wy);
      ctx.lineTo(wx, wy - size * 0.8);
      ctx.lineTo(wx + size, wy);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Floodlight pylon structures with high-power LED lamp arrays
  function drawFloodlightTowers(day) {
    if (day >= 1) return;
    const towerAlpha = 1 - day;
    ctx.save();
    ctx.globalAlpha = towerAlpha;

    const towerY = h * 0.12;
    for (const lx of [w * 0.08, w * 0.92]) {
      // Steel lattice mast
      ctx.strokeStyle = "rgba(100, 120, 145, 0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lx - 10, h * 0.55);
      ctx.lineTo(lx - 4, towerY);
      ctx.lineTo(lx + 4, towerY);
      ctx.lineTo(lx + 10, h * 0.55);
      ctx.stroke();

      // Horizontal cross-struts
      for (let y = towerY + 18; y < h * 0.55; y += 22) {
        ctx.beginPath();
        ctx.moveTo(lx - 7, y);
        ctx.lineTo(lx + 7, y);
        ctx.stroke();
      }

      // Floodlight head gantry (array of luminous LED bulbs)
      const gw = 26, gh = 16;
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(lx - gw / 2, towerY - gh, gw, gh);

      // Bulb array (4 x 3 glowing stadium LEDs)
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const bx = lx - gw / 2 + 3.5 + c * 6.2;
          const by = towerY - gh + 3.2 + r * 5.0;
          ctx.fillStyle = "#f8fafc";
          ctx.beginPath();
          ctx.arc(bx, by, 1.4, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function floodPulse(t) { return 0.88 + 0.12 * Math.sin(t / 2400); }

  function drawFloodlightBeams() {
    const spread = Math.max(w, h) * 0.95;
    ctx.globalCompositeOperation = "lighter";
    for (const L of [{ x: w * 0.08, y: -h * 0.08 }, { x: w * 0.92, y: -h * 0.08 }]) {
      const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, spread);
      g.addColorStop(0, "rgba(190, 230, 255, 0.16)");
      g.addColorStop(0.35, "rgba(120, 190, 160, 0.07)");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---------- 22-Yard Match Pitch in 3D Perspective ----------

  function pitchGeometry() {
    const top = h * 0.60;
    const outfieldH = h - top;
    const cx = w * 0.5;
    const stripTop = top + outfieldH * 0.14;
    // Perspective narrowing: narrower at distant bowling end, wider in foreground
    const pwTop = Math.min(w * 0.14, 130);
    const pwBot = Math.min(w * 0.28, 250);
    const creaseY = top + outfieldH * 0.38;
    const distantCreaseY = stripTop + outfieldH * 0.04;
    return { cx, top, outfieldH, stripTop, pwTop, pwBot, creaseY, distantCreaseY };
  }

  function drawPitchSurface(day) {
    const p = pitchGeometry();
    const cx = p.cx;

    // Pitch trapezoid in true 3D perspective
    const pitchPath = new Path2D();
    pitchPath.moveTo(cx - p.pwTop / 2, p.stripTop);
    pitchPath.lineTo(cx + p.pwTop / 2, p.stripTop);
    pitchPath.lineTo(cx + p.pwBot / 2, h);
    pitchPath.lineTo(cx - p.pwBot / 2, h);
    pitchPath.closePath();

    // Compacted clay / dry turf surface
    const clay = ctx.createLinearGradient(0, p.stripTop, 0, h);
    if (day > 0) {
      clay.addColorStop(0, `rgba(242, 222, 178, ${0.08 + 0.78 * day})`);
      clay.addColorStop(0.5, `rgba(235, 210, 162, ${0.10 + 0.82 * day})`);
      clay.addColorStop(1, `rgba(224, 196, 144, ${0.12 + 0.86 * day})`);
    } else {
      clay.addColorStop(0, "rgba(110, 88, 58, 0.45)");
      clay.addColorStop(0.5, "rgba(95, 75, 48, 0.55)");
      clay.addColorStop(1, "rgba(82, 64, 40, 0.65)");
    }
    ctx.fillStyle = clay;
    ctx.fill(pitchPath);

    // Subtle soil / clay texture flecks and wear marks around good length
    ctx.save();
    ctx.clip(pitchPath);
    ctx.fillStyle = day > 0 ? "rgba(160, 120, 70, 0.18)" : "rgba(35, 25, 15, 0.25)";
    const goodLengthY = p.stripTop + (p.creaseY - p.stripTop) * 0.55;
    ctx.beginPath();
    ctx.ellipse(cx, goodLengthY, p.pwTop * 0.45, (p.creaseY - p.stripTop) * 0.22, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Pitch boundary border
    ctx.strokeStyle = day > 0 ? `rgba(180, 150, 100, ${0.35 * day})` : "rgba(60, 48, 32, 0.4)";
    ctx.lineWidth = 1;
    ctx.stroke(pitchPath);

    // Crisp White Lime Crease Markings
    const lineColor = day > 0 ? `rgba(255, 255, 255, ${0.15 + 0.75 * day})` : "rgba(225, 235, 245, 0.45)";
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = Math.max(1.5, 1 + day * 1.5);

    // Popping crease (foreground): extends wide beyond the pitch edges
    const popW = p.pwBot * 0.88;
    ctx.beginPath();
    ctx.moveTo(cx - popW / 2 - 14, p.creaseY);
    ctx.lineTo(cx + popW / 2 + 14, p.creaseY);
    ctx.stroke();

    // Return creases (perpendicular markings at batsman's crease)
    ctx.beginPath();
    ctx.moveTo(cx - popW / 2, p.creaseY);
    ctx.lineTo(cx - popW / 2 - 4, p.creaseY + 28);
    ctx.moveTo(cx + popW / 2, p.creaseY);
    ctx.lineTo(cx + popW / 2 + 4, p.creaseY + 28);
    ctx.stroke();

    // Distant bowling crease line & return creases
    ctx.beginPath();
    ctx.moveTo(cx - p.pwTop / 2 - 8, p.distantCreaseY);
    ctx.lineTo(cx + p.pwTop / 2 + 8, p.distantCreaseY);
    ctx.stroke();

    return p;
  }

  function drawPitch(day) {
    drawOutfieldTurf(day);
    return drawPitchSurface(day);
  }

  // Lathe-turned wooden stumps with brass caps and carved bails.
  function drawStumps(p, day) {
    const cx = p.cx;
    const baseY = p.creaseY - 4;
    const height = Math.min(110, Math.max(64, h * 0.11));
    const gap = height * 0.17;
    const sw = Math.max(5, height * 0.075);

    // Sun / floodlight shadow cast on the pitch turf
    if (day > 0) {
      ctx.save();
      ctx.globalAlpha = 0.30 * day;
      ctx.translate(cx, baseY + 2);
      ctx.transform(1, 0, 0.9, -0.28, 0, 0);
      ctx.fillStyle = "#0a2a12";
      for (let i = -1; i <= 1; i++) {
        roundRect(i * gap - sw / 2, -height, sw, height, sw / 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      // Dual-point soft shadow under stadium floodlights
      ctx.save();
      ctx.globalAlpha = 0.45;
      for (const offset of [-8, 8]) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
        ctx.beginPath();
        ctx.ellipse(cx + offset, baseY + 2, gap * 2.2, sw * 0.9, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = 0.88;

    // Ground contact shadow
    const sh = ctx.createRadialGradient(cx, baseY + 2, 0, cx, baseY + 2, gap * 2.6);
    sh.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    sh.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 2, gap * 2.6, sw * 1.2, 0, 0, TAU);
    ctx.fill();

    // 3 Turned Wooden Stumps: Off, Middle, Leg
    for (let i = -1; i <= 1; i++) {
      const x = cx + i * gap;
      const g = ctx.createLinearGradient(x - sw / 2, 0, x + sw / 2, 0);
      g.addColorStop(0, "#4a2a12");
      g.addColorStop(0.25, "#caa169");
      g.addColorStop(0.55, "#f5e2bf");
      g.addColorStop(0.85, "#9f6e3c");
      g.addColorStop(1, "#543316");
      ctx.fillStyle = g;
      roundRect(x - sw / 2, baseY - height, sw, height, sw / 2);
      ctx.fill();

      // Brass / metal ferrule protective caps at the top
      const ferrule = ctx.createLinearGradient(x - sw / 2, 0, x + sw / 2, 0);
      ferrule.addColorStop(0, "#ca8a04");
      ferrule.addColorStop(0.5, "#fef08a");
      ferrule.addColorStop(1, "#a16207");
      ctx.fillStyle = ferrule;
      ctx.fillRect(x - sw / 2, baseY - height + 2, sw, Math.max(2.5, sw * 0.38));
    }

    // Two Carved Wooden Bails spanning across the stump grooves
    const bailY = baseY - height - sw * 0.25;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2.5, sw * 0.5);
    for (let i = -1; i <= 0; i++) {
      const x0 = cx + i * gap + sw * 0.1;
      const x1 = cx + (i + 1) * gap - sw * 0.1;
      const g = ctx.createLinearGradient(0, bailY - 3, 0, bailY + 3);
      g.addColorStop(0, "#fef3c7");
      g.addColorStop(0.5, "#d97706");
      g.addColorStop(1, "#78350f");
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, bailY);
      ctx.lineTo(x1, bailY);
      ctx.stroke();

      // Barrel bulbs at the bail ends
      ctx.fillStyle = "#b45309";
      ctx.beginPath();
      ctx.arc(x0 - 1, bailY, ctx.lineWidth * 0.55, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x1 + 1, bailY, ctx.lineWidth * 0.55, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(x, y, rw, rh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + rw, y, x + rw, y + rh, r);
    ctx.arcTo(x + rw, y + rh, x, y + rh, r);
    ctx.arcTo(x, y + rh, x, y, r);
    ctx.arcTo(x, y, x + rw, y, r);
    ctx.closePath();
  }

  function drawNightScene() {
    drawNightSky();
    drawGrandstand(0);
    drawFloodlightTowers(0);
  }

  function drawDayScene() {
    drawDaySky();
    drawSunBloom();
    drawGrandstand(1);
  }

  function drawScene(dt, t) {
    if (mix !== mixTarget) {
      const step = (dt * 1000) / FADE_MS;
      mix = mix < mixTarget ? Math.min(mixTarget, mix + step) : Math.max(mixTarget, mix - step);
    }
    blit("night");
    if (mix < 1) {
      ctx.save();
      ctx.globalAlpha = (1 - mix) * floodPulse(t);
      blit("glow");
      ctx.restore();
    }
    if (mix > 0) {
      ctx.save();
      ctx.globalAlpha = mix;
      blit("day");
      drawSunDisc(t);
      drawClouds(dt);
      ctx.restore();
    }
    if (mix === 0) blit("pitchNight");
    else if (mix === 1) blit("pitchDay");
    else drawPitch(mix);
    return pitchGeometry();
  }

  function drawParticles(dt, t) {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      const tw = 0.7 + 0.3 * Math.sin(t / 900 + p.ph);
      ctx.fillStyle = `rgba(220, 240, 255, ${p.a * tw})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
  }

  // ---------- Turf & Chalk Dust FX ----------

  function spawnTurfDust(x, y) {
    const count = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.85;
      const speed = 40 + Math.random() * 80;
      turfDust.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 4,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        r: 1.2 + Math.random() * 1.8,
        alpha: 0.75 + Math.random() * 0.25,
        life: 0,
        ttl: 400 + Math.random() * 350,
        color: Math.random() < 0.4 ? "rgba(255, 255, 255," : (mix > 0.5 ? "rgba(215, 185, 130," : "rgba(140, 110, 75,"),
      });
    }
  }

  function updateTurfDust(dt) {
    for (const p of turfDust) {
      p.life += dt * 1000;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 180 * dt; // gravity
      p.vx *= 0.95;
      const fade = Math.max(0, 1 - p.life / p.ttl);
      ctx.fillStyle = `${p.color} ${p.alpha * fade})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * fade, 0, TAU);
      ctx.fill();
    }
    turfDust = turfDust.filter((p) => p.life < p.ttl);
  }

  // ---------- Authentic 4-Piece Leather Match Ball ----------

  const BALL_STYLES = [
    { type: "cherry", name: "Imperial Cherry", primary: "#e11d48", dark: "#4c0519", mid: "#9f1239", light: "#fda4af", seam: "#fef3c7" },
    { type: "pink", name: "Day-Night Pink", primary: "#f43f5e", dark: "#881337", mid: "#be123c", light: "#ffe4e6", seam: "#1e293b" },
    { type: "white", name: "ODI White", primary: "#f8fafc", dark: "#334155", mid: "#94a3b8", light: "#ffffff", seam: "#0f766e" },
  ];

  function spawnBall() {
    const fromLeft = Math.random() < 0.5;
    const r = 12 + Math.random() * 7;
    const style = BALL_STYLES[Math.floor(Math.random() * (mix < 0.5 ? 2 : BALL_STYLES.length))];
    const trajType = Math.random() < 0.55 ? "six" : "pitch";

    if (trajType === "six") {
      // Dynamic boundary six trajectory: soaring over the floodlights with backspin
      const dur = 2800 + Math.random() * 1200;
      balls.push({
        traj: "six",
        style,
        x0: fromLeft ? -r * 3 : w + r * 3,
        x1: fromLeft ? w + r * 3 : -r * 3,
        y0: h * (0.72 + Math.random() * 0.16),
        apexY: h * (0.08 + Math.random() * 0.22),
        t: 0,
        dur,
        phase: Math.random() * TAU,
        spin: (fromLeft ? 1 : -1) * (5.5 + Math.random() * 3.5),
        tilt: (Math.random() - 0.5) * 1.4,
        wobbleSpeed: 4 + Math.random() * 4,
        r,
        trail: [],
      });
    } else {
      // Pitched delivery: hurtling onto the pitch surface with chalk puff & turf bounce
      const dur = 2200 + Math.random() * 900;
      const targetCreaseY = h * (0.68 + Math.random() * 0.12);
      const pitchX = w * (0.42 + Math.random() * 0.16);
      balls.push({
        traj: "pitch",
        style,
        x0: fromLeft ? -r * 2 : w + r * 2,
        x1: fromLeft ? w + r * 2 : -r * 2,
        pitchX,
        y0: h * (0.35 + Math.random() * 0.2),
        pitchY: targetCreaseY,
        t: 0,
        dur,
        pitched: false,
        phase: Math.random() * TAU,
        spin: (fromLeft ? 1 : -1) * (6.5 + Math.random() * 4.0),
        tilt: (Math.random() - 0.5) * 1.1,
        wobbleSpeed: 5 + Math.random() * 3,
        r: r * 0.95,
        trail: [],
      });
    }
  }

  function ballPos(b) {
    const k = Math.min(1, b.t / b.dur);
    if (b.traj === "six") {
      const x = b.x0 + (b.x1 - b.x0) * k;
      // Parabolic gravity flight
      const y = b.y0 - (b.y0 - b.apexY) * 4 * k * (1 - k);
      // Perspective scale: grows as it nears the viewer, then recedes
      const scale = 1 + 0.35 * Math.sin(Math.PI * k);
      return { k, x, y, scale };
    } else {
      // Pitched delivery with bounce restitution
      const kPitch = 0.52;
      let x, y, scale;
      if (k <= kPitch) {
        const u = k / kPitch;
        x = b.x0 + (b.pitchX - b.x0) * u;
        y = b.y0 + (b.pitchY - b.y0) * (u * u);
        scale = 0.8 + 0.25 * u;
        if (!b.pitched && k >= kPitch - 0.04) {
          b.pitched = true;
          spawnTurfDust(b.pitchX, b.pitchY);
        }
      } else {
        const u = (k - kPitch) / (1 - kPitch);
        x = b.pitchX + (b.x1 - b.pitchX) * u;
        // Rebound parabolic arc
        const bounceH = Math.abs(b.pitchY - b.y0) * 0.65;
        y = b.pitchY - bounceH * 4 * u * (1 - u * 0.6);
        scale = 1.05 + 0.25 * (1 - u);
      }
      return { k, x, y, scale };
    }
  }

  // 6-row hand-stitched seam with perpendicular cross-stitches on the spinning sphere.
  function drawSeam(r, phase, tilt, seamColor, alpha) {
    const minor = Math.max(0.04, Math.abs(Math.cos(phase))) * r * 0.98;
    const flip = Math.cos(phase) < 0;
    ctx.save();
    ctx.rotate(tilt);
    ctx.globalAlpha = alpha;

    // Seam indentation / trench
    ctx.strokeStyle = "rgba(40, 5, 5, 0.65)";
    ctx.lineWidth = Math.max(2.4, r * 0.22);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.98, minor, 0, 0, TAU);
    ctx.stroke();

    // Twin raised linen string ridges
    ctx.strokeStyle = seamColor || "rgba(255, 248, 235, 0.95)";
    ctx.lineWidth = Math.max(1, r * 0.08);
    const off = Math.max(1.2, r * 0.09);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.98 + off, minor + off * (minor / r), 0, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(1, r * 0.98 - off), Math.max(0.5, minor - off * (minor / r)), 0, 0, TAU);
    ctx.stroke();

    // Cross-stitches along the visible half of the seam
    ctx.lineWidth = Math.max(0.9, r * 0.055);
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const facing = flip ? Math.sin(a) < 0 : Math.sin(a) > 0;
      if (!facing && minor > r * 0.25) continue;
      const cx = Math.cos(a) * r * 0.98;
      const cy = Math.sin(a) * minor;
      const nx = Math.cos(a) * off;
      const ny = Math.sin(a) * off * (minor / r);
      ctx.beginPath();
      ctx.moveTo(cx - nx, cy - ny);
      ctx.lineTo(cx + nx, cy + ny);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Embossed gold foil branding crest ("CRICKETLE") on the polished face
  function drawGoldStamp(r, phase, tilt) {
    if (Math.sin(phase) < 0.2) return; // Hidden on reverse hemisphere
    ctx.save();
    ctx.rotate(tilt);
    const cx = Math.cos(phase + Math.PI / 2) * r * 0.45;
    const cy = 0;
    const stampR = r * 0.32;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(Math.abs(Math.sin(phase)), 1);

    // Gold foil metallic shimmer
    ctx.strokeStyle = "rgba(253, 224, 71, 0.75)";
    ctx.fillStyle = "rgba(245, 158, 11, 0.85)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, stampR, 0, TAU);
    ctx.stroke();

    // Central star / crown emblem
    ctx.fillStyle = "rgba(254, 240, 138, 0.9)";
    ctx.font = `bold ${Math.max(4, r * 0.22)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("★", 0, -1);

    ctx.restore();
    ctx.restore();
  }

  function drawBall(b) {
    const { k, x, y, scale } = ballPos(b);
    const r = b.r * scale;
    const fade = Math.min(1, Math.min(k, 1 - k) * 7);
    const style = b.style;

    // Aerodynamic motion trail
    b.trail.unshift({ x, y, r });
    if (b.trail.length > 8) b.trail.pop();
    for (let i = 1; i < b.trail.length; i++) {
      const g = b.trail[i];
      const trailAlpha = 0.16 * (1 - i / b.trail.length) * fade;
      ctx.fillStyle = `${style.mid}${Math.round(trailAlpha * 255).toString(16).padStart(2, "0")}`;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * (1 - i * 0.08), 0, TAU);
      ctx.fill();
    }

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(x, y);

    // Floodlight / ambient glow catching the leather
    const glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.5);
    glow.addColorStop(0, `${style.primary}44`);
    glow.addColorStop(1, `${style.primary}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.5, 0, TAU);
    ctx.fill();

    // 3D Leather Body with dynamic sphere shading
    const body = ctx.createRadialGradient(LIGHT.x * r, LIGHT.y * r, r * 0.06, 0, 0, r * 1.05);
    body.addColorStop(0, style.light);
    body.addColorStop(0.24, style.primary);
    body.addColorStop(0.68, style.mid);
    body.addColorStop(1, style.dark);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    // Green grass ambient bounce light on underside
    const turfBounce = ctx.createRadialGradient(0, r * 0.9, 0, 0, r * 0.9, r * 0.8);
    turfBounce.addColorStop(0, "rgba(34, 197, 94, 0.22)");
    turfBounce.addColorStop(1, "rgba(34, 197, 94, 0)");
    ctx.fillStyle = turfBounce;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    // Quarter seams (faint perpendicular indentation curves)
    drawSeam(r * 0.97, b.phase + Math.PI / 2, b.tilt + Math.PI / 2, style.seam, 0.18);

    // Main 6-row raised linen seam with gyroscopic wobble
    const wobble = Math.sin(b.t * 0.006 * b.wobbleSpeed) * 0.18;
    drawSeam(r, b.phase, b.tilt + wobble, style.seam, 1.0);

    // Gold foil brand crest
    drawGoldStamp(r, b.phase, b.tilt + wobble);

    // Polished hemisphere: glossy lacquer specular reflection hotspot
    const spec = ctx.createRadialGradient(LIGHT.x * r * 0.9, LIGHT.y * r * 0.9, 0, LIGHT.x * r * 0.9, LIGHT.y * r * 0.9, r * 0.58);
    spec.addColorStop(0, "rgba(255, 255, 255, 0.72)");
    spec.addColorStop(0.25, "rgba(255, 255, 255, 0.22)");
    spec.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    // Rim darkening for spherical depth
    const rim = ctx.createRadialGradient(0, 0, r * 0.75, 0, 0, r);
    rim.addColorStop(0, "rgba(0, 0, 0, 0)");
    rim.addColorStop(1, "rgba(0, 0, 0, 0.50)");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  function updateBalls(dt) {
    for (const b of balls) {
      b.t += dt * 1000;
      b.phase += b.spin * dt;
      drawBall(b);
    }
    balls = balls.filter((b) => b.t < b.dur);
  }

  // ---------- English Willow Cricket Bat & Authentic Stroke Animation ----------

  function spawnBat() {
    const fromLeft = Math.random() < 0.5;
    const depth = 0.65 + Math.random() * 0.35;
    const len = Math.min(w, h) * (0.26 + Math.random() * 0.08) * depth;
    const isStroke = Math.random() < 0.65;
    const p = pitchGeometry();

    if (isStroke) {
      // Dynamic cricket stroke (cover drive downswing & follow-through) at the batting crease
      const dur = 3200 + Math.random() * 1000;
      const side = fromLeft ? -1 : 1;
      const strokeX = p.cx + side * (p.pwBot * 0.32);
      const strokeY = p.creaseY - 14;
      bats.push({
        mode: "stroke",
        fromLeft,
        x: strokeX,
        y: strokeY,
        t: 0,
        dur,
        len,
        depth,
        impactDone: false,
        alpha: 0.45 + depth * 0.45,
        grain: Array.from({ length: 9 }, () => ({
          o: (Math.random() - 0.5) * 0.88,
          a: 0.09 + Math.random() * 0.14,
          wob: Math.random() * 0.7,
        })),
      });
    } else {
      // Graceful floating willow in stadium depth
      bats.push({
        mode: "drift",
        fromLeft,
        x: fromLeft ? -len : w + len,
        y: h * (0.18 + Math.random() * 0.45),
        vx: (fromLeft ? 1 : -1) * (18 + Math.random() * 16) * depth,
        bob: Math.random() * TAU,
        rot: Math.random() * TAU,
        vr: (Math.random() < 0.5 ? -1 : 1) * (0.22 + Math.random() * 0.28),
        len,
        depth,
        alpha: 0.25 + depth * 0.42,
        grain: Array.from({ length: 9 }, () => ({
          o: (Math.random() - 0.5) * 0.88,
          a: 0.09 + Math.random() * 0.14,
          wob: Math.random() * 0.7,
        })),
      });
    }
  }

  // Renders a handcrafted English willow cricket bat in local coordinates.
  function drawBat(b, currentRot, alphaOverride) {
    const L = b.len;
    const bladeW = L * 0.20;
    const bladeL = L * 0.62;
    const handleL = L * 0.38;
    const handleW = bladeW * 0.26;
    const isStroke = b.mode === "stroke";

    // For stroke animation: pivot around batsman's hands on the handle.
    // For floating bat: pivot around blade sweet spot.
    const pivotY = isStroke ? -L * 0.38 : 0;
    const toeY = L * 0.48 - pivotY;
    const shoulderY = toeY - bladeL;
    const handleTop = shoulderY - handleL;

    ctx.save();
    ctx.globalAlpha = alphaOverride !== undefined ? alphaOverride : b.alpha;
    ctx.translate(b.x, b.y);
    ctx.rotate(currentRot !== undefined ? currentRot : b.rot);

    // Bat ground / depth shadow
    ctx.save();
    ctx.translate(-LIGHT.x * L * 0.06, -LIGHT.y * L * 0.06);
    ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
    roundRect(-bladeW / 2, shoulderY, bladeW, bladeL, bladeW * 0.26);
    ctx.fill();
    ctx.restore();

    // Blade face: authentic pale English willow with subtle heartwood gradient
    const face = ctx.createLinearGradient(-bladeW / 2, 0, bladeW / 2, 0);
    face.addColorStop(0, "#b0854c");
    face.addColorStop(0.12, "#ebd5ac");
    face.addColorStop(0.5, "#f7e8c8");
    face.addColorStop(0.88, "#e2c899");
    face.addColorStop(1, "#8d6635");
    ctx.fillStyle = face;
    roundRect(-bladeW / 2, shoulderY, bladeW, bladeL, bladeW * 0.26);
    ctx.fill();

    // Natural willow wood grain: organic growth lines running down the face
    ctx.save();
    roundRect(-bladeW / 2, shoulderY, bladeW, bladeL, bladeW * 0.26);
    ctx.clip();
    ctx.lineWidth = 1;
    for (const g of b.grain) {
      ctx.strokeStyle = `rgba(115, 75, 30, ${g.a})`;
      ctx.beginPath();
      const gx = g.o * bladeW * 0.48;
      ctx.moveTo(gx, shoulderY);
      for (let y = shoulderY; y <= toeY; y += bladeL / 6) {
        ctx.lineTo(gx + Math.sin(y / L * 9 + g.wob) * bladeW * 0.02, y);
      }
      ctx.stroke();
    }

    // High swell spine / sweet-spot lacquer sheen
    const sheen = ctx.createRadialGradient(-bladeW * 0.15, toeY - bladeL * 0.45, 0, 0, toeY - bladeL * 0.45, bladeW);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.28)");
    sheen.addColorStop(0.6, "rgba(255, 255, 255, 0.08)");
    sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(-bladeW, shoulderY, bladeW * 2, bladeL);

    // Branded cricket decal sticker running down the spine ("CRICKETLE")
    const stickerY = toeY - bladeL * 0.65;
    const stickerH = bladeL * 0.35;
    const stickerG = ctx.createLinearGradient(-bladeW * 0.22, 0, bladeW * 0.22, 0);
    stickerG.addColorStop(0, "#1e3a8a");
    stickerG.addColorStop(0.5, "#3b82f6");
    stickerG.addColorStop(1, "#1e3a8a");
    ctx.fillStyle = stickerG;
    roundRect(-bladeW * 0.22, stickerY, bladeW * 0.44, stickerH, 3);
    ctx.fill();

    // Chrome / gold foil logo accent on decal
    ctx.fillStyle = "#fef08a";
    ctx.font = `bold ${Math.max(5, bladeW * 0.18)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CRICKETLE", 0, stickerY + stickerH * 0.5);

    ctx.restore();

    // Outer edge contour and bevel line
    ctx.strokeStyle = "rgba(90, 60, 25, 0.55)";
    ctx.lineWidth = 1.2;
    roundRect(-bladeW / 2, shoulderY, bladeW, bladeL, bladeW * 0.26);
    ctx.stroke();

    // Red protective rubber toe guard
    ctx.fillStyle = "#991b1b";
    ctx.fillRect(-bladeW / 2 + 1.5, toeY - 4, bladeW - 3, 4);

    // Traditional wooden shoulder splice tapering into the cane handle
    ctx.fillStyle = "#d7bb8c";
    ctx.beginPath();
    ctx.moveTo(-bladeW / 2 + bladeW * 0.12, shoulderY + 1);
    ctx.quadraticCurveTo(-handleW, shoulderY - handleL * 0.20, -handleW / 2, shoulderY - handleL * 0.22);
    ctx.lineTo(handleW / 2, shoulderY - handleL * 0.22);
    ctx.quadraticCurveTo(handleW, shoulderY - handleL * 0.20, bladeW / 2 - bladeW * 0.12, shoulderY + 1);
    ctx.closePath();
    ctx.fill();

    // Cane handle with textured rubber chevron grip
    const handleStart = shoulderY - handleL * 0.22;
    const grip = ctx.createLinearGradient(-handleW / 2, 0, handleW / 2, 0);
    grip.addColorStop(0, "#0f172a");
    grip.addColorStop(0.4, "#2563eb");
    grip.addColorStop(0.6, "#3b82f6");
    grip.addColorStop(1, "#0f172a");
    ctx.fillStyle = grip;
    roundRect(-handleW / 2, handleTop, handleW, handleStart - handleTop, handleW / 2);
    ctx.fill();

    // Ribbed chevron grip ridges
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1;
    const ridges = 12;
    for (let i = 1; i < ridges; i++) {
      const y = handleTop + (i / ridges) * (handleStart - handleTop);
      ctx.beginPath();
      ctx.moveTo(-handleW / 2 + 1, y + 2);
      ctx.lineTo(handleW / 2 - 1, y - 2);
      ctx.stroke();
    }

    // Grip top cap
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.ellipse(0, handleTop + 1, handleW / 2, handleW * 0.28, 0, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  function updateBats(dt, t) {
    for (const b of bats) {
      if (b.mode === "stroke") {
        b.t += dt * 1000;
        const progress = Math.min(1, b.t / b.dur);
        let rot, alpha;
        const dir = b.fromLeft ? 1 : -1;

        if (progress < 0.25) {
          const u = progress / 0.25;
          rot = dir * (-0.75 - 0.35 * Math.sin(u * Math.PI * 0.5));
          alpha = b.alpha * Math.min(1, u * 3);
        } else if (progress < 0.50) {
          const u = (progress - 0.25) / 0.25;
          // Fast acceleration downswing
          rot = dir * (-1.10 + 1.45 * (u * u));
          alpha = b.alpha;
          if (!b.impactDone && u >= 0.9) {
            b.impactDone = true;
            spawnTurfDust(b.x + dir * 18, b.y + b.len * 0.5);
          }
        } else if (progress < 0.75) {
          const u = (progress - 0.50) / 0.25;
          // Follow-through extension
          rot = dir * (0.35 + 0.55 * Math.sin(u * Math.PI * 0.5));
          alpha = b.alpha;
        } else {
          const u = (progress - 0.75) / 0.25;
          rot = dir * 0.90;
          alpha = b.alpha * (1 - u);
        }
        drawBat(b, rot, alpha);
      } else {
        b.x += b.vx * dt;
        b.y += Math.sin(t / 1800 + b.bob) * 6 * dt;
        b.rot += b.vr * dt;
        drawBat(b);
      }
    }
    bats = bats.filter((b) => (b.mode === "stroke" ? b.t < b.dur : b.x > -b.len * 1.5 && b.x < w + b.len * 1.5));
  }

  // ---------- Celebration Confetti ----------

  function burst(colors) {
    if (reduceMotion.matches) return;
    const palette = colors && colors.length ? colors : ["#22c55e", "#f59e0b", "#38bdf8", "#f8fafc"];
    const cx = w * 0.5;
    const cy = Math.min(h * 0.35, 320);
    const n = Math.min(160, Math.round(w / 5));
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.92;
      const speed = 380 + Math.random() * 520;
      confetti.push({
        x: cx + (Math.random() - 0.5) * 60,
        y: cy,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        sw: 6 + Math.random() * 6,
        sh: 3 + Math.random() * 5,
        color: palette[i % palette.length],
        life: 0,
        ttl: 2200 + Math.random() * 900,
      });
    }
    ensureRunning();
  }

  function drawConfetti(dt) {
    for (const c of confetti) {
      c.life += dt * 1000;
      c.vy += 900 * dt;
      c.vx *= 1 - 0.9 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      const a = 1 - Math.max(0, (c.life - c.ttl * 0.6) / (c.ttl * 0.4));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.sw / 2, -c.sh / 2, c.sw, c.sh);
      ctx.restore();
    }
    confetti = confetti.filter((c) => c.life < c.ttl && c.y < h + 40);
  }

  // ---------- Main Animation Loop & Lifecycle ----------

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    mix = mixTarget;
    drawStumps(drawScene(0, 0), mix);
  }

  const MIN_FRAME_MS = 1000 / 30;

  function frame(now) {
    raf = 0;
    if (small() && now - last < MIN_FRAME_MS - 1) {
      if (!document.hidden) raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    elapsed += dt * 1000;

    ctx.clearRect(0, 0, w, h);
    const pitch = drawScene(dt, now);
    drawParticles(dt, now);

    // Dynamic willow bats (now rendered for all devices)
    const maxBats = small() ? 1 : 2;
    if (elapsed >= nextBatAt && bats.length < maxBats) {
      spawnBat();
      nextBatAt = elapsed + 8000 + Math.random() * 6000;
    }
    updateBats(dt, now);

    // Stumps positioned on popping crease
    drawStumps(pitch, mix);

    // Dynamic leather match balls with realistic trajectory and spin
    const maxBalls = small() ? 1 : 2;
    if (elapsed >= nextBallAt && balls.length < maxBalls) {
      spawnBall();
      nextBallAt = elapsed + 6000 + Math.random() * 5000;
    }
    updateBalls(dt);
    updateTurfDust(dt);
    drawConfetti(dt);

    if (!document.hidden) raf = requestAnimationFrame(frame);
  }

  function ensureRunning() {
    if (raf || reduceMotion.matches || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : ensureRunning()));
  reduceMotion.addEventListener?.("change", () => (reduceMotion.matches ? (stop(), drawStatic()) : ensureRunning()));
  window.addEventListener("resize", resize);
  if (theme) {
    theme.onChange((scene) => {
      mixTarget = scene === "day" ? 1 : 0;
      if (reduceMotion.matches || document.hidden) drawStatic();
    });
  }

  resize();
  drawStatic();
  const start = () => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(ensureRunning, { timeout: 2000 });
    else setTimeout(ensureRunning, 800);
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });

  window.CricketleFX = { burst };
})();

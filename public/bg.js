// Cricketle background FX: a cricket stadium on a <canvas>, by night or by day.
// Night: floodlight beams and drifting haze. Day: blue sky, sun with bloom, slow
// clouds, distant stands. Both: mown outfield with a pitch and stumps, a leather
// ball spinning across the sky, willow bats tumbling in the depth, and a confetti
// burst on a solve. The scene follows window.CricketleTheme and cross-fades over
// 600 ms. DPR capped, paused when the tab is hidden, static under
// prefers-reduced-motion.
//
// Exposes window.CricketleFX = { burst(colors) }.

(function () {
  "use strict";

  const canvas = document.getElementById("bg");
  if (!canvas) return;
  let ctx = canvas.getContext("2d"); // swapped to an offscreen context while a layer is painted
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const TAU = Math.PI * 2;

  let w = 0, h = 0, dpr = 1;
  let particles = [];
  let balls = [];
  let bats = [];
  let confetti = [];
  let raf = 0;
  let last = 0;
  let elapsed = 0;
  let nextBallAt = 3000;
  let nextBatAt = 1500;

  // Scene blend: 0 = night (floodlit), 1 = day (sunlit). Eases towards the
  // theme over FADE_MS under motion and snaps under reduced motion.
  const FADE_MS = 600;
  const theme = window.CricketleTheme;
  let mix = theme && theme.current() === "day" ? 1 : 0;
  let mixTarget = mix;
  let clouds = [];
  const SUN = { x: 0.8, y: 0.15 }; // fraction of the viewport

  // Light comes from the two floodlight towers at the top corners; shading uses this.
  const LIGHT = { x: -0.42, y: -0.5 }; // unit-ish offset for highlights

  // ---------- Setup ----------

  // Phones get a lighter scene: lower pixel ratio, fewer particles, no bats.
  const coarse = matchMedia("(pointer: coarse)");
  let isSmall = false; // refreshed on resize; read every frame
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

  // Static parts of each scene are painted once per resize into offscreen
  // canvases and blitted every frame: a full-screen radial gradient per frame
  // is what made phones struggle. Only clouds, the sun disc, the floodlight
  // pulse, particles, balls and bats are drawn live.
  let layers = {};
  const PAINTERS = {
    night: () => drawNightSky(),
    glow: () => drawFloodlights(0, 1),
    day: () => { drawDaySky(); drawSunBloom(); drawStands(); },
    pitchNight: () => drawPitch(0),
    pitchDay: () => drawPitch(1),
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

  // Layers are painted on first use, so startup only pays for the scene shown.
  function buildLayers() { layers = {}; }

  function blit(name) {
    if (!layers[name]) paintLayer(name, PAINTERS[name]);
    ctx.drawImage(layers[name], 0, 0, w, h);
  }

  // Sparse clouds, kept high so they never cover the cards. Phones get three.
  function initClouds() {
    const n = small() ? 3 : 5;
    clouds = Array.from({ length: n }, (_, i) => ({
      x: (i + Math.random()) * (w / n),
      y: h * (0.12 + Math.random() * 0.22),
      s: 0.6 + Math.random() * 0.8,
      v: 4 + Math.random() * 6, // px per second, left to right
    }));
  }

  function initParticles() {
    const n = Math.round(Math.min(small() ? 36 : 80, (w * h) / (small() ? 30000 : 18000)));
    particles = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.7 + Math.random() * 2,
      vx: (Math.random() - 0.5) * 6,
      vy: -(4 + Math.random() * 9),
      a: 0.1 + Math.random() * 0.28,
      ph: Math.random() * TAU,
    }));
  }

  // ---------- Stadium ----------

  // Both skies are opaque so the canvas is a complete picture on its own.
  function drawNightSky() {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#0b1220");
    g.addColorStop(0.45, "#0f172a");
    g.addColorStop(1, "#0b2a1c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawDaySky() {
    const horizon = h * 0.62;
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, "#2f8fd6");
    g.addColorStop(0.55, "#7cc0ee");
    g.addColorStop(1, "#dff1ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, horizon + 1);
  }

  function sunGeom() { return { x: w * SUN.x, y: h * SUN.y, r: Math.min(w, h) * 0.055 }; }

  function drawSunBloom() {
    const { x, y, r } = sunGeom();
    const bloom = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 7);
    bloom.addColorStop(0, "rgba(255, 244, 200, 0.55)");
    bloom.addColorStop(0.25, "rgba(255, 236, 170, 0.18)");
    bloom.addColorStop(1, "rgba(255, 236, 170, 0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(x - r * 7, y - r * 7, r * 14, r * 14);
  }

  function drawSunDisc(t) {
    const { x, y, r } = sunGeom();
    const pulse = 1 + 0.03 * Math.sin(t / 3000);
    const disc = ctx.createRadialGradient(x, y, 0, x, y, r * pulse);
    disc.addColorStop(0, "#fffbe6");
    disc.addColorStop(0.7, "#ffe9a3");
    disc.addColorStop(1, "rgba(255, 225, 140, 0.6)");
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(x, y, r * pulse, 0, TAU); ctx.fill();
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
    // shaded underside
    ctx.fillStyle = "rgba(170, 200, 230, 0.35)";
    ctx.beginPath(); ctx.ellipse(c.x + b * 0.1, c.y + b * 0.25, b * 1.5, b * 0.25, 0, 0, TAU); ctx.fill();
  }

  function drawClouds(dt) {
    for (const c of clouds) {
      c.x += c.v * dt;
      const span = Math.min(w, h) * 0.12 * c.s;
      if (c.x - span > w) c.x = -span;
      drawCloud(c);
    }
  }

  // Distant stands along the boundary: tiers of seats under a light roof line.
  function drawStands() {
    const horizon = h * 0.62;
    const top = horizon - h * 0.11;
    const tiers = 4;
    const th = (horizon - top - 6) / tiers;
    for (let i = 0; i < tiers; i++) {
      ctx.fillStyle = i % 2 ? "rgba(96, 116, 146, 0.78)" : "rgba(126, 146, 176, 0.78)";
      ctx.fillRect(0, top + 6 + i * th, w, th + 1);
    }
    ctx.fillStyle = "rgba(20, 30, 50, 0.22)"; // shadow under the roof
    ctx.fillRect(0, top + 12, w, th * 0.6);
    ctx.fillStyle = "rgba(240, 244, 248, 0.9)"; // boundary boards
    ctx.fillRect(0, horizon - 5, w, 5);
    ctx.fillStyle = "#e4ebf2"; // roof, slightly curved
    ctx.beginPath();
    ctx.moveTo(0, top + 8);
    ctx.quadraticCurveTo(w / 2, top - 10, w, top + 8);
    ctx.lineTo(w, top + 14);
    ctx.quadraticCurveTo(w / 2, top - 4, 0, top + 14);
    ctx.closePath();
    ctx.fill();
  }

  // Draws the sky for the current blend and returns the pitch geometry.
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

  function floodPulse(t) { return 0.85 + 0.15 * Math.sin(t / 2600); }

  function drawFloodlights(t, fixedPulse) {
    const pulse = fixedPulse !== undefined ? fixedPulse : floodPulse(t);
    const spread = Math.max(w, h) * 0.95;
    ctx.globalCompositeOperation = "lighter";
    for (const L of [{ x: w * 0.08, y: -h * 0.08 }, { x: w * 0.92, y: -h * 0.08 }]) {
      const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, spread);
      g.addColorStop(0, `rgba(190, 230, 255, ${0.16 * pulse})`);
      g.addColorStop(0.35, `rgba(120, 190, 160, ${0.07 * pulse})`);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // Returns the pitch geometry so the stumps can sit on it. `day` is the scene
  // blend (0 night, 1 day): sunlight brings up the outfield, stripes and creases.
  function pitchGeometry() {
    const top = h * 0.62;
    const bh = (h - top) / 9;
    const pw = Math.min(w * 0.22, 220);
    const px = (w - pw) / 2;
    return { px, pw, stripTop: top + bh * 2, creaseY: top + bh * 3.1 };
  }

  function drawPitch(day) {
    const top = h * 0.62;
    const bands = 9;
    const bh = (h - top) / bands;
    if (day > 0) {
      ctx.save();
      ctx.globalAlpha = day;
      const field = ctx.createLinearGradient(0, top, 0, h);
      field.addColorStop(0, "#52b04c");
      field.addColorStop(1, "#2f7d32");
      ctx.fillStyle = field;
      ctx.fillRect(0, top, w, h - top);
      ctx.restore();
    }
    const sr = Math.round(34 + 156 * day), sg = Math.round(197 + 43 * day), sb = Math.round(94 + 56 * day);
    for (let i = 0; i < bands; i++) {
      const a = i % 2 ? 0.035 + 0.105 * day : 0.015 + 0.025 * day;
      ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${a})`;
      ctx.fillRect(0, top + i * bh, w, bh + 1);
    }
    const pw = Math.min(w * 0.22, 220);
    const px = (w - pw) / 2;
    const stripTop = top + bh * 2;
    const g = ctx.createLinearGradient(0, stripTop, 0, h);
    g.addColorStop(0, `rgba(245, 222, 179, ${0.03 + 0.72 * day})`);
    g.addColorStop(1, `rgba(232, 208, 160, ${0.07 + 0.83 * day})`);
    ctx.fillStyle = g;
    ctx.fillRect(px, stripTop, pw, h - stripTop);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.08 + 0.6 * day})`;
    ctx.lineWidth = 1 + day;
    ctx.beginPath();
    ctx.moveTo(px - 14, top + bh * 3.1); ctx.lineTo(px + pw + 14, top + bh * 3.1);
    ctx.moveTo(px - 14, top + bh * 8.3); ctx.lineTo(px + pw + 14, top + bh * 8.3);
    ctx.stroke();
    return { px, pw, stripTop, creaseY: top + bh * 3.1 };
  }

  function drawStumps(pitch, day) {
    const cx = pitch.px + pitch.pw / 2;
    const baseY = pitch.creaseY - 4;
    const height = Math.min(110, Math.max(64, h * 0.11));
    const gap = height * 0.17;
    const sw = Math.max(5, height * 0.075);
    if (day > 0) {
      // Long shadow on the grass, cast away from the sun (upper right): down-left.
      ctx.save();
      ctx.globalAlpha = 0.28 * day;
      ctx.translate(cx, baseY + 2);
      ctx.transform(1, 0, 0.9, -0.28, 0, 0);
      ctx.fillStyle = "#0a2a12";
      for (let i = -1; i <= 1; i++) {
        roundRect(i * gap - sw / 2, -height, sw, height, sw / 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = 0.72;
    // ground shadow
    const sh = ctx.createRadialGradient(cx, baseY + 2, 0, cx, baseY + 2, gap * 2.6);
    sh.addColorStop(0, "rgba(0, 0, 0, 0.45)");
    sh.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.ellipse(cx, baseY + 2, gap * 2.6, sw * 1.2, 0, 0, TAU); ctx.fill();
    // three stumps
    for (let i = -1; i <= 1; i++) {
      const x = cx + i * gap;
      const g = ctx.createLinearGradient(x - sw / 2, 0, x + sw / 2, 0);
      g.addColorStop(0, "#5a3a16");
      g.addColorStop(0.3, "#d9b27a");
      g.addColorStop(0.55, "#f1dcb3");
      g.addColorStop(1, "#6b4520");
      ctx.fillStyle = g;
      roundRect(x - sw / 2, baseY - height, sw, height, sw / 2);
      ctx.fill();
      // metal ferrule at the top
      ctx.fillStyle = "rgba(230, 236, 245, 0.85)";
      ctx.fillRect(x - sw / 2, baseY - height + 2, sw, Math.max(2, sw * 0.35));
    }
    // bails resting in the grooves
    const bailY = baseY - height - sw * 0.25;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2.5, sw * 0.5);
    for (let i = -1; i <= 0; i++) {
      const x0 = cx + i * gap + sw * 0.1;
      const x1 = cx + (i + 1) * gap - sw * 0.1;
      const g = ctx.createLinearGradient(0, bailY - 3, 0, bailY + 3);
      g.addColorStop(0, "#f3dfb8");
      g.addColorStop(1, "#8a5a28");
      ctx.strokeStyle = g;
      ctx.beginPath(); ctx.moveTo(x0, bailY); ctx.lineTo(x1, bailY); ctx.stroke();
      // bulbs at the ends
      ctx.fillStyle = "#c99a5c";
      ctx.beginPath(); ctx.arc(x0 - 1, bailY, ctx.lineWidth * 0.55, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x1 + 1, bailY, ctx.lineWidth * 0.55, 0, TAU); ctx.fill();
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

  function drawParticles(dt, t) {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      const tw = 0.7 + 0.3 * Math.sin(t / 900 + p.ph);
      ctx.fillStyle = `rgba(220, 240, 255, ${p.a * tw})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
  }

  // ---------- Leather ball ----------

  function spawnBall() {
    const fromLeft = Math.random() < 0.5;
    const r = 11 + Math.random() * 8;
    balls.push({
      x0: fromLeft ? -r * 3 : w + r * 3,
      x1: fromLeft ? w + r * 3 : -r * 3,
      baseY: h * (0.76 + Math.random() * 0.14),
      apexY: h * (0.1 + Math.random() * 0.25),
      t: 0,
      dur: 7500 + Math.random() * 4500,
      phase: Math.random() * TAU,            // spin phase around its axis
      spin: (fromLeft ? 1 : -1) * (2.4 + Math.random() * 1.8),
      tilt: (Math.random() - 0.5) * 1.2,     // seam axis tilt
      r,
      trail: [],
    });
  }

  function ballPos(b) {
    const k = b.t / b.dur;
    return {
      k,
      x: b.x0 + (b.x1 - b.x0) * k,
      y: b.baseY - (b.baseY - b.apexY) * 4 * k * (1 - k),
    };
  }

  // Seam drawn as a great circle on a spinning sphere: an ellipse whose minor
  // radius follows cos(phase), tilted by the spin axis. Stitching runs along it.
  function drawSeam(r, phase, tilt, alpha) {
    const minor = Math.max(0.06, Math.abs(Math.cos(phase))) * r * 0.98;
    const flip = Math.cos(phase) < 0;
    ctx.save();
    ctx.rotate(tilt);
    ctx.globalAlpha = alpha;
    // Seam ridge: dark groove + two raised stitch rows.
    ctx.strokeStyle = "rgba(60, 10, 10, 0.55)";
    ctx.lineWidth = Math.max(2.2, r * 0.2);
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.98, minor, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(255, 246, 228, 0.95)";
    ctx.lineWidth = Math.max(1, r * 0.075);
    const off = Math.max(1.2, r * 0.085);
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.98 + off, minor + off * (minor / r), 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, Math.max(1, r * 0.98 - off), Math.max(0.5, minor - off * (minor / r)), 0, 0, TAU); ctx.stroke();
    // Cross stitches between the two rows (only on the side facing us).
    ctx.lineWidth = Math.max(0.8, r * 0.05);
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const facing = flip ? Math.sin(a) < 0 : Math.sin(a) > 0;
      if (!facing && minor > r * 0.25) continue;
      const cx = Math.cos(a) * r * 0.98, cy = Math.sin(a) * minor;
      const nx = Math.cos(a) * off, ny = Math.sin(a) * off * (minor / r);
      ctx.beginPath(); ctx.moveTo(cx - nx, cy - ny); ctx.lineTo(cx + nx, cy + ny); ctx.stroke();
    }
    ctx.restore();
  }

  function drawBall(b) {
    const { k, x, y } = ballPos(b);
    const r = b.r;
    const fade = Math.min(1, Math.min(k, 1 - k) * 8);

    // Motion trail: faded ghosts behind the ball.
    b.trail.unshift({ x, y });
    if (b.trail.length > 7) b.trail.pop();
    for (let i = 1; i < b.trail.length; i++) {
      const g = b.trail[i];
      ctx.fillStyle = `rgba(220, 60, 60, ${0.12 * (1 - i / b.trail.length) * fade})`;
      ctx.beginPath(); ctx.arc(g.x, g.y, r * (1 - i * 0.06), 0, TAU); ctx.fill();
    }

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(x, y);

    // Ambient glow from the floodlights catching the leather.
    const glow = ctx.createRadialGradient(0, 0, r * 0.7, 0, 0, r * 2.6);
    glow.addColorStop(0, "rgba(230, 80, 70, 0.22)");
    glow.addColorStop(1, "rgba(230, 80, 70, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.6, 0, TAU); ctx.fill();

    // Leather body: lit from top-left, deep shadow on the limb.
    const body = ctx.createRadialGradient(LIGHT.x * r, LIGHT.y * r, r * 0.08, 0, 0, r * 1.05);
    body.addColorStop(0, "#ff7b6b");
    body.addColorStop(0.25, "#e03a35");
    body.addColorStop(0.7, "#a51c1c");
    body.addColorStop(1, "#4b0c0c");
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

    // Quarter seams: faint lines on each hemisphere, perpendicular to the main seam.
    drawSeam(r * 0.98, b.phase + Math.PI / 2, b.tilt + Math.PI / 2, 0.18);

    // Main seam with stitching.
    drawSeam(r, b.phase, b.tilt, 1);

    // Polished-side specular highlight and soft sheen.
    const spec = ctx.createRadialGradient(LIGHT.x * r * 0.9, LIGHT.y * r * 0.9, 0, LIGHT.x * r * 0.9, LIGHT.y * r * 0.9, r * 0.6);
    spec.addColorStop(0, "rgba(255, 255, 255, 0.55)");
    spec.addColorStop(0.3, "rgba(255, 255, 255, 0.18)");
    spec.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = spec;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

    // Rim darkening to round the sphere off.
    const rim = ctx.createRadialGradient(0, 0, r * 0.75, 0, 0, r);
    rim.addColorStop(0, "rgba(0, 0, 0, 0)");
    rim.addColorStop(1, "rgba(0, 0, 0, 0.45)");
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

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

  // ---------- Willow bat ----------

  function spawnBat() {
    const fromLeft = Math.random() < 0.5;
    const depth = 0.55 + Math.random() * 0.45;        // 1 = nearest
    const len = Math.min(w, h) * (0.28 + Math.random() * 0.1) * depth;
    bats.push({
      x: fromLeft ? -len : w + len,
      y: h * (0.15 + Math.random() * 0.5),
      vx: (fromLeft ? 1 : -1) * (18 + Math.random() * 16) * depth,
      bob: Math.random() * TAU,
      rot: Math.random() * TAU,
      vr: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.3),
      len,
      depth,
      alpha: 0.28 + depth * 0.45,
      grain: Array.from({ length: 9 }, () => ({ o: (Math.random() - 0.5) * 0.9, a: 0.08 + Math.random() * 0.14, wob: Math.random() * 0.6 })),
    });
  }

  // Bat drawn pointing up (handle at the top) in local coordinates; `len` is total length.
  function drawBat(b) {
    const L = b.len;
    const bladeW = L * 0.19;
    const bladeL = L * 0.6;
    const handleL = L * 0.4;
    const handleW = bladeW * 0.26;
    const toeY = L / 2;
    const shoulderY = toeY - bladeL;
    const handleTop = -L / 2;

    ctx.save();
    ctx.globalAlpha = b.alpha;
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);

    // Soft shadow offset away from the light.
    ctx.save();
    ctx.translate(-LIGHT.x * L * 0.06, -LIGHT.y * L * 0.06);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    roundRect(-bladeW / 2, shoulderY, bladeW, bladeL, bladeW * 0.28);
    ctx.fill();
    ctx.restore();

    // Blade face: pale willow, lit edge on the light side, darker on the other.
    const face = ctx.createLinearGradient(-bladeW / 2, 0, bladeW / 2, 0);
    face.addColorStop(0, "#b48a52");
    face.addColorStop(0.12, "#e6cfa3");
    face.addColorStop(0.5, "#f4e3bf");
    face.addColorStop(0.88, "#dcc091");
    face.addColorStop(1, "#8f6a3a");
    ctx.fillStyle = face;
    roundRect(-bladeW / 2, shoulderY, bladeW, bladeL, bladeW * 0.28);
    ctx.fill();

    // Willow grain: slightly wavy vertical lines.
    ctx.save();
    roundRect(-bladeW / 2, shoulderY, bladeW, bladeL, bladeW * 0.28);
    ctx.clip();
    ctx.lineWidth = 1;
    for (const g of b.grain) {
      ctx.strokeStyle = `rgba(120, 80, 35, ${g.a})`;
      ctx.beginPath();
      const gx = g.o * bladeW * 0.5;
      ctx.moveTo(gx, shoulderY);
      for (let y = shoulderY; y <= toeY; y += bladeL / 6) {
        ctx.lineTo(gx + Math.sin(y / L * 9 + g.wob) * bladeW * 0.02, y);
      }
      ctx.stroke();
    }
    // Sweet-spot sheen.
    const sheen = ctx.createRadialGradient(-bladeW * 0.15, toeY - bladeL * 0.42, 0, 0, toeY - bladeL * 0.42, bladeW);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.22)");
    sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(-bladeW, shoulderY, bladeW * 2, bladeL);
    ctx.restore();

    // Blade edge line and toe guard.
    ctx.strokeStyle = "rgba(90, 60, 25, 0.5)";
    ctx.lineWidth = 1.2;
    roundRect(-bladeW / 2, shoulderY, bladeW, bladeL, bladeW * 0.28);
    ctx.stroke();
    ctx.fillStyle = "rgba(60, 40, 20, 0.35)";
    ctx.fillRect(-bladeW / 2 + 2, toeY - 4, bladeW - 4, 3);

    // Shoulders tapering into the splice.
    ctx.fillStyle = "#d7bb8c";
    ctx.beginPath();
    ctx.moveTo(-bladeW / 2 + bladeW * 0.12, shoulderY + 1);
    ctx.quadraticCurveTo(-handleW, shoulderY - handleL * 0.18, -handleW / 2, shoulderY - handleL * 0.22);
    ctx.lineTo(handleW / 2, shoulderY - handleL * 0.22);
    ctx.quadraticCurveTo(handleW, shoulderY - handleL * 0.18, bladeW / 2 - bladeW * 0.12, shoulderY + 1);
    ctx.closePath();
    ctx.fill();

    // Cane handle with a rubber grip (dark, with spiral ridges).
    const handleStart = shoulderY - handleL * 0.22;
    const gripLen = handleTop - handleStart;
    const grip = ctx.createLinearGradient(-handleW / 2, 0, handleW / 2, 0);
    grip.addColorStop(0, "#0e1a2b");
    grip.addColorStop(0.4, "#2f4a6d");
    grip.addColorStop(0.6, "#3a5a85");
    grip.addColorStop(1, "#0b1422");
    ctx.fillStyle = grip;
    roundRect(-handleW / 2, handleTop, handleW, handleStart - handleTop, handleW / 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    const ridges = 11;
    for (let i = 1; i < ridges; i++) {
      const y = handleTop + (i / ridges) * (handleStart - handleTop);
      ctx.beginPath(); ctx.moveTo(-handleW / 2 + 1, y + 2); ctx.lineTo(handleW / 2 - 1, y - 2); ctx.stroke();
    }
    // Grip cap.
    ctx.fillStyle = "#101a2a";
    ctx.beginPath(); ctx.ellipse(0, handleTop + 1, handleW / 2, handleW * 0.28, 0, 0, TAU); ctx.fill();
    void gripLen;

    ctx.restore();
  }

  function updateBats(dt, t) {
    for (const b of bats) {
      b.x += b.vx * dt;
      b.y += Math.sin(t / 1800 + b.bob) * 6 * dt;
      b.rot += b.vr * dt;
      drawBat(b);
    }
    bats = bats.filter((b) => b.x > -b.len * 1.5 && b.x < w + b.len * 1.5);
  }

  // ---------- Confetti ----------

  function burst(colors) {
    if (reduceMotion.matches) return;
    const palette = colors && colors.length ? colors : ["#22c55e", "#f59e0b", "#38bdf8", "#f8fafc"];
    const cx = w / 2;
    const cy = Math.min(h * 0.35, 320);
    const n = Math.min(160, Math.round(w / 5));
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const speed = 380 + Math.random() * 520;
      confetti.push({
        x: cx + (Math.random() - 0.5) * 60, y: cy,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 12,
        sw: 6 + Math.random() * 6, sh: 3 + Math.random() * 5,
        color: palette[i % palette.length],
        life: 0, ttl: 2200 + Math.random() * 900,
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

  // ---------- Loop ----------

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    mix = mixTarget;
    drawStumps(drawScene(0, 0), mix);
  }

  // Phones render at 30 fps: half the paint work, no visible difference in a
  // background. Desktops run at the display rate.
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

    // Far layer: bats drift behind the stumps and the ball.
    if (!small() && elapsed >= nextBatAt && bats.length < 2) {
      spawnBat();
      nextBatAt = elapsed + 12000 + Math.random() * 10000;
    }
    updateBats(dt, now);
    drawStumps(pitch, mix);

    if (elapsed >= nextBallAt && balls.length < 2) {
      spawnBall();
      nextBallAt = elapsed + 9000 + Math.random() * 7000;
    }
    updateBalls(dt);
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
  // First paint gets a still frame; the animation starts once the page has
  // loaded and the main thread is idle, so content and fonts come first.
  drawStatic();
  const start = () => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(ensureRunning, { timeout: 2000 });
    else setTimeout(ensureRunning, 800);
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });

  window.CricketleFX = { burst };
})();

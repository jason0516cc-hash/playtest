/**
 * waveMap.js — Wave mode map bounds, dynamic sizing, and spawn utilities.
 *
 * Map grows each wave (call setWaveMapForWave at the start of each DAY phase).
 * Mobs spawn randomly along all 4 edges of the map (perimeter strip).
 */

// ── Map dimensions ────────────────────────────────────────────────────────────
const BASE_W = 6_000;   // squarer map (was 8000)
const BASE_H = 4_500;   // taller → 4:3 ratio

// Map stays flat until Ultra starts spawning (earliestWave 50), then grows 20%
const ULTRA_WAVE      = 28;  // Ultra earliestWave per new config
const ULTRA_SIZE_MULT = 1.20;

// Current map dimensions — updated each wave
let _mapW = BASE_W;
let _mapH = BASE_H;

export function getWaveMapW() { return _mapW; }
export function getWaveMapH() { return _mapH; }

// ── Ant hole sub-map — offset far from main map so coordinates never collide ──
export const ANT_HOLE_OFFSET_X = 200_000;
export const ANT_HOLE_OFFSET_Y = 0;

// Sub-map is 1.6x the wave map size (bigger circular arena)
export function getAntHoleSubMapW() { return Math.round(_mapW * 1.6); }
export function getAntHoleSubMapH() { return Math.round(_mapW * 1.6); } // square bounding box for the circle

// Circle arena: center and radius derived from sub-map dimensions
export function getAntHoleCircleCenter() {
  const ox = ANT_HOLE_OFFSET_X, oy = ANT_HOLE_OFFSET_Y;
  const W = getAntHoleSubMapW();
  return { cx: ox + W / 2, cy: oy + W / 2, r: W / 2 };
}

let _antHoleSubMapActive = false;
let _antHoleGroundColor  = '#b8750a'; // default: ant hole brown

export function activateAntHoleSubMap(groundColor) {
  _antHoleSubMapActive = true;
  _antHoleGroundColor  = groundColor || '#b8750a';
}
export function deactivateAntHoleSubMap() { _antHoleSubMapActive = false; }
export function isAntHoleSubMapActive()   { return _antHoleSubMapActive; }

/**
 * Find a random clear spawn position inside the ant hole sub-map.
 * @param {number} radius - player radius
 * @param {Array}  existingMobs - live mobs array (to avoid overlap)
 * @returns {{ x, y }}
 */
export function findAntHolePlayerSpawn(radius, existingMobs) {
  const { cx, cy, r } = getAntHoleCircleCenter();
  const safeR = r - radius - 40; // stay inside circle with margin
  const MOB_CLEAR = 160;
  for (let i = 0; i < 500; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = Math.random() * safeR;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    let clear = true;
    if (existingMobs) {
      for (const m of existingMobs) {
        if (m.dead) continue;
        if (Math.hypot(x - m.x, y - m.y) < m.radius + MOB_CLEAR) { clear = false; break; }
      }
    }
    if (clear) return { x, y };
  }
  // Fallback: spawn near perimeter opposite to mob clusters
  const fallbackAngle = Math.random() * Math.PI * 2;
  return { x: cx + Math.cos(fallbackAngle) * safeR * 0.8, y: cy + Math.sin(fallbackAngle) * safeR * 0.8 };
}

/** Call at the start of each DAY phase. Map is flat until wave 28 (Ultra), then +20%. */
export function setWaveMapForWave(wave) {
  const mult = wave >= ULTRA_WAVE ? ULTRA_SIZE_MULT : 1.0;
  _mapW = Math.round(BASE_W * mult);
  _mapH = Math.round(BASE_H * mult);
  _waveTriangles = null; // invalidate decoration cache on resize
}

// ── Night mode flag (toggled by renderer each frame) ─────────────────────────
let _isNight = false;
export function setWaveNightMode(v) { _isNight = !!v; }

// ── Biome system ──────────────────────────────────────────────────────────────
let _biome = 'garden'; // 'garden' | 'desert' | 'ocean'
export function setWaveMapBiome(biome) {
  _biome = biome;
  _waveTriangles = null; // invalidate decoration cache on biome change
}
export function getWaveMapBiome() { return _biome; }

// Biome colour palettes
const BIOME_COLORS = {
  garden: {
    void:          '#12100a',
    voidNight:     '#03040a',
    grass:         '#4db85c',
    grassNight:    '#0e1a10',
    spawnGrad:     'rgba(80,180,255,0.06)',
    spawnGradN:    'rgba(40,100,200,0.08)',
    perimDay:      '#c83232',
    perimNight:    '#6020a0',
    perimAlpha:    0.10,
    perimAlphaN:   0.18,
    triColor:      'rgba(0,0,0,0.09)',
    wall:          '#1a0e05',
    wallNight:     '#060c1a',
  },
  desert: {
    void:          '#1a1200',
    voidNight:     '#0a0800',
    grass:         '#d4a843',
    grassNight:    '#2a1e06',
    spawnGrad:     'rgba(255,220,100,0.07)',
    spawnGradN:    'rgba(180,120,20,0.09)',
    perimDay:      '#b05010',
    perimNight:    '#804000',
    perimAlpha:    0.12,
    perimAlphaN:   0.20,
    triColor:      'rgba(0,0,0,0.08)',
    wall:          '#2a1800',
    wallNight:     '#0a0800',
  },
  ocean: {
    void:          '#040e16',
    voidNight:     '#01050a',
    grass:         '#1a5e7e',
    grassNight:    '#0a2233',
    spawnGrad:     'rgba(120,220,255,0.07)',
    spawnGradN:    'rgba(40,140,200,0.09)',
    perimDay:      '#0e3a52',
    perimNight:    '#062038',
    perimAlpha:    0.12,
    perimAlphaN:   0.20,
    triColor:      'rgba(255,255,255,0.06)',
    wall:          '#062030',
    wallNight:     '#020a12',
  },
};

// ── Legacy constant exports (base values, kept for backward compat) ───────────
export const WAVE_MAP_W = BASE_W;
export const WAVE_MAP_H = BASE_H;

export const WAVE_WALL_COLOR = '#1a0e05';

// Left 15% — player + NPC spawn zone (proportional to current map)
const SPAWN_FRAC = 0.15;

/** Dynamic player/NPC spawn positions (centre of spawn zone). */
export function getWavePlayerSpawn() {
  return { x: _mapW * 0.07, y: _mapH * 0.50 };
}
export function getWaveNPCSpawn() {
  return { x: _mapW * 0.12, y: _mapH * 0.50 };
}

// Static aliases used by main.js before dynamic map is set
export const WAVE_PLAYER_SPAWN = { x: BASE_W * 0.07, y: BASE_H * 0.50 };
export const WAVE_NPC_SPAWN    = { x: BASE_W * 0.12, y: BASE_H * 0.50 };

// NPC wander bound — left 40% of current map
export function getNPCWanderXMax() { return _mapW * 0.40; }

// ── Bounds check (flat rectangle, no interior walls) ─────────────────────────
export function waveCanMoveTo(x, y, radius = 22) {
  // Allow positions inside the ant hole sub-map when it is active (circular boundary)
  if (_antHoleSubMapActive) {
    const { cx, cy, r } = getAntHoleCircleCenter();
    if (Math.hypot(x - cx, y - cy) + radius <= r) return true;
  }
  return (
    x - radius >= 0     &&
    x + radius <= _mapW &&
    y - radius >= 0     &&
    y + radius <= _mapH
  );
}

// ── Perimeter mob spawn — all 4 edges, configurable strip width ───────────────
const PERIMETER_FRAC = 0.10; // 10% strip from each edge

/**
 * Pick a random position in the perimeter strip of the current map.
 * Tries up to 400 times to find a non-overlapping spot.
 * Returns { x, y } or null if no clear position found.
 */
export function findWaveMobSpawn(radius, existingMobs) {
  const W      = _mapW;
  const H      = _mapH;
  const stripW = W * PERIMETER_FRAC;
  const stripH = H * PERIMETER_FRAC;
  const margin = radius + 10;

  for (let i = 0; i < 400; i++) {
    const edge = Math.floor(Math.random() * 4); // 0=top 1=right 2=bottom 3=left
    let x, y;

    if (edge === 0) {
      // Top strip
      x = margin + Math.random() * (W - 2 * margin);
      y = margin + Math.random() * stripH;
    } else if (edge === 1) {
      // Right strip
      x = W - stripW + Math.random() * (stripW - margin);
      y = margin + Math.random() * (H - 2 * margin);
    } else if (edge === 2) {
      // Bottom strip
      x = margin + Math.random() * (W - 2 * margin);
      y = H - stripH + Math.random() * (stripH - margin);
    } else {
      // Left strip
      x = margin + Math.random() * (stripW - margin);
      y = margin + Math.random() * (H - 2 * margin);
    }

    // Clamp to valid map area
    x = Math.max(margin, Math.min(W - margin, x));
    y = Math.max(margin, Math.min(H - margin, y));

    if (!waveCanMoveTo(x, y, radius + 4)) continue;

    let clear = true;
    for (const m of existingMobs) {
      if (m.dead) continue;
      if (Math.hypot(x - m.x, y - m.y) < radius + (m.radius || 22) + 40) {
        clear = false;
        break;
      }
    }
    if (clear) return { x, y };
  }
  return null;
}

// ── Player respawn in left spawn band ─────────────────────────────────────────
export function findWavePlayerSpawn(radius, npc, mobs) {
  const W      = _mapW;
  const H      = _mapH;
  const margin = radius + 20;

  // If NPC exists, try to spawn near it (within 200–400 units) but clear of mobs
  if (npc && !npc.dead) {
    const MIN_NPC_DIST = radius + npc.radius + 30;
    const MAX_NPC_DIST = 400;
    const MOB_CLEAR    = 80; // stay this far from any mob
    for (let i = 0; i < 200; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = MIN_NPC_DIST + Math.random() * (MAX_NPC_DIST - MIN_NPC_DIST);
      const x     = npc.x + Math.cos(angle) * dist;
      const y     = npc.y + Math.sin(angle) * dist;
      // Must be inside map bounds
      if (x < margin || x > W - margin || y < margin || y > H - margin) continue;
      if (!waveCanMoveTo(x, y, radius)) continue;
      // Must not overlap any living mob
      let clear = true;
      if (mobs) {
        for (const m of mobs) {
          if (m.dead) continue;
          if (Math.hypot(x - m.x, y - m.y) < m.radius + MOB_CLEAR) { clear = false; break; }
        }
      }
      if (clear) return { x, y };
    }
  }

  // Fallback: original left-zone random spawn
  const xMax = W * SPAWN_FRAC;
  for (let i = 0; i < 100; i++) {
    const x = margin + Math.random() * (xMax - 2 * margin);
    const y = margin + Math.random() * (H - 2 * margin);
    if (waveCanMoveTo(x, y, radius)) return { x, y };
  }
  return getWavePlayerSpawn();
}

// ── Colour utility (ant hole sub-map night tint) ──────────────────────────────
function _darkenHex(hex, amount) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.max(0, ((n >> 16) & 0xff) * amount) | 0;
  const g = Math.max(0, ((n >>  8) & 0xff) * amount) | 0;
  const b = Math.max(0, ((n      ) & 0xff) * amount) | 0;
  return `rgb(${r},${g},${b})`;
}

// ── Draw the wave map ─────────────────────────────────────────────────────────
export function drawWaveMap(ctx, cameraX, cameraY, canvasW, canvasH, zoomV) {
  const W  = _mapW;
  const H  = _mapH;
  const hw = canvasW / 2, hh = canvasH / 2;
  const wx2sx = wx => (wx - cameraX) * zoomV + hw;
  const wy2sy = wy => (wy - cameraY) * zoomV + hh;

  const mapL = wx2sx(0), mapT = wy2sy(0);
  const mapR = wx2sx(W), mapB = wy2sy(H);
  const mapSW = mapR - mapL, mapSH = mapB - mapT;

  const bc = BIOME_COLORS[_biome] ?? BIOME_COLORS.garden;

  // ── Outside void ─────────────────────────────────────────────────────────
  ctx.fillStyle = _isNight ? bc.voidNight : bc.void;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // ── Stars in the void (night only) ───────────────────────────────────────
  // (removed — caused per-frame evenodd clip + 200 arc draw calls = frame lag)

  // ── Grass / sand interior ─────────────────────────────────────────────────
  ctx.fillStyle = _isNight ? bc.grassNight : bc.grass;
  ctx.fillRect(mapL, mapT, mapSW, mapSH);

  // ── Soft left-band tint (safe spawn zone) ────────────────────────────────
  const spawnBandR = wx2sx(W * SPAWN_FRAC);
  const grad = ctx.createLinearGradient(mapL, 0, spawnBandR, 0);
  grad.addColorStop(0, _isNight ? bc.spawnGradN : bc.spawnGrad);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(mapL, mapT, spawnBandR - mapL, mapSH);

  // ── Perimeter spawn zone tint (all 4 edges) ───────────────────────────────
  const stripWpx = W * PERIMETER_FRAC * zoomV;
  const stripHpx = H * PERIMETER_FRAC * zoomV;
  ctx.save();
  ctx.globalAlpha = _isNight ? bc.perimAlphaN : bc.perimAlpha;
  ctx.fillStyle = _isNight ? bc.perimNight : bc.perimDay;
  ctx.fillRect(mapL, mapT, mapSW, stripHpx);
  ctx.fillRect(mapL, mapB - stripHpx, mapSW, stripHpx);
  ctx.fillRect(mapL, mapT, stripWpx, mapSH);
  ctx.fillRect(mapR - stripWpx, mapT, stripWpx, mapSH);
  ctx.restore();

  // ── Background triangle decorations ──────────────────────────────────────
  _drawWaveDecorations(ctx, mapL, mapT, mapSW, mapSH, canvasW, canvasH, W, H, bc);

  // ── Border walls ─────────────────────────────────────────────────────────
  const wt = Math.max(3, 8 * zoomV);
  ctx.fillStyle = _isNight ? bc.wallNight : bc.wall;
  ctx.fillRect(mapL,       mapT - wt, mapSW, wt);
  ctx.fillRect(mapL,       mapB,      mapSW, wt);
  ctx.fillRect(mapL - wt,  mapT - wt, wt, mapSH + wt * 2);
  ctx.fillRect(mapR,       mapT - wt, wt, mapSH + wt * 2);

  // ── Ant hole sub-map (separate arena, circular, only when active) ─────────
  if (_antHoleSubMapActive) {
    const { cx, cy, r } = getAntHoleCircleCenter();
    const scx = wx2sx(cx), scy = wy2sy(cy), sr = r * zoomV;
    // Ground circle — use the ant hole's own color (darker at night)
    const gc = _antHoleGroundColor;
    ctx.save();
    ctx.beginPath();
    ctx.arc(scx, scy, sr, 0, Math.PI * 2);
    ctx.fillStyle = _isNight ? _darkenHex(gc, 0.45) : gc;
    ctx.fill();
    // Border ring
    ctx.strokeStyle = _isNight ? '#060c1a' : '#5a3506';
    ctx.lineWidth = Math.max(3, wt);
    ctx.stroke();
    ctx.restore();
  }
}

// ── Stars in the void (seeded, outside map area) ─────────────────────────────
let _stars = null;
function _initStars() {
  if (_stars) return;
  _stars = [];
  let s = 7;
  const rng = () => { s = Math.imul(1664525, s) + 1013904223 | 0; return (s >>> 0) / 0xFFFFFFFF; };
  for (let i = 0; i < 200; i++) {
    _stars.push({ fx: rng(), fy: rng(), r: 0.5 + rng() * 1.5, bright: 0.4 + rng() * 0.6 });
  }
}

function _drawStars(ctx, canvasW, canvasH, mapL, mapT, mapR, mapB) {
  _initStars();
  ctx.save();
  // Clip to the void regions (outside the map rectangle)
  ctx.beginPath();
  ctx.rect(0, 0, canvasW, canvasH);
  ctx.rect(mapL, mapT, mapR - mapL, mapB - mapT); // subtract map interior
  ctx.clip('evenodd');
  for (const st of _stars) {
    const x = st.fx * canvasW;
    const y = st.fy * canvasH;
    ctx.beginPath();
    ctx.arc(x, y, st.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,220,255,${st.bright})`;
    ctx.fill();
  }
  ctx.restore();
}

// ── Decoration triangles (seeded, regenerate when map resizes) ────────────────
let _waveTriangles = null;
let _triMapW = 0, _triMapH = 0;

function _initWaveTriangles(W, H) {
  if (_waveTriangles && _triMapW === W && _triMapH === H) return;
  _triMapW = W; _triMapH = H;
  _waveTriangles = [];
  let s = 42;
  const rng = () => { s = Math.imul(1664525, s) + 1013904223 | 0; return (s >>> 0) / 0xFFFFFFFF; };
  for (let i = 0; i < 160; i++) {
    const r = 120 + rng() * 260;
    _waveTriangles.push({
      x: rng() * W,
      y: rng() * H,
      r,
      rot: rng() * Math.PI * 2,
      cr: r * (0.25 + 0.15),
      bow: 0.05 + rng() * 0.07,
    });
  }
}

function _drawWaveDecorations(ctx, mapL, mapT, mapSW, mapSH, canvasW, canvasH, W, H, bc) {
  _initWaveTriangles(W, H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(mapL, mapT, mapSW, mapSH);
  ctx.clip();
  ctx.fillStyle = bc ? bc.triColor : 'rgba(0,0,0,0.09)';
  const zv = mapSW / W;
  for (const t of _waveTriangles) {
    const sx = mapL + t.x * zv, sy = mapT + t.y * zv;
    const sr = t.r * zv;
    if (sx + sr < 0 || sx - sr > canvasW || sy + sr < 0 || sy - sr > canvasH) continue;
    _drawSoftTri(ctx, sx, sy, sr, t.rot, t.cr * zv, t.bow);
    ctx.fill();
  }
  ctx.restore();
}

function _drawSoftTri(ctx, cx, cy, r, rot, cr, bow) {
  const vx = [0, 1, 2].map(i => cx + Math.cos(rot + i * Math.PI * 2 / 3) * r);
  const vy = [0, 1, 2].map(i => cy + Math.sin(rot + i * Math.PI * 2 / 3) * r);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const j  = (i + 1) % 3;
    const ex = vx[j] - vx[i], ey = vy[j] - vy[i];
    const el = Math.hypot(ex, ey);
    const ux = ex / el, uy = ey / el, nx = -uy, ny = ux;
    const t  = Math.min(cr, el * 0.42);
    const ax = vx[i] + ux * t, ay = vy[i] + uy * t;
    const bx = vx[j] - ux * t, by = vy[j] - uy * t;
    if (i === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    ctx.quadraticCurveTo(mx + nx * bow * el, my + ny * bow * el, bx, by);
    const nj  = (j + 1) % 3;
    const e2x = vx[nj] - vx[j], e2y = vy[nj] - vy[j];
    const e2l = Math.hypot(e2x, e2y);
    const t2  = Math.min(cr, e2l * 0.42);
    ctx.quadraticCurveTo(vx[j], vy[j], vx[j] + (e2x / e2l) * t2, vy[j] + (e2y / e2l) * t2);
  }
  ctx.closePath();
}
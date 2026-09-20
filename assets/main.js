import './input.js';                                  // side-effect: registers all listeners

import { player, updatePlayer, respawnPlayer }  from './player.js';
import { updatePetals, hotbar, rebuildPetals, refreshAllPetals } from './petals.js';
import { initCamera, updateCamera,
         camera, petalOrigin,
         zoomState, setZoom, getZoom,
         setMinZoom, DEFAULT_MIN_ZOOM, snapCamera }  from './camera.js';
import { render, triggerPetalDeathPops, clearPetalDeathPops, setPlayerWasDead } from './renderer.js';
import { levelHUD } from './LevelHUD.js';
import { initMobs, updateMobs, setWaveNPCTarget, clearWaveNPCTarget, spawnWaveMob, mobs,
         spawnFriendlyAntPet, spawnFriendlyBeePet, spawnFriendlyDiggerPet,
         getBossAntHoleAtPoint, spawnAntHoleInteriorMobs } from './mobs.js';
import { updateCombat, spawnMobDrops }   from './combat.js';
import { updateDrops, checkPickups, worldDrops } from './drops.js';
import { updateDamagePopups } from './damagePopups.js';
import { addToInventory, clearInventory }                from './inventory.js';
import { initUI, notifyInventoryChanged,
         updateHotbar, updateInventory,
         updateSettingsCog }             from './uiManager.js';
import { setHomescreenMode, hotbarSlideOffset } from './HotbarUI.js';
import { runIrisTransition }             from './homescreen.js';
import { initTooltip }                   from './mobTooltip.js';
import { drawPetalTooltip } from './petalTooltip.js';
import { PETAL_TYPES, SCALABLE_PETAL_IDS } from './petalTypes.js';
import { settings }                      from './settings.js';
import { linkSettings }                  from './inputState.js';
linkSettings(settings);
import { benchBar }                      from './petals.js';

// Wave mode imports
import { setWaveMapMode }                from './map.js';
import { initNPC, updateNPC, npc }       from './npc.js';
import { initWaveManager, updateWaveManager, startWaves, onWaveMobDied, waveState, WaveState, triggerWaveGameOver, skipToNight, setWaveBiome } from './waveManager.js';
import { initBossManager } from './bossManager.js';
import { getWaveNPCSpawn, findWavePlayerSpawn,
         activateAntHoleSubMap, deactivateAntHoleSubMap, isAntHoleSubMapActive,
         findAntHolePlayerSpawn,
         ANT_HOLE_OFFSET_X, ANT_HOLE_OFFSET_Y,
         getAntHoleSubMapW, getAntHoleSubMapH,
         setWaveMapBiome } from './waveMap.js';
import { startSpectate, cancelSpectate, updateSpectate, isSpectating } from './spectateMode.js';
import { initNPCUI, destroyNPCUI, tickNPCUI, tryToggleNPCUI, closeNPCUI } from './npcUpgradeUI.js';
import { clearMobGallery } from './MobGalleryUI.js';

// ── NPC egg-petal spawner ─────────────────────────────────────────────────────
/** Callback passed to updateNPC — spawns the appropriate friendly pet and returns its id. */
function _spawnNPCEggPet(typeId, x, y) {
  const pt = PETAL_TYPES[typeId];
  if (!pt) return null;
  const tier = pt.tier ?? 0;
  let pet = null;
  if (pt.isAntEgg)         pet = spawnFriendlyAntPet(tier, x, y, -1, 0);
  else if (pt.isBeeEgg)    pet = spawnFriendlyBeePet(tier, x, y, -1, 0);
  else if (pt.isDiggerEgg) pet = spawnFriendlyDiggerPet(tier, x, y, -1, 0, '#aaaaaa');
  if (pet) pet.isNPCPet = true;
  return pet ? pet.id : null;
}

// ── Canvas ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');

// Track CSS-pixel dimensions separately — render logic works in CSS pixels
let canvasW = window.innerWidth;
let canvasH = window.innerHeight;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvasW   = window.innerWidth;
  canvasH   = window.innerHeight;

  canvas.width        = Math.round(canvasW * dpr);
  canvas.height       = Math.round(canvasH * dpr);
  canvas.style.width  = canvasW + 'px';
  canvas.style.height = canvasH + 'px';

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

// ── Scroll wheel zoom ─────────────────────────────────────────────────────────
window.addEventListener('wheel', e => {
  // Don't hijack scroll events that originate inside a UI panel
  const UI_PANEL_IDS = ['inv-panel', 'crafting-panel', 'mobgal-panel', 'settings-panel', 'updatelog-panel'];
  if (UI_PANEL_IDS.some(id => document.getElementById(id)?.contains(e.target))) return;

  e.preventDefault();
  let factor;
  if (e.ctrlKey) {
    // Pinch-to-zoom on trackpad: deltaY is small, use proportionally
    factor = Math.pow(0.99, e.deltaY);
  } else if (e.deltaMode === 0) {
    // Mouse wheel: deltaMode 0 (pixels) with large deltaY — use fixed step
    factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  } else {
    // Trackpad two-finger scroll (line/page mode): scale gently
    factor = Math.pow(0.99, e.deltaY / 4);
  }
  setZoom(getZoom() * factor);
}, { passive: false });

// ── Early UI init — runs before play so panels exist on homescreen ────────────
initUI();
initTooltip(canvas);

// ── Death overlay ─────────────────────────────────────────────────────────────
let _deathOverlayVisible = false;

function showDeathOverlay() {
  if (_deathOverlayVisible) return;
  _deathOverlayVisible = true;
  const el = document.getElementById('death-overlay');
  if (!el) return;
  el.style.display = 'flex';
  // Force reflow then animate in
  el.getBoundingClientRect();
  el.style.transform = 'translateY(0)';
  el.style.opacity   = '1';
}

function hideDeathOverlay(onDone) {
  if (!_deathOverlayVisible) { if (onDone) onDone(); return; }
  _deathOverlayVisible = false;
  const el = document.getElementById('death-overlay');
  if (!el) { if (onDone) onDone(); return; }
  el.style.transform = 'translateY(-110%)';
  el.style.opacity   = '0';
  setTimeout(() => {
    el.style.display = 'none';
    if (onDone) onDone();
  }, 420);
}

// Wire death overlay buttons directly (modules execute after DOM parse)
{
  const continueBtn = document.getElementById('death-continue');
  const closeBtn    = document.getElementById('death-close');

  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      hideDeathOverlay(() => {
        // Iris closes → show homescreen at midpoint → iris opens
        runIrisTransition(
          () => {
            // Midpoint: screen is black — swap content
            respawnPlayer();
            clearPetalDeathPops();
            setPlayerWasDead(false);
            _playerWasDeadLocal = false;
            _waveGameOverShown = false;
            // Wave mode teardown
            if (_wavesMode) {
              _wavesMode = false;
              setWaveMapMode(false);
              clearWaveNPCTarget();
              cancelSpectate();
              closeNPCUI();
              // Clean up ant hole sub-map if somehow still active
              if (_ahState.active) { _ahState.active = false; deactivateAntHoleSubMap(); _ahState.interiorMobIds.clear(); }
            }
            stopGameLoop();
            const homeEl = document.getElementById('home-screen');
            if (homeEl) homeEl.style.display = 'flex';
            startHomescreenHotbar();
            // Refresh level pill with current XP
            if (typeof window._refreshHomePill === 'function') window._refreshHomePill();
            // Re-attach flower mouse listeners
            if (typeof window._reattachFlowerListeners === 'function') {
              window._reattachFlowerListeners();
            }
          },
          null
        );
      });
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      hideDeathOverlay(null);
    });
  }
}

// ── Homescreen hotbar canvas loop (exported for homescreen.js) ────────────────
let _homebar_raf = null;

// Expose current virtualH so ui.js can use correct H for hit-testing on homescreen
let _homescreenVirtualH = 0;
export function getHomescreenVirtualH() { return _homescreenVirtualH; }

export function startHomescreenHotbar() {
  setHomescreenMode(true);

  // Seed inventory at homescreen so player can set up hotbar before choosing a mode
  clearInventory();
  clearMobGallery();
  addToInventory('magnet_impracticality');
  addToInventory('ant_egg_umbral');
  addToInventory('cutter_umbral');
  addToInventory('stinger_super');
  notifyInventoryChanged();

  let lastFrameTime = performance.now();
  function frame(now) {
    const dt = Math.min(now - lastFrameTime, 100);
    lastFrameTime = now;
    canvasW = window.innerWidth;
    canvasH = window.innerHeight;
    ctx.clearRect(0, 0, canvasW, canvasH);
    const homeContent = document.querySelector('.home-content');
    const rect = homeContent ? homeContent.getBoundingClientRect() : null;
    const hotbarGap = 28;
    const hotbarOffset = 18 + 68 + 10 + 54;
    const desiredTop = rect ? rect.bottom + hotbarGap : canvasH * 0.65;
    const virtualH = desiredTop + hotbarOffset + hotbarSlideOffset;
    _homescreenVirtualH = virtualH;
    updateHotbar(ctx, canvasW, virtualH);
    drawPetalTooltip(ctx, canvasW, canvasH, dt);
    updateInventory();
    updateSettingsCog(now);
    _homebar_raf = requestAnimationFrame(frame);
  }
  _homebar_raf = requestAnimationFrame(frame);
}

function stopHomescreenHotbar() {
  if (_homebar_raf) { cancelAnimationFrame(_homebar_raf); _homebar_raf = null; }
}

// ── Game mode flag ─────────────────────────────────────────────────────────────
let _wavesMode = false;
let _waveGameOverShown = false;

// ── Boss ant hole sub-map state ───────────────────────────────────────────────
const _ahState = {
  active:          false,   // player is currently inside the ant hole sub-map
  bossHoleId:      null,    // id of the boss ant_hole mob in the overworld
  bossHoleX:       0,       // overworld position — used for teleport-back & drop relocation
  bossHoleY:       0,
  bossHoleTier:    0,
  interiorMobIds:  new Set(), // IDs of all interior mobs that must die to clear the sub-map
  persistedMobIds: new Set(), // surviving interior mob IDs kept when player dies and exits
  exitCooldown:    0,       // ms remaining before the player can re-enter any boss hole
};

/**
 * Teleport player into the boss ant hole sub-map.
 * Activates the sub-map, refreshes petals, spawns interior mobs, and moves the player.
 */
function _enterBossAntHole(bossHole) {
  if (_ahState.active) return; // already inside
  _ahState.active       = true;
  _ahState.bossHoleId   = bossHole.id;
  _ahState.bossHoleX    = bossHole.x;
  _ahState.bossHoleY    = bossHole.y;
  _ahState.bossHoleTier = bossHole.tier;
  _ahState.interiorMobIds.clear();

  // Activate sub-map rendering & bounds (use the ant hole's ground color)
  activateAntHoleSubMap(bossHole.color);

  // Refresh all petals before the fight
  refreshAllPetals();

  // Check if the player is re-entering the same hole after dying — reuse surviving mobs
  const hasPersisted = _ahState.persistedMobIds.size > 0;
  if (hasPersisted) {
    // Restore only still-living persisted mobs into the tracking set
    for (const id of _ahState.persistedMobIds) {
      const mob = mobs.find(m => m.id === id);
      if (mob && !mob.dead) _ahState.interiorMobIds.add(id);
    }
    _ahState.persistedMobIds.clear();
  }

  // Pick the player's spawn position BEFORE spawning mobs so mobs don't land on it
  const spawn = findAntHolePlayerSpawn(player.radius, mobs);

  // Only spawn fresh mobs if this is a first entry (no persisted mobs restored)
  if (_ahState.interiorMobIds.size === 0) {
    const ids = spawnAntHoleInteriorMobs(bossHole.tier, spawn.x, spawn.y);
    for (const id of ids) _ahState.interiorMobIds.add(id);
    // Mark the boss hole so overworld milestone spawns are suppressed while interior is live
    bossHole.interiorActive = true;
  }

  // Teleport player to the pre-chosen clear spot
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;

  // Snap camera instantly so there's no lag-drag from the overworld position
  snapCamera(spawn.x, spawn.y);

  // Grant 2.5s of invincibility so the player isn't instantly killed on entry
  player.invincibleTimer = Math.max(player.invincibleTimer, 2500);
}

/**
 * Exit the ant hole sub-map.
 * @param {'victory'|'playerDied'|'holeDied'} reason
 *   victory   — all interior mobs killed → boss hole dies, drops loot, no re-entry
 *   playerDied — player died inside → mobs preserved for re-entry
 *   holeDied  — hole killed externally while player inside → interior mobs silently despawn
 */
function _exitBossAntHole(reason) {
  if (!_ahState.active) return;
  _ahState.active = false;

  const ox = ANT_HOLE_OFFSET_X, oy = ANT_HOLE_OFFSET_Y;
  const ahW = getAntHoleSubMapW(), ahH = getAntHoleSubMapH();

  // Relocate any drops inside the sub-map back to the overworld exit point
  const scatter = 80;
  for (const drop of worldDrops) {
    if (drop.x >= ox && drop.x <= ox + ahW && drop.y >= oy && drop.y <= oy + ahH) {
      drop.x = _ahState.bossHoleX + (Math.random() - 0.5) * scatter;
      drop.y = _ahState.bossHoleY + (Math.random() - 0.5) * scatter;
    }
  }

  if (reason === 'playerDied') {
    // Preserve surviving interior mobs so the player finds the same fight on re-entry
    _ahState.persistedMobIds.clear();
    for (const id of _ahState.interiorMobIds) {
      const mob = mobs.find(m => m.id === id);
      if (mob && !mob.dead) _ahState.persistedMobIds.add(id);
    }
    _ahState.interiorMobIds.clear();
    // Clear the interiorActive flag so milestone spawns can fire again if somehow damaged
    const bossHoleMob = mobs.find(m => m.id === _ahState.bossHoleId);
    if (bossHoleMob) bossHoleMob.interiorActive = false;

  } else if (reason === 'victory') {
    // All interior mobs cleared — kill the boss hole (drops loot), no re-entry possible
    _ahState.interiorMobIds.clear();
    _ahState.persistedMobIds.clear();
    const bossHoleMob = mobs.find(m => m.id === _ahState.bossHoleId);
    if (bossHoleMob && !bossHoleMob.dead) {
      bossHoleMob.interiorActive = false;
      bossHoleMob.clearedByInterior = true; // suppress overworld death-wave spawns
      bossHoleMob.dead = true;
      spawnMobDrops(bossHoleMob, true /* isBoss */);
    }

  } else { // 'holeDied' — hole was killed externally while player was inside
    // Silently despawn interior mobs — no drops, no tracking
    for (const id of _ahState.interiorMobIds) {
      const mob = mobs.find(m => m.id === id);
      if (mob && !mob.dead) mob.dead = true;
    }
    _ahState.interiorMobIds.clear();
    _ahState.persistedMobIds.clear();
  }

  // Teleport player back to just beside the hole position
  player.x  = _ahState.bossHoleX + 150;
  player.y  = _ahState.bossHoleY;
  player.vx = 0;
  player.vy = 0;

  // Snap camera instantly — no lag-drag back from the sub-map
  snapCamera(player.x, player.y);

  // Brief cooldown before the player can enter another hole (not needed after victory since hole is dead)
  if (reason !== 'victory') _ahState.exitCooldown = 2000;

  // Deactivate sub-map rendering & bounds
  deactivateAntHoleSubMap();
}

/** Tick the ant hole sub-map — call once per frame while in wave mode. */
function _tickAntHoleSubMap() {
  if (!_ahState.active) return;

  // If the boss ant hole was killed in the overworld while player is inside → exit immediately
  const bossHoleMob = mobs.find(m => m.id === _ahState.bossHoleId);
  if (!bossHoleMob || bossHoleMob.dead) {
    _exitBossAntHole('holeDied');
    return;
  }

  // Prune dead interior mobs from tracking set
  for (const id of [..._ahState.interiorMobIds]) {
    const mob = mobs.find(m => m.id === id);
    if (!mob || mob.dead) _ahState.interiorMobIds.delete(id);
  }

  // All interior mobs cleared → exit with victory
  if (_ahState.interiorMobIds.size === 0) {
    _exitBossAntHole('victory');
  }
}

// ── Game loop ─────────────────────────────────────────────────────────────────
let lastTime = performance.now();
let _lastMinZoom = DEFAULT_MIN_ZOOM;
let _loopRaf = null;
let _playerWasDeadLocal = false;

function stopGameLoop() {
  if (_loopRaf) { cancelAnimationFrame(_loopRaf); _loopRaf = null; }
}

function loop(now) {
  const dt = Math.min(now - lastTime, 100);
  lastTime = now;

  // ── Wave mode: player death → spectate + auto-respawn ────────────────────
  if (_wavesMode && player.dead && !_playerWasDeadLocal) {
    _playerWasDeadLocal = true;
    setPlayerWasDead(true);
    player.deathRotation = (Math.random() * 2 - 1) * (15 * Math.PI / 180);
    triggerPetalDeathPops(canvasW, canvasH);
    // If the player died inside the ant hole, exit the sub-map first so the
    // respawn position is calculated in the overworld coordinate space.
    if (_ahState.active) _exitBossAntHole('playerDied');
    startSpectate(() => {
      const spawn = findWavePlayerSpawn(player.radius, npc, mobs);
      respawnPlayer();
      player.x = spawn.x; // override AFTER respawn (respawnPlayer uses normal map spawn)
      player.y = spawn.y;
      clearPetalDeathPops();
      setPlayerWasDead(false);
      _playerWasDeadLocal = false;
    });
  }

  // ── Normal mode: player death → death overlay ────────────────────────────
  if (!_wavesMode && player.dead && !_playerWasDeadLocal) {
    _playerWasDeadLocal = true;
    setPlayerWasDead(true);
    player.deathRotation = (Math.random() * 2 - 1) * (15 * Math.PI / 180);
    triggerPetalDeathPops(canvasW, canvasH);
    setTimeout(showDeathOverlay, 350);
  }

  // Wave game over → show death overlay once
  if (_wavesMode && waveState.state === WaveState.GAME_OVER && !_waveGameOverShown) {
    _waveGameOverShown = true;
    cancelSpectate();
    setTimeout(showDeathOverlay, 500);
  }

  // Auto-save wave progress per biome key whenever wave number advances
  if (_wavesMode && window._wavesSaveKey && waveState.waveNumber > 1) {
    try {
      const stored = parseInt(localStorage.getItem(window._wavesSaveKey) || '1', 10);
      if (waveState.waveNumber > stored) {
        localStorage.setItem(window._wavesSaveKey, String(waveState.waveNumber));
      }
    } catch (_) {}
  }

  // Camera: spectating NPC or following player
  if (_wavesMode && isSpectating() && npc && !npc.dead) {
    updateCamera(npc.x, npc.y);
  } else {
    if (!player.dead) updatePlayer(dt);
    updateCamera(player.x, player.y);
  }

  if (_wavesMode) {
    updateSpectate(dt);
    updateNPC(dt, mobs, PETAL_TYPES, _spawnNPCEggPet);
    // Detect NPC death → trigger game over
    if (!npc.dead && npc.hp <= 0) {
      npc.dead = true;
      triggerWaveGameOver();
    }
    updateWaveManager(dt);

    // ── Ant hole sub-map ─────────────────────────────────────────────────
    _tickAntHoleSubMap();

    // Tick down re-entry cooldown
    if (_ahState.exitCooldown > 0) _ahState.exitCooldown = Math.max(0, _ahState.exitCooldown - dt);

    // Player collides with boss ant hole in the overworld → enter sub-map
    if (!_ahState.active && !player.dead && _ahState.exitCooldown <= 0) {
      const bossHole = getBossAntHoleAtPoint(player.x, player.y, player.radius);
      if (bossHole) _enterBossAntHole(bossHole);
    }
  }

  if (!player.dead) {
    updatePetals(dt, petalOrigin.x, petalOrigin.y);
  }
  updateMobs(dt, player.x, player.y);
  if (!player.dead) {
    updateCombat(dt);
  }
  updateDrops(dt);
  updateDamagePopups(dt);

  // ── Antennae vision bonus ────────────────────────────────────────────────
  let totalVisionBonus = 0;
  for (const typeId of hotbar) {
    if (!typeId) continue;
    const pt = PETAL_TYPES[typeId];
    if (pt?.visionBonus) totalVisionBonus += pt.visionBonus;
  }
  const newMinZoom = DEFAULT_MIN_ZOOM / (1 + totalVisionBonus);
  if (Math.abs(newMinZoom - _lastMinZoom) > 0.0001) {
    const wasAtMin = Math.abs(zoomState.v - _lastMinZoom) < 0.01;
    setMinZoom(newMinZoom);
    if (wasAtMin) setZoom(newMinZoom);
    _lastMinZoom = newMinZoom;
  }

  let pickupMult = 1;
  let flatPickupBonus = 0;
  for (const typeId of hotbar) {
    if (!typeId) continue;
    const pt = PETAL_TYPES[typeId];
    if (pt?.pickupBonus) pickupMult += pt.pickupBonus;
    if (pt?.flatPickupBonus) flatPickupBonus += pt.flatPickupBonus;
  }

  checkPickups(player.x, player.y, typeId => {
    if (typeId === 'rose') {
      player.hp = Math.min(player.maxHp, player.hp + 22);
      return;
    }
    if (settings.equipDrops) {
      const emptyTop = hotbar.indexOf(null);
      if (emptyTop !== -1) {
        hotbar[emptyTop] = typeId;
        rebuildPetals();
        return;
      }
      const emptyBench = benchBar.indexOf(null);
      if (emptyBench !== -1) {
        benchBar[emptyBench] = typeId;
        return;
      }
    }
    addToInventory(typeId);
    notifyInventoryChanged();
  }, pickupMult, flatPickupBonus);

  if (_wavesMode) { tickNPCUI(); _tickSkipNightBtn(); }

  render(ctx, canvasW, canvasH, camera.x, camera.y, dt);

  _loopRaf = requestAnimationFrame(loop);
}

// ── startGame — classic map mode ─────────────────────────────────────────────
async function startGame() {
  stopHomescreenHotbar();
  setHomescreenMode(false);
  _wavesMode = false;
  _waveGameOverShown = false;
  _playerWasDeadLocal = false;
  setPlayerWasDead(false);
  setWaveMapMode(false);
  clearWaveNPCTarget();
  closeNPCUI();
  destroyNPCUI();
  _destroySkipNightBtn();
  initCamera(player.x, player.y);
  initMobs(player.x, player.y);

  // Inventory was seeded at homescreen — player configured hotbar before entering
  clearMobGallery();

  lastTime = performance.now();
  levelHUD.init(player.xp);
  _loopRaf = requestAnimationFrame(loop);
}

// ── startWavesGame — waves mode ───────────────────────────────────────────────
async function startWavesGame(biome = 'garden') {
  stopHomescreenHotbar();
  setHomescreenMode(false);
  _wavesMode = true;
  _waveGameOverShown = false;
  _playerWasDeadLocal = false;
  setPlayerWasDead(false);

  // Apply biome to map renderer and wave manager
  setWaveMapBiome(biome);
  setWaveBiome(biome);

  setWaveMapMode(true);

  // Respawn player first (resets hp/dead/velocity), then override position to wave spawn
  respawnPlayer();
  player.x = 200;
  player.y = 3100; // WAVE_MAP_H / 2

  // Init NPC using dynamic map getter (map may be sized for a later wave on restart)
  const npcSpawn = getWaveNPCSpawn();
  initNPC(npcSpawn.x, npcSpawn.y);
  setWaveNPCTarget(npc);

  // Init mobs (wave mode — zone spawning disabled)
  initMobs(player.x, player.y);

  // Init wave state machine
  initWaveManager(
    (typeId, tier, isStructure, spawnAtCenter) => spawnWaveMob(typeId, tier, isStructure, spawnAtCenter),
    () => { /* game over detected via waveState in loop */ },
    (id) => mobs.find(m => m.id === id) ?? null
  );
  initBossManager(hotbar);

  // Inventory was seeded at homescreen — player configured hotbar before entering
  clearMobGallery();

  initNPCUI();
  _initSkipNightBtn();

  initCamera(player.x, player.y);
  lastTime = performance.now();
  levelHUD.init(player.xp);
  _loopRaf = requestAnimationFrame(loop);

  // Load per-biome saved wave progress
  const saveKey = biome === 'desert' ? 'waves_startwave_desert'
                : biome === 'ocean'  ? 'waves_startwave_ocean'
                : 'waves_startwave_garden';
  // TESTING: always start at wave 1 on page refresh, regardless of saved progress.
  // The save/resume system below is left intact — flip this back to read from
  // localStorage once testing is done.
  let savedWave = 1;
  /*
  try {
    const v = localStorage.getItem(saveKey);
    if (v) savedWave = Math.max(1, parseInt(v, 10) || 1);
  } catch (_) {}
  */
  // Store active save key so the game loop can update it
  window._wavesSaveKey = saveKey;

  setTimeout(() => startWaves(savedWave), 800);
}

// ── Skip-to-night button ──────────────────────────────────────────────────────
let _skipBtn = null;
let _skipDismissedForWave = -1; // wave number where player clicked ✕

function _initSkipNightBtn() {
  if (_skipBtn) return;

  const style = document.createElement('style');
  style.textContent = `
    #skip-night-btn {
      display: none;
      position: fixed;
      top: 70px; left: 50%;
      transform: translateX(-50%);
      z-index: 500;
      background: rgba(10,18,40,0.85);
      border: 1.5px solid rgba(255,255,255,0.18);
      border-radius: 24px;
      padding: 5px 8px 5px 14px;
      font-family: 'UbuntuCustom','Ubuntu',Arial,sans-serif;
      font-size: 13px;
      color: rgba(255,255,255,0.80);
      display: none;
      align-items: center;
      gap: 6px;
      pointer-events: auto;
      user-select: none;
      backdrop-filter: blur(4px);
    }
    #skip-night-btn span { opacity: 0.7; }
    #skip-night-yes, #skip-night-no {
      width: 28px; height: 28px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      font-size: 15px;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, transform 0.1s;
      flex-shrink: 0;
    }
    #skip-night-yes { background: rgba(60,180,80,0.25); color: #88ee88; }
    #skip-night-yes:hover { background: rgba(60,180,80,0.55); transform: scale(1.12); }
    #skip-night-no  { background: rgba(200,60,60,0.20); color: #ee8888; }
    #skip-night-no:hover  { background: rgba(200,60,60,0.45); transform: scale(1.12); }
  `;
  document.head.appendChild(style);

  _skipBtn = document.createElement('div');
  _skipBtn.id = 'skip-night-btn';
  _skipBtn.innerHTML = `
    <span>Skip to night?</span>
    <button id="skip-night-yes" title="Skip to night">✓</button>
    <button id="skip-night-no"  title="Dismiss">✕</button>
  `;
  document.body.appendChild(_skipBtn);

  document.getElementById('skip-night-yes').addEventListener('click', () => {
    skipToNight();
    _skipBtn.style.display = 'none';
  });
  document.getElementById('skip-night-no').addEventListener('click', () => {
    _skipDismissedForWave = waveState.waveNumber;
    _skipBtn.style.display = 'none';
  });
}

function _tickSkipNightBtn() {
  if (!_skipBtn) return;
  const isDayPhase = waveState.state === WaveState.DAY;
  const dismissed  = _skipDismissedForWave === waveState.waveNumber;
  // Show after the 2s "cleared!" banner fades (stateTimer > 2000) and not dismissed
  const show = isDayPhase && !dismissed && waveState.stateTimer > 2000;
  _skipBtn.style.display = show ? 'flex' : 'none';
}

function _destroySkipNightBtn() {
  if (_skipBtn) { _skipBtn.remove(); _skipBtn = null; }
  _skipDismissedForWave = -1;
}

window.startGame = startGame;
window.startWavesGame = startWavesGame;
window._getHomescreenVirtualH = getHomescreenVirtualH;
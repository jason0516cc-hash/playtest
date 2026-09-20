/**
 * npc.js — The NPC companion for Waves mode.
 *
 * The NPC is a standard flower with:
 *   - 10,000 HP, no respawn
 *   - 5 petal slots (healing + egg petals only)
 *   - Wanders the left 40% of the wave map
 *   - Flees mobs that come within 200 world units
 *   - Face changes to sad at/below 25% HP
 */

import { getNPCWanderXMax, getWaveMapH, waveCanMoveTo } from './waveMap.js';
import { PLAYER_SPEED, PLAYER_COLOR, PLAYER_BORDER } from './constants.js';

export const NPC_MAX_HP        = 10000000000000000;
export const NPC_RADIUS        = 22;
const WANDER_SPEED_MULT        = 0.30;   // 30% of player speed
const FLEE_SPEED_MULT          = 1.00;   // full player speed
const MOB_THREAT_RADIUS        = 200;    // world units
const WANDER_INTERVAL_MIN      = 3000;   // ms
const WANDER_INTERVAL_MAX      = 5000;
const NPC_HEAL_TICK_MS         = 1000;   // rose / leaf heal period
const EGG_SPAWN_INTERVAL       = 12000;  // ms between egg petal triggers

export const NPC_ORBIT_R = 50; // world units: radius + 28 ≈ NPC_RADIUS + 28

export const npc = {
  x:         0,
  y:         0,
  radius:    NPC_RADIUS,
  hp:        NPC_MAX_HP,
  maxHp:     NPC_MAX_HP,
  dead:      false,
  name:      'NPC',
  color:     PLAYER_COLOR,
  border:    PLAYER_BORDER,
  mass:      200,
  vx:        0,
  vy:        0,
  facing:    0,
  moveAngle: 0,
  smoothRotation: 0,
  legPhase:  0,

  // 5 petal slots — stores typeId strings (or null)
  petals:    [null, null, null, null, null],

  // orbit angle (updated each frame by updateNPC)
  orbitAngle: 0,

  // internal AI state
  _wanderX:    0,
  _wanderY:    0,
  _wanderTimer: 0,
  _fleeing:     false,
  _healTimer:   0,
  // Egg slots: track hatch state and linked pet id so we only have one pet per slot
  _eggStates:   [null, null, null, null, null],  // 'hatch_wait' | 'linked' | null
  _eggTimers:   [0, 0, 0, 0, 0],
  _eggPetIds:   [null, null, null, null, null],
  // Rose slots: per-slot state machine ('spawn_wait'|'healing'|null) with reload
  _roseStates:  [null, null, null, null, null],
  _roseTimers:  [0, 0, 0, 0, 0],
  hurtFlash:    0,   // ms remaining of red damage flash
};

/** Called once when entering waves mode */
export function initNPC(x, y) {
  npc.x    = x;
  npc.y    = y;
  npc.hp   = NPC_MAX_HP;
  npc.dead = false;
  npc.vx   = 0;
  npc.vy   = 0;
  npc.facing = 0;
  npc.smoothRotation = 0;
  npc.petals = [null, null, null, null, null];
  npc.orbitAngle = 0;
  npc._wanderTimer = 0;
  npc._fleeing = false;
  npc._healTimer = 0;
  npc._eggStates = [null, null, null, null, null];
  npc._eggTimers = [0, 0, 0, 0, 0];
  npc._eggPetIds = [null, null, null, null, null];
  npc._roseStates = [null, null, null, null, null];
  npc._roseTimers = [0, 0, 0, 0, 0];
  npc.hurtFlash   = 0;
  _pickWanderTarget();
}

// ── NPC petal helpers ─────────────────────────────────────────────────────────

/** True if this petal typeId is allowed in NPC slots */
export function isNPCPetalAllowed(typeId) {
  if (!typeId) return false;
  // Egg petals (ant_egg, bee_egg, digger_egg and any tiered variants)
  if (typeId === 'ant_egg' || typeId === 'bee_egg' || typeId === 'digger_egg') return true;
  if (typeId.startsWith('ant_egg') || typeId.startsWith('bee_egg') || typeId.startsWith('digger_egg')) return true;
  // Healing petals: rose and leaf (and their tiered variants like rose_unusual, leaf_rare)
  if (typeId === 'rose' || typeId.startsWith('rose_')) return true;
  if (typeId === 'leaf' || typeId.startsWith('leaf_')) return true;
  return false;
}

/** Equip a petal from player inventory into the first empty NPC slot. Returns slot index or -1. */
export function npcEquipPetal(typeId) {
  const slot = npc.petals.indexOf(null);
  if (slot === -1) return -1;
  npc.petals[slot] = typeId;
  // Reset egg state for this slot
  npc._eggStates[slot] = null;
  npc._eggTimers[slot] = EGG_SPAWN_INTERVAL;
  npc._eggPetIds[slot] = null;
  // Reset rose state for this slot
  npc._roseStates[slot] = null;
  npc._roseTimers[slot] = 0;
  return slot;
}

/** Unequip an NPC slot, returning { typeId, petIds } (petIds is an array, may be empty). */
export function npcUnequipPetal(slot) {
  const typeId  = npc.petals[slot];
  const raw     = npc._eggPetIds[slot];
  const petIds  = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
  npc.petals[slot]      = null;
  npc._eggStates[slot]  = null;
  npc._eggPetIds[slot]  = null;
  npc._roseStates[slot] = null;
  npc._roseTimers[slot] = 0;
  return { typeId, petIds };
}

// ── AI update ────────────────────────────────────────────────────────────────

/**
 * @param {number} dt   - Delta time in ms
 * @param {Array}  mobs - Live mob array from mobs.js
 * @param {import('./petalTypes.js').PETAL_TYPES} PETAL_TYPES
 * @param {Function} spawnFriendlyDigger - optional cb to spawn egg pet
 */
export function updateNPC(dt, mobs, PETAL_TYPES, spawnEggPet) {
  if (npc.dead) return;

  // Advance petal orbit angle each frame (matches renderer speed)
  npc.orbitAngle += 0.018;

  const spd = PLAYER_SPEED;

  // ── Threat scan ──────────────────────────────────────────────────────────
  let nearestD = Infinity, threatX = 0, threatY = 0;
  for (const mob of mobs) {
    if (mob.dead) continue;
    if (mob.typeId === 'digger' || mob.typeId === 'beekeeper' || mob.isFriendlyPet) continue;
    if (mob.typeId === 'ant_egg' || mob.typeId === 'beehive' || mob.typeId === 'ant_hole') continue;
    const d = Math.hypot(mob.x - npc.x, mob.y - npc.y);
    if (d < MOB_THREAT_RADIUS && d < nearestD) {
      nearestD = d; threatX = mob.x; threatY = mob.y;
    }
  }

  let dx = 0, dy = 0;
  npc._fleeing = (nearestD < MOB_THREAT_RADIUS);

  if (npc._fleeing) {
    // Flee away from threat
    const fdx = npc.x - threatX, fdy = npc.y - threatY;
    const fd = Math.hypot(fdx, fdy);
    if (fd > 0.01) { dx = fdx / fd; dy = fdy / fd; }
    npc.moveAngle = Math.atan2(dy, dx);
    npc._wanderTimer = 0; // force new wander target after fleeing
    const moveSpd = spd * FLEE_SPEED_MULT;
    const nx = npc.x + dx * moveSpd;
    const ny = npc.y + dy * moveSpd;
    if (waveCanMoveTo(nx, ny, npc.radius)) { npc.x = nx; npc.y = ny; }
    else {
      // Bounce off wall — pick a new wander target
      _pickWanderTarget();
    }
  } else {
    // Wander
    npc._wanderTimer -= dt;
    if (npc._wanderTimer <= 0) _pickWanderTarget();

    const wdx = npc._wanderX - npc.x;
    const wdy = npc._wanderY - npc.y;
    const wd  = Math.hypot(wdx, wdy);
    if (wd > 15) {
      dx = wdx / wd; dy = wdy / wd;
      npc.moveAngle = Math.atan2(dy, dx);
      const moveSpd = spd * WANDER_SPEED_MULT;
      const nx = npc.x + dx * moveSpd;
      const ny = npc.y + dy * moveSpd;
      if (waveCanMoveTo(nx, ny, npc.radius)) { npc.x = nx; npc.y = ny; }
      else { _pickWanderTarget(); }
    } else {
      _pickWanderTarget();
    }
  }

  // Smooth rotation
  let diff = npc.moveAngle - npc.smoothRotation;
  if (diff > Math.PI)  diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  npc.smoothRotation += diff * 0.12;

  // ── Leaf petal passive heal (tick-based, unchanged) ─────────────────────
  npc._healTimer -= dt;
  if (npc._healTimer <= 0) {
    npc._healTimer = NPC_HEAL_TICK_MS;
    for (let s = 0; s < 5; s++) {
      const pid = npc.petals[s];
      if (!pid || !PETAL_TYPES) continue;
      const pt = PETAL_TYPES[pid];
      if (!pt) continue;
      // Leaf — passive heal per second
      if (pt.passiveHeal) {
        npc.hp = Math.min(npc.maxHp, npc.hp + pt.passiveHeal);
      }
    }
  }

  // ── Rose petal state machine (mirrors player: spawn_wait → healing → reload) ─
  for (let s = 0; s < 5; s++) {
    const pid = npc.petals[s];
    if (!pid || !PETAL_TYPES) continue;
    const pt = PETAL_TYPES[pid];
    if (!pt || !pt.healAmount) continue;

    const state = npc._roseStates[s];

    if (state === null) {
      // Idle — start spawn_wait cycle
      npc._roseStates[s] = 'spawn_wait';
      npc._roseTimers[s] = 500;
    } else if (state === 'spawn_wait') {
      npc._roseTimers[s] -= dt;
      if (npc._roseTimers[s] <= 0) {
        if (npc.hp < npc.maxHp) {
          // Hurt — move to healing phase
          npc._roseStates[s] = 'healing';
          npc._roseTimers[s] = 850; // approach + wait time combined
        } else {
          // Full HP — reset and try again next cycle
          npc._roseStates[s] = 'spawn_wait';
          npc._roseTimers[s] = 500;
        }
      }
    } else if (state === 'healing') {
      npc._roseTimers[s] -= dt;
      if (npc._roseTimers[s] <= 0) {
        // Apply heal and go to reload
        npc.hp = Math.min(npc.maxHp, npc.hp + pt.healAmount);
        npc._roseStates[s] = 'reload';
        npc._roseTimers[s] = pt.reloadTime ?? 3000;
      }
    } else if (state === 'reload') {
      npc._roseTimers[s] -= dt;
      if (npc._roseTimers[s] <= 0) {
        // Reload done — restart cycle
        npc._roseStates[s] = 'spawn_wait';
        npc._roseTimers[s] = 500;
      }
    }
  }

  // ── Egg petal state machine (mirrors player: hatch_wait → linked → reload) ─
  if (spawnEggPet) {
    for (let s = 0; s < 5; s++) {
      const pid = npc.petals[s];
      if (!pid || !PETAL_TYPES) continue;
      const pt = PETAL_TYPES[pid];
      if (!pt || (!pt.isAntEgg && !pt.isBeeEgg && !pt.isDiggerEgg)) continue;

      const eggState = npc._eggStates[s];

      if (eggState === null) {
        // Not started — begin hatch countdown
        npc._eggStates[s] = 'hatch_wait';
        npc._eggTimers[s] = pt.hatchTime ?? EGG_SPAWN_INTERVAL;
      } else if (eggState === 'hatch_wait') {
        npc._eggTimers[s] -= dt;
        if (npc._eggTimers[s] <= 0) {
          // Spawn one pet per piece (ant_egg has 4 pieces; bee/digger eggs have 1)
          const pieceCount = pt.pieces ? pt.pieces.length : 1;
          const spawnedIds = [];
          for (let p = 0; p < pieceCount; p++) {
            const petId = spawnEggPet(pid, npc.x, npc.y);
            if (petId != null) spawnedIds.push(petId);
          }
          if (spawnedIds.length > 0) {
            npc._eggPetIds[s] = spawnedIds;
            npc._eggStates[s] = 'linked';
          } else {
            // Spawn failed — retry shortly
            npc._eggTimers[s] = 500;
          }
        }
      } else if (eggState === 'linked') {
        // Check if ANY of the pets are still alive
        const petIds = Array.isArray(npc._eggPetIds[s]) ? npc._eggPetIds[s] : (npc._eggPetIds[s] != null ? [npc._eggPetIds[s]] : []);
        const anyAlive = petIds.some(id => mobs.some(m => m.id === id && !m.dead));
        if (!anyAlive) {
          // All pets died — reload then hatch again
          npc._eggPetIds[s] = null;
          npc._eggStates[s] = 'reload';
          npc._eggTimers[s] = pt.reloadTime ?? EGG_SPAWN_INTERVAL;
        }
      } else if (eggState === 'reload') {
        npc._eggTimers[s] -= dt;
        if (npc._eggTimers[s] <= 0) {
          npc._eggStates[s] = 'hatch_wait';
          npc._eggTimers[s] = pt.hatchTime ?? EGG_SPAWN_INTERVAL;
        }
      }
    }
  }
}

// ── Face state ────────────────────────────────────────────────────────────────
/** Returns { attackT, defendT } for the NPC's flower face */
export function getNPCFaceState() {
  const pct = npc.hp / npc.maxHp;
  if (pct <= 0.25) return { attackT: 0, defendT: 1 };
  return { attackT: 0, defendT: 0 };
}

// ── Internals ────────────────────────────────────────────────────────────────

function _pickWanderTarget() {
  const margin = 100;
  const xMax   = getNPCWanderXMax() - margin;
  const yMax   = getWaveMapH() - margin;
  npc._wanderX = margin + Math.random() * (xMax - margin);
  npc._wanderY = margin + Math.random() * (yMax - margin);
  npc._wanderTimer = WANDER_INTERVAL_MIN + Math.random() * (WANDER_INTERVAL_MAX - WANDER_INTERVAL_MIN);
}
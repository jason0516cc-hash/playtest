/**
 * npcUpgradeUI.js — Standalone NPC popup GUI.
 *
 * Opens when the player presses E near the NPC (within NPC_PROXIMITY world units).
 * Completely separate from the crafting panel — never injected into it.
 *
 * Fixes:
 *   - Removed from crafting panel (was a tab there before)
 *   - Petal equip now correctly removes from inventory
 *   - Press E near NPC to open, E / Escape to close
 */

import { npc, isNPCPetalAllowed, npcEquipPetal, npcUnequipPetal } from './npc.js';
import { inventoryItems as inventory } from './inventory.js';
import { notifyInventoryChanged } from './uiManager.js';
import { PETAL_TYPES }          from './petalTypes.js';
import { player }               from './player.js';
import { RARITY_BG, RARITY_BORDER, RARITY_TEXT } from './constants.js';
import { drawInventoryIcon }    from './petalDrawing.js';
import { mobs }                 from './mobs.js';

const NPC_PROXIMITY = 300; // world units — must be near NPC to open

let _open      = false;
let _container = null;   // the popup DOM element

// ── Public API ────────────────────────────────────────────────────────────────

/** Call once after DOM is ready (when entering waves mode). */
export function initNPCUI() {
  if (_container) return;   // already created
  _buildPopup();
}

/** Tear down the popup entirely (leaving waves mode). */
export function destroyNPCUI() {
  if (_container) {
    _container.remove();
    _container = null;
  }
  _open = false;
}

/** Called every frame while in waves mode — hides the popup if player walks away. */
export function tickNPCUI() {
  if (_open && !_nearNPC()) closeNPCUI();
}

/** Toggle open/close when E is pressed (only if near NPC). */
export function tryToggleNPCUI() {
  if (!_container) return;
  if (_open) { closeNPCUI(); return; }
  if (_nearNPC()) openNPCUI();
}

export function closeNPCUI() {
  _open = false;
  if (_container) _container.style.display = 'none';
}

// keep old names as no-ops so main.js can still import them without errors
// (main.js references are replaced separately, but these are a safety net)
export const injectNPCTab  = initNPCUI;
export const updateNPCTab  = tickNPCUI;
export const hideNPCTab    = closeNPCUI;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _nearNPC() {
  if (!npc || npc.dead) return false;
  return Math.hypot(player.x - npc.x, player.y - npc.y) <= NPC_PROXIMITY;
}

function openNPCUI() {
  _open = true;
  if (_container) {
    _container.style.display = 'flex';
    _render();
  }
}

// ── DOM construction ──────────────────────────────────────────────────────────

function _buildPopup() {
  // Styles
  const style = document.createElement('style');
  style.textContent = `
    #npc-popup {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 2000;
      flex-direction: column;
      gap: 0;
      background: rgba(18, 28, 18, 0.97);
      border: 2px solid #3a6a3a;
      border-radius: 12px;
      padding: 14px 16px 16px;
      min-width: 300px;
      max-width: 360px;
      font-family: "UbuntuCustom","Ubuntu",Arial,sans-serif;
      color: #eee;
    }
    #npc-popup-title {
      font-size: 15px;
      font-weight: bold;
      color: #8ecf8e;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    #npc-popup-close {
      background: none;
      border: none;
      color: #888;
      font-size: 18px;
      cursor: pointer;
      line-height: 1;
      padding: 0 2px;
    }
    #npc-popup-close:hover { color: #fff; }
    .npc-section-label {
      font-size: 12px;
      color: #aaa;
      margin: 8px 0 5px;
    }
    .npc-hp-bar-wrap {
      background: rgba(0,0,0,0.4);
      border-radius: 4px;
      height: 10px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .npc-hp-bar {
      height: 100%;
      transition: width 0.3s;
    }
    .npc-slots-row {
      display: flex;
      gap: 6px;
      margin-bottom: 10px;
      justify-content: center;
    }
    .npc-slot {
      width: 50px; height: 50px;
      border-radius: 8px;
      border: 2px solid #555;
      background: rgba(0,0,0,0.3);
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; color: #aaa;
      text-align: center;
      white-space: pre-line;
      transition: border-color 0.15s, background 0.15s;
      position: relative; overflow: hidden; box-sizing: border-box;
    }
    .npc-slot canvas { display:block; width:100%!important; height:100%!important; pointer-events:none; }
    .npc-slot:hover { border-color: #aaa; }
    .npc-slot.filled { background: rgba(40,80,40,0.5); border-color: #4a8a4a; }
    .npc-inv-grid {
      display: flex; flex-wrap: wrap; gap: 5px;
      max-height: 160px; overflow-y: auto;
    }
    .npc-inv-item {
      width: 46px; height: 46px;
      border-radius: 7px;
      border: 2px solid #555;
      background: rgba(0,0,0,0.3);
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; color: #ccc;
      text-align: center;
      white-space: pre-line;
      position: relative;
      transition: border-color 0.15s;
      overflow: hidden; box-sizing: border-box;
    }
    .npc-inv-item canvas { display:block; width:100%!important; height:100%!important; pointer-events:none; }
    .npc-inv-item:hover { border-color: #fff; }
    .npc-badge {
      position: absolute; top: 2px; right: 3px;
      font-size: 10px; font-weight: bold; color: #fff;
    }
    .npc-empty-inv {
      color: #777; font-size: 12px;
      padding: 10px 0; width: 100%; text-align: center;
    }
    #npc-popup-hint {
      font-size: 11px;
      color: #666;
      text-align: center;
      margin-top: 10px;
    }
  `;
  document.head.appendChild(style);

  _container = document.createElement('div');
  _container.id = 'npc-popup';
  document.body.appendChild(_container);

  // Close on Escape only — E toggle is handled by ui.js → tryToggleNPCUI()
  // so we must NOT also close on 'e'/'E' here or the panel instantly re-closes.
  window.addEventListener('keydown', e => {
    if (_open && e.key === 'Escape') {
      closeNPCUI();
    }
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function _render() {
  if (!_container) return;
  _container.innerHTML = '';

  // Title row
  const title = document.createElement('div');
  title.id = 'npc-popup-title';
  title.innerHTML = '🤝 NPC Companion';
  const closeBtn = document.createElement('button');
  closeBtn.id = 'npc-popup-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeNPCUI);
  title.appendChild(closeBtn);
  _container.appendChild(title);

  // HP bar
  const hpPct = Math.max(0, npc.hp / npc.maxHp);
  const hpLabel = document.createElement('div');
  hpLabel.className = 'npc-section-label';
  hpLabel.textContent = `NPC HP: ${Math.round(npc.hp).toLocaleString()} / ${npc.maxHp.toLocaleString()} (${Math.round(hpPct * 100)}%)`;
  _container.appendChild(hpLabel);

  const hpWrap = document.createElement('div');
  hpWrap.className = 'npc-hp-bar-wrap';
  const hpBar = document.createElement('div');
  hpBar.className = 'npc-hp-bar';
  hpBar.style.width = (hpPct * 100) + '%';
  hpBar.style.background = hpPct > 0.5 ? '#4caf50' : hpPct > 0.25 ? '#ff9800' : '#f44336';
  hpWrap.appendChild(hpBar);
  _container.appendChild(hpWrap);

  // NPC slots
  const slotsLabel = document.createElement('div');
  slotsLabel.className = 'npc-section-label';
  slotsLabel.textContent = 'NPC Petal Slots — click to unequip';
  _container.appendChild(slotsLabel);

  const slotsRow = document.createElement('div');
  slotsRow.className = 'npc-slots-row';
  for (let s = 0; s < 5; s++) {
    const pid = npc.petals[s];
    const slot = document.createElement('div');
    slot.className = 'npc-slot' + (pid ? ' filled' : '');
    if (pid) {
      const pt = PETAL_TYPES[pid];
      const _bg  = RARITY_BG[pt?.rarity]     || '#556';
      const _brd = RARITY_BORDER[pt?.rarity] || '#4a8a4a';
      if (pt?.rarity === 'Impracticality') {
        slot.style.background  = 'linear-gradient(135deg,#ff0000,#ff8800,#ffff00,#00cc44,#0088ff,#8800ff,#ff00cc)';
        slot.style.borderColor = '#990099';
      } else {
        slot.style.background  = `color-mix(in srgb, ${_bg} 38%, #0c1020)`;
        slot.style.borderColor = _brd;
      }
      slot.title = `Click to return "${pt?.name || pid}" to inventory`;
      // Draw canvas icon like inventory
      const cv = document.createElement('canvas');
      const slotCSS = 50;
      const physSize = Math.round(slotCSS * (window.devicePixelRatio || 1));
      cv.width = physSize; cv.height = physSize;
      drawInventoryIcon(cv, pid);
      slot.appendChild(cv);
      slot.addEventListener('click', () => {
        const { typeId: returned, petIds } = npcUnequipPetal(s);
        // Kill all linked pet mobs (if any were hatched and are still alive)
        for (const petId of petIds) {
          const pet = mobs.find(m => m.id === petId && !m.dead);
          if (pet) pet.dead = true;
        }
        if (returned) {
          if (!inventory[returned]) inventory[returned] = 0;
          inventory[returned]++;
          notifyInventoryChanged();
        }
        _render();
      });
    } else {
      slot.textContent = '—';
    }
    slotsRow.appendChild(slot);
  }
  _container.appendChild(slotsRow);

  // Inventory list filtered to allowed petals
  const invLabel = document.createElement('div');
  invLabel.className = 'npc-section-label';
  invLabel.textContent = 'Your Healing & Egg Petals — click to equip';
  _container.appendChild(invLabel);

  const grid = document.createElement('div');
  grid.className = 'npc-inv-grid';

  const RARITY_ORDER = [
    'Common','Unusual','Rare','Epic','Legendary',
    'Mythic','Ultra','Super','Radiant','Mystic','Runic',
    'Seraphic','Umbral','Impracticality',
  ];

  const allowedItems = Object.entries(inventory)
    .filter(([, count]) => count > 0)
    .filter(([typeId]) => isNPCPetalAllowed(typeId))
    .map(([typeId, count]) => ({ typeId, count, pt: PETAL_TYPES[typeId] }))
    .sort((a, b) =>
      (RARITY_ORDER.indexOf(b.pt?.rarity) - RARITY_ORDER.indexOf(a.pt?.rarity))
      || (a.pt?.name || '').localeCompare(b.pt?.name || '')
    );

  let anyItems = allowedItems.length > 0;
  for (const { typeId, count } of allowedItems) {
    const pt = PETAL_TYPES[typeId];
    const item = document.createElement('div');
    item.className = 'npc-inv-item';
    item.title     = pt ? `${pt.name} — click to equip on NPC` : typeId;
    const _ibg  = RARITY_BG[pt?.rarity]     || '#556';
    const _ibrd = RARITY_BORDER[pt?.rarity] || '#555';
    if (pt?.rarity === 'Impracticality') {
      item.style.background  = 'linear-gradient(135deg,#ff0000,#ff8800,#ffff00,#00cc44,#0088ff,#8800ff,#ff00cc)';
      item.style.borderColor = '#990099';
    } else {
      item.style.background  = `color-mix(in srgb, ${_ibg} 38%, #0c1020)`;
      item.style.borderColor = _ibrd;
    }
    // Draw canvas icon like inventory
    const cv = document.createElement('canvas');
    const slotCSS = 46;
    const physSize = Math.round(slotCSS * (window.devicePixelRatio || 1));
    cv.width = physSize; cv.height = physSize;
    drawInventoryIcon(cv, typeId);
    item.appendChild(cv);

    const badge = document.createElement('span');
    badge.className   = 'npc-badge';
    badge.textContent = count > 1 ? `×${count}` : '';
    item.appendChild(badge);

    item.addEventListener('click', () => {
      // Check NPC slots aren't full
      if (npc.petals.every(p => p !== null)) {
        item.style.borderColor = '#f44';
        setTimeout(() => { item.style.borderColor = _ibrd; }, 500);
        return;
      }
      // Equip: add to NPC, remove from inventory
      const slot = npcEquipPetal(typeId);
      if (slot !== -1) {
        inventory[typeId]--;
        if (inventory[typeId] <= 0) delete inventory[typeId];
        notifyInventoryChanged();
        _render();   // refresh to show updated counts
      }
    });

    grid.appendChild(item);
  }

  if (!anyItems) {
    const empty = document.createElement('div');
    empty.className = 'npc-empty-inv';
    empty.textContent = 'No healing or egg petals in inventory.';
    grid.appendChild(empty);
  }

  _container.appendChild(grid);

  const hint = document.createElement('div');
  hint.id = 'npc-popup-hint';
  hint.textContent = 'Press E or Esc to close';
  _container.appendChild(hint);
}

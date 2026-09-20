/**
 * spectateMode.js — Player death spectate in Waves mode.
 *
 * When the player dies in waves mode:
 *  - Camera locks to the NPC position
 *  - Countdown "Respawning in 5…" shown in the centre of the screen
 *  - After 5 seconds: player respawns at left spawn zone
 */

const RESPAWN_DELAY_MS = 5000;

let _active      = false;
let _timer       = 0;
let _onRespawn   = null;

/** Begin spectate mode; onRespawn() is called when the timer ends. */
export function startSpectate(onRespawnCb) {
  _active    = true;
  _timer     = RESPAWN_DELAY_MS;
  _onRespawn = onRespawnCb;
}

/** Cancel spectate mode (e.g. game over triggers before respawn). */
export function cancelSpectate() {
  _active    = false;
  _timer     = 0;
  _onRespawn = null;
}

export function isSpectating() { return _active; }

/** Update spectate timer. Call every frame while spectating. */
export function updateSpectate(dt) {
  if (!_active) return;
  _timer -= dt;
  if (_timer <= 0) {
    _active = false;
    const cb = _onRespawn;
    _onRespawn = null;
    if (cb) cb();
  }
}

/** Seconds remaining (rounded up) — for UI display. */
export function spectateSecondsLeft() {
  return Math.max(0, Math.ceil(_timer / 1000));
}

// ── Draw the spectate overlay ─────────────────────────────────────────────────
export function drawSpectateOverlay(ctx, W, H) {
  if (!_active) return;

  const secs = spectateSecondsLeft();
  const label = `Respawning in ${secs}…`;

  ctx.save();

  // Dark vignette at edges to signal "you are dead"
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // Countdown text
  const fontSize = 36;
  ctx.font         = `bold ${fontSize}px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  const cy = H * 0.38;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.70)';
  ctx.fillText(label, W / 2 + 2, cy + 2);

  // Main text
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, W / 2, cy);

  // Small sub-label
  ctx.font      = `18px "UbuntuCustom", "Ubuntu", Arial, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('Camera following NPC', W / 2, cy + fontSize);

  ctx.restore();
}
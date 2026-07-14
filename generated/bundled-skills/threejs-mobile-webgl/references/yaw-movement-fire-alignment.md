# Camera Yaw vs Movement vs Raycast Alignment

Use when the player can move correctly but shooting misses, tracers go backward, or hits never register after a camera/control refactor.

## Symptom

- Joystick movement feels correct after yaw fix.
- Fire button flashes HUD/recoil but zombies take no damage.
- Desktop mouse aim may work while mobile fire does not (or vice versa).

## Cause

Three.js camera forward is often derived from yaw with **negative sin / negative cos** for world X/Z, while an older 2D-style raycast still used **positive cos(yaw)** or a mismatched axis. Movement and `shoot()` must share one convention.

## Check (minified HTML)

1. Grep the same file for `sin(yaw)` and `cos(yaw)` in **movement** and **shoot** / ray direction.
2. Confirm camera position + ray direction use the same forward vector as player velocity.
3. After any flipY or billboard fix, re-verify fire — texture fixes do not fix yaw.

## Fix pattern

```js
// Forward from yaw (example — match your camera setup)
const fx = -Math.sin(yaw);
const fz = -Math.cos(yaw);
// Use (fx, fz) for movement impulse AND raycast direction
```

## Mobile overlay

If fire works but look pad stops while holding fire, check z-index and `pointer-events` on look vs fire buttons (see ios-mobile-textures.md control overlay section).

## Evidence

- Pocket Zombies `games/mobile-sideways-fps/index.html`, 2026-07-03: movement yaw fixed ~00:50 UTC; firing ray still wrong until `shoot()` aligned ~05:10 UTC (`memory/2026-07-03-intraday-notes.md`).
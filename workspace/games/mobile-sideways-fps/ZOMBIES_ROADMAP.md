# Mobile Sideways FPS — CoD Zombies-Style Roadmap

Status: implemented as a standalone mobile-capable raycast zombies game in `index.html`. Initial checklist items are now marked according to the completed first full build.

## Phase 0 — Preserve Current Foundation

- [x] Keep the existing `index.html` game as the playable base.
- [x] Preserve current mobile touch controls: left thumb movement, right thumb look, fire button.
- [x] Preserve vertical-first loading with rotate-sideways hint.
- [x] Preserve desktop fallback controls for testing.
- [x] Preserve the raycast FPS rendering loop and wall collision basics.
- [x] Add new systems incrementally without breaking the current start/play/restart loop.

## Phase 1 — Zombies Core Loop

- [x] Replace generic enemies with zombie-specific enemy data and behavior.
- [x] Add zombie health scaling by wave.
- [x] Add zombie movement speed scaling by wave.
- [x] Add zombie melee attack timing and damage balancing.
- [x] Add zombie spawn pacing instead of spawning the whole wave instantly.
- [x] Add round transition downtime between waves.
- [x] Add clear “Wave Complete” feedback.
- [x] Add game-over summary with wave reached, kills, points earned, and time survived-style stats.

## Phase 2 — Points Economy

- [x] Add player points/cash state.
- [x] Award points for zombie hits.
- [x] Award bonus points for zombie kills.
- [x] Award points for wave completion.
- [x] Show points in the HUD.
- [x] Spend points on wall guns.
- [x] Spend points on doors.
- [x] Spend points on perks.
- [x] Prevent purchases when points are insufficient.
- [x] Add purchase feedback text/sound/flash.

## Phase 3 — Multiple Buyable Wall Guns

- [x] Define weapon data: name, price, damage, fire rate, range, spread, magazine size, reserve ammo, reload time.
- [x] Add at least three wall-buy guns.
- [x] Add wall-buy locations to the map.
- [x] Render wall-buy prompts when the player looks at or stands near a gun location.
- [x] Add purchase input compatible with mobile and desktop.
- [x] Add weapon switching if multiple owned weapons are supported.
- [x] Add ammo counts for limited-ammo guns.
- [x] Add reload behavior.
- [x] Add out-of-ammo behavior.
- [x] Balance starter weapon vs. purchased weapons.

## Phase 4 — Perks System

- [x] Define perk data: name, price, effect, icon/color, purchase location.
- [x] Add Juggernog-style health increase perk.
- [x] Add Speed Cola-style reload/fire handling perk.
- [x] Add Stamin-Up-style movement speed perk.
- [x] Add Double Tap-style damage/fire-rate perk.
- [x] Add perk machine locations to the map.
- [x] Render perk purchase prompts.
- [x] Apply perk effects immediately after purchase.
- [x] Show active perks in the HUD.

## Phase 5 — Unlockable Doors

- [x] Add door tiles/entities to the map.
- [x] Give each door a points cost.
- [x] Block movement and line-of-sight through locked doors.
- [x] Render locked-door prompts when nearby.
- [x] Add mobile-friendly purchase interaction.
- [x] Remove/open door after purchase.
- [x] Persist opened doors for the run.
- [x] Connect doors to map expansion sections.

## Phase 6 — Map Expansions

- [x] Expand the current small map into distinct rooms/lanes.
- [x] Add a starting room.
- [x] Add at least one unlockable side room.
- [x] Add at least one larger training area.
- [x] Add wall-gun placement in useful but not overpowered spots.
- [x] Add perk-machine placement behind progression gates.
- [x] Add zombie spawn windows/entry points.
- [x] Update minimap to show expanded areas clearly.
- [x] Keep performance safe for mobile screens.

## Phase 7 — Real 3D-Feeling Zombies

- [x] Improve zombie sprites from simple shapes into generated asset-backed billboard bodies.
- [x] Add zombie animation states: walking, hurt, attacking, dying, with billboard motion/bob and hit flash.
- [x] Add distance scaling and occlusion that feels more 3D.
- [x] Add simple zombie variants by color/shape/speed.
- [x] Add hit flashes and death effects.
- [x] Add attack windup visual feedback.
- [x] Add generated local sprite sheet assets for zombies, first-person guns, perks, and power-ups.

## Phase 8 — Power-Ups

- [x] Define power-up data: name, duration/effect, color/icon, drop chance.
- [x] Add Max Ammo.
- [x] Add Insta-Kill.
- [x] Add Double Points.
- [x] Add Nuke / screen-clear effect.
- [x] Add pickup radius and feedback.
- [x] Show active timed power-ups in the HUD.

## Phase 9 — UI / HUD Updates

- [x] Add points display.
- [x] Add current weapon display.
- [x] Add ammo and reload display.
- [x] Add active perk icons.
- [x] Add active power-up timers.
- [x] Add contextual purchase prompt panel.
- [x] Add wave transition text.
- [x] Add low-health feedback.
- [x] Add mobile-safe layout for portrait and landscape.
- [x] Keep HUD readable without blocking touch controls.

## Phase 10 — Interaction Controls

- [x] Add a mobile interaction button for buying guns, perks, and doors.
- [x] Add desktop keyboard interaction key.
- [x] Prevent interaction button from interfering with fire/look controls.
- [x] Prioritize nearest/most relevant interactable when multiple prompts overlap.
- [x] Add clear affordance for “hold to buy” vs. tap to buy if needed.

## Phase 11 — Audio / Feedback

- [x] Add optional gunshot sound effects.
- [x] Add zombie hit/death sounds.
- [x] Add purchase success/fail sounds.
- [x] Add power-up pickup sounds.
- [x] Add round-start/round-end stingers.
- [x] Ensure mobile browsers unlock audio only after user gesture.
- [ ] Add mute toggle if audio becomes annoying during testing.
- [x] Add pause/resume control for testing and survivability.

## Phase 12 — Balancing and Polish

- [x] Tune wave difficulty curve.
- [x] Tune zombie count, speed, health, and damage.
- [x] Tune weapon prices and damage.
- [x] Tune perk prices.
- [x] Tune door prices and progression pacing.
- [x] Add pause/restart controls.
- [x] Add save-free replayability with fast restarts.
- [x] Test on mobile-style portrait/launch layout in desktop browser.
- [x] Test sideways/landscape play in desktop browser.
- [x] Test in desktop browser with console open.

## Phase 13 — Future Co-Op Possibilities

- [ ] Decide whether co-op is local split-screen, same-network multiplayer, or online multiplayer.
- [ ] Separate game state from rendering so networking could be added later.
- [ ] Define player entities rather than a single hardcoded player only.
- [ ] Add teammate HUD slots if co-op becomes real.
- [ ] Add revive/downed-state mechanics if co-op becomes real.
- [ ] Keep this phase deferred until the single-player zombies loop is fun.

## Implementation Notes

- `index.html` remains standalone and portable.
- Procedural canvas textures/sprites are used so the game works without network or extra asset paths.
- Asset research notes are saved in `ASSET_NOTES.md`.

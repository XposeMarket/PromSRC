# Pocket Zombies Asset Notes

This game now uses a real generated sprite sheet plus procedural fallback textures.

## Current Local Asset

- `assets/pocket-zombies-sprites.png`
- Regenerated with Prometheus image generation on 2026-06-28 for this project after the restart/resume pass.
- Copied from `generated/images/pocket-zombies-assets/openai_codex_2026-06-28T19-47-15-072Z_Create_a_single_4x4_sprite_sheet_for_a_mobile_HT/openai_codex_2026-06-28T19-48-24-200Z_Create_a_single_4x4_sprite_sheet_for_a_mob.png` into the game directory so the HTML can load it with a stable relative path.

## Sprite Sheet Contents

The sheet is arranged as a 4-column grid of isolated game sprites:

- Row 1: zombie billboard variants: normal, crawler/skinny, brute, armored.
- Row 2: first-person weapon sprites: M1911-style pistol, compact SMG, trench shotgun, battle rifle.
- Row 3: perk icons: red health/Jug-style soda, blue reload/Speed-style soda, yellow double-damage, green stamina.
- Row 4: power-up icons: max ammo crate, lightning/insta-kill, double-points coin, nuke/skull badge.

## Research / Source Rationale

Relevant external asset sources were considered:

- Kenney assets: CC0 game assets and UI/audio packs.
- Quaternius: CC0 low-poly game kits, including zombie/apocalypse-style packs.
- CraftPix / itch.io zombie sprite packs: useful references, but licensing and direct-download flow vary by pack.
- OpenGameArt CC0 collections: broad texture/sprite source pool.

For this standalone mobile HTML game, the cleanest path was to generate a custom local sprite sheet instead of relying on fragile direct-download links or unclear third-party licensing. The game still keeps procedural wall, door, floor, minimap, HUD, and fallback renderers so it remains playable even if the image has not finished loading.

## Used In-Game

- Zombie enemies render as billboard sprites from the sheet, scaled by distance in the raycast view.
- The player's current gun renders as an actual first-person weapon sprite at the bottom center of the screen.
- Wall guns, perk machines, and power-ups use their corresponding sheet icons.
- Procedural wall/door/floor textures remain local canvas textures for speed and consistency.

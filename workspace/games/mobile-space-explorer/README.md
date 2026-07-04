# Galaxy Drift

Third-person Three.js space explorer (mobile landscape + desktop).

## Run locally

```bash
cd games/mobile-space-explorer
npx http-server . -p 8778 -c-1
```

Open http://127.0.0.1:8778/

## Controls

**Desktop:** WASD move, mouse drag look, Space jump, Shift boost, E talk (near friendly NPC), click/hold fire (hostile NPCs in biomes).

**Mobile:** MOVE stick, right-side look pad (full pitch/yaw), JUMP, BOOST, FIRE, TALK.

## Play loop

1. Start in the **galaxy** — stars, asteroids, four planets.
2. Fly into a planet (or dev console: `__galaxyDrift.warpToPlanet('ember'|'frost'|'jade'|'dune')`) for black fade → **biome** open world.
3. Each planet has a different biome (lava, tundra, jungle, desert), NPCs (chat or fight).
4. Walk to the biome edge to fade back to space.
5. Asteroid impacts reduce hull (HUD + red flash).
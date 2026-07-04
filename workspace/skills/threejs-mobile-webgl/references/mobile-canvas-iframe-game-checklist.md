# Mobile canvas iframe + single-file game checklist

Use when a workspace HTML game runs in Prometheus mobile canvas (`/api/canvas/workspace/...`) and symptoms flip between invisible enemies, missing HUD sprites, wrong camera aim, or assets that worked then regressed.

## Iframe asset URLs

Relative PNG paths break when the document URL is not the game folder. Resolve against `location.href`:

```js
function resolveAssetUrl(url) {
  const bust = (url.includes("?") ? "&" : "?") + "pmtex=" + assetBust;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url + bust;
  try { return new URL(url, location.href).href + bust; } catch (e) { return url + bust; }
}
```

Route all `texUrl` / weapon DOM `src` through the same helper. Keep CanvasTexture placeholder + in-place canvas redraw (see ios-mobile-textures.md).

## Duplicate script after `</html>`

Symptom: zombies invisible, half the game logic dead, validate_file still passes opening tags.

Cause: early `</script></body></html>` then hundreds of lines of duplicate JS including old sprite loops.

Fix: delete everything after the first valid document close; confirm exactly one `makeHumanoid` / one game loop.

## Visibility vs orientation (not always textures)

If HUD works but 3D enemies “missing”, check:

1. Player spawn yaw — initial yaw may face away from first-wave spawns (`Math.PI` toward corridor).
2. Spawn Z in front of camera, not only at map origin.
3. Mobile FOV in resize handler.
4. `preserveDrawingBuffer: true` when automating screenshots of WebGL canvas.

## Minified file discipline

After any afternoon-long edit pass: grep `\?\.[0-9]` (invalid optional chaining), confirm file `last_modified` matches latest DEBUG note, hard-refresh iframe `?v=` cache bust.

## Evidence

- Pocket Zombies `games/mobile-sideways-fps/index.html`, 2026-07-03 15:49–18:25 UTC (`memory/2026-07-03-intraday-notes.md:58-88`).
# threejs_cinematic_v1 report

## Scene

`index.html` and `scene.js` compose a dependency-free browser fixture around a pinned Three.js `0.184.0` ES-module CDN import. No sign-in, data submission, or external side effect is used; the CDN request only loads the documented rendering library.

The environment contains a shadow-catching moonlit ground plane, horizon ring, rock formations, a ten-sided observatory base, a metallic half-dome, window slit, antenna, emissive beacon core, three rotating signal rings, a translucent signal beam, a procedural star field, and drifting firefly motes. Lighting uses a hemisphere fill, shadow-casting directional moonlight, a cyan beacon point light, and a warm window point light.

## Timed beats

The cinematic is a looping 18-second transmission. Camera choreography is represented in `scene.js` by the `CINEMATIC_BEATS` array, whose entries contain an explicit `time` in seconds, camera `position`, look-at `target`, and exposure. `applyCinematicTime(time)` finds the active adjacent keyframes, normalizes the segment time, and eases it with `smoothstep` before interpolating the camera and target.

The beats are:

- `0.0s` — **Distant approach**: a wide establishing view of the observatory.
- `4.5s` — **The beacon wakes**: the camera pushes closer as cyan light and the core pulse intensify.
- `9.5s` — **Orbit of the signal**: the view crosses to the opposite side while the beacon rings rotate.
- `14.0s` — **Last pulse**: the camera settles into a tighter return view and the beam flashes.
- `18.0s` — **Distant approach**: a closing keyframe matches the first beat, making the timeline loop cleanly.

The render loop uses `clock.getElapsedTime()`, wraps it with `elapsed % TIMELINE_DURATION`, applies the current cinematic keyframe segment, animates the beacon, lights, rings, stars, and motes, then renders and schedules the next frame with `requestAnimationFrame(render)`.

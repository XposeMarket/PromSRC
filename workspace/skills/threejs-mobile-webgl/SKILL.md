---
name: "threejs-mobile-webgl"
description: "Diagnose Three.js/WebGL failures that reproduce on iPhone, iPad, mobile Safari, iOS PWA/WebView, or a mobile file canvas while the same scene works on desktop. Use for missing textured sprites or transparent PNG planes, CanvasTexture upload issues, touch-overlay interception, or Three.js mobile yaw, movement, and fire misalignment; do not use for general Three.js authoring."
---

# Three.js Mobile WebGL

Use this skill before assuming asset paths are broken when a Three.js scene works on desktop but mobile Safari/iOS drops sprites or WebGL texture assets.

## Workflow

1. Confirm whether geometry renders while textured sprites disappear.
2. Confirm the asset request succeeds independently of WebGL.
3. Check PNG dimensions. Treat non-power-of-two textures as suspicious on iOS.
4. Disable mipmaps and repeat wrapping on sprite textures.
5. If sprites still disappear, upload sprites through a same-origin power-of-two `CanvasTexture`.
6. Cache-bust the iframe URL and sprite image URLs while testing in a PWA or mobile canvas.
7. For mobile game controls, check full-screen touch overlays and z-index before changing game logic.

## Known iOS Texture Fix

Read [references/ios-mobile-textures.md](references/ios-mobile-textures.md) for the reusable fix pattern: `CanvasTexture`, power-of-two backing canvas, `ClampToEdgeWrapping`, `LinearFilter`, `generateMipmaps=false`, `unpackAlignment=1`, and material refresh after image load.

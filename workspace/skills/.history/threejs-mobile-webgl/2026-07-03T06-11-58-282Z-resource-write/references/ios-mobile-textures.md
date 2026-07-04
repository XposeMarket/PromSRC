# iOS Mobile Texture Debugging

Use this reference when a Three.js/WebGL scene works on desktop or desktop mobile emulation, but iPhone/iPad/mobile Safari shows missing sprites, billboards, transparent PNG planes, icons, or pickups while geometry, lights, DOM images, and HUD still render.

## Fast Diagnosis

Suspect iOS WebGL texture upload/completeness when:

- Desktop renders the same file and asset paths correctly.
- Network requests for PNG/JPG/WebP assets return 200.
- DOM `<img>` assets render, but Three.js textured meshes do not.
- Room geometry or untextured materials render normally.
- The missing assets are transparent PNG sprites, billboard planes, powerups, enemies, particles, or UI-like meshes.
- The scene is inside an iframe, PWA, mobile file canvas, or Safari/WebView.

Check texture dimensions. If any texture uploaded to WebGL is non-power-of-two (NPOT), avoid mipmaps and repeat wrapping. Many desktop WebGL2 paths tolerate mistakes that iOS/WebView still punishes.

## Required Safe Texture Settings

For NPOT textures, use:

```js
texture.wrapS = THREE.ClampToEdgeWrapping;
texture.wrapT = THREE.ClampToEdgeWrapping;
texture.minFilter = THREE.LinearFilter;
texture.magFilter = THREE.LinearFilter;
texture.generateMipmaps = false;
texture.flipY = false;
texture.needsUpdate = true;
```

Do not use `LinearMipmapLinearFilter`, `RepeatWrapping`, or mipmaps for NPOT mobile sprite textures.

## Most Reliable iOS Workaround

If safe NPOT settings are not enough, draw the image into a same-origin power-of-two canvas first, then create a `CanvasTexture`.

```js
const texCache = {};
const assetBust = Date.now().toString(36);
const maxSpriteTex = Math.min(renderer.capabilities.maxTextureSize || 2048, 1024);

function nextPot(n) {
  return Math.min(maxSpriteTex, 2 ** Math.ceil(Math.log2(Math.max(2, n || 2))));
}

function spriteTexture(url, onReady = () => {}) {
  if (texCache[url]) return texCache[url];

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texCache[url] = texture;

  const img = new Image();
  img.onload = () => {
    const w = nextPot(img.naturalWidth || img.width);
    const h = nextPot(img.naturalHeight || img.height);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, w, h);
    texture.needsUpdate = true;
    onReady(texture);
  };
  img.src = url + (url.includes("?") ? "&" : "?") + "pmtex=" + assetBust;

  return texture;
}
```

When updating existing sprite meshes, mark affected materials dirty after the canvas redraw.

## Mobile Canvas/Iframe Cache Guard

If the scene is opened inside a mobile canvas iframe or PWA, cache-bust the iframe URL and asset URLs while debugging. iOS may keep a failed document or texture decode alive longer than expected.

## Control Overlay Check

For mobile games, also inspect touch overlays. A full-screen look pad can steal taps from fire/reload/buy buttons if it has a higher stacking order. Ensure action buttons have a higher `z-index`, `pointer-events:auto`, `touch-action:none`, and stop event propagation in `pointerdown`/`pointerup`.

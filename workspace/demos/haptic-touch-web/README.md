# Tactile Web

An open-source haptics playground for iOS Safari and the modern web. It is intentionally plain HTML, CSS, and JavaScript so people can inspect the source and run their own copy without a framework or build step.

## Live demo

- https://tactile-web-nine.vercel.app

## Demos

- **Reasoning level**: Prometheus Mobile-inspired stepped slider. Each crossed step requests a small selection tick.
- **Flashlight intensity**: iOS Control Center-inspired vertical slider with a stable pointer-capture surface and pulses while moving.
- **Button sampler**: selection, light impact, medium impact, and success/double-pulse patterns.
- **Haptic arm**: a required trusted tap for iOS 18.4+ before testing movement.
- **Source panel**: live links to the HTML, CSS, JavaScript, README, and MIT license, plus a copyable minimal helper.

## Why the sliders no longer get stuck

The first version placed a fixed, invisible `input[switch]` over each control. The second overlay could intercept the first one and sit above other page controls. The current version keeps every haptic input local to its slider and uses pointer capture on the slider itself. The reasoning step labels remain real buttons, so tapping them does not start a competing drag.

## Haptic strategy

The demo imports [`ios-vibrator-pro-max`](https://github.com/samdenty/ios-vibrator-pro-max), the open-source polyfill behind [vibrator.dev](https://vibrator.dev/). It patches `navigator.vibrate()` and translates trusted button clicks and pointer movement into the hidden iOS Safari switch interaction required for native haptics. The controls themselves stay stable and own pointer capture; no invisible overlay is placed over them.

Haptic behavior on iOS is still controlled by the OS and Safari. Test on a physical iPhone in Safari with system haptics enabled. On iOS 18.4 and newer, tap a button first to establish the trusted vibration grant, then drag slowly. Desktop browsers can verify the interaction trace, but they do not have a touch actuator.

## Run locally

```bash
npx serve -l 4173 .
```

Then open `http://localhost:4173`.

## Deploy to Vercel

From this directory:

```bash
npx vercel deploy --yes --name tactile-web
```

The project is static and has no secrets or runtime dependencies.

## Files

- `index.html` — page markup and accessible slider/button controls.
- `styles.css` — visual system and responsive layout.
- `script.js` — pointer capture, haptic fallbacks, state, and copy helper.
- `LICENSE` — MIT license.

## License

MIT. See [`LICENSE`](./LICENSE).

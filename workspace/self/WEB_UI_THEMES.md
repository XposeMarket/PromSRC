# Web UI Themes System

## Overview

The Prometheus web UI uses a **dual-attribute theming** system:
- **`data-theme`** = structural base (dark/light) — CSS that applies to all dark variants or light variants. **DO NOT EDIT** these, they are shared.
- **`data-skin`** = named theme override — CSS variables and custom styles that override the base for a specific theme.

This approach lets you add unlimited named themes (blue, purple, etc.) without touching the original dark/light CSS, which guarantees those modes stay frozen.

## Key Files

| File | Purpose |
|------|---------|
| `web-ui/index.html` | FOUC script (~line 45): `window.PROM_THEMES` registry + embed theme list |
| `web-ui/index.html` | Inline theme functions (~line 6965): `getThemeList()`, `resolveTheme()`, `toggleTheme()`, `applyTheme()`, `selectTheme()` |
| `web-ui/index.html` | Ember canvas script (~line 7652): `EMBER_THEMES` object keyed by skin ID; particle color palettes |
| `web-ui/src/styles/themes.css` | All `:root[data-skin="..."]` overrides + theme-picker UI |
| `web-ui/src/app.js` | Mirror of theme functions (called from JS, exported to window) |
| `web-ui/src/pages/SettingsPage.js` | Integrates `renderThemePicker()` into Settings → System → Appearance |
| `web-ui/service-worker.js` | VERSION string (bump on every web-ui change) |
| `assets/chat-main-background-*.jpeg` | Theme background images |

## Current Themes

```
dark  → Default Dark  (base: dark)
light → Light         (base: light)
blue  → Olympian Blue (base: dark)
purple→ Aether Violet (base: dark)
```

Toggle order: `dark → light → blue → purple → dark` (rotates on top-bar click).

## Adding a New Theme

### Step 1: Add to Registry (web-ui/index.html, line ~45)

```javascript
window.PROM_THEMES = [
  { id: 'dark',    label: 'Default Dark',  base: 'dark'  },
  { id: 'light',   label: 'Light',         base: 'light' },
  { id: 'blue',    label: 'Olympian Blue', base: 'dark'  },
  { id: 'purple',  label: 'Aether Violet', base: 'dark'  },
  { id: 'YOUR_ID', label: 'Your Theme',    base: 'dark' }, // NEW
];
```

- **id**: kebab-case, used as `data-skin="your-id"`; also used to key `EMBER_THEMES`
- **label**: User-facing name shown in Settings picker and top-bar toggle preview
- **base**: `'dark'` or `'light'` — determines which structural CSS applies

### Step 2: Define Ember Palette (web-ui/index.html, line ~7652)

```javascript
const EMBER_THEMES = {
  dark: { palette: [[200,100,18], ...], core: 'rgba(255,210,130,0.92)' },
  blue: { palette: [[40,96,190], ...], core: 'rgba(150,200,255,0.92)' },
  purple: { palette: [[120,70,210], ...], core: 'rgba(208,170,255,0.92)' },
  your_id: { palette: [[R1,G1,B1], [R2,G2,B2], ...], core: 'rgba(R,G,B,A)' }, // NEW
};
```

- **palette**: 5 `[R, G, B]` triples — particle colors. Use values in your theme's accent range. Example for a teal theme: `[[20,180,200], [15,150,170], ...]`
- **core**: RGBA of the main ember glow — the brightest part. Should be a lighter/more-saturated version of the palette colors. Example: `'rgba(100,220,240,0.92)'`

### Step 3: Create Background Asset (assets/)

Optional, but recommended. Copy or create a 1000x1000px+ image:
```bash
cp some-image.jpeg assets/chat-main-background-your-id.jpeg
```

The CSS will reference it as `/assets/chat-main-background-your-id.jpeg`.

### Step 4: Write CSS Overrides (web-ui/src/styles/themes.css)

**Critical ordering:** Add a new `:root[data-skin="your_id"]` block BEFORE the theme-picker comment (~line 226). This ensures it loads before picker styles and wins via source order.

Use this template:

```css
:root[data-skin="your_id"] {
  /* ── SURFACES ── */
  --bg: #1a1a1a;              /* main background */
  --bg-soft: #222222;         /* softer variant */
  --panel: #2d2d2d;           /* dialog/panel bg */
  --panel-2: #3a3a3a;         /* secondary panel */
  --line: rgba(R,G,B,0.12);   /* borders, subtle */
  --line-strong: rgba(R,G,B,0.22);

  /* ── TEXT ── */
  --text: #f0f0f0;
  --fg: #f0f0f0;
  --muted: #999999;

  /* ── BRAND / FLAME ── */
  --brand: #YOUR_HEX;         /* primary accent */
  --brand-2: #DARKER_HEX;
  --ok: #4ade80;
  --warn: #fbbf24;
  --err: #f87171;

  --flame: #YOUR_HEX;         /* same as brand, used for glow/borders */
  --flame-mid: #LIGHTER_HEX;
  --flame-glow: rgba(R,G,B,0.26);
  --flame-border: rgba(R,G,B,0.48);

  /* ── SIDEBAR ── */
  --sidebar-bg: rgba(R,G,B,0.82);
  --sidebar-text: #f0f0f0;
  --sidebar-muted: #999999;
  --sidebar-icon-bg: rgba(R,G,B,0.08);
  --sidebar-item-hover: rgba(R,G,B,0.16);
  --sidebar-active-bg: rgba(R,G,B,0.22);
  /* ... etc (copy from existing theme, adjust RGB) */

  /* ── OTHER VARS ── */
  --pm-orange: #YOUR_HEX;     /* reused as "orange" throughout */
  --pm-orange-hot: #DARKER;
  --pm-ember: #DARK_SHADE;
  --pm-gold: #LIGHTER;
  --composer-bg: rgba(R,G,B,0.76);
  --composer-border: rgba(R,G,B,0.12);
}

/* ── STRUCTURAL BACKGROUNDS ── */
:root[data-skin="your_id"] body {
  background:
    radial-gradient(circle at top left, rgba(R,G,B,0.12), transparent 34%),
    radial-gradient(circle at bottom right, rgba(R,G,B,0.07), transparent 30%),
    var(--bg);
}
:root[data-skin="your_id"] main { background: #1a1a1a; }
:root[data-skin="your_id"] .main-shell-wrap { background: #222222; }

/* ── MAIN CHAT BACKGROUND ── */
:root[data-skin="your_id"] #chat-view {
  background:
    linear-gradient(rgba(20,20,20,0.55), rgba(20,20,20,0.62)),
    #1a1a1a url('/assets/chat-main-background-your-id.jpeg') center center / cover no-repeat;
}
:root[data-skin="your_id"] .side-chat-main-pane,
:root[data-skin="your_id"] .side-chat-pane {
  background:
    linear-gradient(rgba(20,20,20,0.55), rgba(20,20,20,0.62)),
    #1a1a1a url('/assets/chat-main-background-your-id.jpeg') center center / cover no-repeat;
}

/* ── PAGE VIEWS ── */
:root[data-skin="your_id"] .page-view { background: var(--panel); }

/* ── SIDEBAR + TOPBAR (recolor orange→your accent) ── */
:root[data-skin="your_id"] .sidebar,
:root[data-skin="your_id"] .topbar {
  --pm-glow: rgba(R,G,B,0.18);
  background: var(--sidebar-bg);
  border-color: rgba(R,G,B,0.12);
}
:root[data-skin="your_id"] .sidebar { border-right-color: rgba(R,G,B,0.20); }

:root[data-skin="your_id"] .sidebar::before,
:root[data-skin="your_id"] .topbar::before {
  background:
    conic-gradient(
      from var(--pm-angle),
      transparent 0deg,
      color-mix(in srgb, #YOUR_HEX, transparent 88%) 52deg,
      color-mix(in srgb, #LIGHTER_HEX, transparent 92%) 95deg,
      transparent 150deg,
      color-mix(in srgb, #DARK_HEX, transparent 82%) 225deg,
      transparent 310deg,
      color-mix(in srgb, #DARKER_HEX, transparent 89%) 360deg
    );
}
/* ... ::after conic also recolored ... */

/* ── HOVER/FOCUS STATES ── */
:root[data-skin="your_id"] .sidebar:hover,
:root[data-skin="your_id"] .topbar:hover,
:root[data-skin="your_id"] .topbar:focus-within {
  --pm-glow: rgba(R,G,B,0.26);
  box-shadow: 0 0 24px var(--pm-glow), ...;
}
:root[data-skin="your_id"] .sidebar-footer { border-top-color: rgba(R,G,B,0.18); }

/* ── CHAT SCROLLBAR ── */
:root[data-skin="your_id"] #chat-messages.chat-scroller-active {
  scrollbar-color: rgba(R,G,B,0.50) transparent;
}
:root[data-skin="your_id"] #chat-messages.chat-scroller-active::-webkit-scrollbar-thumb {
  background-color: rgba(R,G,B,0.50);
}

/* ── COMPOSER GLOW (buttons stay orange) ── */
:root[data-skin="your_id"] .chat-input-area:hover,
:root[data-skin="your_id"] .chat-input-area:focus-within {
  --pm-glow: rgba(R,G,B,0.34);
  box-shadow: ... rgba(R,G,B,0.24) ...;
}

/* ── RIGHT PANEL / SKILLS ── */
:root[data-skin="your_id"] .skill-card-icon {
  background: rgba(R,G,B,0.12);
  border-color: rgba(R,G,B,0.28);
  color: #LIGHTER_HEX;
}
:root[data-skin="your_id"] .skill-card.enabled .skill-card-icon {
  background: rgba(R,G,B,0.18);
  border-color: rgba(R,G,B,0.45);
}
:root[data-skin="your_id"] .skill-pin-btn:hover { background: rgba(R,G,B,0.10); color: #LIGHTER_HEX; }
:root[data-skin="your_id"] .skill-pin-btn.active { color: #LIGHTER_HEX; }
:root[data-skin="your_id"] .skill-card.pinned {
  border-color: rgba(R,G,B,0.45);
  box-shadow: 0 0 0 1px rgba(R,G,B,0.15);
}
:root[data-skin="your_id"] .skills-show-more-btn {
  background: rgba(R,G,B,0.12);
  border-color: rgba(R,G,B,0.30);
}
:root[data-skin="your_id"] .skills-show-more-btn:hover {
  background: rgba(R,G,B,0.20);
  border-color: rgba(R,G,B,0.42);
}
:root[data-skin="your_id"] .skill-hover-popover { border-color: rgba(R,G,B,0.28); }
:root[data-skin="your_id"] .skill-hover-popover button:hover {
  border-color: rgba(R,G,B,0.55);
  background: rgba(R,G,B,0.18);
}
```

**Copy from existing themes** (blue/purple) and swap the RGB values. The structure is identical; only colors change.

### Step 5: Add Theme Picker Preview Colors (web-ui/src/styles/themes.css)

At the end, before the closing `}`:

```css
.theme-swatch[data-skin-preview="your_id"] .tsc-bg    { background: #1a1a1a; }
.theme-swatch[data-skin-preview="your_id"] .tsc-panel { background: #2d2d2d; }
.theme-swatch[data-skin-preview="your_id"] .tsc-accent{ background: #YOUR_HEX; }
```

These colors are displayed as 3 tiny chips in the Settings → Appearance picker grid.

### Step 6: Bump Service Worker & Sync

```bash
# Edit web-ui/service-worker.js, line 20:
const VERSION = 'pm-v<N>-2026-06-09-your-theme';

# Then sync:
npm run sync:web-ui
```

This triggers `prepare-public-build.js --web-only`, which copies `web-ui/` → `generated/public-web-ui/static/` and rewrites paths (`src/` → `static/`).

The sync check ensures everything landed:
```bash
npm run sync:web-ui
# [check-public-web-ui-sync] web-ui and generated/public-web-ui are in sync ✓
```

## Critical Details

### Do NOT Edit Dark/Light CSS
- `base.css`, `components.css`, `pages.css` contain `:root[data-theme="dark"]` rules (greyed out, orange-ish).
- **Never touch these.** Themes override via `data-skin` at the CSS-variable level, not by rewriting base rules.
- When you add a theme, you're adding a **new** skin, not modifying an existing base.

### CSS Variable Cascade
- Base CSS uses vars like `--bg`, `--brand`, `--flame`, `--pm-orange`, etc.
- `:root[data-skin="your_id"]` redefines these vars.
- Because of CSS source-order + specificity, `themes.css` (which loads last) wins over `base.css`.

### Naming Convention
- Skin IDs: kebab-case lowercase (e.g., `your_id`, not `Your_ID`).
- Labels: Title case, poetic (e.g., "Aether Violet").
- HEX colors: Use consistent depth — don't mix `#fff` (too bright for dark theme) with `#000` (too dark). Compare to existing themes.

### RGBA Opacity Choices
- Text/muted: no alpha (solid colors like `#f0f0f0`).
- Borders/lines: `0.12` or `0.22` (subtle, shouldn't draw attention).
- Hover/glow: `0.16`, `0.18`, `0.24`, `0.26` (semi-transparent to blend with background).
- Sidebar/composer bg: `0.76`–`0.82` (frosted-glass look via backdrop-filter).
- Glows/shadows: `0.34` or higher for brightness.

### Settings Modal → Leave Orange
- The whole `#settings-modal` stays orange for contrast (see comment in blue/purple blocks).
- Do NOT override skill cards, buttons, or anything inside the modal for your theme.

### Composer Buttons → Leave Orange
- `.chat-attach-btn` and `.send-btn` are hardcoded `#f97316` orange.
- Do NOT override them. They're intentional — the orange "hot" button breaks the theme intentionally.

### Ember Particles
- Must match the theme's accent color so embers "blend" with the theme's vibe.
- Update both the `EMBER_THEMES[your_id].palette` (5 RGB triples) and `.core` (RGBA glow).

### Background Image Overlay
- Always use a darkening gradient on top: `linear-gradient(rgba(20,20,20,0.55), rgba(20,20,20,0.62))`.
- This ensures chat messages remain readable over the background image.
- Adjust the alpha (0.55 / 0.62) if messages are too dim or the image is too bold.

## Checklist for Adding a New Theme

- [ ] Add entry to `window.PROM_THEMES` in `index.html:45`
- [ ] Add palette + core to `EMBER_THEMES` in `index.html:7652`
- [ ] Create/copy background image → `assets/chat-main-background-your_id.jpeg`
- [ ] Write full `:root[data-skin="your_id"]` block in `themes.css` (before picker comment ~line 226)
- [ ] Add `.theme-swatch[data-skin-preview="your_id"]` preview colors in `themes.css`
- [ ] Bump `VERSION` in `service-worker.js`
- [ ] Run `npm run sync:web-ui` (verify sync check passes)
- [ ] Hard-refresh browser (Cmd+Shift+R) to clear service worker cache
- [ ] Test theme toggle (top-bar click or Settings → Appearance)
- [ ] Test all pages: ChatPage, SettingsPage, etc.
- [ ] Verify localStorage persistence: reload and check theme sticks
- [ ] Check emoji hover, scrollbar, composer glow, sidebar glow, right-panel skills

## Testing Locally

1. **Toggle via top-bar**: Click the theme icon (top-left, next to user name).
   - Should cycle: dark → light → blue → purple → dark
   - Each click rotates to the next theme instantly.

2. **Pick via Settings**: Settings → System → Appearance
   - Shows grid of theme swatches (3-chip preview per theme).
   - Click a swatch to apply instantly.

3. **Verify persistence**: Hard-refresh (Cmd+Shift+R), then reload.
   - Theme should stick. Check localStorage: `window.localStorage.getItem('prometheus_theme')` should be `'your_id'`.

4. **Inspect CSS**: DevTools → Inspect any element.
   - Should see `<html data-theme="dark" data-skin="your_id">`.
   - Verify vars are applied: e.g., `--bg: #1a1a1a;` in :root computed styles.

5. **Check embers**: Canvas should show particles in your theme's color.
   - Look at the main chat pane — small colored particles should float/flicker.
   - Colors should match your `palette` in `EMBER_THEMES`.

## Common Pitfalls

| Mistake | Fix |
|---------|-----|
| Forgot to sync after editing `themes.css` | Run `npm run sync:web-ui`; hard-refresh browser. The dev server serves from `generated/public-web-ui/`, not `web-ui/` directly. |
| Theme doesn't appear in Settings picker | Forgot to add entry to `window.PROM_THEMES` or didn't sync. Also check `renderThemePicker()` is called. |
| Orange embers instead of theme color | Forgot to add skin ID to `EMBER_THEMES`, or used wrong palette RGB values. |
| Theme rotates in wrong order | Check registry order in `PROM_THEMES`. Toggle order matches array order. |
| Dark/light modes look broken | Edited base.css by mistake. Revert! Only edit via `data-skin` overrides in themes.css. |
| Colors look washed out / too dim | Check `--bg` and surface colors are dark enough for dark theme (not > #333333). Increase opacity on glows/borders. |
| Settings modal looks weird | Did you override skill-card styles? Don't — they should stay orange. Check `:root[data-skin="..."] #settings-modal` is absent. |

## References

- **For color inspiration**: Look at the existing blue (`#3d8bff`, `#6fb0ff`) and purple (`#8b5cf6`, `#b794ff`) themes in `themes.css`. They use a primary accent + lighter variant + darker shade.
- **For RGBA opacity patterns**: All `--line-*` are `0.12`/`0.22`; all hover states are `0.16`/`0.18`; all glows are `0.24`+. Copy the pattern.
- **For background darkening**: Blue uses `rgba(6,13,30,0.55)` / `rgba(6,13,30,0.62)` (matches #07101f theme). Purple uses `rgba(10,4,24,0.55)` / `rgba(10,4,24,0.62)` (matches #0c0518 theme). Use a shade slightly darker than your `--bg` value.

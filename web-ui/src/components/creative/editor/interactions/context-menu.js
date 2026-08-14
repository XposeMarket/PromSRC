/**
 * Context menu — right-click on canvas/element.
 */

import { hitTestScene } from '../preview/renderer.js';

export function createContextMenu({ viewportRoot, store, getScene, onAction }) {
  let _menu = null;

  function show(x, y, items) {
    hide();
    _menu = document.createElement('div');
    _menu.className = 'ce-context-menu';
    _menu.style.cssText = `left:${x}px;top:${y}px`;

    for (const item of items) {
      if (item === 'divider') {
        const d = document.createElement('div');
        d.className = 'ce-context-menu__divider';
        _menu.appendChild(d);
        continue;
      }
      const btn = document.createElement('button');
      btn.className = 'ce-context-menu__item' + (item.danger ? ' ce-context-menu__item--danger' : '');
      btn.textContent = item.label;
      if (item.shortcut) {
        const sc = document.createElement('span');
        sc.className = 'ce-context-menu__shortcut';
        sc.textContent = item.shortcut;
        btn.appendChild(sc);
      }
      btn.addEventListener('click', () => {
        hide();
        item.action?.();
      });
      _menu.appendChild(btn);
    }

    viewportRoot.appendChild(_menu);

    // Flip if near edge
    requestAnimationFrame(() => {
      if (!_menu) return;
      const rect  = _menu.getBoundingClientRect();
      const rootR = viewportRoot.getBoundingClientRect();
      if (rect.right  > rootR.right)  _menu.style.left = (x - rect.width)  + 'px';
      if (rect.bottom > rootR.bottom) _menu.style.top  = (y - rect.height) + 'px';
    });
  }

  function hide() {
    if (_menu) { _menu.remove(); _menu = null; }
  }

  function onContextMenu(e) {
    e.preventDefault();
    const rect = viewportRoot.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;

    const { zoom, panX, panY, timeMs } = store.getState();
    const sx = (mx - panX) / zoom;
    const sy = (my - panY) / zoom;
    const scene = getScene();

    // Use the same rotated/animated/locked-aware hit test as the viewport.
    const hit = hitTestScene(sx, sy, scene, timeMs ?? 0);

    if (hit) {
      store.setState({ selectedIds: [hit.id] });
      show(mx, my, [
        { label: 'Duplicate',    action: () => onAction?.('duplicate',  hit) },
        { label: 'Bring to Front', action: () => onAction?.('bringToFront', hit) },
        { label: 'Send to Back',   action: () => onAction?.('sendToBack',   hit) },
        'divider',
        { label: 'Delete',       action: () => onAction?.('delete', hit), danger: true, shortcut: 'Del' },
      ]);
    } else {
      show(mx, my, [
        { label: 'Select All', action: () => onAction?.('selectAll', null) },
        'divider',
        { label: 'Fit to Screen', action: () => onAction?.('fit', null) },
      ]);
    }
  }

  viewportRoot.addEventListener('contextmenu', onContextMenu);

  // Dismiss on click outside
  function onDocumentPointerDown(e) {
    if (_menu && !_menu.contains(e.target)) hide();
  }
  document.addEventListener('pointerdown', onDocumentPointerDown);

  function dispose() {
    hide();
    viewportRoot.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('pointerdown', onDocumentPointerDown);
  }

  return { show, hide, dispose };
}

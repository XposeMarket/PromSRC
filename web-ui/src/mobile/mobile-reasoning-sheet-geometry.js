// Viewport-safe placement for the mobile reasoning sheet.
// The values are layout-viewport CSS pixels so a fixed sheet stays adjacent to
// its trigger while the iOS keyboard shrinks visualViewport.
export function reasoningSheetViewportPlacement({
  visualViewport = {},
  layoutHeight = 0,
  triggerRect = null,
  margin = 10,
  gap = 8,
  preferredHeight = 280,
} = {}) {
  const safeMargin = Math.max(0, Number(margin) || 0);
  const safeGap = Math.max(0, Number(gap) || 0);
  const viewportTop = Math.max(0, Number(visualViewport.offsetTop) || 0);
  const viewportHeight = Math.max(0, Number(visualViewport.height) || Number(layoutHeight) || 0);
  const viewportBottom = viewportTop + viewportHeight;
  const safeLayoutHeight = Math.max(Number(layoutHeight) || 0, viewportBottom);
  const triggerTop = Number(triggerRect?.top);
  const triggerBottom = Number(triggerRect?.bottom);
  const hasTrigger = Number.isFinite(triggerTop) && Number.isFinite(triggerBottom);
  const aboveHeight = hasTrigger ? triggerTop - safeGap - viewportTop - safeMargin : viewportHeight - safeMargin * 2;
  const belowHeight = hasTrigger ? viewportBottom - triggerBottom - safeGap - safeMargin : 0;
  const anchor = hasTrigger && aboveHeight < Math.min(Number(preferredHeight) || 280, 120) && belowHeight > aboveHeight
    ? 'below'
    : 'above';
  const sheetTop = anchor === 'below'
    ? Math.max(viewportTop + safeMargin, triggerBottom + safeGap)
    : viewportTop + safeMargin;
  const sheetBottom = anchor === 'below'
    ? viewportBottom - safeMargin
    : Math.max(viewportTop + safeMargin, hasTrigger ? triggerTop - safeGap : viewportBottom - safeMargin);
  const maxHeight = Math.max(0, sheetBottom - sheetTop);

  return {
    bottom: Math.max(0, safeLayoutHeight - sheetBottom),
    maxHeight,
    viewportTop,
    viewportBottom,
    anchor,
    // Exposed for the DOM-only probe and to make short-keyboard handling explicit.
    isShortViewport: maxHeight < Math.min(Number(preferredHeight) || 280, 180),
  };
}

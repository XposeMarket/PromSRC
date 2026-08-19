/** Escape dynamic values used in CSS selectors. */
export function cssEscapeValue(value) {
  const raw = String(value || '');
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(raw);
  return raw.replace(/["\\\]\[]/g, '\\$&');
}

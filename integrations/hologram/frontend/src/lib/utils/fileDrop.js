/**
 * Helpers for Wails native OnFileDrop (Linux GTK coords vs CSS layout).
 * See https://github.com/wailsapp/wails/issues/3686
 */

/**
 * Convert native drop coordinates to CSS pixels for getBoundingClientRect().
 * GTK/Wails may supply device pixels; layout uses CSS pixels.
 */
export function dropCoordsToCSS(x, y) {
  const dpr = window.devicePixelRatio || 1;
  if (dpr <= 1) {
    return { x, y };
  }
  return { x: x / dpr, y: y / dpr };
}

/**
 * True if native drop coordinates fall inside element's bounding box.
 * Tries CSS-scaled coords first, then raw coords (platform variance).
 */
export function isDropPointInElement(x, y, element) {
  if (!element) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const css = dropCoordsToCSS(x, y);
  if (pointInRect(css.x, css.y, rect)) {
    return true;
  }
  return pointInRect(x, y, rect);
}

function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

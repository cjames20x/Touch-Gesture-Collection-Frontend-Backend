// gesture.js — gesture utility helpers

/**
 * Normalize a point relative to the surface element's bounding rect.
 * Returns { x, y } both in [0, 1].
 */
export function normalizeToElement(x, y, element) {
  const rect = element.getBoundingClientRect();
  return {
    x: (x - rect.left) / rect.width,
    y: (y - rect.top)  / rect.height,
  };
}

/**
 * Classify a recorded gesture path into a label.
 * Very lightweight heuristic — replace with your ML model as needed.
 *
 * @param {{ x:number, y:number, time:number }[]} points
 * @returns {'tap'|'swipe-left'|'swipe-right'|'swipe-up'|'swipe-down'|'scroll'|'unknown'}
 */
export function classifyGesture(points) {
  if (!points || points.length === 0) return 'unknown';

  const first = points[0];
  const last  = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Tap: very little movement
  if (dist < 0.03) return 'tap';

  // Scroll: mostly vertical, longer path
  if (Math.abs(dy) > Math.abs(dx) * 1.5) {
    return dy > 0 ? 'swipe-down' : 'swipe-up';
  }

  // Swipe: mostly horizontal
  if (Math.abs(dx) > Math.abs(dy) * 1.5) {
    return dx > 0 ? 'swipe-right' : 'swipe-left';
  }

  return 'unknown';
}

export default { normalizeToElement, classifyGesture };
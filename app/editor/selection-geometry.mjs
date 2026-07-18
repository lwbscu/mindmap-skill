const DEFAULT_DRAG_THRESHOLD = 3;

export function normalizeRect(rect) {
  const left = Math.min(rect.x1, rect.x2);
  const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2);
  const bottom = Math.max(rect.y1, rect.y2);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    left,
    top,
    right,
    bottom,
  };
}

export function rectFromPoints(start, current) {
  return normalizeRect({
    x1: start.x,
    y1: start.y,
    x2: current.x,
    y2: current.y,
  });
}

export function rectFromBox(box) {
  return normalizeRect({
    x1: box.x,
    y1: box.y,
    x2: box.x + box.width,
    y2: box.y + box.height,
  });
}

export function isSignificantDrag(start, current, threshold = DEFAULT_DRAG_THRESHOLD) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

export function marqueeMode(start, current) {
  return current.x >= start.x ? 'contain' : 'intersect';
}

export function containsRect(container, candidate) {
  return (
    candidate.left >= container.left &&
    candidate.right <= container.right &&
    candidate.top >= container.top &&
    candidate.bottom <= container.bottom
  );
}

export function intersectsRect(a, b) {
  return (
    a.left <= b.right &&
    a.right >= b.left &&
    a.top <= b.bottom &&
    a.bottom >= b.top
  );
}

export function hitTestRect(item, selectionRect, mode = 'contain') {
  const itemRect = rectFromBox(item);
  return mode === 'contain'
    ? containsRect(selectionRect, itemRect)
    : intersectsRect(selectionRect, itemRect);
}

export function idsFromMarquee(items, start, current, options = {}) {
  const mode = options.mode ?? marqueeMode(start, current);
  const rect = rectFromPoints(start, current);
  const idKey = options.idKey ?? 'id';

  return items
    .filter((item) => !item.locked && !item.hidden)
    .filter((item) => hitTestRect(item, rect, mode))
    .map((item) => item[idKey])
    .filter((id) => id != null);
}

export function applySelectionDelta(currentIds, candidateIds, options = {}) {
  const selected = new Set(currentIds);
  const candidates = new Set(candidateIds);
  const shift = Boolean(options.shift);

  if (!shift) {
    return [...candidates];
  }

  for (const id of candidates) {
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
  }

  return [...selected];
}

export function selectByMarquee(items, start, current, currentIds = [], options = {}) {
  const mode = options.mode ?? marqueeMode(start, current);
  const candidateIds = idsFromMarquee(items, start, current, {
    ...options,
    mode,
  });

  return {
    mode,
    rect: rectFromPoints(start, current),
    candidateIds,
    selectionIds: applySelectionDelta(currentIds, candidateIds, options),
  };
}

export function pointInRect(point, rect) {
  const box = rect.left == null ? rectFromBox(rect) : rect;
  return (
    point.x >= box.left &&
    point.x <= box.right &&
    point.y >= box.top &&
    point.y <= box.bottom
  );
}

export function boundsForItems(items) {
  if (!items.length) {
    return null;
  }

  const rects = items.map(rectFromBox);
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    left,
    top,
    right,
    bottom,
  };
}

const SIDES = Object.freeze(["top", "right", "bottom", "left"]);
const ORTHOGONAL_MODES = new Set(["architecture", "dependency"]);

const DEFAULT_OPTIONS = Object.freeze({
  gridSize: 8,
  nodeMargin: 22,
  stubLength: 34,
  laneGap: 18,
  bendPenalty: 64,
  crowdPenalty: 96,
  crossPenalty: 240,
  maxGridPoints: 6400,
  labelWidth: 132,
  labelHeight: 26,
  labelGap: 8
});

function finite(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function snap(value, gridSize = 8) {
  return Math.round(finite(value) / gridSize) * gridSize;
}

function clonePoint(point) {
  return { x: finite(point?.x), y: finite(point?.y) };
}

function stableEdgeId(edge, index = 0) {
  if (edge?.id) return String(edge.id);
  return `${edge?.from ?? "unknown"}->${edge?.to ?? "unknown"}:${index}`;
}

export function rectFromNode(node) {
  return {
    id: String(node?.id ?? ""),
    x: finite(node?.x),
    y: finite(node?.y),
    width: Math.max(1, finite(node?.width, 1)),
    height: Math.max(1, finite(node?.height, 1))
  };
}

export function expandRect(rect, amount = 0) {
  const value = finite(amount);
  return {
    id: rect.id,
    x: rect.x - value,
    y: rect.y - value,
    width: rect.width + value * 2,
    height: rect.height + value * 2
  };
}

export function rectCenter(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

export function pointKey(point) {
  return `${point.x},${point.y}`;
}

export function pointInRect(point, rect, tolerance = 0) {
  return point.x > rect.x - tolerance
    && point.x < rect.x + rect.width + tolerance
    && point.y > rect.y - tolerance
    && point.y < rect.y + rect.height + tolerance;
}

export function segmentIntersectsRect(a, b, rect, tolerance = 0) {
  const left = rect.x - tolerance;
  const right = rect.x + rect.width + tolerance;
  const top = rect.y - tolerance;
  const bottom = rect.y + rect.height + tolerance;

  if (a.x === b.x) {
    const x = a.x;
    if (x <= left || x >= right) return false;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return maxY > top && minY < bottom;
  }

  if (a.y === b.y) {
    const y = a.y;
    if (y <= top || y >= bottom) return false;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return maxX > left && minX < right;
  }

  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX <= left || minX >= right || maxY <= top || minY >= bottom) return false;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const intersections = [];
  if (dx !== 0) {
    for (const x of [left, right]) {
      const t = (x - a.x) / dx;
      if (t >= 0 && t <= 1) intersections.push({ x, y: a.y + t * dy });
    }
  }
  if (dy !== 0) {
    for (const y of [top, bottom]) {
      const t = (y - a.y) / dy;
      if (t >= 0 && t <= 1) intersections.push({ x: a.x + t * dx, y });
    }
  }
  return intersections.some((point) => point.x > left && point.x < right && point.y > top && point.y < bottom)
    || pointInRect(a, rect, tolerance)
    || pointInRect(b, rect, tolerance);
}

export function segmentClear(a, b, obstacles, options = {}) {
  const tolerance = finite(options.tolerance, 0);
  return !(obstacles ?? []).some((rect) => segmentIntersectsRect(a, b, rect, tolerance));
}

function portPoint(rect, side, offset = 0) {
  const center = rectCenter(rect);
  const lane = finite(offset);
  if (side === "top") return { x: center.x + lane, y: rect.y };
  if (side === "bottom") return { x: center.x + lane, y: rect.y + rect.height };
  if (side === "left") return { x: rect.x, y: center.y + lane };
  return { x: rect.x + rect.width, y: center.y + lane };
}

function stubPoint(rect, side, distance, offset = 0) {
  const point = portPoint(rect, side, offset);
  const stub = finite(distance);
  if (side === "top") return { x: point.x, y: point.y - stub };
  if (side === "bottom") return { x: point.x, y: point.y + stub };
  if (side === "left") return { x: point.x - stub, y: point.y };
  return { x: point.x + stub, y: point.y };
}

function oppositeSide(side) {
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  if (side === "left") return "right";
  return "left";
}

function preferredSides(source, target, viewType) {
  const a = rectCenter(source);
  const b = rectCenter(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (viewType === "dependency") {
    return Math.abs(dx) >= Math.abs(dy) * 0.55
      ? [dx >= 0 ? "right" : "left", dx >= 0 ? "left" : "right"]
      : [dy >= 0 ? "bottom" : "top", dy >= 0 ? "top" : "bottom"];
  }
  if (viewType === "mindmap") {
    return Math.abs(dx) >= Math.abs(dy)
      ? [dx >= 0 ? "right" : "left", dx >= 0 ? "left" : "right"]
      : [dy >= 0 ? "bottom" : "top", dy >= 0 ? "top" : "bottom"];
  }
  return Math.abs(dy) >= Math.abs(dx) * 0.6
    ? [dy >= 0 ? "bottom" : "top", dy >= 0 ? "top" : "bottom"]
    : [dx >= 0 ? "right" : "left", dx >= 0 ? "left" : "right"];
}

function sideCandidates(source, target, edge, viewType) {
  const preferred = preferredSides(source, target, viewType);
  const explicit = [
    SIDES.includes(edge?.fromSide) ? edge.fromSide : preferred[0],
    SIDES.includes(edge?.toSide) ? edge.toSide : preferred[1]
  ];
  const pairs = [explicit, preferred];
  for (const side of SIDES) pairs.push([side, oppositeSide(side)]);
  for (const fromSide of SIDES) {
    for (const toSide of SIDES) pairs.push([fromSide, toSide]);
  }
  const seen = new Set();
  return pairs.filter(([fromSide, toSide]) => {
    const key = `${fromSide}:${toSide}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function edgeLane(edge, index, groups, options) {
  const pairKey = `${edge.from}->${edge.to}`;
  const group = groups.get(pairKey) ?? [];
  const laneIndex = Math.max(0, group.indexOf(index));
  const laneCount = Math.max(1, group.length);
  return (laneIndex - (laneCount - 1) / 2) * options.laneGap;
}

function buildLaneGroups(edges) {
  const groups = new Map();
  edges.forEach((edge, index) => {
    const key = `${edge.from}->${edge.to}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  for (const [key, indexes] of groups) {
    indexes.sort((a, b) => stableEdgeId(edges[a], a).localeCompare(stableEdgeId(edges[b], b)));
    groups.set(key, indexes);
  }
  return groups;
}

function normalizeLayoutEdge(edge, layoutEdges, index) {
  const id = stableEdgeId(edge, index);
  return {
    ...edge,
    id,
    ...(layoutEdges?.[id] && typeof layoutEdges[id] === "object" ? layoutEdges[id] : {})
  };
}

function shouldPreserveRoute(edge) {
  return edge?.lockedRoute === true
    || edge?.manualRoute === true
    || edge?.routeMode === "manual"
    || edge?.routeMode === "locked";
}

function preservedRoute(edge) {
  return {
    ...edge,
    fromSide: SIDES.includes(edge.fromSide) ? edge.fromSide : undefined,
    toSide: SIDES.includes(edge.toSide) ? edge.toSide : undefined,
    waypoints: Array.isArray(edge.waypoints) ? edge.waypoints.map(clonePoint) : [],
    labelAt: edge.labelAt ? clonePoint(edge.labelAt) : undefined,
    routeMode: "manual",
    routeStyle: edge.routeStyle ?? (edge.curveControlPoints?.length === 2 ? "curved" : "orthogonal"),
    lockedRoute: Boolean(edge.lockedRoute ?? edge.manualRoute),
    curveControlPoints: Array.isArray(edge.curveControlPoints) ? edge.curveControlPoints.map(clonePoint) : undefined
  };
}

function addCoord(set, value, gridSize) {
  const next = snap(value, gridSize);
  if (Number.isFinite(next)) set.add(next);
}

function addExactCoord(set, value) {
  const next = finite(value);
  if (Number.isFinite(next)) set.add(next);
}

function collectCandidateCoordinates(rects, source, target, start, end, options) {
  const xs = new Set();
  const ys = new Set();
  const margin = Math.max(options.nodeMargin, options.stubLength + options.laneGap * 2);
  const all = [...rects, source, target];
  for (const point of [start, end, rectCenter(source), rectCenter(target)]) {
    addExactCoord(xs, point.x);
    addExactCoord(ys, point.y);
    addCoord(xs, point.x, options.gridSize);
    addCoord(ys, point.y, options.gridSize);
  }
  for (const rect of all) {
    const left = rect.x - margin;
    const right = rect.x + rect.width + margin;
    const top = rect.y - margin;
    const bottom = rect.y + rect.height + margin;
    const center = rectCenter(rect);
    for (const value of [left, rect.x - options.nodeMargin, rect.x, center.x, rect.x + rect.width, rect.x + rect.width + options.nodeMargin, right]) {
      addCoord(xs, value, options.gridSize);
    }
    for (const value of [top, rect.y - options.nodeMargin, rect.y, center.y, rect.y + rect.height, rect.y + rect.height + options.nodeMargin, bottom]) {
      addCoord(ys, value, options.gridSize);
    }
  }
  const bounds = {
    minX: Math.min(...all.map((rect) => rect.x), start.x, end.x) - margin * 2,
    maxX: Math.max(...all.map((rect) => rect.x + rect.width), start.x, end.x) + margin * 2,
    minY: Math.min(...all.map((rect) => rect.y), start.y, end.y) - margin * 2,
    maxY: Math.max(...all.map((rect) => rect.y + rect.height), start.y, end.y) + margin * 2
  };
  for (const value of [bounds.minX, bounds.maxX]) addCoord(xs, value, options.gridSize);
  for (const value of [bounds.minY, bounds.maxY]) addCoord(ys, value, options.gridSize);
  return {
    xs: [...xs].sort((a, b) => a - b),
    ys: [...ys].sort((a, b) => a - b)
  };
}

function buildGridPoints(xs, ys, obstacles, options) {
  const points = [];
  const byKey = new Map();
  if (xs.length * ys.length > options.maxGridPoints) return { points, byKey, tooLarge: true };
  for (const x of xs) {
    for (const y of ys) {
      const point = { x, y };
      if (obstacles.some((rect) => pointInRect(point, rect, 0))) continue;
      const key = pointKey(point);
      points.push(point);
      byKey.set(key, point);
    }
  }
  return { points, byKey, tooLarge: false };
}

function reconstruct(cameFrom, key, byKey) {
  const keys = [key];
  while (cameFrom.has(keys[0])) keys.unshift(cameFrom.get(keys[0]));
  return keys.map((item) => byKey.get(item)).filter(Boolean);
}

function directionOf(a, b) {
  if (!a || !b) return "";
  return a.x === b.x ? "v" : "h";
}

function routeGrid(start, end, xs, ys, obstacles, usedSegments, usedRouteSegments, options) {
  const { byKey, tooLarge } = buildGridPoints(xs, ys, obstacles, options);
  if (tooLarge) return null;
  const startKey = pointKey(start);
  const endKey = pointKey(end);
  byKey.set(startKey, start);
  byKey.set(endKey, end);

  const xIndex = new Map(xs.map((x, index) => [x, index]));
  const yIndex = new Map(ys.map((y, index) => [y, index]));
  const open = new Map([[startKey, { key: startKey, f: 0 }]]);
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const previousDirection = new Map();
  const maxIterations = Math.max(2000, Math.min(options.maxGridPoints * 12, 90000));

  const neighborKeys = (point) => {
    const neighbors = [];
    const xi = xIndex.get(point.x);
    const yi = yIndex.get(point.y);
    const push = (x, y) => {
      const key = `${x},${y}`;
      const candidate = byKey.get(key);
      if (!candidate) return;
      if (segmentClear(point, candidate, obstacles)) neighbors.push(key);
    };
    if (xi !== undefined) {
      for (let left = xi - 1; left >= 0; left -= 1) {
        const key = `${xs[left]},${point.y}`;
        if (byKey.has(key)) {
          push(xs[left], point.y);
          break;
        }
      }
      for (let right = xi + 1; right < xs.length; right += 1) {
        const key = `${xs[right]},${point.y}`;
        if (byKey.has(key)) {
          push(xs[right], point.y);
          break;
        }
      }
    }
    if (yi !== undefined) {
      for (let up = yi - 1; up >= 0; up -= 1) {
        const key = `${point.x},${ys[up]}`;
        if (byKey.has(key)) {
          push(point.x, ys[up]);
          break;
        }
      }
      for (let down = yi + 1; down < ys.length; down += 1) {
        const key = `${point.x},${ys[down]}`;
        if (byKey.has(key)) {
          push(point.x, ys[down]);
          break;
        }
      }
    }
    return neighbors;
  };

  for (let iteration = 0; iteration < maxIterations && open.size; iteration += 1) {
    const current = [...open.values()].sort((a, b) => a.f - b.f || a.key.localeCompare(b.key))[0];
    open.delete(current.key);
    if (current.key === endKey) return reconstruct(cameFrom, current.key, byKey);
    const point = byKey.get(current.key);
    for (const nextKey of neighborKeys(point)) {
      const next = byKey.get(nextKey);
      const currentDirection = previousDirection.get(current.key);
      const nextDirection = directionOf(point, next);
      const bendCost = currentDirection && currentDirection !== nextDirection ? options.bendPenalty : 0;
      const segmentKey = canonicalSegmentKey(point, next);
      const crowdCost = (usedSegments.get(segmentKey) ?? 0) * options.crowdPenalty;
      const crossCost = usedRouteSegments.some(([a, b]) => segmentsCross(point, next, a, b)) ? options.crossPenalty : 0;
      const tentative = (gScore.get(current.key) ?? Infinity)
        + Math.abs(next.x - point.x)
        + Math.abs(next.y - point.y)
        + bendCost
        + crowdCost
        + crossCost;
      if (tentative >= (gScore.get(nextKey) ?? Infinity)) continue;
      cameFrom.set(nextKey, current.key);
      gScore.set(nextKey, tentative);
      previousDirection.set(nextKey, nextDirection);
      const heuristic = Math.abs(end.x - next.x) + Math.abs(end.y - next.y);
      open.set(nextKey, { key: nextKey, f: tentative + heuristic });
    }
  }
  return null;
}

function canonicalSegmentKey(a, b) {
  const values = [pointKey(a), pointKey(b)].sort();
  return `${values[0]}|${values[1]}`;
}

function segmentsCross(a, b, c, d) {
  const sharesEndpoint = [a, b].some((point) => [c, d].some((other) => point.x === other.x && point.y === other.y));
  if (sharesEndpoint) return false;
  const firstVertical = a.x === b.x;
  const secondVertical = c.x === d.x;
  if (firstVertical === secondVertical) return false;
  const vertical = firstVertical ? [a, b] : [c, d];
  const horizontal = firstVertical ? [c, d] : [a, b];
  const x = vertical[0].x;
  const y = horizontal[0].y;
  return x > Math.min(horizontal[0].x, horizontal[1].x)
    && x < Math.max(horizontal[0].x, horizontal[1].x)
    && y > Math.min(vertical[0].y, vertical[1].y)
    && y < Math.max(vertical[0].y, vertical[1].y);
}

function markUsedSegments(path, usedSegments, usedRouteSegments) {
  for (let index = 1; index < path.length; index += 1) {
    const key = canonicalSegmentKey(path[index - 1], path[index]);
    usedSegments.set(key, (usedSegments.get(key) ?? 0) + 1);
    usedRouteSegments.push([path[index - 1], path[index]]);
  }
}

function compressOrthogonalPath(points) {
  if (!points.length) return [];
  const compressed = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = compressed[compressed.length - 1];
    const current = points[index];
    const next = points[index + 1];
    if (directionOf(previous, current) === directionOf(current, next)) continue;
    compressed.push(current);
  }
  compressed.push(points[points.length - 1]);
  return compressed;
}

function fallbackOrthogonal(start, end, sourceSide, targetSide, lane, options) {
  if (sourceSide === "left" || sourceSide === "right" || targetSide === "left" || targetSide === "right") {
    const midX = snap((start.x + end.x) / 2 + lane, options.gridSize);
    return compressOrthogonalPath([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]);
  }
  const midY = snap((start.y + end.y) / 2 + lane, options.gridSize);
  return compressOrthogonalPath([start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]);
}

function pathPenalty(path, sourcePort, targetPort, obstacles, options) {
  if (!path?.length) return Infinity;
  let score = 0;
  let previousDirection = "";
  const fullPath = [sourcePort, ...path, targetPort];
  for (let index = 1; index < fullPath.length; index += 1) {
    const a = fullPath[index - 1];
    const b = fullPath[index];
    score += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const direction = directionOf(a, b);
    if (previousDirection && previousDirection !== direction) score += options.bendPenalty;
    previousDirection = direction;
    if (!segmentClear(a, b, obstacles)) score += 100000;
  }
  return score;
}

function labelRect(point, labelWidth, labelHeight) {
  return {
    x: point.x - labelWidth / 2,
    y: point.y - labelHeight / 2,
    width: labelWidth,
    height: labelHeight
  };
}

function rectsIntersect(a, b, tolerance = 0) {
  return a.x < b.x + b.width + tolerance
    && a.x + a.width + tolerance > b.x
    && a.y < b.y + b.height + tolerance
    && a.y + a.height + tolerance > b.y;
}

export function placeEdgeLabel(path, obstacles = [], occupiedLabels = [], options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  if (!Array.isArray(path) || path.length < 2) return undefined;
  const reserveIfClear = (candidate) => {
    const rect = labelRect(candidate, config.labelWidth, config.labelHeight);
    const bounds = config.labelBounds;
    if (bounds && (rect.x < bounds.x || rect.y < bounds.y || rect.x + rect.width > bounds.x + bounds.width || rect.y + rect.height > bounds.y + bounds.height)) return false;
    const blocked = obstacles.some((obstacle) => rectsIntersect(rect, obstacle, config.labelGap))
      || occupiedLabels.some((occupied) => rectsIntersect(rect, occupied, config.labelGap));
    if (blocked) return false;
    occupiedLabels.push(rect);
    return true;
  };
  const segments = [];
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (length <= 0) continue;
    segments.push({ a, b, length, direction: directionOf(a, b) });
  }
  segments.sort((a, b) => b.length - a.length || pointKey(a.a).localeCompare(pointKey(b.a)));
  for (const segment of segments) {
    const midpoint = {
      x: snap((segment.a.x + segment.b.x) / 2, config.gridSize),
      y: snap((segment.a.y + segment.b.y) / 2, config.gridSize)
    };
    const normal = segment.direction === "h" ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const attempts = [0];
    for (let distance = 1; distance <= 3; distance += 1) attempts.push(distance, -distance);
    for (const attempt of attempts) {
      const candidate = {
        x: midpoint.x + normal.x * attempt * (config.labelHeight + config.labelGap),
        y: midpoint.y + normal.y * attempt * (config.labelHeight + config.labelGap)
      };
      if (reserveIfClear(candidate)) return candidate;
    }
  }
  const fallback = {
    x: snap((path[0].x + path[path.length - 1].x) / 2, config.gridSize),
    y: snap((path[0].y + path[path.length - 1].y) / 2, config.gridSize)
  };
  const stepX = config.labelWidth + config.labelGap * 2;
  const stepY = config.labelHeight + config.labelGap * 2;
  for (let ring = 1; ring <= 16; ring += 1) {
    const candidates = [
      { x: fallback.x + ring * stepX, y: fallback.y },
      { x: fallback.x - ring * stepX, y: fallback.y },
      { x: fallback.x, y: fallback.y + ring * stepY },
      { x: fallback.x, y: fallback.y - ring * stepY },
      { x: fallback.x + ring * stepX, y: fallback.y + ring * stepY },
      { x: fallback.x - ring * stepX, y: fallback.y - ring * stepY },
    ];
    for (const candidate of candidates) if (reserveIfClear(candidate)) return candidate;
  }
  const bounds = config.labelBounds;
  if (bounds) {
    const candidates = [];
    for (let y = bounds.y + config.labelHeight / 2; y <= bounds.y + bounds.height - config.labelHeight / 2; y += stepY) {
      for (let x = bounds.x + config.labelWidth / 2; x <= bounds.x + bounds.width - config.labelWidth / 2; x += stepX) {
        candidates.push({ x, y });
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - fallback.x, a.y - fallback.y) - Math.hypot(b.x - fallback.x, b.y - fallback.y) || pointKey(a).localeCompare(pointKey(b)));
    for (const candidate of candidates) if (reserveIfClear(candidate)) return candidate;
  }
  const clampedFallback = bounds ? {
    x: Math.max(bounds.x + config.labelWidth / 2, Math.min(bounds.x + bounds.width - config.labelWidth / 2, fallback.x)),
    y: Math.max(bounds.y + config.labelHeight / 2, Math.min(bounds.y + bounds.height - config.labelHeight / 2, fallback.y)),
  } : fallback;
  occupiedLabels.push(labelRect(clampedFallback, config.labelWidth, config.labelHeight));
  return clampedFallback;
}

function labelWidthFor(edge, options) {
  const estimated = Math.max(56, Math.min(180, [...String(edge?.label || "")].length * 10 + 22));
  return Math.min(options.labelWidth, estimated);
}

function cubicPoint(source, controlA, controlB, target, t) {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * source.x + 3 * inverse ** 2 * t * controlA.x + 3 * inverse * t ** 2 * controlB.x + t ** 3 * target.x,
    y: inverse ** 3 * source.y + 3 * inverse ** 2 * t * controlA.y + 3 * inverse * t ** 2 * controlB.y + t ** 3 * target.y,
  };
}

function routeOrthogonalEdge(edge, index, context) {
  const source = context.nodesById.get(edge.from);
  const target = context.nodesById.get(edge.to);
  if (!source || !target) return { ...edge, routeMode: "auto", routeStyle: "orthogonal", routeError: "missing-terminal", lockedRoute: false, waypoints: [] };

  let best = null;
  const lane = edgeLane(edge, index, context.laneGroups, context.options);
  const obstacles = context.obstacles.filter((rect) => rect.id !== source.id && rect.id !== target.id);
  for (const [fromSide, toSide] of sideCandidates(source, target, edge, context.viewType)) {
    const laneOffset = fromSide === "top" || fromSide === "bottom" ? lane : -lane;
    const targetLaneOffset = toSide === "top" || toSide === "bottom" ? -lane : lane;
    const sourcePort = portPoint(source, fromSide, laneOffset);
    const targetPort = portPoint(target, toSide, targetLaneOffset);
    const start = stubPoint(source, fromSide, context.options.stubLength, laneOffset);
    const end = stubPoint(target, toSide, context.options.stubLength, targetLaneOffset);
    const { xs, ys } = collectCandidateCoordinates(obstacles, source, target, start, end, context.options);
    const path = routeGrid(start, end, xs, ys, obstacles, context.usedSegments, context.usedRouteSegments, context.options)
      ?? fallbackOrthogonal(start, end, fromSide, toSide, lane, context.options);
    const compressed = compressOrthogonalPath(path);
    const score = pathPenalty(compressed, sourcePort, targetPort, obstacles, context.options);
    if (!best || score < best.score) {
      best = { score, fromSide, toSide, sourcePort, targetPort, path: compressed };
    }
  }

  const route = best ?? {
    fromSide: preferredSides(source, target, context.viewType)[0],
    toSide: preferredSides(source, target, context.viewType)[1],
    sourcePort: portPoint(source, "right"),
    targetPort: portPoint(target, "left"),
    path: []
  };
  const fullPath = [route.sourcePort, ...route.path, route.targetPort];
  markUsedSegments(fullPath, context.usedSegments, context.usedRouteSegments);
  const labelAt = edge.label
    ? placeEdgeLabel(fullPath, context.labelObstacles, context.occupiedLabels, { ...context.options, labelWidth: labelWidthFor(edge, context.options) })
    : edge.labelAt ? clonePoint(edge.labelAt) : undefined;
  return {
    ...edge,
    fromSide: route.fromSide,
    toSide: route.toSide,
    waypoints: route.path,
    labelAt,
    routeMode: "auto",
    routeStyle: "orthogonal",
    lockedRoute: false
  };
}

function routeCurvedEdge(edge, index, context) {
  const source = context.nodesById.get(edge.from);
  const target = context.nodesById.get(edge.to);
  if (!source || !target) return { ...edge, routeMode: "auto", routeStyle: "curved", routeError: "missing-terminal", lockedRoute: false, waypoints: [] };

  const lane = edgeLane(edge, index, context.laneGroups, context.options);
  const [fromSide, toSide] = sideCandidates(source, target, edge, "mindmap")[0];
  const sourcePort = portPoint(source, fromSide, fromSide === "top" || fromSide === "bottom" ? lane : -lane);
  const targetPort = portPoint(target, toSide, toSide === "top" || toSide === "bottom" ? -lane : lane);
  const dx = targetPort.x - sourcePort.x;
  const dy = targetPort.y - sourcePort.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const fanout = Math.max(72, Math.min(220, Math.abs(horizontal ? dx : dy) * 0.42));
  const c1 = horizontal
    ? { x: sourcePort.x + Math.sign(dx || 1) * fanout, y: sourcePort.y + lane }
    : { x: sourcePort.x + lane, y: sourcePort.y + Math.sign(dy || 1) * fanout };
  const c2 = horizontal
    ? { x: targetPort.x - Math.sign(dx || 1) * fanout, y: targetPort.y - lane }
    : { x: targetPort.x - lane, y: targetPort.y - Math.sign(dy || 1) * fanout };
  const curvePath = Array.from({ length: 13 }, (_, sample) => cubicPoint(sourcePort, c1, c2, targetPort, sample / 12));
  const labelAt = edge.label
    ? placeEdgeLabel(curvePath, context.labelObstacles, context.occupiedLabels, { ...context.options, labelWidth: labelWidthFor(edge, context.options) })
    : edge.labelAt ? clonePoint(edge.labelAt) : undefined;

  return {
    ...edge,
    fromSide,
    toSide,
    waypoints: [],
    labelAt,
    routeMode: "auto",
    routeStyle: "curved",
    lockedRoute: false,
    curveControlPoints: [c1, c2]
  };
}

function normalizeOptions(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...(options && typeof options === "object" ? options : {}) };
  config.gridSize = Math.max(1, finite(config.gridSize, DEFAULT_OPTIONS.gridSize));
  config.nodeMargin = Math.max(0, finite(config.nodeMargin, DEFAULT_OPTIONS.nodeMargin));
  config.stubLength = Math.max(8, finite(config.stubLength, DEFAULT_OPTIONS.stubLength));
  config.laneGap = Math.max(4, finite(config.laneGap, DEFAULT_OPTIONS.laneGap));
  config.crossPenalty = Math.max(0, finite(config.crossPenalty, DEFAULT_OPTIONS.crossPenalty));
  config.maxGridPoints = Math.max(256, finite(config.maxGridPoints, DEFAULT_OPTIONS.maxGridPoints));
  return config;
}

function getViewRoutingMode(viewType, options = {}) {
  const explicit = options.routing ?? options.routeMode;
  if (explicit === "curved" || explicit === "orthogonal") return explicit;
  return viewType === "mindmap" ? "curved" : "orthogonal";
}

export function routeDiagramEdges({ nodes = [], edges = [], viewType = "architecture", layoutEdges = {}, layers = [], canvas = {}, options = {} } = {}) {
  const config = normalizeOptions(options);
  const nodeRects = (Array.isArray(nodes) ? nodes : []).map(rectFromNode).filter((node) => node.id);
  const naturalPadding = Math.max(config.labelWidth + config.labelGap * 2, config.nodeMargin * 3);
  const naturalBounds = nodeRects.length ? {
    x: Math.min(...nodeRects.map((node) => node.x)) - naturalPadding,
    y: Math.min(...nodeRects.map((node) => node.y)) - naturalPadding,
    width: Math.max(...nodeRects.map((node) => node.x + node.width)) - Math.min(...nodeRects.map((node) => node.x)) + naturalPadding * 2,
    height: Math.max(...nodeRects.map((node) => node.y + node.height)) - Math.min(...nodeRects.map((node) => node.y)) + naturalPadding * 2,
  } : null;
  const labelBounds = Number(canvas?.width) > 0 && Number(canvas?.height) > 0
    ? { x: 0, y: 0, width: Number(canvas.width), height: Number(canvas.height) }
    : naturalBounds;
  const routeOptions = { ...config, labelBounds };
  const nodesById = new Map(nodeRects.map((node) => [node.id, node]));
  const normalizedEdges = (Array.isArray(edges) ? edges : []).map((edge, index) => normalizeLayoutEdge(edge, layoutEdges, index));
  const laneGroups = buildLaneGroups(normalizedEdges);
  const expandedNodes = nodeRects.map((node) => expandRect(node, config.nodeMargin));
  const layerObstacles = (Array.isArray(layers) ? layers : [])
    .filter((layer) => layer?.avoidRouting === true)
    .map((layer) => expandRect(rectFromNode(layer), config.nodeMargin));
  const context = {
    viewType,
    options: routeOptions,
    nodesById,
    laneGroups,
    obstacles: [...expandedNodes, ...layerObstacles],
    labelObstacles: nodeRects,
    usedSegments: new Map(),
    usedRouteSegments: [],
    occupiedLabels: []
  };
  const routingMode = getViewRoutingMode(viewType, config);

  return normalizedEdges.map((edge, index) => {
    if (shouldPreserveRoute(edge)) return preservedRoute(edge);
    if (routingMode === "curved" || (!ORTHOGONAL_MODES.has(viewType) && viewType === "mindmap")) {
      return routeCurvedEdge(edge, index, context);
    }
    return routeOrthogonalEdge(edge, index, context);
  });
}

export function routeDiagram(diagram = {}, viewType = "architecture", options = {}) {
  return {
    ...diagram,
    edges: routeDiagramEdges({
      nodes: diagram.nodes,
      edges: diagram.edges,
      viewType,
      layers: diagram.layers,
      canvas: diagram.canvas,
      options
    })
  };
}

export const smartRouterInternals = Object.freeze({
  snap,
  stableEdgeId,
  portPoint,
  stubPoint,
  preferredSides,
  compressOrthogonalPath,
  fallbackOrthogonal,
  canonicalSegmentKey
});

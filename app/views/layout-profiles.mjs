const DEFAULT_CANVAS = Object.freeze({ width: 2400, height: 1480, background: "#ffffff" });

export const LAYOUT_PROFILES = Object.freeze({
  architecture: Object.freeze({
    type: "architecture",
    direction: "down",
    gridSize: 8,
    node: Object.freeze({ width: 360, height: 84, horizontalGap: 88, verticalGap: 112 }),
    layer: Object.freeze({ paddingX: 72, paddingY: 72, gap: 96, minHeight: 180 }),
    elk: Object.freeze({
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.spacing.nodeNode": "80"
    })
  }),
  dependency: Object.freeze({
    type: "dependency",
    direction: "right",
    gridSize: 8,
    node: Object.freeze({ width: 330, height: 82, horizontalGap: 150, verticalGap: 64 }),
    layer: Object.freeze({ paddingX: 88, paddingY: 84, gap: 80, minHeight: 220 }),
    elk: Object.freeze({
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "150",
      "elk.spacing.nodeNode": "64"
    })
  }),
  mindmap: Object.freeze({
    type: "mindmap",
    direction: "radial",
    gridSize: 8,
    node: Object.freeze({ width: 320, height: 86, horizontalGap: 170, verticalGap: 74 }),
    layer: Object.freeze({ paddingX: 96, paddingY: 96, gap: 96, minHeight: 240 }),
    elk: Object.freeze({
      "elk.algorithm": "mrtree",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "76",
      "elk.layered.spacing.nodeNodeBetweenLayers": "170"
    })
  })
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function snap(value, gridSize = 8) {
  return Math.round(Number(value || 0) / gridSize) * gridSize;
}

function nodeCenter(node) {
  return {
    x: Number(node.x || 0) + Number(node.width || 0) / 2,
    y: Number(node.y || 0) + Number(node.height || 0) / 2
  };
}

function compareNodePosition(a, b) {
  return (Number(a.y || 0) - Number(b.y || 0))
    || (Number(a.x || 0) - Number(b.x || 0))
    || String(a.id).localeCompare(String(b.id));
}

function compareLayerPosition(a, b) {
  return (Number(a.y || 0) - Number(b.y || 0))
    || (Number(a.x || 0) - Number(b.x || 0))
    || String(a.id).localeCompare(String(b.id));
}

function groupBy(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

function normalizeCanvas(canvas) {
  return {
    ...DEFAULT_CANVAS,
    ...(canvas && typeof canvas === "object" ? canvas : {})
  };
}

export function getLayoutProfile(type = "architecture") {
  return LAYOUT_PROFILES[type] ?? LAYOUT_PROFILES.architecture;
}

export function getViewTypes() {
  return Object.keys(LAYOUT_PROFILES);
}

function fitCanvasToNodes(diagram, padding = 160) {
  if (!diagram.nodes?.length) {
    diagram.canvas = normalizeCanvas(diagram.canvas);
    return diagram;
  }
  const right = Math.max(...diagram.nodes.map((node) => Number(node.x || 0) + Number(node.width || 0)));
  const bottom = Math.max(...diagram.nodes.map((node) => Number(node.y || 0) + Number(node.height || 0)));
  diagram.canvas = {
    ...normalizeCanvas(diagram.canvas),
    width: Math.max(normalizeCanvas(diagram.canvas).width, right + padding),
    height: Math.max(normalizeCanvas(diagram.canvas).height, bottom + padding)
  };
  return diagram;
}

function applyLayerBounds(diagram, profile) {
  if (!Array.isArray(diagram.layers) || !diagram.layers.length) return diagram;
  const nodesByLayer = groupBy(diagram.nodes ?? [], (node) => node.layer || "__unlayered");
  for (const layer of diagram.layers) {
    const nodes = nodesByLayer.get(layer.id) ?? [];
    if (!nodes.length) continue;
    const minX = Math.min(...nodes.map((node) => Number(node.x || 0)));
    const minY = Math.min(...nodes.map((node) => Number(node.y || 0)));
    const maxX = Math.max(...nodes.map((node) => Number(node.x || 0) + Number(node.width || profile.node.width)));
    const maxY = Math.max(...nodes.map((node) => Number(node.y || 0) + Number(node.height || profile.node.height)));
    layer.x = snap(minX - profile.layer.paddingX, profile.gridSize);
    layer.y = snap(minY - profile.layer.paddingY, profile.gridSize);
    layer.width = snap(maxX - minX + profile.layer.paddingX * 2, profile.gridSize);
    layer.height = snap(Math.max(profile.layer.minHeight, maxY - minY + profile.layer.paddingY * 2), profile.gridSize);
  }
  return diagram;
}

function layoutArchitecture(diagram, profile, options = {}) {
  const startX = Number(options.startX ?? 340);
  let y = Number(options.startY ?? 180);
  const nodesByLayer = groupBy(diagram.nodes ?? [], (node) => node.layer || "__unlayered");
  const orderedLayers = [...(diagram.layers ?? [])].sort(compareLayerPosition);
  const layerIds = orderedLayers.map((layer) => layer.id);
  if (nodesByLayer.has("__unlayered")) layerIds.push("__unlayered");

  for (const layerId of layerIds) {
    const nodes = (nodesByLayer.get(layerId) ?? []).sort(compareNodePosition);
    if (!nodes.length) continue;
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 1.8)));
    let maxRowBottom = y;
    nodes.forEach((node, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      node.width = Number(node.width || profile.node.width);
      node.height = Number(node.height || profile.node.height);
      node.x = snap(startX + column * (profile.node.width + profile.node.horizontalGap), profile.gridSize);
      node.y = snap(y + row * (profile.node.height + profile.node.verticalGap), profile.gridSize);
      maxRowBottom = Math.max(maxRowBottom, node.y + node.height);
    });
    y = snap(maxRowBottom + profile.layer.gap + profile.layer.paddingY, profile.gridSize);
  }

  return fitCanvasToNodes(applyLayerBounds(diagram, profile));
}

function buildRanks(diagram, roots = []) {
  const nodeIds = new Set((diagram.nodes ?? []).map((node) => node.id));
  const outgoing = new Map([...nodeIds].map((id) => [id, []]));
  const incomingCount = new Map([...nodeIds].map((id) => [id, 0]));
  for (const edge of diagram.edges ?? []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    outgoing.get(edge.from).push(edge.to);
    incomingCount.set(edge.to, incomingCount.get(edge.to) + 1);
  }

  const rank = new Map();
  const queue = roots.length
    ? roots.filter((id) => nodeIds.has(id))
    : [...nodeIds].filter((id) => incomingCount.get(id) === 0).sort();
  if (!queue.length && nodeIds.size) queue.push([...nodeIds].sort()[0]);
  for (const id of queue) rank.set(id, 0);

  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    for (const next of outgoing.get(id) ?? []) {
      const nextRank = (rank.get(id) ?? 0) + 1;
      if (!rank.has(next) || nextRank < rank.get(next)) {
        rank.set(next, nextRank);
        queue.push(next);
      }
    }
  }

  for (const id of nodeIds) {
    if (!rank.has(id)) rank.set(id, 0);
  }
  return rank;
}

function layoutDependency(diagram, profile, options = {}) {
  const roots = Array.isArray(options.roots) ? options.roots : [];
  const rank = buildRanks(diagram, roots);
  const nodesByRank = groupBy(diagram.nodes ?? [], (node) => rank.get(node.id) ?? 0);
  const ranks = [...nodesByRank.keys()].sort((a, b) => a - b);
  const startX = Number(options.startX ?? 260);
  const startY = Number(options.startY ?? 220);

  for (const rankIndex of ranks) {
    const nodes = nodesByRank.get(rankIndex).sort(compareNodePosition);
    nodes.forEach((node, index) => {
      node.width = Number(node.width || profile.node.width);
      node.height = Number(node.height || profile.node.height);
      node.x = snap(startX + rankIndex * (profile.node.width + profile.node.horizontalGap), profile.gridSize);
      node.y = snap(startY + index * (profile.node.height + profile.node.verticalGap), profile.gridSize);
    });
  }

  return fitCanvasToNodes(applyLayerBounds(diagram, profile));
}

function inferMindmapRoot(diagram, options = {}) {
  if (options.rootId) return options.rootId;
  const nodeIds = new Set((diagram.nodes ?? []).map((node) => node.id));
  const incoming = new Set();
  for (const edge of diagram.edges ?? []) {
    if (nodeIds.has(edge.to)) incoming.add(edge.to);
  }
  const candidate = (diagram.nodes ?? []).find((node) => !incoming.has(node.id));
  return candidate?.id ?? diagram.nodes?.[0]?.id;
}

function layoutMindmap(diagram, profile, options = {}) {
  const rootId = inferMindmapRoot(diagram, options);
  const root = (diagram.nodes ?? []).find((node) => node.id === rootId);
  if (!root) return layoutArchitecture(diagram, profile, options);

  const canvas = normalizeCanvas(diagram.canvas);
  const center = {
    x: Number(options.centerX ?? canvas.width / 2),
    y: Number(options.centerY ?? canvas.height / 2)
  };
  root.width = Number(root.width || profile.node.width);
  root.height = Number(root.height || profile.node.height);
  root.x = snap(center.x - root.width / 2, profile.gridSize);
  root.y = snap(center.y - root.height / 2, profile.gridSize);

  const children = (diagram.nodes ?? [])
    .filter((node) => node.id !== rootId)
    .sort(compareNodePosition);
  const radiusBase = Number(options.radius ?? 360);
  const radiusStep = Number(options.radiusStep ?? 42);
  const total = Math.max(children.length, 1);
  children.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
    const radius = radiusBase + Math.floor(index / 8) * radiusStep;
    node.width = Number(node.width || profile.node.width);
    node.height = Number(node.height || profile.node.height);
    node.x = snap(center.x + Math.cos(angle) * radius - node.width / 2, profile.gridSize);
    node.y = snap(center.y + Math.sin(angle) * radius - node.height / 2, profile.gridSize);
  });

  return fitCanvasToNodes(applyLayerBounds(diagram, profile));
}

export function fallbackLayout(diagram, viewType = "architecture", options = {}) {
  const next = clone(diagram);
  const profile = getLayoutProfile(viewType);
  next.canvas = normalizeCanvas(next.canvas);
  next.nodes = Array.isArray(next.nodes) ? next.nodes : [];
  next.layers = Array.isArray(next.layers) ? next.layers : [];
  next.edges = Array.isArray(next.edges) ? next.edges : [];

  if (profile.type === "dependency") return layoutDependency(next, profile, options);
  if (profile.type === "mindmap") return layoutMindmap(next, profile, options);
  return layoutArchitecture(next, profile, options);
}

function toElkGraph(diagram, profile) {
  return {
    id: "root",
    layoutOptions: profile.elk,
    children: (diagram.nodes ?? []).map((node) => ({
      id: node.id,
      width: Number(node.width || profile.node.width),
      height: Number(node.height || profile.node.height)
    })),
    edges: (diagram.edges ?? []).map((edge, index) => ({
      id: edge.id || `${edge.from}->${edge.to}:${index}`,
      sources: [edge.from],
      targets: [edge.to]
    }))
  };
}

export async function layoutWithElk(diagram, viewType = "architecture", options = {}) {
  const profile = getLayoutProfile(viewType);
  try {
    const module = await import("elkjs/lib/elk.bundled.js");
    const Elk = module.default ?? module;
    const elk = new Elk();
    const graph = await elk.layout(toElkGraph(diagram, profile), options.elkOptions ?? {});
    const byId = new Map((graph.children ?? []).map((node) => [node.id, node]));
    const next = clone(diagram);
    next.nodes = (next.nodes ?? []).map((node) => {
      const laidOut = byId.get(node.id);
      if (!laidOut) return node;
      return {
        ...node,
        x: snap((laidOut.x ?? 0) + Number(options.offsetX ?? 180), profile.gridSize),
        y: snap((laidOut.y ?? 0) + Number(options.offsetY ?? 180), profile.gridSize),
        width: Number(laidOut.width || node.width || profile.node.width),
        height: Number(laidOut.height || node.height || profile.node.height)
      };
    });
    return fitCanvasToNodes(applyLayerBounds(next, profile));
  } catch {
    return fallbackLayout(diagram, viewType, options);
  }
}

export function compactCameraFor(diagram, padding = 120) {
  const nodes = diagram.nodes ?? [];
  if (!nodes.length) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const minX = Math.min(...nodes.map((node) => Number(node.x || 0)));
  const minY = Math.min(...nodes.map((node) => Number(node.y || 0)));
  const maxX = Math.max(...nodes.map((node) => Number(node.x || 0) + Number(node.width || 0)));
  const maxY = Math.max(...nodes.map((node) => Number(node.y || 0) + Number(node.height || 0)));
  return {
    x: snap(minX - padding),
    y: snap(minY - padding),
    zoom: 1,
    bounds: {
      x: snap(minX - padding),
      y: snap(minY - padding),
      width: snap(maxX - minX + padding * 2),
      height: snap(maxY - minY + padding * 2)
    }
  };
}

export function routeEdgesOrthogonally(diagram) {
  const next = clone(diagram);
  const nodes = new Map((next.nodes ?? []).map((node) => [node.id, node]));
  next.edges = (next.edges ?? []).map((edge, index) => {
    const source = nodes.get(edge.from);
    const target = nodes.get(edge.to);
    if (!source || !target || edge.waypoints?.length) {
      return { ...edge, id: edge.id || `${edge.from}->${edge.to}:${index}` };
    }
    const a = nodeCenter(source);
    const b = nodeCenter(target);
    if (Math.abs(a.x - b.x) > Math.abs(a.y - b.y)) {
      const midX = snap((a.x + b.x) / 2);
      return { ...edge, id: edge.id || `${edge.from}->${edge.to}:${index}`, fromSide: a.x <= b.x ? "right" : "left", toSide: a.x <= b.x ? "left" : "right", waypoints: [{ x: midX, y: a.y }, { x: midX, y: b.y }] };
    }
    const midY = snap((a.y + b.y) / 2);
    return { ...edge, id: edge.id || `${edge.from}->${edge.to}:${index}`, fromSide: a.y <= b.y ? "bottom" : "top", toSide: a.y <= b.y ? "top" : "bottom", waypoints: [{ x: a.x, y: midY }, { x: b.x, y: midY }] };
  });
  return next;
}

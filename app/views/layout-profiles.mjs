const DEFAULT_CANVAS = Object.freeze({ width: 2400, height: 1480, background: "#ffffff" });

export const LAYOUT_PROFILES = Object.freeze({
  architecture: Object.freeze({
    type: "architecture",
    direction: "down",
    gridSize: 8,
    node: Object.freeze({ width: 336, height: 96, horizontalGap: 152, verticalGap: 40 }),
    layer: Object.freeze({ paddingX: 36, paddingY: 32, gap: 56, minHeight: 152 }),
    elk: Object.freeze({
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "88",
      "elk.spacing.nodeNode": "56"
    })
  }),
  dependency: Object.freeze({
    type: "dependency",
    direction: "right",
    gridSize: 8,
    node: Object.freeze({ width: 336, height: 100, horizontalGap: 168, verticalGap: 48 }),
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
    node: Object.freeze({ width: 312, height: 92, horizontalGap: 128, verticalGap: 36 }),
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

function estimatedTextWidth(value, fontSize) {
  return [...String(value || "")].reduce((sum, character) => sum + (/[^\x00-\xff]/.test(character) ? fontSize : fontSize * .58), 0);
}

function preferredNodeSize(node, profile) {
  const titleSize = Math.max(16, Math.min(24, Number(node.titleSize || 20)));
  const subtitleSize = Math.max(11, Math.min(16, Number(node.subtitleSize || 13)));
  const contentWidth = Math.max(estimatedTextWidth(node.title, titleSize), estimatedTextWidth(node.subtitle, subtitleSize));
  return {
    width: snap(Math.max(profile.node.width, Math.min(432, contentWidth + 104)), profile.gridSize),
    height: snap(Math.max(profile.node.height, 92), profile.gridSize),
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
  const startX = Number(options.startX ?? 140);
  let y = Number(options.startY ?? 112);
  const nodesByLayer = groupBy(diagram.nodes ?? [], (node) => node.layer || "__unlayered");
  const orderedLayers = [...(diagram.layers ?? [])].sort(compareLayerPosition);
  const layerIds = orderedLayers.map((layer) => layer.id);
  if (nodesByLayer.has("__unlayered")) layerIds.push("__unlayered");

  for (const layerId of layerIds) {
    const nodes = (nodesByLayer.get(layerId) ?? []).sort(compareNodePosition);
    if (!nodes.length) continue;
    const columns = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(nodes.length * 1.65))));
    const sizes = nodes.map((node) => preferredNodeSize(node, profile));
    const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(...sizes.filter((_, index) => index % columns === column).map((size) => size.width), profile.node.width));
    const columnX = columnWidths.map((_, column) => startX + columnWidths.slice(0, column).reduce((sum, width) => sum + width + profile.node.horizontalGap, 0));
    let maxRowBottom = y;
    nodes.forEach((node, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const size = sizes[index];
      node.width = size.width;
      node.height = size.height;
      node.x = snap(columnX[column], profile.gridSize);
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

  let rankX = startX;
  for (const rankIndex of ranks) {
    const nodes = nodesByRank.get(rankIndex).sort(compareNodePosition);
    const sizes = nodes.map((node) => preferredNodeSize(node, profile));
    nodes.forEach((node, index) => {
      const size = sizes[index];
      node.width = size.width;
      node.height = size.height;
      node.x = snap(rankX, profile.gridSize);
      node.y = snap(startY + index * (profile.node.height + profile.node.verticalGap), profile.gridSize);
    });
    rankX += Math.max(profile.node.width, ...sizes.map((size) => size.width)) + profile.node.horizontalGap;
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

function buildMindmapHierarchy(diagram, rootId) {
  const nodes = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
  const children = new Map([...nodes.keys()].map((id) => [id, []]));
  const parent = new Map();
  for (const node of nodes.values()) {
    const parentId = node.parentId ?? node.parent;
    if (parentId && nodes.has(parentId) && parentId !== node.id && !parent.has(node.id)) {
      parent.set(node.id, parentId);
      children.get(parentId).push(node.id);
    }
  }
  const queue = [rootId];
  const visited = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const adjacent = (diagram.edges ?? []).flatMap((edge) => edge.from === current ? [edge.to] : edge.to === current ? [edge.from] : []);
    for (const id of adjacent) {
      if (!nodes.has(id) || visited.has(id)) continue;
      visited.add(id);
      parent.set(id, current);
      children.get(current).push(id);
      queue.push(id);
    }
  }
  for (const id of nodes.keys()) {
    if (id === rootId || visited.has(id)) continue;
    parent.set(id, rootId);
    children.get(rootId).push(id);
    visited.add(id);
  }
  const depth = new Map([[rootId, 0]]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const id of children.get(current) ?? []) {
      depth.set(id, (depth.get(current) ?? 0) + 1);
      if (!queue.includes(id)) queue.push(id);
    }
  }
  return { children, parent, depth };
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
  const rootSize = preferredNodeSize({ ...root, titleSize: Math.max(24, Number(root.titleSize || 24)) }, profile);
  root.width = Math.max(360, rootSize.width);
  root.height = Math.max(104, rootSize.height);
  root.x = snap(center.x - root.width / 2, profile.gridSize);
  root.y = snap(center.y - root.height / 2, profile.gridSize);

  const hierarchy = buildMindmapHierarchy(diagram, rootId);
  const mode = options.layout || "both";
  const rootChildren = hierarchy.children.get(rootId) ?? [];
  const branchSide = new Map(rootChildren.map((id, index) => [id, mode === "left" ? -1 : mode === "right" ? 1 : index % 2 === 0 ? 1 : -1]));
  const branchOf = new Map(rootChildren.map((id) => [id, id]));
  const queue = [...rootChildren];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const child of hierarchy.children.get(current) ?? []) {
      branchOf.set(child, branchOf.get(current));
      queue.push(child);
    }
  }
  const groups = new Map();
  for (const node of diagram.nodes ?? []) {
    if (node.id === rootId) continue;
    const depth = hierarchy.depth.get(node.id) ?? 1;
    const side = mode === "radial" ? 0 : (branchSide.get(branchOf.get(node.id)) ?? 1);
    const key = `${depth}:${side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  if (mode === "radial") {
    for (const [key, nodes] of groups) {
      const depth = Number(key.split(":")[0]);
      const radius = depth * Number(options.radiusStep || 330);
      nodes.sort(compareNodePosition).forEach((node, index) => {
        const size = preferredNodeSize(node, profile);
        const angle = -Math.PI / 2 + index / Math.max(1, nodes.length) * Math.PI * 2;
        Object.assign(node, size, { x: snap(center.x + Math.cos(angle) * radius - size.width / 2, profile.gridSize), y: snap(center.y + Math.sin(angle) * radius - size.height / 2, profile.gridSize) });
      });
    }
  } else {
    for (const [key, nodes] of groups) {
      const [depthValue, sideValue] = key.split(":").map(Number);
      const side = sideValue || 1;
      const ordered = nodes.sort(compareNodePosition);
      const gap = profile.node.height + profile.node.verticalGap;
      ordered.forEach((node, index) => {
        const size = preferredNodeSize(node, profile);
        const x = side > 0 ? center.x + depthValue * (profile.node.width + profile.node.horizontalGap) : center.x - depthValue * (profile.node.width + profile.node.horizontalGap) - size.width;
        const y = center.y - ((ordered.length - 1) * gap) / 2 + index * gap - size.height / 2;
        Object.assign(node, size, { x: snap(x, profile.gridSize), y: snap(y, profile.gridSize) });
      });
    }
  }

  return fitCanvasToNodes(applyLayerBounds(diagram, profile));
}

export function fallbackLayout(diagram, viewType = "architecture", options = {}) {
  const next = clone(diagram);
  const profile = getLayoutProfile(viewType);
  next.canvas = normalizeCanvas(next.canvas);
  next.nodes = Array.isArray(next.nodes) ? next.nodes : [];
  next.layers = Array.isArray(next.layers) ? next.layers : [];
  next.edges = Array.isArray(next.edges) ? next.edges : [];

  let laidOut;
  if (profile.type === "dependency") laidOut = layoutDependency(next, profile, options);
  else if (profile.type === "mindmap") laidOut = layoutMindmap(next, profile, options);
  else laidOut = layoutArchitecture(next, profile, options);
  return resetEdgeRoutes(laidOut);
}

function resetEdgeRoutes(diagram) {
  const nodes = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
  diagram.edges = (diagram.edges ?? []).map((edge, index) => {
    const source = nodes.get(edge.from);
    const target = nodes.get(edge.to);
    if (!source || !target) return { ...edge, id: edge.id || `${edge.from}->${edge.to}:${index}`, waypoints: [] };
    const a = nodeCenter(source);
    const b = nodeCenter(target);
    const horizontal = Math.abs(a.x - b.x) > Math.abs(a.y - b.y);
    return {
      ...edge,
      id: edge.id || `${edge.from}->${edge.to}:${index}`,
      fromSide: horizontal ? (a.x <= b.x ? "right" : "left") : (a.y <= b.y ? "bottom" : "top"),
      toSide: horizontal ? (a.x <= b.x ? "left" : "right") : (a.y <= b.y ? "top" : "bottom"),
      waypoints: [],
    };
  });
  return diagram;
}

function toElkGraph(diagram, profile) {
  return {
    id: "root",
    layoutOptions: profile.elk,
    children: (diagram.nodes ?? []).map((node) => ({ id: node.id, ...preferredNodeSize(node, profile) })),
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
        width: Number(laidOut.width || preferredNodeSize(node, profile).width),
        height: Number(laidOut.height || preferredNodeSize(node, profile).height)
      };
    });
    return resetEdgeRoutes(fitCanvasToNodes(applyLayerBounds(next, profile)));
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

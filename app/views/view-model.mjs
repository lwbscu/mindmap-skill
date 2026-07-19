import { compactCameraFor, fallbackLayout, getLayoutProfile, getViewTypes } from "./layout-profiles.mjs";
import { stableEdgeId } from "./graph-query.mjs";

const DEFAULT_VIEW_TYPE = "architecture";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pickDefined(source, keys) {
  const next = {};
  for (const key of keys) {
    if (source[key] !== undefined) next[key] = clone(source[key]);
  }
  return next;
}

function viewLabel(type) {
  if (type === "dependency") return "Dependency";
  if (type === "mindmap") return "MindMap";
  return "Architecture";
}

function normalizeViewType(type) {
  return getViewTypes().includes(type) ? type : DEFAULT_VIEW_TYPE;
}

function layoutFromDiagram(diagram) {
  return {
    nodes: Object.fromEntries((diagram.nodes ?? []).map((node) => [
      node.id,
      pickDefined(node, [
        "x",
        "y",
        "width",
        "height",
        "layer",
        "locked",
        "collapsed",
        "groupId"
      ])
    ])),
    layers: Object.fromEntries((diagram.layers ?? []).map((layer) => [
      layer.id,
      pickDefined(layer, [
        "x",
        "y",
        "width",
        "height",
        "fill",
        "stroke",
        "tabFill",
        "labelMode",
        "collapsed",
        "locked"
      ])
    ])),
    edges: Object.fromEntries((diagram.edges ?? []).map((edge, index) => [
      stableEdgeId(edge, index),
      pickDefined(edge, [
        "fromSide",
        "toSide",
        "waypoints",
        "labelAt",
        "labelRatio",
        "routeMode",
        "routeStyle",
        "lockedRoute",
        "curveControlPoints",
        "stroke",
        "strokeWidth",
        "hidden",
        "manual",
        "flagged"
      ])
    ]))
  };
}

function compactLegacyArchitectureLayout(diagram) {
  const layout = layoutFromDiagram(diagram);
  const nodes = diagram.nodes ?? [];
  if (!nodes.length) return layout;
  const minX = Math.min(...nodes.map((node) => Number(node.x || 0)));
  const minY = Math.min(...nodes.map((node) => Number(node.y || 0)));
  const maxX = Math.max(...nodes.map((node) => Number(node.x || 0) + Number(node.width || 0)));
  const maxY = Math.max(...nodes.map((node) => Number(node.y || 0) + Number(node.height || 0)));
  const span = Math.max(maxX - minX, maxY - minY);
  const scale = span > 1800 ? 0.44 : span > 1400 ? 0.64 : 1;
  if (scale === 1) return layout;
  const offsetX = 120;
  const offsetY = 96;
  const scalePoint = (point = {}) => ({
    x: Math.round((Number(point.x || 0) - minX) * scale + offsetX),
    y: Math.round((Number(point.y || 0) - minY) * scale + offsetY),
  });

  layout.nodes = Object.fromEntries(nodes.map((node) => {
    const source = layout.nodes[node.id] ?? {};
    return [node.id, {
      ...source,
      ...scalePoint(source),
      width: Math.max(node.kind === "group" ? 320 : 224, Math.round(Number(source.width || 224) * scale)),
      height: Math.max(node.kind === "group" ? 180 : 72, Math.round(Number(source.height || 78) * scale)),
    }];
  }));
  layout.layers = Object.fromEntries((diagram.layers ?? []).map((layer) => {
    const source = layout.layers[layer.id] ?? {};
    return [layer.id, {
      ...source,
      ...scalePoint(source),
      width: Math.max(520, Math.round(Number(source.width || 800) * scale)),
      height: Math.max(96, Math.round(Number(source.height || 180) * scale)),
    }];
  }));
  layout.edges = Object.fromEntries((diagram.edges ?? []).map((edge, index) => {
    const id = stableEdgeId(edge, index);
    const source = layout.edges[id] ?? {};
    return [id, {
      ...source,
      ...(Array.isArray(source.waypoints) ? { waypoints: source.waypoints.map(scalePoint) } : {}),
    }];
  }));
  return layout;
}

function normalizeLayout(layout = {}) {
  const nodes = Object.fromEntries(Object.entries(layout.nodes && typeof layout.nodes === "object" ? layout.nodes : {}).map(([id, item]) => [id, pickDefined(item || {}, ["x", "y", "width", "height", "layer", "locked", "collapsed", "groupId"])]));
  return {
    mode: layout.mode ?? "manual",
    engine: layout.engine ?? "fallback",
    editorVersion: Number(layout.editorVersion || 0),
    profile: normalizeViewType(layout.profile ?? layout.type),
    nodes,
    layers: layout.layers && typeof layout.layers === "object" ? clone(layout.layers) : {},
    edges: layout.edges && typeof layout.edges === "object" ? clone(layout.edges) : {}
  };
}

function normalizeCamera(camera, diagram) {
  if (camera && typeof camera === "object") {
    return {
      x: Number.isFinite(Number(camera.x)) ? Number(camera.x) : 0,
      y: Number.isFinite(Number(camera.y)) ? Number(camera.y) : 0,
      zoom: Number.isFinite(Number(camera.zoom)) ? Number(camera.zoom) : 1,
      ...(camera.bounds ? { bounds: clone(camera.bounds) } : {})
    };
  }
  return compactCameraFor(diagram);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item.trim()))];
}

function defaultView(diagram, type) {
  const profile = getLayoutProfile(type);
  const modeOptions = type === "mindmap"
    ? { rootId: diagram.nodes?.[0]?.id ?? null, layout: "both", routing: "curved" }
    : { routing: "orthogonal" };
  const layout = layoutFromDiagram(fallbackLayout(diagram, type, modeOptions));
  return {
    id: type,
    type,
    label: viewLabel(type),
    camera: compactCameraFor(diagram),
    layout: {
      mode: "auto",
      engine: "compact",
      editorVersion: 2,
      profile: type,
      nodes: layout.nodes,
      layers: layout.layers,
      edges: layout.edges
    },
    hiddenNodes: [],
    hiddenEdges: [],
    hiddenLayers: [],
    collapsedNodes: [],
    fixedNodes: [],
    filters: type === "dependency"
      ? { direction: "both", depth: 2, relations: [] }
      : {},
    modeOptions
  };
}

function normalizeView(rawView, diagram, existingIds = new Set()) {
  const type = normalizeViewType(rawView?.type ?? rawView?.id);
  const fallback = defaultView(diagram, type);
  const requestedId = typeof rawView?.id === "string" && rawView.id.trim() ? rawView.id.trim() : fallback.id;
  let id = requestedId;
  for (let suffix = 2; existingIds.has(id); suffix += 1) {
    id = `${requestedId}-${suffix}`;
  }
  existingIds.add(id);
  const hasManualNodes = (diagram.nodes ?? []).some((node) => node.manual);
  const shouldUpgradeGeneratedLayout = Boolean(rawView?.layout) && !Number(rawView.layout.editorVersion) && !hasManualNodes;
  const layout = normalizeLayout(shouldUpgradeGeneratedLayout ? fallback.layout : { ...fallback.layout, ...(rawView?.layout ?? {}) });
  layout.profile = type;
  return {
    ...fallback,
    ...clone(rawView ?? {}),
    id,
    type,
    label: typeof rawView?.label === "string" && rawView.label.trim() ? rawView.label : fallback.label,
    camera: normalizeCamera(rawView?.camera ?? fallback.camera, diagram),
    layout,
    hiddenNodes: normalizeStringArray(rawView?.hiddenNodes ?? fallback.hiddenNodes),
    hiddenEdges: normalizeStringArray(rawView?.hiddenEdges ?? fallback.hiddenEdges),
    hiddenLayers: normalizeStringArray(rawView?.hiddenLayers ?? fallback.hiddenLayers),
    collapsedNodes: normalizeStringArray(rawView?.collapsedNodes ?? fallback.collapsedNodes),
    fixedNodes: normalizeStringArray(rawView?.fixedNodes ?? fallback.fixedNodes),
    filters: rawView?.filters && typeof rawView.filters === "object" ? clone(rawView.filters) : clone(fallback.filters),
    modeOptions: rawView?.modeOptions && typeof rawView.modeOptions === "object"
      ? { ...clone(fallback.modeOptions), ...clone(rawView.modeOptions) }
      : clone(fallback.modeOptions)
  };
}

export function ensureViews(diagram, options = {}) {
  const next = clone(diagram ?? {});
  next.schemaVersion = next.schemaVersion ?? "mindmap-app/v1";
  next.canvas = next.canvas && typeof next.canvas === "object" ? next.canvas : { width: 2400, height: 1480, background: "#ffffff" };
  next.layers = Array.isArray(next.layers) ? next.layers : [];
  next.nodes = Array.isArray(next.nodes) ? next.nodes : [];
  next.edges = Array.isArray(next.edges) ? next.edges : [];

  const existingIds = new Set();
  const suppliedViews = Array.isArray(next.views) ? next.views : [];
  const views = suppliedViews.map((view) => normalizeView(view, next, existingIds));
  for (const type of getViewTypes()) {
    if (!views.some((view) => view.type === type)) {
      views.push(normalizeView(defaultView(next, type), next, existingIds));
    }
  }

  next.views = views;
  if (!Array.isArray(next.savedViews)) next.savedViews = [];
  next.savedViews = next.savedViews
    .filter((view) => view && typeof view === "object")
    .map((view, index) => ({
      id: typeof view.id === "string" && view.id.trim() ? view.id : `saved-${index + 1}`,
      label: typeof view.label === "string" && view.label.trim() ? view.label : `Saved ${index + 1}`,
      camera: normalizeCamera(view.camera, next),
      viewId: view.viewId,
      createdAt: view.createdAt
    }));

  const requested = options.activeViewId ?? next.activeViewId;
  const active = views.find((view) => view.id === requested || view.type === requested) ?? views.find((view) => view.type === DEFAULT_VIEW_TYPE) ?? views[0];
  next.activeViewId = active?.id ?? DEFAULT_VIEW_TYPE;
  return next;
}

export function getActiveView(diagram, viewIdOrType) {
  const normalized = ensureViews(diagram, { activeViewId: viewIdOrType });
  return normalized.views.find((view) => view.id === normalized.activeViewId)
    ?? normalized.views.find((view) => view.type === viewIdOrType)
    ?? normalized.views[0];
}

export function activate(diagram, viewIdOrType) {
  return ensureViews(diagram, { activeViewId: viewIdOrType });
}

export function capture(diagram, viewIdOrSnapshot, snapshot = {}) {
  const normalized = ensureViews(diagram);
  const viewId = typeof viewIdOrSnapshot === "string" ? viewIdOrSnapshot : normalized.activeViewId;
  const patch = typeof viewIdOrSnapshot === "string" ? snapshot : (viewIdOrSnapshot ?? {});
  const index = normalized.views.findIndex((view) => view.id === viewId || view.type === viewId);
  if (index < 0) return normalized;

  const current = normalized.views[index];
  const extracted = layoutFromDiagram(normalized);
  const layoutPatch = patch.layout && typeof patch.layout === "object" ? patch.layout : {};
  normalized.views[index] = {
    ...current,
    ...pickDefined(patch, ["label", "filters", "modeOptions"]),
    camera: patch.camera ? normalizeCamera(patch.camera, normalized) : current.camera,
    hiddenNodes: patch.hiddenNodes ? normalizeStringArray(patch.hiddenNodes) : current.hiddenNodes,
    hiddenEdges: patch.hiddenEdges ? normalizeStringArray(patch.hiddenEdges) : current.hiddenEdges,
    hiddenLayers: patch.hiddenLayers ? normalizeStringArray(patch.hiddenLayers) : current.hiddenLayers,
    collapsedNodes: patch.collapsedNodes ? normalizeStringArray(patch.collapsedNodes) : current.collapsedNodes,
    fixedNodes: patch.fixedNodes ? normalizeStringArray(patch.fixedNodes) : current.fixedNodes,
    layout: normalizeLayout({
      ...current.layout,
      ...layoutPatch,
      nodes: { ...extracted.nodes, ...(layoutPatch.nodes ?? {}) },
      layers: { ...extracted.layers, ...(layoutPatch.layers ?? {}) },
      edges: { ...extracted.edges, ...(layoutPatch.edges ?? {}) }
    }),
    updatedAt: patch.updatedAt ?? new Date().toISOString()
  };
  normalized.activeViewId = normalized.views[index].id;
  return normalized;
}

export function makeView(diagram, type, overrides = {}) {
  return normalizeView({ ...defaultView(diagram, normalizeViewType(type)), ...overrides }, diagram);
}

export { stableEdgeId };

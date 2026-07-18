import { filterDependencies, stableEdgeId } from "./graph-query.mjs";
import { fallbackLayout, routeEdgesOrthogonally } from "./layout-profiles.mjs";
import { ensureViews, getActiveView } from "./view-model.mjs";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toSet(value) {
  if (value == null) return new Set();
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return new Set(value.filter(Boolean));
  return new Set([value].filter(Boolean));
}

function normalizeLayoutBuckets(layout = {}) {
  return {
    nodes: layout.nodes && typeof layout.nodes === "object" ? layout.nodes : {},
    layers: layout.layers && typeof layout.layers === "object" ? layout.layers : {},
    edges: layout.edges && typeof layout.edges === "object" ? layout.edges : {}
  };
}

function applyViewLayout(blueprint, view) {
  const layout = normalizeLayoutBuckets(view.layout);
  blueprint.nodes = (blueprint.nodes ?? []).map((node) => ({
    ...node,
    ...(layout.nodes[node.id] ?? {})
  }));
  blueprint.layers = (blueprint.layers ?? []).map((layer) => ({
    ...layer,
    ...(layout.layers[layer.id] ?? {})
  }));
  blueprint.edges = (blueprint.edges ?? []).map((edge, index) => {
    const id = stableEdgeId(edge, index);
    return {
      ...edge,
      id,
      ...(layout.edges[id] ?? {})
    };
  });
  return blueprint;
}

function removeHidden(blueprint, view) {
  const hiddenNodes = toSet(view.hiddenNodes);
  const hiddenEdges = toSet(view.hiddenEdges);
  const hiddenLayers = toSet(view.hiddenLayers);
  blueprint.nodes = (blueprint.nodes ?? []).filter((node) => !hiddenNodes.has(node.id) && !hiddenLayers.has(node.layer));
  const visibleNodeIds = new Set(blueprint.nodes.map((node) => node.id));
  blueprint.edges = (blueprint.edges ?? []).filter((edge, index) => {
    const id = stableEdgeId(edge, index);
    return !hiddenEdges.has(id) && visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to);
  });
  blueprint.layers = (blueprint.layers ?? []).filter((layer) => !hiddenLayers.has(layer.id) && blueprint.nodes.some((node) => node.layer === layer.id));
  return blueprint;
}

function removeCollapsedChildren(blueprint, view) {
  const collapsed = toSet(view.collapsedNodes);
  if (!collapsed.size) return blueprint;
  const childIds = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of blueprint.nodes ?? []) {
      if (childIds.has(node.id)) continue;
      const parentId = node.parentId ?? node.parent ?? node.groupId;
      if (collapsed.has(parentId) || childIds.has(parentId)) {
        childIds.add(node.id);
        changed = true;
      }
    }
  }
  if (!childIds.size) return blueprint;
  blueprint.nodes = blueprint.nodes.filter((node) => !childIds.has(node.id));
  blueprint.edges = blueprint.edges.filter((edge) => !childIds.has(edge.from) && !childIds.has(edge.to));
  return blueprint;
}

function resolveDependency(blueprint, view) {
  const filters = view.filters ?? {};
  const hasRoots = Boolean(filters.rootId || (Array.isArray(filters.rootIds) && filters.rootIds.length));
  const hasRelations = Array.isArray(filters.relations) && filters.relations.length;
  const hasDepth = filters.depth !== undefined && Number.isFinite(Number(filters.depth));
  if (!hasRoots && !hasRelations && !hasDepth && !filters.direction) return blueprint;
  return filterDependencies(blueprint, {
    rootId: filters.rootId,
    rootIds: filters.rootIds,
    direction: filters.direction ?? "both",
    depth: filters.depth ?? Infinity,
    relations: filters.relations
  }).diagram;
}

function resolveMindmap(blueprint, view) {
  const rootId = view.modeOptions?.rootId;
  if (!rootId) return blueprint;
  const nodeIds = new Set((blueprint.nodes ?? []).map((node) => node.id));
  if (!nodeIds.has(rootId)) return blueprint;
  return blueprint;
}

function maybeApplyFallbackLayout(blueprint, view, options) {
  const mode = options.layoutMode ?? view.layout?.mode;
  if (options.autoLayout || mode === "fallback" || mode === "auto") {
    return fallbackLayout(blueprint, view.type, {
      ...(view.modeOptions ?? {}),
      ...(view.filters?.rootId ? { roots: [view.filters.rootId] } : {}),
      ...(Array.isArray(view.filters?.rootIds) ? { roots: view.filters.rootIds } : {})
    });
  }
  return blueprint;
}

export function resolveView(diagram, viewIdOrType, options = {}) {
  const normalized = ensureViews(diagram, { activeViewId: viewIdOrType });
  const view = getActiveView(normalized, viewIdOrType ?? normalized.activeViewId);
  const blueprint = clone(normalized);
  delete blueprint.activeViewId;
  if (!options.keepViews) {
    delete blueprint.views;
    delete blueprint.savedViews;
  }

  applyViewLayout(blueprint, view);
  removeCollapsedChildren(blueprint, view);
  removeHidden(blueprint, view);

  let resolved = blueprint;
  if (view.type === "dependency") resolved = resolveDependency(resolved, view);
  if (view.type === "mindmap") resolved = resolveMindmap(resolved, view);
  resolved = maybeApplyFallbackLayout(resolved, view, options);
  if (options.routeEdges) resolved = routeEdgesOrthogonally(resolved);
  resolved.activeView = {
    id: view.id,
    type: view.type,
    label: view.label,
    camera: clone(view.camera),
    filters: clone(view.filters),
    modeOptions: clone(view.modeOptions)
  };
  return resolved;
}

export function resolveActiveView(diagram, options = {}) {
  return resolveView(diagram, diagram?.activeViewId, options);
}

export function listViews(diagram) {
  return ensureViews(diagram).views.map((view) => ({
    id: view.id,
    type: view.type,
    label: view.label,
    camera: clone(view.camera),
    filters: clone(view.filters),
    modeOptions: clone(view.modeOptions)
  }));
}

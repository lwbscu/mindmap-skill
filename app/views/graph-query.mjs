function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function stableEdgeId(edge, index = 0) {
  if (edge?.id) return String(edge.id);
  const relation = edge?.relation || edge?.label || "edge";
  return `${edge?.from ?? "unknown"}->${edge?.to ?? "unknown"}:${relation}:${index}`;
}

function toSet(value) {
  if (value == null) return new Set();
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return new Set(value.filter(Boolean));
  return new Set([value].filter(Boolean));
}

function normalizeDirection(direction = "outbound") {
  if (direction === "inbound" || direction === "incoming") return "inbound";
  if (direction === "both" || direction === "bidirectional") return "both";
  return "outbound";
}

function edgeAllowed(edge, relationSet) {
  return relationSet.size === 0 || relationSet.has(edge.relation || "unknown");
}

export function buildGraph(diagram, options = {}) {
  const relationSet = toSet(options.relations);
  const nodes = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
  const edges = [];
  const outgoing = new Map([...nodes.keys()].map((id) => [id, []]));
  const incoming = new Map([...nodes.keys()].map((id) => [id, []]));

  for (const [index, sourceEdge] of (diagram.edges ?? []).entries()) {
    if (!nodes.has(sourceEdge.from) || !nodes.has(sourceEdge.to)) continue;
    const edge = { ...sourceEdge, id: stableEdgeId(sourceEdge, index) };
    if (!edgeAllowed(edge, relationSet)) continue;
    edges.push(edge);
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }

  return { nodes, edges, outgoing, incoming };
}

function walkEdges(graph, id, direction) {
  if (direction === "inbound") {
    return graph.incoming.get(id) ?? [];
  }
  if (direction === "both") {
    return [...(graph.outgoing.get(id) ?? []), ...(graph.incoming.get(id) ?? [])];
  }
  return graph.outgoing.get(id) ?? [];
}

function opposite(edge, id, direction) {
  if (direction === "inbound") return edge.from;
  if (direction === "both") return edge.from === id ? edge.to : edge.from;
  return edge.to;
}

export function dependencyTraversal(diagram, options = {}) {
  const graph = buildGraph(diagram, options);
  const direction = normalizeDirection(options.direction);
  const depthLimit = Number.isFinite(Number(options.depth)) ? Math.max(0, Number(options.depth)) : Infinity;
  const rootIds = [...toSet(options.rootIds ?? options.rootId)].filter((id) => graph.nodes.has(id));
  const queue = rootIds.length ? rootIds.map((id) => ({ id, depth: 0 })) : [...graph.nodes.keys()].map((id) => ({ id, depth: 0 }));
  const nodeIds = new Set(queue.map((item) => item.id));
  const edgeIds = new Set();
  const depthByNode = new Map(queue.map((item) => [item.id, item.depth]));

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current.depth >= depthLimit) continue;
    for (const edge of walkEdges(graph, current.id, direction)) {
      const nextId = opposite(edge, current.id, direction);
      if (!graph.nodes.has(nextId)) continue;
      edgeIds.add(edge.id);
      if (!nodeIds.has(nextId)) {
        nodeIds.add(nextId);
        depthByNode.set(nextId, current.depth + 1);
        queue.push({ id: nextId, depth: current.depth + 1 });
      }
    }
  }

  return { nodeIds, edgeIds, depthByNode, graph };
}

export function filterDependencies(diagram, options = {}) {
  const traversal = dependencyTraversal(diagram, options);
  const next = clone(diagram);
  const nodeIds = traversal.nodeIds;
  const edgeIds = traversal.edgeIds;
  next.nodes = (next.nodes ?? []).filter((node) => nodeIds.has(node.id));
  next.edges = (next.edges ?? [])
    .map((edge, index) => ({ ...edge, id: stableEdgeId(edge, index) }))
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && (!edgeIds.size || edgeIds.has(edge.id)));
  next.layers = (next.layers ?? []).filter((layer) => next.nodes.some((node) => node.layer === layer.id));
  return {
    diagram: next,
    nodes: next.nodes,
    edges: next.edges,
    nodeIds,
    edgeIds,
    depthByNode: traversal.depthByNode
  };
}

export function shortestPath(diagram, fromId, toId, options = {}) {
  const graph = buildGraph(diagram, options);
  const direction = normalizeDirection(options.direction);
  if (!graph.nodes.has(fromId) || !graph.nodes.has(toId)) {
    return { nodeIds: [], edgeIds: [], edges: [], nodes: [] };
  }
  const queue = [fromId];
  const seen = new Set([fromId]);
  const previous = new Map();

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    if (id === toId) break;
    for (const edge of walkEdges(graph, id, direction)) {
      const nextId = opposite(edge, id, direction);
      if (seen.has(nextId)) continue;
      seen.add(nextId);
      previous.set(nextId, { nodeId: id, edge });
      queue.push(nextId);
    }
  }

  if (!seen.has(toId)) {
    return { nodeIds: [], edgeIds: [], edges: [], nodes: [] };
  }

  const nodeIds = [toId];
  const edges = [];
  for (let id = toId; id !== fromId;) {
    const step = previous.get(id);
    if (!step) break;
    edges.push(step.edge);
    id = step.nodeId;
    nodeIds.push(id);
  }
  nodeIds.reverse();
  edges.reverse();
  const edgeIds = edges.map((edge) => edge.id);
  return {
    nodeIds,
    edgeIds,
    nodes: nodeIds.map((id) => graph.nodes.get(id)).filter(Boolean),
    edges
  };
}

export function dependencyNeighborhood(diagram, nodeId, options = {}) {
  return filterDependencies(diagram, {
    ...options,
    rootIds: [nodeId],
    direction: options.direction ?? "both",
    depth: options.depth ?? 1
  });
}

export function relatedEdgesForNodes(diagram, nodeIds, options = {}) {
  const selected = toSet(nodeIds);
  const graph = buildGraph(diagram, options);
  return graph.edges.filter((edge) => selected.has(edge.from) && selected.has(edge.to));
}

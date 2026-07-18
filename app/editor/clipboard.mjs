function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function copySubgraph(diagram, nodeIds) {
  const selected = new Set(nodeIds ?? []);
  return {
    nodes: (diagram.nodes ?? []).filter((node) => selected.has(node.id)).map(clone),
    edges: (diagram.edges ?? []).filter((edge) => selected.has(edge.from) && selected.has(edge.to)).map(clone),
  };
}

export function pasteSubgraph(payload, options = {}) {
  const offset = Number(options.offset ?? 24);
  const suffix = options.suffix ?? Date.now().toString(36);
  const idFactory = options.idFactory ?? ((sourceId, index) => `${sourceId}-copy-${suffix}-${index}`);
  const edgeIdFactory = options.edgeIdFactory ?? ((_edge, index) => `manual-edge-${suffix}-${index}`);
  const idMap = new Map((payload?.nodes ?? []).map((node, index) => [node.id, idFactory(node.id, index)]));
  const nodes = (payload?.nodes ?? []).map((source) => ({
    ...clone(source),
    id: idMap.get(source.id),
    title: `${source.title || "未命名"} 副本`,
    manual: true,
    referenceOf: source.manual ? undefined : source.id,
    x: Number(source.x || 0) + offset,
    y: Number(source.y || 0) + offset,
    ...(source.parentId && idMap.has(source.parentId) ? { parentId: idMap.get(source.parentId) } : {}),
    ...(source.groupId && idMap.has(source.groupId) ? { groupId: idMap.get(source.groupId) } : {}),
  }));
  const edges = (payload?.edges ?? [])
    .filter((edge) => idMap.has(edge.from) && idMap.has(edge.to))
    .map((edge, index) => ({
      ...clone(edge),
      id: edgeIdFactory(edge, index),
      from: idMap.get(edge.from),
      to: idMap.get(edge.to),
      manual: true,
    }));
  return { nodes, edges, idMap, nodeIds: nodes.map((node) => node.id) };
}

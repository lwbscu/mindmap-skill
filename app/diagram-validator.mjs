const VALID_RELATIONS = new Set([
  "calls",
  "reads",
  "writes",
  "publishes",
  "subscribes",
  "depends_on",
  "routes",
  "transforms",
  "evaluates",
  "guards",
  "observes",
  "unknown",
]);

const STATUS_LABELS = new Map([
  ["implemented", "已实现"],
  ["external", "外部依赖"],
  ["planned", "拟介入"],
  ["unknown", "待确认"],
  ["risk", "风险"],
]);

const SIDES = new Set(["top", "right", "bottom", "left"]);

function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function requireObject(value, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object, got ${typeOf(value)}`);
    return false;
  }
  return true;
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requireNumber(value, path, errors, { positive = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number`);
    return;
  }
  if (positive && value <= 0) {
    errors.push(`${path} must be positive`);
  }
}

function requireStringArray(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array of strings`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") {
      errors.push(`${path}[${index}] must be a string`);
    }
  }
}

function requireOptionalString(value, path, errors) {
  if (value !== undefined && typeof value !== "string") {
    errors.push(`${path} must be a string`);
  }
}

function requireLinks(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  for (const [index, link] of value.entries()) {
    if (!requireObject(link, `${path}[${index}]`, errors)) continue;
    requireString(link.label, `${path}[${index}].label`, errors);
    requireString(link.href, `${path}[${index}].href`, errors);
  }
}

function validateBox(item, path, errors) {
  for (const key of ["x", "y", "width", "height"]) {
    requireNumber(item[key], `${path}.${key}`, errors, {
      positive: key === "width" || key === "height",
    });
  }
}

function validatePoint(point, path, errors) {
  if (!requireObject(point, path, errors)) return;
  requireNumber(point.x, `${path}.x`, errors);
  requireNumber(point.y, `${path}.y`, errors);
}

function validateStatus(value, path, errors) {
  if (value === undefined) return;
  const key = String(value).trim().toLowerCase();
  if (!STATUS_LABELS.has(key)) {
    errors.push(`${path} must be one of ${[...STATUS_LABELS.keys()].join(", ")}`);
  }
}

export function normalizeStatus(status) {
  if (!status) return "";
  const key = String(status).trim().toLowerCase();
  return STATUS_LABELS.has(key) ? key : "unknown";
}

export function statusLabel(status) {
  const key = normalizeStatus(status);
  return key ? STATUS_LABELS.get(key) : "";
}

export function validateDiagram(diagram) {
  const errors = [];
  if (!requireObject(diagram, "diagram", errors)) {
    return { ok: false, errors };
  }

  if (diagram.schemaVersion !== "mindmap-app/v1") {
    errors.push("diagram.schemaVersion must be mindmap-app/v1");
  }
  requireString(diagram.title, "diagram.title", errors);
  requireOptionalString(diagram.subtitle, "diagram.subtitle", errors);
  requireOptionalString(diagram.language, "diagram.language", errors);
  if (!requireObject(diagram.canvas, "diagram.canvas", errors)) {
    return { ok: false, errors };
  }
  requireNumber(diagram.canvas.width, "diagram.canvas.width", errors, { positive: true });
  requireNumber(diagram.canvas.height, "diagram.canvas.height", errors, { positive: true });

  for (const key of ["layers", "nodes", "edges"]) {
    if (!Array.isArray(diagram[key])) {
      errors.push(`diagram.${key} must be an array`);
    }
  }
  if (errors.length) return { ok: false, errors };

  const layerIds = new Set();
  for (const [index, layer] of diagram.layers.entries()) {
    const path = `diagram.layers[${index}]`;
    if (!requireObject(layer, path, errors)) continue;
    requireString(layer.id, `${path}.id`, errors);
    requireString(layer.label, `${path}.label`, errors);
    validateBox(layer, path, errors);
    if (layerIds.has(layer.id)) errors.push(`${path}.id duplicates ${layer.id}`);
    layerIds.add(layer.id);
  }

  const nodeIds = new Set();
  for (const [index, node] of diagram.nodes.entries()) {
    const path = `diagram.nodes[${index}]`;
    if (!requireObject(node, path, errors)) continue;
    requireString(node.id, `${path}.id`, errors);
    requireString(node.title, `${path}.title`, errors);
    requireOptionalString(node.kind, `${path}.kind`, errors);
    validateBox(node, path, errors);
    if (nodeIds.has(node.id)) errors.push(`${path}.id duplicates ${node.id}`);
    nodeIds.add(node.id);
    if (node.layer && !layerIds.has(node.layer)) {
      errors.push(`${path}.layer references missing layer ${node.layer}`);
    }
    validateStatus(node.status, `${path}.status`, errors);
    requireStringArray(node.evidence, `${path}.evidence`, errors);
    requireStringArray(node.risks, `${path}.risks`, errors);
    requireLinks(node.links, `${path}.links`, errors);
  }

  for (const [index, edge] of diagram.edges.entries()) {
    const path = `diagram.edges[${index}]`;
    if (!requireObject(edge, path, errors)) continue;
    requireString(edge.from, `${path}.from`, errors);
    requireString(edge.to, `${path}.to`, errors);
    if (!nodeIds.has(edge.from)) errors.push(`${path}.from references missing node ${edge.from}`);
    if (!nodeIds.has(edge.to)) errors.push(`${path}.to references missing node ${edge.to}`);
    for (const side of ["fromSide", "toSide"]) {
      if (edge[side] !== undefined && !SIDES.has(edge[side])) {
        errors.push(`${path}.${side} must be one of ${[...SIDES].join(", ")}`);
      }
    }
    if (edge.relation && !VALID_RELATIONS.has(edge.relation)) {
      errors.push(`${path}.relation must be a known relation`);
    }
    requireStringArray(edge.evidence, `${path}.evidence`, errors);
    if (edge.waypoints !== undefined) {
      if (!Array.isArray(edge.waypoints)) {
        errors.push(`${path}.waypoints must be an array`);
      } else {
        edge.waypoints.forEach((point, pointIndex) => {
          validatePoint(point, `${path}.waypoints[${pointIndex}]`, errors);
        });
      }
    }
    if (edge.labelAt !== undefined) validatePoint(edge.labelAt, `${path}.labelAt`, errors);
  }

  return { ok: errors.length === 0, errors };
}

export function assertValidDiagram(diagram) {
  const result = validateDiagram(diagram);
  if (!result.ok) {
    throw new Error(`Invalid MindMap diagram:\n${result.errors.join("\n")}`);
  }
  return diagram;
}

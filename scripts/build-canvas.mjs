#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCanvasObject } from './validate-canvas.mjs';

const GENERATOR = 'mindmap-skill/build-canvas.mjs';
const SUPPORTED_SCHEMA_VERSION = '1.0';
const NODE_WIDTH = 320;
const NODE_HEIGHT = 160;
const GROUP_PADDING = 48;
const RANK_GAP = 460;
const LANE_GAP = 230;
const MERGE_X_GAP = 420;
const ROLE_STYLES = {
  entrypoint: { color: '1' },
  interface: { color: '5' },
  module: { color: '4' },
  service: { color: '4' },
  model: { color: '4', shape: 'predefined-process' },
  data: { color: '1', shape: 'database' },
  storage: { color: '1', shape: 'database' },
  state: { color: '6' },
  process: { color: '6', shape: 'predefined-process' },
  objective: { color: '2' },
  loss: { color: '2' },
  optimizer: { color: '2', shape: 'predefined-process' },
  evaluation: { color: '5' },
  output: { color: '5' },
  external: { color: '5' },
  risk: { color: '2', shape: 'diamond' },
  unknown: { color: '2' },
};

function issue(category, message, path = '$') {
  return { severity: 'error', category, message, path };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(code, category, message, path = '$', extra = {}) {
  printJson({
    ok: false,
    errors: [issue(category, message, path)],
    warnings: [],
    ...extra,
  });
  return code;
}

function stableId(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 16);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value) {
  return value === undefined || typeof value === 'string';
}

function optionalBoolean(value) {
  return value === undefined || typeof value === 'boolean';
}

function optionalNumber(value) {
  return value === undefined || (Number.isInteger(value) && value >= 0);
}

function normalizeStyleAttributes(value, path, errors) {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    errors.push(issue('schema-error', 'styleAttributes must be an object when provided.', path));
    return undefined;
  }
  return { ...value };
}

function parseArgs(argv) {
  const result = {
    input: undefined,
    output: undefined,
    mode: undefined,
    advanced: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--input' || arg === '--output' || arg === '--mode' || arg === '--advanced') {
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Missing value for ${arg}.`);
      }
      result[arg.slice(2)] = next;
      index += 1;
    } else if (arg === '-h' || arg === '--help') {
      throw new Error('Usage: node build-canvas.mjs --input <blueprint.json> --output <file.canvas> --mode create|merge --advanced auto|on|off');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!result.input || !result.output || !result.mode || !result.advanced) {
    throw new Error('Usage: node build-canvas.mjs --input <blueprint.json> --output <file.canvas> --mode create|merge --advanced auto|on|off');
  }
  if (!['create', 'merge'].includes(result.mode)) {
    throw new Error('--mode must be create or merge.');
  }
  if (!['auto', 'on', 'off'].includes(result.advanced)) {
    throw new Error('--advanced must be auto, on, or off.');
  }
  return result;
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function validateBlueprint(blueprint) {
  const errors = [];
  if (!isPlainObject(blueprint)) {
    errors.push(issue('schema-error', 'Blueprint root must be an object.'));
    return { ok: false, errors };
  }
  if (blueprint.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    errors.push(issue('schema-error', 'Blueprint schemaVersion must be "1.0".', '$.schemaVersion'));
  }
  if (!optionalString(blueprint.title)) {
    errors.push(issue('schema-error', 'Blueprint title must be a string when provided.', '$.title'));
  }
  if (!optionalString(blueprint.language)) {
    errors.push(issue('schema-error', 'Blueprint language must be a string when provided.', '$.language'));
  }
  if (!Array.isArray(blueprint.nodes)) {
    errors.push(issue('schema-error', 'Blueprint nodes must be an array.', '$.nodes'));
  }
  if (!Array.isArray(blueprint.edges)) {
    errors.push(issue('schema-error', 'Blueprint edges must be an array.', '$.edges'));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const nodeKeys = new Set();
  blueprint.nodes.forEach((node, index) => {
    const base = `$.nodes[${index}]`;
    if (!isPlainObject(node)) {
      errors.push(issue('schema-error', 'Blueprint node must be an object.', base));
      return;
    }
    for (const key of ['key', 'label', 'role']) {
      if (typeof node[key] !== 'string' || node[key].length === 0) {
        errors.push(issue('schema-error', `Blueprint node ${key} must be a non-empty string.`, `${base}.${key}`));
      }
    }
    if (typeof node.key === 'string') {
      if (nodeKeys.has(node.key)) {
        errors.push(issue('semantic-error', `Duplicate blueprint node key "${node.key}".`, `${base}.key`));
      }
      nodeKeys.add(node.key);
    }
    for (const key of ['details', 'group']) {
      if (!optionalString(node[key])) {
        errors.push(issue('schema-error', `Blueprint node ${key} must be a string when provided.`, `${base}.${key}`));
      }
    }
    for (const key of ['rank', 'lane']) {
      if (!optionalNumber(node[key])) {
        errors.push(issue('schema-error', `Blueprint node ${key} must be a non-negative integer when provided.`, `${base}.${key}`));
      }
    }
    if (node.evidence !== undefined && !Array.isArray(node.evidence) && typeof node.evidence !== 'string') {
      errors.push(issue('schema-error', 'Blueprint node evidence must be a string or array when provided.', `${base}.evidence`));
    }
    if (!optionalBoolean(node.uncertain)) {
      errors.push(issue('schema-error', 'Blueprint node uncertain must be a boolean when provided.', `${base}.uncertain`));
    }
    normalizeStyleAttributes(node.styleAttributes, `${base}.styleAttributes`, errors);
  });

  const edgeKeys = new Set();
  blueprint.edges.forEach((edge, index) => {
    const base = `$.edges[${index}]`;
    if (!isPlainObject(edge)) {
      errors.push(issue('schema-error', 'Blueprint edge must be an object.', base));
      return;
    }
    for (const key of ['from', 'to', 'relation']) {
      if (typeof edge[key] !== 'string' || edge[key].length === 0) {
        errors.push(issue('schema-error', `Blueprint edge ${key} must be a non-empty string.`, `${base}.${key}`));
      }
    }
    if (typeof edge.from === 'string' && !nodeKeys.has(edge.from)) {
      errors.push(issue('reference-error', `Blueprint edge references unknown from key "${edge.from}".`, `${base}.from`));
    }
    if (typeof edge.to === 'string' && !nodeKeys.has(edge.to)) {
      errors.push(issue('reference-error', `Blueprint edge references unknown to key "${edge.to}".`, `${base}.to`));
    }
    for (const key of ['label']) {
      if (!optionalString(edge[key])) {
        errors.push(issue('schema-error', `Blueprint edge ${key} must be a string when provided.`, `${base}.${key}`));
      }
    }
    if (edge.evidence !== undefined && !Array.isArray(edge.evidence) && typeof edge.evidence !== 'string') {
      errors.push(issue('schema-error', 'Blueprint edge evidence must be a string or array when provided.', `${base}.evidence`));
    }
    if (!optionalBoolean(edge.feedback)) {
      errors.push(issue('schema-error', 'Blueprint edge feedback must be a boolean when provided.', `${base}.feedback`));
    }
    normalizeStyleAttributes(edge.styleAttributes, `${base}.styleAttributes`, errors);

    if (typeof edge.from === 'string' && typeof edge.to === 'string' && typeof edge.relation === 'string') {
      const key = edgeKey(edge);
      if (edgeKeys.has(key)) {
        errors.push(issue('semantic-error', `Duplicate blueprint edge stable key "${key}".`, base));
      }
      edgeKeys.add(key);
    }
  });

  return { ok: errors.length === 0, errors };
}

function edgeKey(edge) {
  return `${edge.from}|${edge.relation}|${edge.to}|${edge.label ?? ''}`;
}

function nodeIdForKey(key) {
  return stableId(`node:${key}`);
}

function groupKey(groupName) {
  return `group:${groupName}`;
}

function edgeIdForKey(key) {
  return stableId(`edge:${key}`);
}

function isFeedbackEdge(edge) {
  const text = `${edge.relation ?? ''} ${edge.label ?? ''}`.toLowerCase();
  return edge.feedback === true
    || text.includes('feedback')
    || text.includes('loop')
    || text.includes('training')
    || text.includes('闭环')
    || text.includes('反馈')
    || text.includes('训练');
}

function feedbackOnlyNodeKeys(nodes, edges) {
  const structuralDegree = new Map(nodes.map((node) => [node.key, 0]));
  const feedbackParticipants = new Set();
  for (const edge of edges) {
    if (isFeedbackEdge(edge)) {
      feedbackParticipants.add(edge.from);
      feedbackParticipants.add(edge.to);
      continue;
    }
    structuralDegree.set(edge.from, (structuralDegree.get(edge.from) ?? 0) + 1);
    structuralDegree.set(edge.to, (structuralDegree.get(edge.to) ?? 0) + 1);
  }
  return new Set([...feedbackParticipants].filter((key) => (structuralDegree.get(key) ?? 0) === 0));
}

function computeRanks(nodes, edges) {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const incoming = new Map(nodes.map((node) => [node.key, 0]));
  const outgoing = new Map(nodes.map((node) => [node.key, []]));

  for (const edge of edges) {
    if (!byKey.has(edge.from) || !byKey.has(edge.to) || isFeedbackEdge(edge)) {
      continue;
    }
    outgoing.get(edge.from).push(edge.to);
    incoming.set(edge.to, incoming.get(edge.to) + 1);
  }

  const rank = new Map(nodes.map((node) => [node.key, Number.isInteger(node.rank) ? node.rank : 0]));
  const queue = nodes.filter((node) => incoming.get(node.key) === 0).map((node) => node.key);
  let cursor = 0;
  while (cursor < queue.length) {
    const key = queue[cursor];
    cursor += 1;
    for (const next of outgoing.get(key)) {
      if (!Number.isInteger(byKey.get(next).rank)) {
        rank.set(next, Math.max(rank.get(next), rank.get(key) + 1));
      }
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  const feedbackOnly = feedbackOnlyNodeKeys(nodes, edges);
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges.filter(isFeedbackEdge)) {
      if (feedbackOnly.has(edge.to) && !Number.isInteger(byKey.get(edge.to)?.rank)) {
        const nextRank = Math.max(rank.get(edge.to) ?? 0, rank.get(edge.from) ?? 0);
        if (nextRank !== rank.get(edge.to)) {
          rank.set(edge.to, nextRank);
          changed = true;
        }
      }
      if (feedbackOnly.has(edge.from) && !Number.isInteger(byKey.get(edge.from)?.rank)) {
        const nextRank = Math.max(rank.get(edge.from) ?? 0, rank.get(edge.to) ?? 0);
        if (nextRank !== rank.get(edge.from)) {
          rank.set(edge.from, nextRank);
          changed = true;
        }
      }
    }
    if (!changed) {
      break;
    }
  }

  return rank;
}

function formatNodeText(node) {
  const lines = [node.label];
  if (node.details) {
    lines.push('', node.details);
  }
  return lines.join('\n');
}

function asStyleAttributes(value) {
  return isPlainObject(value) ? { ...value } : undefined;
}

function buildStandardNode(node, id, coordinates, includeAdvanced) {
  const roleStyle = ROLE_STYLES[node.role] ?? { color: '6' };
  const canvasNode = {
    id,
    type: 'text',
    x: coordinates.x,
    y: coordinates.y,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    text: formatNodeText(node),
    color: node.uncertain ? '2' : roleStyle.color,
  };

  if (includeAdvanced) {
    const defaultStyle = { textAlign: 'center' };
    if (roleStyle.shape) {
      defaultStyle.shape = roleStyle.shape;
    }
    canvasNode.styleAttributes = {
      ...defaultStyle,
      ...(asStyleAttributes(node.styleAttributes) ?? {}),
    };
  }
  return canvasNode;
}

function buildGroupNode(name, id, members, includeAdvanced) {
  const left = Math.min(...members.map((node) => node.x));
  const top = Math.min(...members.map((node) => node.y));
  const right = Math.max(...members.map((node) => node.x + node.width));
  const bottom = Math.max(...members.map((node) => node.y + node.height));
  const groupNode = {
    id,
    type: 'group',
    x: left - GROUP_PADDING,
    y: top - GROUP_PADDING,
    width: (right - left) + (GROUP_PADDING * 2),
    height: (bottom - top) + (GROUP_PADDING * 2),
    label: name,
  };
  if (includeAdvanced) {
    groupNode.styleAttributes = { border: null };
  }
  return groupNode;
}

function buildStandardEdge(edge, id, keyToId, includeAdvanced) {
  const feedback = isFeedbackEdge(edge);
  const canvasEdge = {
    id,
    fromNode: keyToId[edge.from],
    fromSide: feedback ? 'bottom' : 'right',
    toNode: keyToId[edge.to],
    toSide: feedback ? 'bottom' : 'left',
    toEnd: 'arrow',
  };
  const label = edge.label ?? edge.relation;
  if (label) {
    canvasEdge.label = label;
  }
  if (feedback) {
    canvasEdge.color = '4';
  }
  if (includeAdvanced) {
    const styleAttributes = asStyleAttributes(edge.styleAttributes) ?? {};
    if (feedback) {
      styleAttributes.path = styleAttributes.path ?? 'long-dashed';
      styleAttributes.pathfindingMethod = styleAttributes.pathfindingMethod ?? 'square';
    }
    if (Object.keys(styleAttributes).length > 0) {
      canvasEdge.styleAttributes = styleAttributes;
    }
  }
  return canvasEdge;
}

function layoutBlueprintNodes(blueprint) {
  const ranks = computeRanks(blueprint.nodes, blueprint.edges);
  const feedbackOnly = feedbackOnlyNodeKeys(blueprint.nodes, blueprint.edges);
  const lanesByRank = new Map();
  const coordinates = new Map();

  const sorted = [...blueprint.nodes].sort((a, b) => {
    const rankDelta = (ranks.get(a.key) ?? 0) - (ranks.get(b.key) ?? 0);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    if (Number.isInteger(a.lane) && Number.isInteger(b.lane) && a.lane !== b.lane) {
      return a.lane - b.lane;
    }
    return a.key.localeCompare(b.key);
  });

  for (const node of sorted) {
    const rank = ranks.get(node.key) ?? 0;
    const usedLanes = lanesByRank.get(rank) ?? new Set();
    let lane = Number.isInteger(node.lane) ? node.lane : (feedbackOnly.has(node.key) ? 2 : 0);
    while (usedLanes.has(lane)) {
      lane += 1;
    }
    usedLanes.add(lane);
    lanesByRank.set(rank, usedLanes);
    coordinates.set(node.key, {
      x: rank * RANK_GAP,
      y: lane * LANE_GAP,
      rank,
      lane,
    });
  }

  return coordinates;
}

function buildFreshCanvas(blueprint, includeAdvanced) {
  const coordinates = layoutBlueprintNodes(blueprint);
  const keyToId = {};
  const edgeKeyToId = {};
  const normalNodes = [];

  for (const node of blueprint.nodes) {
    const id = nodeIdForKey(node.key);
    keyToId[node.key] = id;
    normalNodes.push(buildStandardNode(node, id, coordinates.get(node.key), includeAdvanced));
  }

  const groupNames = [...new Set(blueprint.nodes.map((node) => node.group).filter(Boolean))].sort();
  const groupNodes = [];
  for (const name of groupNames) {
    const key = groupKey(name);
    const id = nodeIdForKey(key);
    keyToId[key] = id;
    const memberIds = new Set(blueprint.nodes.filter((node) => node.group === name).map((node) => keyToId[node.key]));
    const members = normalNodes.filter((node) => memberIds.has(node.id));
    if (members.length > 0) {
      groupNodes.push(buildGroupNode(name, id, members, includeAdvanced));
    }
  }

  const edges = blueprint.edges.map((edge) => {
    const key = edgeKey(edge);
    const id = edgeIdForKey(key);
    edgeKeyToId[key] = id;
    return buildStandardEdge(edge, id, keyToId, includeAdvanced);
  });

  return {
    nodes: [...groupNodes, ...normalNodes],
    edges,
    metadata: {
      mindmap: {
        schemaVersion: SUPPORTED_SCHEMA_VERSION,
        generator: GENERATOR,
        keyToId,
        edgeKeyToId,
        nodeRoles: Object.fromEntries(blueprint.nodes.map((node) => [node.key, node.role])),
        nodeLabels: Object.fromEntries(blueprint.nodes.map((node) => [node.key, node.label])),
      },
    },
  };
}

async function findNearestObsidianDir(startPath) {
  let current = path.resolve(path.dirname(startPath));
  while (true) {
    const candidate = path.join(current, '.obsidian');
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {
      // Continue upward.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function detectAdvancedCanvas(outputPath) {
  const obsidianDir = await findNearestObsidianDir(outputPath);
  if (!obsidianDir) {
    return false;
  }

  let enabled = [];
  try {
    enabled = JSON.parse(await fs.readFile(path.join(obsidianDir, 'community-plugins.json'), 'utf8'));
  } catch {
    return false;
  }
  if (!Array.isArray(enabled)) {
    return false;
  }

  for (const pluginId of ['advanced-canvas', 'obsidian-advanced-canvas']) {
    if (!enabled.includes(pluginId)) {
      continue;
    }
    const pluginDir = path.join(obsidianDir, 'plugins', pluginId);
    try {
      const [manifest, main] = await Promise.all([
        fs.stat(path.join(pluginDir, 'manifest.json')),
        fs.stat(path.join(pluginDir, 'main.js')),
      ]);
      if (manifest.isFile() && main.isFile()) {
        return true;
      }
    } catch {
      // Enabled but not fully installed.
    }
  }
  return false;
}

async function resolveAdvancedMode(mode, outputPath) {
  if (mode === 'on') {
    return true;
  }
  if (mode === 'off') {
    return false;
  }
  return detectAdvancedCanvas(outputPath);
}

function indexCanvas(canvas) {
  return {
    nodesById: new Map(canvas.nodes.map((node) => [node.id, node])),
    edgesById: new Map(canvas.edges.map((edge) => [edge.id, edge])),
  };
}

function maxRight(canvas) {
  if (canvas.nodes.length === 0) {
    return 0;
  }
  return Math.max(...canvas.nodes.map((node) => Number.isInteger(node.x) && Number.isInteger(node.width) ? node.x + node.width : 0));
}

function mergeObjectPreservingUnknown(existing, replacement, fieldsToPreserve) {
  const merged = { ...existing, ...replacement };
  for (const field of fieldsToPreserve) {
    if (existing[field] !== undefined) {
      merged[field] = existing[field];
    }
  }
  return merged;
}

function ensureMindmapMetadata(canvas) {
  if (!isPlainObject(canvas.metadata)) {
    canvas.metadata = {};
  }
  if (!isPlainObject(canvas.metadata.mindmap)) {
    canvas.metadata.mindmap = {};
  }
  if (!isPlainObject(canvas.metadata.mindmap.keyToId)) {
    canvas.metadata.mindmap.keyToId = {};
  }
  if (!isPlainObject(canvas.metadata.mindmap.edgeKeyToId)) {
    canvas.metadata.mindmap.edgeKeyToId = {};
  }
  if (!isPlainObject(canvas.metadata.mindmap.nodeRoles)) {
    canvas.metadata.mindmap.nodeRoles = {};
  }
  if (!isPlainObject(canvas.metadata.mindmap.nodeLabels)) {
    canvas.metadata.mindmap.nodeLabels = {};
  }
  canvas.metadata.mindmap.schemaVersion = SUPPORTED_SCHEMA_VERSION;
  canvas.metadata.mindmap.generator = GENERATOR;
  return canvas.metadata.mindmap;
}

function metadataKeyForId(mapping, id) {
  for (const [key, mappedId] of Object.entries(mapping)) {
    if (mappedId === id) {
      return key;
    }
  }
  return undefined;
}

function assertMetadataMatch(kind, key, deterministicId, mappedId, idToKey, errors) {
  if (mappedId !== undefined && mappedId !== deterministicId) {
    errors.push(issue('semantic-error', `${kind} metadata maps "${key}" to "${mappedId}", but deterministic id is "${deterministicId}".`));
  }
  const existingKey = idToKey(deterministicId);
  if (existingKey !== undefined && existingKey !== key) {
    errors.push(issue('semantic-error', `${kind} id "${deterministicId}" is already mapped to semantic key "${existingKey}".`));
  }
}

function mergeCanvas(existingCanvas, blueprint, includeAdvanced) {
  const merged = {
    ...existingCanvas,
    nodes: [...existingCanvas.nodes],
    edges: [...existingCanvas.edges],
  };
  const mindmap = ensureMindmapMetadata(merged);
  const { nodesById, edgesById } = indexCanvas(merged);
  const errors = [];
  const existingKeyToId = { ...mindmap.keyToId };
  const existingEdgeKeyToId = { ...mindmap.edgeKeyToId };
  const existingNodeRoles = { ...mindmap.nodeRoles };
  const existingNodeLabels = { ...mindmap.nodeLabels };
  const fresh = buildFreshCanvas(blueprint, includeAdvanced);
  const freshMindmap = fresh.metadata.mindmap;
  const rightStart = maxRight(merged) + MERGE_X_GAP;
  const freshNodesById = new Map(fresh.nodes.map((node) => [node.id, node]));

  for (const [key, id] of Object.entries(freshMindmap.keyToId)) {
    assertMetadataMatch('Node', key, id, existingKeyToId[key], (candidate) => metadataKeyForId(existingKeyToId, candidate), errors);
    if (nodesById.has(id) && existingKeyToId[key] !== id) {
      errors.push(issue('semantic-error', `Node id "${id}" is occupied by an existing object without a matching MindMap key for "${key}".`));
    }
  }
  for (const [key, id] of Object.entries(freshMindmap.edgeKeyToId)) {
    assertMetadataMatch('Edge', key, id, existingEdgeKeyToId[key], (candidate) => metadataKeyForId(existingEdgeKeyToId, candidate), errors);
    if (edgesById.has(id) && existingEdgeKeyToId[key] !== id) {
      errors.push(issue('semantic-error', `Edge id "${id}" is occupied by an existing object without a matching MindMap key for "${key}".`));
    }
  }
  for (const [key, role] of Object.entries(freshMindmap.nodeRoles)) {
    if (existingNodeRoles[key] !== undefined && existingNodeRoles[key] !== role) {
      errors.push(issue('semantic-error', `Node key "${key}" changed role from "${existingNodeRoles[key]}" to "${role}".`));
    }
  }
  for (const [key, label] of Object.entries(freshMindmap.nodeLabels)) {
    let existingLabel = existingNodeLabels[key];
    if (existingLabel === undefined) {
      const existingId = existingKeyToId[key];
      const existingNode = existingId ? nodesById.get(existingId) : undefined;
      if (existingNode?.type === 'text' && typeof existingNode.text === 'string') {
        existingLabel = existingNode.text.split('\n', 1)[0].trim();
      }
    }
    if (existingLabel !== undefined && existingLabel !== label) {
      errors.push(issue('semantic-error', `Node key "${key}" changed label from "${existingLabel}" to "${label}".`));
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  let newNodeLane = 0;
  const placeNewNode = (node) => {
    const original = freshNodesById.get(node.id) ?? node;
    const x = rightStart + Math.max(0, Math.floor(original.x / RANK_GAP)) * RANK_GAP;
    const y = Number.isInteger(original.y) ? original.y : newNodeLane * LANE_GAP;
    newNodeLane += 1;
    return { ...node, x, y };
  };

  for (const freshNode of fresh.nodes.filter((node) => node.type !== 'group')) {
    const existing = nodesById.get(freshNode.id);
    if (existing) {
      const updated = mergeObjectPreservingUnknown(existing, freshNode, [
        'x', 'y', 'width', 'height', 'text', 'color', 'styleAttributes',
      ]);
      const index = merged.nodes.findIndex((node) => node.id === freshNode.id);
      merged.nodes[index] = updated;
    } else {
      const node = placeNewNode(freshNode);
      merged.nodes.push(node);
      nodesById.set(node.id, node);
    }
  }

  for (const freshGroup of fresh.nodes.filter((node) => node.type === 'group')) {
    const memberKeys = blueprint.nodes
      .filter((node) => node.group && nodeIdForKey(groupKey(node.group)) === freshGroup.id)
      .map((node) => node.key);
    const memberNodes = memberKeys
      .map((key) => nodesById.get(freshMindmap.keyToId[key]))
      .filter(Boolean);
    const replacement = memberNodes.length > 0
      ? buildGroupNode(freshGroup.label, freshGroup.id, memberNodes, includeAdvanced)
      : freshGroup;
    const existing = nodesById.get(freshGroup.id);
    if (existing) {
      const updated = mergeObjectPreservingUnknown(existing, replacement, [
        'x', 'y', 'width', 'height', 'label', 'color', 'styleAttributes',
      ]);
      const index = merged.nodes.findIndex((node) => node.id === freshGroup.id);
      merged.nodes[index] = updated;
    } else {
      merged.nodes.unshift(replacement);
      nodesById.set(replacement.id, replacement);
    }
  }

  for (const freshEdge of fresh.edges) {
    const existing = edgesById.get(freshEdge.id);
    if (existing) {
      const updated = mergeObjectPreservingUnknown(existing, freshEdge, [
        'fromSide', 'toSide', 'fromEnd', 'toEnd', 'fromFloating', 'toFloating',
        'color', 'label', 'styleAttributes',
      ]);
      const index = merged.edges.findIndex((edge) => edge.id === freshEdge.id);
      merged.edges[index] = updated;
    } else {
      merged.edges.push(freshEdge);
      edgesById.set(freshEdge.id, freshEdge);
    }
  }

  mindmap.keyToId = {
    ...existingKeyToId,
    ...freshMindmap.keyToId,
  };
  mindmap.edgeKeyToId = {
    ...existingEdgeKeyToId,
    ...freshMindmap.edgeKeyToId,
  };
  mindmap.nodeRoles = {
    ...existingNodeRoles,
    ...freshMindmap.nodeRoles,
  };
  mindmap.nodeLabels = {
    ...existingNodeLabels,
    ...freshMindmap.nodeLabels,
  };

  return { ok: true, canvas: merged };
}

async function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temp, filePath);
  } catch (error) {
    try {
      await fs.unlink(temp);
    } catch {
      // Nothing to clean up.
    }
    throw error;
  }
}

async function backupCanvas(filePath) {
  const root = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const backupDir = path.join(root, 'mindmap-skill', 'backups');
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${path.basename(filePath)}.${stamp}.${process.pid}.bak`);
  await fs.copyFile(filePath, backupPath, fssync.constants.COPYFILE_EXCL);
  return backupPath;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    return fail(2, 'schema-error', error.message);
  }

  let blueprint;
  try {
    blueprint = await readJsonFile(args.input);
  } catch (error) {
    const category = error instanceof SyntaxError ? 'parse-error' : 'schema-error';
    return fail(2, category, `Unable to read blueprint: ${error.message}`);
  }

  const blueprintValidation = validateBlueprint(blueprint);
  if (!blueprintValidation.ok) {
    printJson({ ok: false, errors: blueprintValidation.errors, warnings: [] });
    return 1;
  }

  const outputPath = path.resolve(args.output);
  const includeAdvanced = await resolveAdvancedMode(args.advanced, outputPath);
  let canvas;
  let backupPath = null;

  if (args.mode === 'create') {
    try {
      await fs.access(outputPath);
      return fail(2, 'schema-error', `Refusing to overwrite existing output: ${outputPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        return fail(2, 'schema-error', `Unable to check output path: ${error.message}`);
      }
    }
    canvas = buildFreshCanvas(blueprint, includeAdvanced);
  } else {
    let existingCanvas;
    try {
      existingCanvas = await readJsonFile(outputPath);
    } catch (error) {
      const category = error instanceof SyntaxError ? 'parse-error' : 'schema-error';
      return fail(2, category, `Unable to read existing canvas for merge: ${error.message}`);
    }

    const existingValidation = validateCanvasObject(existingCanvas);
    if (existingValidation.errors.length > 0) {
      printJson({
        ok: false,
        errors: existingValidation.errors,
        warnings: existingValidation.warnings,
      });
      return 1;
    }

    const mergeResult = mergeCanvas(existingCanvas, blueprint, includeAdvanced);
    if (!mergeResult.ok) {
      printJson({ ok: false, errors: mergeResult.errors, warnings: [] });
      return 1;
    }
    canvas = mergeResult.canvas;
  }

  const finalValidation = validateCanvasObject(canvas);
  if (finalValidation.errors.length > 0) {
    printJson({
      ok: false,
      errors: finalValidation.errors,
      warnings: finalValidation.warnings,
    });
    return 1;
  }

  try {
    if (args.mode === 'merge') {
      backupPath = await backupCanvas(outputPath);
    }
    await atomicWriteJson(outputPath, canvas);
  } catch (error) {
    return fail(2, 'schema-error', `Unable to write output: ${error.message}`, '$', { backupPath });
  }

  printJson({
    ok: true,
    mode: args.mode,
    output: outputPath,
    advanced: includeAdvanced,
    backupPath,
    nodes: canvas.nodes.length,
    edges: canvas.edges.length,
    warnings: finalValidation.warnings,
  });
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      printJson({
        ok: false,
        errors: [issue('schema-error', error.message)],
        warnings: [],
      });
      process.exitCode = 2;
    });
}

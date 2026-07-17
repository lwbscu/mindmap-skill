#!/usr/bin/env node

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const NODE_TYPES = new Set(['text', 'file', 'link', 'group']);
const SIDES = new Set(['top', 'right', 'bottom', 'left']);
const ENDS = new Set(['none', 'arrow']);
const COLORS = new Set(['1', '2', '3', '4', '5', '6']);
const BACKGROUND_STYLES = new Set(['cover', 'ratio', 'repeat']);

const TOP_LEVEL_FIELDS = new Set(['nodes', 'edges', 'metadata', 'startNode']);
const NODE_FIELDS = new Set([
  'id',
  'type',
  'x',
  'y',
  'width',
  'height',
  'color',
  'text',
  'file',
  'subpath',
  'url',
  'label',
  'background',
  'backgroundStyle',
  'styleAttributes',
]);
const EDGE_FIELDS = new Set([
  'id',
  'fromNode',
  'fromSide',
  'fromEnd',
  'fromFloating',
  'toNode',
  'toSide',
  'toEnd',
  'toFloating',
  'color',
  'label',
  'styleAttributes',
]);

function issue(category, message, path, severity = 'error') {
  return { severity, category, message, path };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value) {
  return Number.isInteger(value);
}

function isCanvasColor(value) {
  const color = String(value);
  return COLORS.has(color) || /^#[0-9a-f]{3,8}$/i.test(color);
}

function rectOf(node) {
  return {
    left: node.x,
    top: node.y,
    right: node.x + node.width,
    bottom: node.y + node.height,
  };
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function contains(outer, inner) {
  return outer.left <= inner.left
    && outer.top <= inner.top
    && outer.right >= inner.right
    && outer.bottom >= inner.bottom;
}

function pushUnknownFieldWarnings(collection, allowed, basePath, warnings) {
  for (const key of Object.keys(collection)) {
    if (!allowed.has(key)) {
      warnings.push(issue(
        'plugin-enhancement-warning',
        `Non-standard or plugin extension field "${key}" is preserved but not part of the standard JSON Canvas core.`,
        `${basePath}.${key}`,
        'warning',
      ));
    }
  }
}

export function validateCanvasObject(canvas, options = {}) {
  const errors = [];
  const warnings = [];
  const strict = Boolean(options.strict);

  if (!isPlainObject(canvas)) {
    errors.push(issue('schema-error', 'Canvas root must be a JSON object.', '$'));
    return { ok: false, strict, errors, warnings };
  }

  pushUnknownFieldWarnings(canvas, TOP_LEVEL_FIELDS, '$', warnings);

  if (!Array.isArray(canvas.nodes)) {
    errors.push(issue('schema-error', 'Canvas must contain a nodes array.', '$.nodes'));
  }
  if (!Array.isArray(canvas.edges)) {
    errors.push(issue('schema-error', 'Canvas must contain an edges array.', '$.edges'));
  }
  if (errors.length > 0) {
    return { ok: false, strict, errors, warnings };
  }

  const nodeIds = new Set();
  const allIds = new Set();
  const textLikeNodes = [];
  const groupNodes = [];

  canvas.nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`;
    if (!isPlainObject(node)) {
      errors.push(issue('schema-error', 'Node must be an object.', path));
      return;
    }

    pushUnknownFieldWarnings(node, NODE_FIELDS, path, warnings);

    if (typeof node.id !== 'string' || node.id.length === 0) {
      errors.push(issue('schema-error', 'Node id must be a non-empty string.', `${path}.id`));
    } else {
      if (allIds.has(node.id)) {
        errors.push(issue('schema-error', `Duplicate global id "${node.id}".`, `${path}.id`));
      }
      allIds.add(node.id);
      nodeIds.add(node.id);
    }

    if (typeof node.type !== 'string' || !NODE_TYPES.has(node.type)) {
      errors.push(issue('schema-error', 'Node type must be one of text, file, link, group.', `${path}.type`));
    }

    for (const key of ['x', 'y', 'width', 'height']) {
      if (!isInteger(node[key])) {
        errors.push(issue('geometry-error', `Node ${key} must be an integer.`, `${path}.${key}`));
      }
    }
    if (isInteger(node.width) && node.width <= 0) {
      errors.push(issue('geometry-error', 'Node width must be positive.', `${path}.width`));
    }
    if (isInteger(node.height) && node.height <= 0) {
      errors.push(issue('geometry-error', 'Node height must be positive.', `${path}.height`));
    }

    if (node.color !== undefined && !isCanvasColor(node.color)) {
      errors.push(issue('schema-error', 'Node color must be a preset 1-6 or a hexadecimal color.', `${path}.color`));
    }
    if (node.styleAttributes !== undefined && !isPlainObject(node.styleAttributes)) {
      errors.push(issue('schema-error', 'Node styleAttributes must be an object when provided.', `${path}.styleAttributes`));
    }

    if (node.type === 'text') {
      if (typeof node.text !== 'string' || node.text.length === 0) {
        errors.push(issue('schema-error', 'Text nodes require a non-empty text field.', `${path}.text`));
      } else {
        textLikeNodes.push({ node, path });
      }
    } else if (node.type === 'file') {
      if (typeof node.file !== 'string' || node.file.length === 0) {
        errors.push(issue('schema-error', 'File nodes require a non-empty file field.', `${path}.file`));
      }
      if (node.subpath !== undefined && (typeof node.subpath !== 'string' || !node.subpath.startsWith('#'))) {
        errors.push(issue('schema-error', 'File node subpath must be a string beginning with #.', `${path}.subpath`));
      }
    } else if (node.type === 'link') {
      if (typeof node.url !== 'string' || node.url.length === 0) {
        errors.push(issue('schema-error', 'Link nodes require a non-empty url field.', `${path}.url`));
      }
    } else if (node.type === 'group') {
      if (node.label !== undefined && typeof node.label !== 'string') {
        errors.push(issue('schema-error', 'Group node label must be a string when provided.', `${path}.label`));
      }
      if (node.background !== undefined && (typeof node.background !== 'string' || node.background.length === 0)) {
        errors.push(issue('schema-error', 'Group node background must be a non-empty string when provided.', `${path}.background`));
      }
      if (node.backgroundStyle !== undefined && !BACKGROUND_STYLES.has(node.backgroundStyle)) {
        errors.push(issue('schema-error', 'Group node backgroundStyle must be cover, ratio, or repeat.', `${path}.backgroundStyle`));
      }
      groupNodes.push({ node, path });
    }
  });

  const incidentNodeIds = new Set();
  canvas.edges.forEach((edge, index) => {
    const path = `$.edges[${index}]`;
    if (!isPlainObject(edge)) {
      errors.push(issue('schema-error', 'Edge must be an object.', path));
      return;
    }

    pushUnknownFieldWarnings(edge, EDGE_FIELDS, path, warnings);

    if (typeof edge.id !== 'string' || edge.id.length === 0) {
      errors.push(issue('schema-error', 'Edge id must be a non-empty string.', `${path}.id`));
    } else {
      if (allIds.has(edge.id)) {
        errors.push(issue('schema-error', `Duplicate global id "${edge.id}".`, `${path}.id`));
      }
      allIds.add(edge.id);
    }

    for (const [key, enumSet, label] of [
      ['fromSide', SIDES, 'side'],
      ['toSide', SIDES, 'side'],
      ['fromEnd', ENDS, 'end'],
      ['toEnd', ENDS, 'end'],
    ]) {
      if (edge[key] !== undefined && !enumSet.has(edge[key])) {
        errors.push(issue('schema-error', `Edge ${key} has an invalid ${label} enum value.`, `${path}.${key}`));
      }
    }
    for (const key of ['fromFloating', 'toFloating']) {
      if (edge[key] !== undefined && typeof edge[key] !== 'boolean') {
        errors.push(issue('schema-error', `Edge ${key} must be a boolean when provided.`, `${path}.${key}`));
      }
    }

    if (edge.color !== undefined && !isCanvasColor(edge.color)) {
      errors.push(issue('schema-error', 'Edge color must be a preset 1-6 or a hexadecimal color.', `${path}.color`));
    }
    if (edge.styleAttributes !== undefined && !isPlainObject(edge.styleAttributes)) {
      errors.push(issue('schema-error', 'Edge styleAttributes must be an object when provided.', `${path}.styleAttributes`));
    }

    if (typeof edge.fromNode !== 'string' || !nodeIds.has(edge.fromNode)) {
      errors.push(issue('reference-error', 'Edge fromNode must reference an existing node id.', `${path}.fromNode`));
    } else {
      incidentNodeIds.add(edge.fromNode);
    }

    if (typeof edge.toNode !== 'string' || !nodeIds.has(edge.toNode)) {
      errors.push(issue('reference-error', 'Edge toNode must reference an existing node id.', `${path}.toNode`));
    } else {
      incidentNodeIds.add(edge.toNode);
    }
  });

  if (canvas.startNode !== undefined && (typeof canvas.startNode !== 'string' || !nodeIds.has(canvas.startNode))) {
    errors.push(issue('reference-error', 'startNode must reference an existing node id.', '$.startNode'));
  }
  if (isPlainObject(canvas.metadata) && canvas.metadata.startNode !== undefined
    && (typeof canvas.metadata.startNode !== 'string' || !nodeIds.has(canvas.metadata.startNode))) {
    errors.push(issue('reference-error', 'metadata.startNode must reference an existing node id.', '$.metadata.startNode'));
  }

  if (errors.length === 0) {
    const normalNodes = canvas.nodes
      .map((node, index) => ({ node, path: `$.nodes[${index}]` }))
      .filter(({ node }) => node.type !== 'group');

    for (let i = 0; i < normalNodes.length; i += 1) {
      for (let j = i + 1; j < normalNodes.length; j += 1) {
        if (intersects(rectOf(normalNodes[i].node), rectOf(normalNodes[j].node))) {
          warnings.push(issue(
            'semantic-error',
            `Node "${normalNodes[i].node.id}" overlaps node "${normalNodes[j].node.id}".`,
            normalNodes[j].path,
            'warning',
          ));
        }
      }
    }

    for (const { node, path } of normalNodes) {
      if (!incidentNodeIds.has(node.id)) {
        warnings.push(issue('semantic-error', `Node "${node.id}" is orphaned.`, path, 'warning'));
      }
    }

    for (const { node: group, path: groupPath } of groupNodes) {
      const groupRect = rectOf(group);
      let contained = 0;
      for (const { node, path } of normalNodes) {
        const nodeRect = rectOf(node);
        if (contains(groupRect, nodeRect)) {
          contained += 1;
        } else if (intersects(groupRect, nodeRect)) {
          warnings.push(issue(
            'semantic-error',
            `Group "${group.id}" intersects but does not contain node "${node.id}".`,
            path,
            'warning',
          ));
        }
      }
      if (contained === 0) {
        warnings.push(issue('semantic-error', `Group "${group.id}" contains no nodes.`, groupPath, 'warning'));
      }
    }

    for (const { node, path } of textLikeNodes) {
      const trimmed = node.text.trim();
      if (trimmed.length > 0 && trimmed.length < 2) {
        warnings.push(issue('semantic-error', 'Text node content is too short to be semantically clear.', `${path}.text`, 'warning'));
      }
    }
  }

  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  return { ok, strict, errors, warnings };
}

export async function validateCanvasFile(filePath, options = {}) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      strict: Boolean(options.strict),
      errors: [issue('schema-error', `Unable to read input file: ${error.message}`, '$')],
      warnings: [],
      cliError: true,
    };
  }

  let canvas;
  try {
    canvas = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      strict: Boolean(options.strict),
      errors: [issue('parse-error', `Invalid JSON: ${error.message}`, '$')],
      warnings: [],
    };
  }

  return validateCanvasObject(canvas, options);
}

function printJson(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main(argv) {
  const args = [...argv];
  const strictIndex = args.indexOf('--strict');
  const strict = strictIndex !== -1;
  if (strict) {
    args.splice(strictIndex, 1);
  }

  if (args.length !== 1 || args[0] === '-h' || args[0] === '--help') {
    printJson({
      ok: false,
      strict,
      errors: [issue('schema-error', 'Usage: node validate-canvas.mjs <file.canvas> [--strict]', '$')],
      warnings: [],
    });
    return 2;
  }

  const result = await validateCanvasFile(args[0], { strict });
  printJson(result);
  if (result.cliError) {
    return 2;
  }
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      printJson({
        ok: false,
        strict: false,
        errors: [issue('schema-error', error.message, '$')],
        warnings: [],
      });
      process.exitCode = 2;
    });
}

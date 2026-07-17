#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const SKILL_DIR = path.dirname(SCRIPT_DIR);
const BUILD = path.join(SCRIPT_DIR, 'build-canvas.mjs');
const VALIDATE = path.join(SCRIPT_DIR, 'validate-canvas.mjs');
const ENSURE_ADVANCED = path.join(SCRIPT_DIR, 'ensure-advanced-canvas.mjs');
const FIXTURES = path.join(SCRIPT_DIR, 'fixtures');
const RELEASE_FIXTURE = path.join(FIXTURES, 'advanced-canvas-release');
const SKILL_DOC = path.join(SKILL_DIR, 'SKILL.md');
const CONTRACT_DOC = path.join(SKILL_DIR, 'references', 'obsidian-canvas-contract.md');
const OPENAI_AGENT = path.join(SKILL_DIR, 'agents', 'openai.yaml');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function runNode(script, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        cwd: SCRIPT_DIR,
        env: { ...process.env, ...options.env },
        maxBuffer: 1024 * 1024 * 8,
      },
      (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          stdout,
          stderr,
          signal: error?.signal,
        });
      },
    );
  });
}

function parseJsonOutput(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Expected JSON stdout, got:\n${result.stdout}\nSTDERR:\n${result.stderr}\n${error.message}`);
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function normalizeReport(report) {
  const clone = { ...report };
  delete clone.output;
  delete clone.backupPath;
  return clone;
}

function normalizeCanvas(canvas) {
  const stable = (value) => {
    if (Array.isArray(value)) {
      return value.map(stable);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    }
    return value;
  };
  return JSON.stringify(stable(canvas), null, 2);
}

function rect(node) {
  return {
    left: node.x,
    top: node.y,
    right: node.x + node.width,
    bottom: node.y + node.height,
  };
}

function overlaps(a, b) {
  const ar = rect(a);
  const br = rect(b);
  return ar.left < br.right && ar.right > br.left && ar.top < br.bottom && ar.bottom > br.top;
}

function maxRight(canvas) {
  return Math.max(...canvas.nodes.map((node) => node.x + node.width));
}

function modelBlueprint(extra = {}) {
  return {
    schemaVersion: '1.0',
    title: 'Model Architecture',
    language: 'en',
    nodes: [
      { key: 'input', label: 'Input', role: 'data', group: 'Data', rank: 0, lane: 0 },
      { key: 'encoder', label: 'Encoder', role: 'model', group: 'Model', rank: 1, lane: 0 },
      { key: 'latent', label: 'Latent', role: 'data', group: 'Model', rank: 2, lane: 0 },
      { key: 'decoder', label: 'Decoder', role: 'model', group: 'Model', rank: 3, lane: 0 },
      { key: 'output', label: 'Output', role: 'data', group: 'Data', rank: 4, lane: 0 },
      { key: 'loss', label: 'Loss', role: 'process', group: 'Training', rank: 4, lane: 1 },
      { key: 'optimizer', label: 'Optimizer', role: 'process', group: 'Training', rank: 3, lane: 1 },
      { key: 'training-feedback', label: 'Training Feedback', role: 'process', group: 'Training', rank: 2, lane: 1 },
      ...(extra.nodes ?? []),
    ],
    edges: [
      { from: 'input', to: 'encoder', relation: 'transforms' },
      { from: 'encoder', to: 'latent', relation: 'transforms' },
      { from: 'latent', to: 'decoder', relation: 'transforms' },
      { from: 'decoder', to: 'output', relation: 'transforms' },
      { from: 'output', to: 'loss', relation: 'evaluates' },
      { from: 'loss', to: 'optimizer', relation: 'trains' },
      { from: 'optimizer', to: 'training-feedback', relation: 'updates' },
      { from: 'training-feedback', to: 'encoder', relation: 'feedback', feedback: true },
      { from: 'training-feedback', to: 'decoder', relation: 'feedback', feedback: true },
      ...(extra.edges ?? []),
    ],
  };
}

async function buildCanvas(tmp, name, blueprint, mode = 'create', advanced = 'off', env = {}) {
  const input = path.join(tmp, `${name}.blueprint.json`);
  const output = path.join(tmp, `${name}.canvas`);
  await writeJson(input, blueprint);
  const result = await runNode(BUILD, ['--input', input, '--output', output, '--mode', mode, '--advanced', advanced], { env });
  return { input, output, result, report: parseJsonOutput(result) };
}

async function makeVault(tmp, name) {
  const vault = path.join(tmp, name);
  await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
  return vault;
}

async function copyReleaseIntoPlugin(vault) {
  const pluginDir = path.join(vault, '.obsidian', 'plugins', 'advanced-canvas');
  await fs.mkdir(pluginDir, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) {
    await fs.copyFile(path.join(RELEASE_FIXTURE, file), path.join(pluginDir, file));
  }
  return pluginDir;
}

test('create model architecture is deterministic across output paths', async (tmp) => {
  const first = await buildCanvas(path.join(tmp, 'a'), 'model', modelBlueprint());
  const second = await buildCanvas(path.join(tmp, 'b'), 'model', modelBlueprint());

  assert.equal(first.result.code, 0, first.result.stdout);
  assert.equal(second.result.code, 0, second.result.stdout);
  assert.deepEqual(normalizeReport(first.report), normalizeReport(second.report));

  const firstCanvas = await readJson(first.output);
  const secondCanvas = await readJson(second.output);
  assert.equal(normalizeCanvas(firstCanvas), normalizeCanvas(secondCanvas));

  const labels = new Set(firstCanvas.nodes.filter((node) => node.type === 'text').map((node) => node.text.split('\n')[0]));
  for (const label of ['Input', 'Encoder', 'Latent', 'Decoder', 'Output', 'Loss', 'Optimizer', 'Training Feedback']) {
    assert.ok(labels.has(label), `missing model node ${label}`);
  }
});

test('default feedback layout and role styles stay readable without layout hints', async (tmp) => {
  const blueprint = {
    schemaVersion: '1.0',
    nodes: [
      { key: 'input', label: 'Input', role: 'data' },
      { key: 'encoder', label: 'Encoder', role: 'model' },
      { key: 'output', label: 'Output', role: 'output' },
      { key: 'loss', label: 'Loss', role: 'loss' },
      { key: 'optimizer', label: 'Optimizer', role: 'optimizer' },
    ],
    edges: [
      { from: 'input', to: 'encoder', relation: 'transforms' },
      { from: 'encoder', to: 'output', relation: 'transforms' },
      { from: 'output', to: 'loss', relation: 'evaluates', feedback: true },
      { from: 'loss', to: 'optimizer', relation: 'feedback', feedback: true },
      { from: 'optimizer', to: 'encoder', relation: 'feedback', feedback: true },
    ],
  };
  const created = await buildCanvas(tmp, 'feedback-defaults', blueprint, 'create', 'on');
  assert.equal(created.result.code, 0, created.result.stdout);
  const canvas = await readJson(created.output);
  const ids = canvas.metadata.mindmap.keyToId;
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]));
  const output = byId.get(ids.output);
  const loss = byId.get(ids.loss);
  const optimizer = byId.get(ids.optimizer);
  assert.ok(loss.x >= output.x, 'loss should stay near the output rank');
  assert.ok(loss.y > output.y, 'loss should be below the forward path');
  assert.ok(optimizer.y > output.y, 'optimizer should be below the forward path');
  assert.equal(byId.get(ids.input).styleAttributes.shape, 'database');
  assert.equal(byId.get(ids.encoder).styleAttributes.shape, 'predefined-process');
  const feedbackEdge = canvas.edges.find((edge) => edge.fromNode === ids.output && edge.toNode === ids.loss);
  assert.equal(feedbackEdge.styleAttributes.path, 'long-dashed');
  assert.equal(feedbackEdge.styleAttributes.pathfindingMethod, 'square');
});

test('create Chinese architecture with external, unknown, feedback loop, and 40 non-overlapping nodes', async (tmp) => {
  const nodes = Array.from({ length: 40 }, (_, index) => ({
    key: `node-${index}`,
    label: index === 0 ? '输入' : index === 38 ? '外部系统' : index === 39 ? '待确认模块' : `模块 ${index}`,
    role: index === 38 ? 'external' : index === 39 ? 'unknown' : 'module',
    details: index === 39 ? '待确认：运行边界未知' : undefined,
    uncertain: index === 39,
    group: index < 20 ? '核心链路' : '训练与反馈',
    rank: Math.floor(index / 5),
    lane: index % 5,
  }));
  const edges = Array.from({ length: 39 }, (_, index) => ({
    from: `node-${index}`,
    to: `node-${index + 1}`,
    relation: index === 37 ? 'depends_on' : 'transforms',
  }));
  edges.push({ from: 'node-39', to: 'node-3', relation: 'feedback', label: '反馈闭环', feedback: true });

  const created = await buildCanvas(tmp, 'zh-architecture', {
    schemaVersion: '1.0',
    title: '中文模型架构',
    language: 'zh-CN',
    nodes,
    edges,
  });
  assert.equal(created.result.code, 0, created.result.stdout);

  const canvas = await readJson(created.output);
  const normalNodes = canvas.nodes.filter((node) => node.type !== 'group');
  for (let i = 0; i < normalNodes.length; i += 1) {
    for (let j = i + 1; j < normalNodes.length; j += 1) {
      assert.equal(overlaps(normalNodes[i], normalNodes[j]), false, `${normalNodes[i].id} overlaps ${normalNodes[j].id}`);
    }
  }
  const ids = new Set(canvas.nodes.map((node) => node.id));
  for (const edge of canvas.edges) {
    assert.ok(ids.has(edge.fromNode), `edge ${edge.id} fromNode is dangling`);
    assert.ok(ids.has(edge.toNode), `edge ${edge.id} toNode is dangling`);
  }
});

async function prepareMergeCase(tmp, advanced = 'off') {
  const created = await buildCanvas(tmp, 'merge-base', modelBlueprint(), 'create', advanced);
  assert.equal(created.result.code, 0, created.result.stdout);
  const canvas = await readJson(created.output);
  const inputNode = canvas.nodes.find((node) => node.text?.startsWith('Input'));
  assert.ok(inputNode, 'base input node missing');
  inputNode.x = 1234;
  inputNode.y = 567;
  inputNode.text = 'Input\nHuman-authored details';
  inputNode.color = '#123456';
  inputNode.manualNote = 'preserve me';
  inputNode.styleAttributes = { backgroundColor: '#ffffff', borderStyle: 'dotted', custom: 'manual' };
  const firstEdge = canvas.edges[0];
  firstEdge.label = 'human edge label';
  firstEdge.color = '#654321';
  firstEdge.fromSide = 'bottom';
  firstEdge.styleAttributes = { path: 'long-dashed', pathfindingMethod: 'square' };
  const firstGroup = canvas.nodes.find((node) => node.type === 'group');
  firstGroup.label = `${firstGroup.label} (curated)`;
  firstGroup.color = '#abcdef';
  firstGroup.styleAttributes = { border: 'dashed' };
  canvas.nodes.push({
    id: 'manual-node',
    type: 'text',
    x: 9000,
    y: 100,
    width: 280,
    height: 120,
    text: 'Manual Node',
    styleAttributes: { backgroundColor: '#ffeeaa' },
    customManualField: true,
  });
  canvas.metadata.owner = 'human';
  canvas.metadata.extra = { keep: true };
  canvas.unknownTopLevel = { keep: true };
  await writeJson(created.output, canvas);
  return {
    output: created.output,
    before: canvas,
    inputNodeId: inputNode.id,
    firstEdgeId: firstEdge.id,
    firstGroupId: firstGroup.id,
  };
}

test('merge preserves manual node, coordinates, unknown fields, metadata, and styleAttributes', async (tmp) => {
  const prepared = await prepareMergeCase(tmp, 'on');
  const blueprint = modelBlueprint({
    nodes: [{ key: 'calibrator', label: 'Calibrator', role: 'process', group: 'Training', rank: 5, lane: 2 }],
    edges: [{ from: 'output', to: 'calibrator', relation: 'evaluates' }],
  });
  const input = path.join(tmp, 'merge.blueprint.json');
  await writeJson(input, blueprint);
  const cache = path.join(tmp, 'cache');
  const result = await runNode(BUILD, ['--input', input, '--output', prepared.output, '--mode', 'merge', '--advanced', 'on'], {
    env: { XDG_CACHE_HOME: cache },
  });
  const report = parseJsonOutput(result);
  assert.equal(result.code, 0, result.stdout);
  assert.ok(report.backupPath, 'merge did not report a backup path');
  await fs.stat(report.backupPath);

  const merged = await readJson(prepared.output);
  assert.ok(merged.nodes.some((node) => node.id === 'manual-node'), 'manual node was dropped');
  assert.deepEqual(merged.metadata.extra, { keep: true });
  assert.equal(merged.metadata.owner, 'human');
  assert.deepEqual(merged.unknownTopLevel, { keep: true });

  const inputNode = merged.nodes.find((node) => node.id === prepared.inputNodeId);
  assert.equal(inputNode.x, 1234);
  assert.equal(inputNode.y, 567);
  assert.equal(inputNode.text, 'Input\nHuman-authored details');
  assert.equal(inputNode.color, '#123456');
  assert.equal(inputNode.manualNote, 'preserve me');
  assert.deepEqual(inputNode.styleAttributes, { backgroundColor: '#ffffff', borderStyle: 'dotted', custom: 'manual' });
  const firstEdge = merged.edges.find((edge) => edge.id === prepared.firstEdgeId);
  assert.equal(firstEdge.label, 'human edge label');
  assert.equal(firstEdge.color, '#654321');
  assert.equal(firstEdge.fromSide, 'bottom');
  assert.deepEqual(firstEdge.styleAttributes, { path: 'long-dashed', pathfindingMethod: 'square' });
  const firstGroup = merged.nodes.find((node) => node.id === prepared.firstGroupId);
  assert.match(firstGroup.label, /\(curated\)$/);
  assert.equal(firstGroup.color, '#abcdef');
  assert.deepEqual(firstGroup.styleAttributes, { border: 'dashed' });
});

test('merge adds new content to the right and is idempotent', async (tmp) => {
  const prepared = await prepareMergeCase(tmp, 'off');
  const beforeRight = maxRight(prepared.before);
  const blueprint = modelBlueprint({
    nodes: [{ key: 'calibrator', label: 'Calibrator', role: 'process', group: 'Training', rank: 5, lane: 2 }],
    edges: [{ from: 'output', to: 'calibrator', relation: 'evaluates' }],
  });
  const input = path.join(tmp, 'merge-idempotent.blueprint.json');
  await writeJson(input, blueprint);
  const env = { XDG_CACHE_HOME: path.join(tmp, 'cache') };
  const first = await runNode(BUILD, ['--input', input, '--output', prepared.output, '--mode', 'merge', '--advanced', 'off'], { env });
  assert.equal(first.code, 0, first.stdout);
  const afterFirst = await fs.readFile(prepared.output, 'utf8');
  const merged = JSON.parse(afterFirst);
  const newNodeId = merged.metadata.mindmap.keyToId.calibrator;
  const newNode = merged.nodes.find((node) => node.id === newNodeId);
  assert.ok(newNode, 'new node missing after merge');
  assert.ok(newNode.x > beforeRight, `new node x=${newNode.x} is not right of ${beforeRight}`);

  const second = await runNode(BUILD, ['--input', input, '--output', prepared.output, '--mode', 'merge', '--advanced', 'off'], { env });
  assert.equal(second.code, 0, second.stdout);
  const afterSecond = await fs.readFile(prepared.output, 'utf8');
  assert.equal(afterSecond, afterFirst, 'merge output changed on second run');
});

test('merge rejects metadata keyToId conflicts', async (tmp) => {
  const created = await buildCanvas(tmp, 'conflict-base', modelBlueprint());
  assert.equal(created.result.code, 0, created.result.stdout);
  const canvas = await readJson(created.output);
  canvas.metadata.mindmap.keyToId.input = 'conflicting-id';
  await writeJson(created.output, canvas);
  const input = path.join(tmp, 'conflict.blueprint.json');
  await writeJson(input, modelBlueprint());
  const result = await runNode(BUILD, ['--input', input, '--output', created.output, '--mode', 'merge', '--advanced', 'off']);
  const report = parseJsonOutput(result);
  assert.notEqual(result.code, 0, 'conflicting merge unexpectedly succeeded');
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.message.includes('metadata maps "input"')), JSON.stringify(report.errors));
});

test('merge rejects semantic label changes for an existing key', async (tmp) => {
  const created = await buildCanvas(tmp, 'label-conflict-base', modelBlueprint());
  assert.equal(created.result.code, 0, created.result.stdout);
  const changed = modelBlueprint();
  changed.nodes = changed.nodes.map((node) =>
    node.key === 'encoder' ? { ...node, label: 'Renamed Encoder' } : node,
  );
  const input = path.join(tmp, 'label-conflict.blueprint.json');
  await writeJson(input, changed);
  const result = await runNode(BUILD, ['--input', input, '--output', created.output, '--mode', 'merge', '--advanced', 'off']);
  const report = parseJsonOutput(result);
  assert.notEqual(result.code, 0, 'label-conflicting merge unexpectedly succeeded');
  assert.ok(
    report.errors.some((error) => error.message.includes('changed label from "Encoder" to "Renamed Encoder"')),
    JSON.stringify(report.errors),
  );
});

test('merge rejects occupied deterministic IDs when MindMap metadata is absent', async (tmp) => {
  const blueprint = {
    schemaVersion: '1.0',
    nodes: [{ key: 'occupied', label: 'Generated Unit', role: 'module' }],
    edges: [],
  };
  const generated = await buildCanvas(path.join(tmp, 'generated'), 'generated', blueprint);
  assert.equal(generated.result.code, 0, generated.result.stdout);
  const generatedCanvas = await readJson(generated.output);
  const occupiedId = generatedCanvas.metadata.mindmap.keyToId.occupied;
  const target = path.join(tmp, 'manual.canvas');
  await writeJson(target, {
    nodes: [{ id: occupiedId, type: 'text', x: 0, y: 0, width: 200, height: 100, text: 'Manual node' }],
    edges: [],
  });
  const input = path.join(tmp, 'occupied.blueprint.json');
  await writeJson(input, blueprint);
  const result = await runNode(BUILD, ['--input', input, '--output', target, '--mode', 'merge', '--advanced', 'off']);
  const report = parseJsonOutput(result);
  assert.notEqual(result.code, 0, 'merge unexpectedly overwrote an untracked manual node');
  assert.match(JSON.stringify(report.errors), /occupied by an existing object/);
  assert.equal((await readJson(target)).nodes[0].text, 'Manual node');
});

test('create refuses to overwrite an existing canvas', async (tmp) => {
  const created = await buildCanvas(tmp, 'no-overwrite', modelBlueprint());
  assert.equal(created.result.code, 0, created.result.stdout);
  const before = await fs.readFile(created.output, 'utf8');
  const input = path.join(tmp, 'no-overwrite.blueprint.json');
  await writeJson(input, modelBlueprint());
  const result = await runNode(BUILD, ['--input', input, '--output', created.output, '--mode', 'create', '--advanced', 'off']);
  const report = parseJsonOutput(result);
  assert.notEqual(result.code, 0, 'create unexpectedly overwrote existing file');
  assert.equal(report.ok, false);
  assert.match(JSON.stringify(report.errors), /Refusing to overwrite/);
  assert.equal(await fs.readFile(created.output, 'utf8'), before);
});

test('validator rejects duplicate global IDs, dangling edges, bad JSON, invalid enums, invalid top-level, and metadata.startNode', async (tmp) => {
  const duplicate = path.join(tmp, 'duplicate.canvas');
  await writeJson(duplicate, {
    nodes: [{ id: 'same', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
    edges: [{ id: 'same', fromNode: 'same', toNode: 'same', fromSide: 'right', toSide: 'left', toEnd: 'arrow' }],
  });
  assert.notEqual((await runNode(VALIDATE, [duplicate])).code, 0);

  const dangling = path.join(tmp, 'dangling.canvas');
  await writeJson(dangling, {
    nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
    edges: [{ id: 'e', fromNode: 'a', toNode: 'missing', fromSide: 'right', toSide: 'left', toEnd: 'arrow' }],
  });
  assert.notEqual((await runNode(VALIDATE, [dangling])).code, 0);

  const badJson = path.join(tmp, 'bad.canvas');
  await fs.writeFile(badJson, '{not-json', 'utf8');
  assert.notEqual((await runNode(VALIDATE, [badJson])).code, 0);

  const invalidEnums = path.join(tmp, 'invalid-enums.canvas');
  await writeJson(invalidEnums, {
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A', color: '9' },
      { id: 'b', type: 'text', x: 200, y: 0, width: 100, height: 80, text: 'B' },
    ],
    edges: [{ id: 'e', fromNode: 'a', toNode: 'b', fromSide: 'diagonal', fromEnd: 'dot', toEnd: 'circle', color: 'bad' }],
  });
  assert.notEqual((await runNode(VALIDATE, [invalidEnums])).code, 0);

  const invalidTop = path.join(tmp, 'invalid-top.canvas');
  await writeJson(invalidTop, {
    nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
    edges: [],
    unexpectedTopLevel: true,
  });
  assert.notEqual((await runNode(VALIDATE, [invalidTop, '--strict'])).code, 0);

  const invalidMetadataStartNode = path.join(tmp, 'invalid-metadata-start.canvas');
  await writeJson(invalidMetadataStartNode, {
    nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'A' }],
    edges: [],
    metadata: { startNode: 'missing' },
  });
  assert.notEqual((await runNode(VALIDATE, [invalidMetadataStartNode])).code, 0, 'metadata.startNode should be rejected when it points at a missing node');
});

test('validator accepts standard hex colors, optional group label, file subpath, group background, and backgroundStyle', async (tmp) => {
  const standard = path.join(tmp, 'standard.canvas');
  await writeJson(standard, {
    nodes: [
      { id: 'text', type: 'text', x: 0, y: 0, width: 100, height: 80, text: 'Text', color: '#ff00aa' },
      { id: 'file', type: 'file', x: 200, y: 0, width: 100, height: 80, file: 'Doc.md', subpath: '#Heading' },
      { id: 'group-no-label', type: 'group', x: -20, y: -20, width: 360, height: 140, background: '#ffffff', backgroundStyle: 'cover' },
    ],
    edges: [{ id: 'edge', fromNode: 'text', toNode: 'file', fromSide: 'right', toSide: 'left', toEnd: 'arrow', color: '#00ffaa' }],
  });
  const result = await runNode(VALIDATE, [standard, '--strict']);
  const report = parseJsonOutput(result);
  assert.equal(result.code, 0, JSON.stringify(report, null, 2));
  assert.equal(report.ok, true);
});

test('advanced on known styleAttributes pass final strict validation; unknown extensions only warn non-strict', async (tmp) => {
  const blueprint = modelBlueprint({
    nodes: [
      {
        key: 'styled',
        label: 'Styled Node',
        role: 'module',
        rank: 5,
        lane: 3,
        styleAttributes: { backgroundColor: '#ffffff', borderStyle: 'solid', borderWidth: '2px' },
      },
    ],
    edges: [{ from: 'output', to: 'styled', relation: 'routes', styleAttributes: { strokeStyle: 'dashed', strokeWidth: 2 } }],
  });
  const created = await buildCanvas(tmp, 'advanced-style', blueprint, 'create', 'on');
  assert.equal(created.result.code, 0, created.result.stdout);

  const canvas = await readJson(created.output);
  canvas.edges[0].toFloating = false;
  canvas.edges[0].fromFloating = true;
  await writeJson(created.output, canvas);
  const strict = await runNode(VALIDATE, [created.output, '--strict']);
  assert.equal(strict.code, 0, strict.stdout);

  canvas.nodes.find((node) => node.text?.startsWith('Styled Node')).unknownAdvancedExtension = true;
  await writeJson(created.output, canvas);
  const nonStrict = parseJsonOutput(await runNode(VALIDATE, [created.output]));
  assert.equal(nonStrict.ok, true);
  assert.ok(nonStrict.warnings.some((warning) => warning.path.includes('unknownAdvancedExtension')));
});

test('temporary vault plugin install, idempotency, templates, check mode, degradation, and community plugins', async (tmp) => {
  const checkVault = await makeVault(tmp, 'check-vault');
  const checkCommunity = path.join(checkVault, '.obsidian', 'community-plugins.json');
  await writeJson(checkCommunity, ['calendar']);
  const beforeCheck = await fs.readdir(path.join(checkVault, '.obsidian'));
  const check = parseJsonOutput(await runNode(ENSURE_ADVANCED, ['--vault', checkVault, '--check']));
  assert.equal(check.status, 'needs_action');
  assert.deepEqual(await readJson(checkCommunity), ['calendar']);
  assert.deepEqual(await fs.readdir(path.join(checkVault, '.obsidian')), beforeCheck, '--check wrote files');

  const installVault = await makeVault(tmp, 'install-vault');
  await writeJson(path.join(installVault, '.obsidian', 'community-plugins.json'), ['calendar']);
  const firstInstall = parseJsonOutput(await runNode(ENSURE_ADVANCED, ['--vault', installVault, '--source-dir', RELEASE_FIXTURE]));
  assert.equal(firstInstall.status, 'ok');
  assert.equal(firstInstall.installed, true);
  assert.equal(firstInstall.enabled, true);
  assert.equal(firstInstall.templatesAdded, 9);
  assert.deepEqual(await readJson(path.join(installVault, '.obsidian', 'community-plugins.json')), ['calendar', 'advanced-canvas']);

  const dataPath = path.join(installVault, '.obsidian', 'plugins', 'advanced-canvas', 'data.json');
  const afterFirstData = await fs.readFile(dataPath, 'utf8');
  const secondInstall = parseJsonOutput(await runNode(ENSURE_ADVANCED, ['--vault', installVault, '--source-dir', RELEASE_FIXTURE]));
  assert.equal(secondInstall.status, 'ok');
  assert.equal(secondInstall.templatesAdded, 0);
  assert.equal(await fs.readFile(dataPath, 'utf8'), afterFirstData);
  const installPluginEntries = await fs.readdir(path.dirname(dataPath));
  assert.equal(installPluginEntries.some((entry) => entry.includes('.bak-') || entry.includes('.tmp-')), false);
  const installPluginDirs = await fs.readdir(path.join(installVault, '.obsidian', 'plugins'));
  assert.equal(installPluginDirs.some((entry) => entry.startsWith('advanced-canvas.backup-')), false);

  const legacyVault = await makeVault(tmp, 'legacy-vault');
  await writeJson(path.join(legacyVault, '.obsidian', 'community-plugins.json'), ['calendar']);
  const legacyPlugin = await copyReleaseIntoPlugin(legacyVault);
  await writeJson(path.join(legacyPlugin, 'data.json'), {
    nodeTemplates: [{ label: 'Existing Node Template', type: 'text', width: 100, height: 80 }],
    templates: [{ label: 'Legacy Template', type: 'text', width: 100, height: 80 }],
    otherKey: { keep: true },
  });
  const legacy = parseJsonOutput(await runNode(ENSURE_ADVANCED, ['--vault', legacyVault, '--source-dir', RELEASE_FIXTURE]));
  assert.equal(legacy.status, 'ok');
  const legacyData = await readJson(path.join(legacyPlugin, 'data.json'));
  assert.ok(Array.isArray(legacyData.nodeTemplates));
  assert.ok(Array.isArray(legacyData.templates), 'legacy templates key should remain present');
  assert.ok(legacyData.nodeTemplates.some((template) => template.label === 'Existing Node Template'));
  assert.ok(legacyData.nodeTemplates.some((template) => template.label === 'Legacy Template'));
  assert.ok(legacyData.nodeTemplates.some((template) => template.label === 'MindMap · Model'));
  assert.deepEqual(legacyData.otherKey, { keep: true });

  const recoveryVault = await makeVault(tmp, 'recovery-vault');
  await writeJson(path.join(recoveryVault, '.obsidian', 'community-plugins.json'), []);
  const interruptedPlugin = await copyReleaseIntoPlugin(recoveryVault);
  await writeJson(path.join(interruptedPlugin, 'data.json'), { nodeTemplates: [] });
  const interruptedBackup = `${interruptedPlugin}.backup-100`;
  await fs.rename(interruptedPlugin, interruptedBackup);
  const recovered = parseJsonOutput(await runNode(ENSURE_ADVANCED, ['--vault', recoveryVault, '--source-dir', RELEASE_FIXTURE]));
  assert.equal(recovered.status, 'ok');
  await fs.stat(interruptedPlugin);
  await assert.rejects(fs.stat(interruptedBackup));

  const degradedVault = await makeVault(tmp, 'degraded-vault');
  const badRelease = path.join(tmp, 'bad-release');
  await fs.mkdir(badRelease, { recursive: true });
  await fs.writeFile(path.join(badRelease, 'manifest.json'), '{"id":"advanced-canvas","version":"6.5.0"}\n', 'utf8');
  const degraded = parseJsonOutput(await runNode(ENSURE_ADVANCED, ['--vault', degradedVault, '--source-dir', badRelease]));
  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.degraded, true);
  const obsidianEntries = await fs.readdir(path.join(degradedVault, '.obsidian'));
  assert.equal(obsidianEntries.some((entry) => entry.startsWith('.advanced-canvas-install-')), false);
  await assert.rejects(fs.stat(path.join(degradedVault, '.obsidian', 'plugins', 'advanced-canvas')));
});

test('plugin network policy pins version, release URL, hashes, and official hosts', async (tmp) => {
  const unpinnedVault = await makeVault(tmp, 'unpinned-vault');
  const unpinned = parseJsonOutput(await runNode(ENSURE_ADVANCED, ['--vault', unpinnedVault, '--version', '6.5.1']));
  assert.equal(unpinned.status, 'degraded');
  assert.match(unpinned.warnings.join('\n'), /not allowed for unpinned Advanced Canvas version 6\.5\.1/);

  const source = await fs.readFile(ENSURE_ADVANCED, 'utf8');
  assert.match(source, /releases\/download\/\$\{version\}\/\$\{fileName\}/);
  assert.doesNotMatch(source, /releases\/download\/v\$\{version\}/);
  assert.match(source, /6583fcede1ea1ca8d0717ee7834c510f416adc416399d3991c4e4d8f0663ca5a/);
  assert.match(source, /release-assets\.githubusercontent\.com/);
  assert.match(source, /parsed\.protocol === "https:"/);
  assert.match(source, /rejectUnauthorized: true/);
});

test('documentation contract and CLI agree on lane, feedback, title, language, and default prompt', async (tmp) => {
  const [contract, agentConfig] = await Promise.all([
    fs.readFile(CONTRACT_DOC, 'utf8'),
    fs.readFile(OPENAI_AGENT, 'utf8'),
  ]);
  assert.match(agentConfig, /default_prompt:.*\$mindmap-skill/);

  assert.match(contract, /"lane": 1/, 'contract should document lane as an integer example');
  const laneBlueprint = {
    schemaVersion: '1.0',
    nodes: [
      { key: 'a', label: 'A', role: 'module', lane: 0 },
      { key: 'b', label: 'B', role: 'module', lane: 1 },
    ],
    edges: [{ from: 'a', to: 'b', relation: 'calls' }],
  };
  const laneCreate = await buildCanvas(path.join(tmp, 'lane-contract'), 'lane-contract', laneBlueprint);
  assert.equal(laneCreate.result.code, 0, laneCreate.result.stdout);

  assert.match(contract, /"feedback": true/, 'contract should document feedback as a boolean example');
  const feedbackBlueprint = modelBlueprint({
    edges: [{ from: 'output', to: 'input', relation: 'feedback', label: 'retry result affects API response', feedback: true }],
  });
  const feedbackCreate = await buildCanvas(path.join(tmp, 'feedback-contract'), 'feedback-contract', feedbackBlueprint);
  assert.equal(feedbackCreate.result.code, 0, feedbackCreate.result.stdout);

  assert.match(contract, /`title` and `language` are optional strings/);
  const missingTitleLanguage = {
    schemaVersion: '1.0',
    nodes: [
      { key: 'a', label: 'A', role: 'module' },
      { key: 'b', label: 'B', role: 'module' },
    ],
    edges: [{ from: 'a', to: 'b', relation: 'calls' }],
  };
  const missingCreate = await buildCanvas(path.join(tmp, 'required-contract'), 'required-contract', missingTitleLanguage);
  assert.equal(missingCreate.result.code, 0, missingCreate.result.stdout);
});

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mindmap-skill-test-'));
  const failures = [];
  try {
    for (const { name, fn } of tests) {
      const testTmp = path.join(root, name.replace(/[^a-zA-Z0-9._-]+/g, '-'));
      await fs.mkdir(testTmp, { recursive: true });
      try {
        await fn(testTmp);
        console.log(`PASS ${name}`);
      } catch (error) {
        failures.push({ name, error });
        console.log(`FAIL ${name}`);
        console.log(`  ${error.stack ?? error.message}`);
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log('');
  console.log(`Summary: ${tests.length - failures.length}/${tests.length} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});

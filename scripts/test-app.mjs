#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderStandaloneHtml, renderSvg } from "../app/render-svg.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const example = path.join(root, "examples", "rpent-libero-behavior.diagram.json");

function runNode(script, args = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

const diagram = JSON.parse(await fs.readFile(example, "utf8"));
assert.equal(diagram.schemaVersion, "mindmap-app/v1");
assert.ok(Array.isArray(diagram.layers));
assert.ok(Array.isArray(diagram.nodes));
assert.ok(Array.isArray(diagram.edges));
assert.equal(new Set(diagram.nodes.map((node) => node.id)).size, diagram.nodes.length);

const nodeIds = new Set(diagram.nodes.map((node) => node.id));
for (const edge of diagram.edges) {
  assert.ok(nodeIds.has(edge.from), `missing edge source ${edge.from}`);
  assert.ok(nodeIds.has(edge.to), `missing edge target ${edge.to}`);
}

const svg = renderSvg(diagram);
const html = renderStandaloneHtml(diagram, svg);
for (const keyword of [
  "RuntimeProvider",
  "BEHAVIOR Toolkit",
  "FullTaskRunner",
  "official task_success",
  "info.done.success only"
]) {
  assert.ok(svg.includes(keyword), `svg missing ${keyword}`);
  assert.ok(html.includes(keyword), `html missing ${keyword}`);
}

const build = await runNode(path.join(root, "scripts", "build-app.mjs"));
assert.equal(build.code, 0, `${build.stdout}\n${build.stderr}`);
const builtIndex = await fs.readFile(path.join(root, "dist", "app", "index.html"), "utf8");
assert.ok(builtIndex.includes("./app.js"));
assert.ok(builtIndex.includes("./manifest.webmanifest"));
await fs.access(path.join(root, "dist", "app", "assets", "mindmap.png"));
await fs.access(path.join(root, "dist", "app", "service-worker.js"));
const manifest = JSON.parse(await fs.readFile(path.join(root, "dist", "app", "manifest.webmanifest"), "utf8"));
assert.equal(manifest.name, "MindMap");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "./");
assert.ok(manifest.icons.some((icon) => icon.src === "./assets/mindmap.png"));

console.log(JSON.stringify({
  ok: true,
  example,
  nodes: diagram.nodes.length,
  edges: diagram.edges.length
}, null, 2));

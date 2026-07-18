#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertValidDiagram, statusLabel, validateDiagram } from "../app/diagram-validator.mjs";
import { renderStandaloneHtml, renderSvg } from "../app/render-svg.mjs";
import { createCamera, screenToWorld, setZoomAt, worldToScreen } from "../app/editor/camera.mjs";
import { copySubgraph, pasteSubgraph } from "../app/editor/clipboard.mjs";
import { command, createCommandHistory } from "../app/editor/command-history.mjs";
import { createInteractionStateMachine, InteractionState } from "../app/editor/interaction-state.mjs";
import { selectByMarquee } from "../app/editor/selection-geometry.mjs";
import { shortestPath, stableEdgeId } from "../app/views/graph-query.mjs";
import { fallbackLayout, layoutWithElk } from "../app/views/layout-profiles.mjs";
import { activate, ensureViews } from "../app/views/view-model.mjs";
import { resolveView } from "../app/views/view-resolver.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const examplesDir = path.join(root, "examples");
const examplePath = path.join(examplesDir, "rpent-libero-behavior.diagram.json");

function runNode(script, args = [], options = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { cwd: root, env: { ...process.env, ...(options.env || {}) } }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const exampleFiles = (await fs.readdir(examplesDir)).filter((file) => file.endsWith(".diagram.json")).sort();
assert.ok(exampleFiles.length > 0, "expected at least one example diagram");

const rendered = [];
for (const file of exampleFiles) {
  const diagram = assertValidDiagram(JSON.parse(await fs.readFile(path.join(examplesDir, file), "utf8")));
  assert.equal(new Set(diagram.nodes.map((node) => node.id)).size, diagram.nodes.length);
  const svg = renderSvg(diagram);
  const html = renderStandaloneHtml(diagram, svg);
  assert.ok(svg.includes(diagram.title));
  assert.ok(html.includes(diagram.title));
  rendered.push({ file, diagram, svg, html });
}

const { diagram, svg, html } = rendered.find((item) => item.file === path.basename(examplePath));
for (const keyword of ["RuntimeProvider", "BEHAVIOR Runtime", "FullTaskRunner", "[T,23]", "official task_success", "info.done.success", "下一阶段拟介入", "Planned / 待确认"]) {
  assert.ok(svg.includes(keyword), `svg missing ${keyword}`);
  assert.ok(html.includes(keyword), `html missing ${keyword}`);
}
assert.equal(statusLabel("planned"), "拟介入");
assert.equal(statusLabel("unknown"), "待确认");
const bad = structuredClone(diagram);
bad.edges = [{ from: "missing", to: diagram.nodes[0].id }];
assert.equal(validateDiagram(bad).ok, false);

// Legacy v1 diagrams gain three shared-data views without changing their top-level graph.
const migrated = ensureViews(diagram);
assert.equal(migrated.schemaVersion, "mindmap-app/v1");
assert.deepEqual(new Set(migrated.views.map((view) => view.type)), new Set(["mindmap", "dependency", "architecture"]));
assert.equal(migrated.nodes.length, diagram.nodes.length);
assert.equal(migrated.edges.length, diagram.edges.length);
assert.equal(migrated.activeViewId, "architecture");
const architecture = resolveView(migrated, "architecture");
const dependency = resolveView(activate(migrated, "dependency"), "dependency");
const mindmap = resolveView(activate(migrated, "mindmap"), "mindmap");
assert.equal(architecture.nodes.length, diagram.nodes.length);
assert.ok(dependency.nodes.length > 0);
assert.ok(mindmap.nodes.length > 0);
assert.ok(Math.max(...architecture.nodes.map((node) => node.x + node.width)) < Math.max(...diagram.nodes.map((node) => node.x + node.width)), "legacy architecture view should be compacted");
assert.equal(stableEdgeId(diagram.edges[0], 0), stableEdgeId(diagram.edges[0], 0));

const directEdge = diagram.edges.find((edge) => edge.from !== edge.to);
const directPath = shortestPath(diagram, directEdge.from, directEdge.to, { direction: "outbound" });
assert.deepEqual(directPath.nodeIds, [directEdge.from, directEdge.to]);
assert.equal(directPath.edgeIds.length, 1);

// Marquee semantics: left-to-right contains, right-to-left intersects, Shift toggles.
const items = [
  { id: "a", x: 10, y: 10, width: 20, height: 20 },
  { id: "b", x: 45, y: 10, width: 30, height: 20 },
];
assert.deepEqual(selectByMarquee(items, { x: 0, y: 0 }, { x: 60, y: 40 }).candidateIds, ["a"]);
assert.deepEqual(selectByMarquee(items, { x: 60, y: 40 }, { x: 0, y: 0 }).candidateIds, ["a", "b"]);
assert.deepEqual(selectByMarquee(items, { x: 0, y: 0 }, { x: 60, y: 40 }, ["a"], { shift: true }).selectionIds, []);

const camera = createCamera({ x: 40, y: 70, zoom: 1.2 });
const anchor = { x: 420, y: 280 };
const world = screenToWorld(camera, anchor);
assert.deepEqual(worldToScreen(camera, world), anchor);
const zoomed = setZoomAt(camera, anchor, 2.1);
assert.deepEqual(worldToScreen(zoomed, world), anchor);

let counter = 0;
const historyStack = createCommandHistory({ limit: 3 });
historyStack.execute(command("increment", () => { counter += 1; }, () => { counter -= 1; }));
assert.equal(counter, 1);
historyStack.undo();
assert.equal(counter, 0);
historyStack.redo();
assert.equal(counter, 1);
historyStack.transaction("two changes", (history) => {
  history.execute(command("a", () => { counter += 2; }, () => { counter -= 2; }));
  history.execute(command("b", () => { counter += 3; }, () => { counter -= 3; }));
});
assert.equal(counter, 6);
historyStack.undo();
assert.equal(counter, 1);

const payload = copySubgraph({
  nodes: [{ id: "a", title: "A", x: 0, y: 0 }, { id: "b", title: "B", x: 40, y: 0 }, { id: "c", title: "C" }],
  edges: [{ id: "ab", from: "a", to: "b" }, { id: "bc", from: "b", to: "c" }],
}, ["a", "b"]);
const pasted = pasteSubgraph(payload, { offset: 24, suffix: "test" });
assert.equal(pasted.nodes.length, 2);
assert.equal(pasted.edges.length, 1);
assert.equal(pasted.edges[0].from, "a-copy-test-0");
assert.equal(pasted.edges[0].to, "b-copy-test-1");
assert.equal(pasted.nodes[0].x, 24);

const machine = createInteractionStateMachine({ clock: () => 42 });
assert.equal(machine.beginFromInput({ target: "blank" }), true);
assert.equal(machine.state, InteractionState.MARQUEE);
assert.equal(machine.begin(InteractionState.PANNING), false);
machine.end();
assert.equal(machine.beginFromInput({ target: "port" }), true);
assert.equal(machine.state, InteractionState.CONNECTING);

const small = { canvas: { width: 800, height: 600 }, layers: [], nodes: diagram.nodes.slice(0, 5), edges: diagram.edges.filter((edge) => diagram.nodes.slice(0, 5).some((node) => node.id === edge.from) && diagram.nodes.slice(0, 5).some((node) => node.id === edge.to)) };
const elkLayout = await layoutWithElk(small, "architecture");
assert.ok(elkLayout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
const largeGraph = {
  canvas: { width: 3200, height: 2400 },
  layers: [],
  nodes: Array.from({ length: 1000 }, (_, index) => ({ id: `n${index}`, title: `Node ${index}`, width: 224, height: 78 })),
  edges: Array.from({ length: 2000 }, (_, index) => ({ id: `e${index}`, from: `n${index % 1000}`, to: `n${(index + 1) % 1000}` })),
};
const benchmarkStart = performance.now();
const largeLayout = fallbackLayout(largeGraph, "dependency");
const benchmarkMs = performance.now() - benchmarkStart;
assert.equal(largeLayout.nodes.length, 1000);
assert.equal(largeLayout.edges.length, 2000);
assert.ok(benchmarkMs < 5000, `1000-node fallback layout took ${benchmarkMs.toFixed(0)}ms`);

const build = await runNode(path.join(root, "scripts", "build-app.mjs"));
assert.equal(build.code, 0, `${build.stdout}\n${build.stderr}`);
const appIndex = await fs.readFile(path.join(root, "app", "index.html"), "utf8");
const appScript = await fs.readFile(path.join(root, "app", "app.js"), "utf8");
const appStyles = await fs.readFile(path.join(root, "app", "styles.css"), "utf8");
const desktopMain = await fs.readFile(path.join(root, "desktop", "main.mjs"), "utf8");
for (const id of ["app-shell", "graph-canvas", "marquee", "lasso-overlay", "minimap", "node-list", "layer-list", "inspector-content", "selection-toolbar", "zoom-percent", "add-node", "toggle-left", "toggle-right", "error-banner"]) {
  assert.ok(appIndex.includes(`id="${id}"`), `app index missing ${id}`);
}
for (const snippet of ["new Graph(", "new Selection(", "new Scroller(", "new MiniMap(", "selectByMarquee", "pasteSubgraph", "edge:connected", "autoLayout", "exportPdf", "exportMermaid", "data-view-mode"]) {
  assert.ok(appScript.includes(snippet), `app script missing ${snippet}`);
}
for (const selector of [".app-shell", ".topbar", ".sidebar", ".inspector", ".canvas-controls", ".selection-toolbar", ".minimap-shell", ".x6-widget-selection-box"]) {
  assert.ok(appStyles.includes(selector), `app styles missing ${selector}`);
}
assert.ok(svg.includes('class="node-card"'));
assert.ok(svg.includes('class="layer-tag"'));
assert.ok(desktopMain.includes("protocol.handle(scheme"));
assert.ok(desktopMain.includes("BrowserWindow"));
assert.ok(desktopMain.includes("icon: iconPath"));
assert.ok(desktopMain.includes("StartupWMClass") || (await fs.readFile(path.join(root, "scripts", "install-desktop.mjs"), "utf8")).includes("StartupWMClass"));

const builtIndex = await fs.readFile(path.join(root, "dist", "app", "index.html"), "utf8");
assert.ok(builtIndex.includes("./assets/app-"));
assert.match(builtIndex, /\.\/assets\/manifest-[^"']+\.webmanifest/);
await fs.access(path.join(root, "dist", "app", "service-worker.js"));
const sourceIcon = await fs.readFile(path.join(root, "app", "assets", "mindmap.png"));
const builtIcon = await fs.readFile(path.join(root, "dist", "app", "assets", "mindmap.png"));
assert.equal(sha256(builtIcon), sha256(sourceIcon), "build must preserve the approved PNG bytes");
const manifest = JSON.parse(await fs.readFile(path.join(root, "dist", "app", "manifest.webmanifest"), "utf8"));
assert.equal(manifest.name, "MindMap");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "./");
assert.ok(manifest.icons.some((icon) => icon.src === "./assets/mindmap.png"));

const isolatedRoot = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "mindmap-xdg-"));
const isolatedIconDir = path.join(isolatedRoot, "icons", "hicolor", "512x512", "apps");
await fs.mkdir(isolatedIconDir, { recursive: true });
const staleIcon = path.join(isolatedIconDir, "mindmap-app-deadbeefcafe.png");
await fs.writeFile(staleIcon, "stale");
const isolatedEnv = { XDG_DATA_HOME: isolatedRoot };
const install = await runNode(path.join(root, "scripts", "install-desktop.mjs"), [], { env: isolatedEnv });
assert.equal(install.code, 0, `${install.stdout}\n${install.stderr}`);
const installResult = JSON.parse(install.stdout);
const desktopEntry = await fs.readFile(path.join(isolatedRoot, "applications", "mindmap-app.desktop"), "utf8");
assert.ok(desktopEntry.includes("StartupWMClass=MindMap"));
assert.ok(desktopEntry.includes(`Icon=${installResult.icon}`));
assert.equal(sha256(await fs.readFile(installResult.installedIcon)), sha256(sourceIcon));
await assert.rejects(fs.access(staleIcon));
const uninstall = await runNode(path.join(root, "scripts", "uninstall-desktop.mjs"), [], { env: isolatedEnv });
assert.equal(uninstall.code, 0, `${uninstall.stdout}\n${uninstall.stderr}`);
await assert.rejects(fs.access(path.join(isolatedRoot, "applications", "mindmap-app.desktop")));
await assert.rejects(fs.access(installResult.installedIcon));
await fs.rm(isolatedRoot, { recursive: true, force: true });

console.log(JSON.stringify({ ok: true, examples: exampleFiles, nodes: diagram.nodes.length, edges: diagram.edges.length, views: migrated.views.map((view) => view.type), benchmarkMs: Math.round(benchmarkMs) }, null, 2));

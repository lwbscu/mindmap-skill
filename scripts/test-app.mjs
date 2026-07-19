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
import { computeInlineEditorPlacement, createInlineEditDraft, inlineEditDraftChanged, normalizeInlineEditDraft } from "../app/editor/inline-editing.mjs";
import {
  applyMarkToSelection,
  createRichTextFromPlainText,
  insertTextAtSelection,
  isSafeLink,
  marksAtSelection,
  normalizeMarks,
  normalizeRichText,
  richTextToPlainText,
  richTextToSafeHtml,
  safeHtmlToRichText,
} from "../app/editor/rich-text.mjs";
import { addImageAssetToDiagram, assignImageToNode, validateImageAssets } from "../app/media/image-assets.mjs";
import { pointInRect, rectFromNode, routeDiagramEdges, segmentIntersectsRect } from "../app/routing/smart-router.mjs";
import { selectByMarquee } from "../app/editor/selection-geometry.mjs";
import { createNodeStylePatch, getCommonNodeStyle, normalizeNodeStyle } from "../app/editor/style-model.mjs";
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
const maliciousRichText = structuredClone(diagram);
maliciousRichText.nodes[0].richText = {
  title: { version: 1, blocks: [{ type: "paragraph", align: "left", runs: [{ text: maliciousRichText.nodes[0].title, marks: { link: "javascript:alert(1)" } }] }] },
  subtitle: createRichTextFromPlainText(maliciousRichText.nodes[0].subtitle || ""),
};
assert.equal(validateDiagram(maliciousRichText).ok, false);

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

const rectanglesIntersect = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const portPoint = (node, side) => ({
  x: side === "left" ? node.x : side === "right" ? node.x + node.width : node.x + node.width / 2,
  y: side === "top" ? node.y : side === "bottom" ? node.y + node.height : node.y + node.height / 2,
});
const routedArchitecture = resolveView(migrated, "architecture", { routeEdges: true });
const routedNodes = new Map(routedArchitecture.nodes.map((node) => [node.id, node]));
for (const edge of routedArchitecture.edges) {
  const source = routedNodes.get(edge.from);
  const target = routedNodes.get(edge.to);
  const points = [portPoint(source, edge.fromSide), ...(edge.waypoints || []), portPoint(target, edge.toSide)];
  for (let index = 0; index < points.length - 1; index += 1) {
    for (const node of routedArchitecture.nodes) {
      if (node.id === edge.from || node.id === edge.to) continue;
      assert.equal(segmentIntersectsRect(points[index], points[index + 1], rectFromNode(node), 1), false, `${edge.id} crosses ${node.id}`);
    }
  }
}
const labelRects = routedArchitecture.edges.filter((edge) => edge.label && edge.labelAt).map((edge) => ({
  id: edge.id,
  x: edge.labelAt.x - Math.min(132, Math.max(56, [...String(edge.label)].length * 10 + 22)) / 2,
  y: edge.labelAt.y - 13,
  width: Math.min(132, Math.max(56, [...String(edge.label)].length * 10 + 22)),
  height: 26,
}));
for (const label of labelRects) {
  assert.ok(label.x >= 0 && label.y >= 0 && label.x + label.width <= routedArchitecture.canvas.width && label.y + label.height <= routedArchitecture.canvas.height, `${label.id} label leaves canvas`);
  for (const node of routedArchitecture.nodes) assert.equal(rectanglesIntersect(label, rectFromNode(node)), false, `${label.id} label overlaps ${node.id}`);
}
for (let index = 0; index < labelRects.length; index += 1) {
  for (let other = index + 1; other < labelRects.length; other += 1) {
    assert.equal(rectanglesIntersect(labelRects[index], labelRects[other]), false, `${labelRects[index].id} label overlaps ${labelRects[other].id}`);
  }
}

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

const editDraft = createInlineEditDraft({ title: "主题", subtitle: "说明" });
assert.equal(editDraft.title, "主题");
assert.equal(editDraft.subtitle, "说明");
assert.equal(richTextToPlainText(editDraft.richText.title, { singleBlock: true }), "主题");
const normalizedEditDraft = normalizeInlineEditDraft({ title: "  新主题  ", subtitle: "  新说明  " });
assert.equal(normalizedEditDraft.title, "新主题");
assert.equal(normalizedEditDraft.subtitle, "新说明");
assert.equal(inlineEditDraftChanged(editDraft, { title: "主题 2", subtitle: "说明" }), true);
const markedText = applyMarkToSelection(createRichTextFromPlainText("MindMap", { singleBlock: true }), { start: 0, end: 4 }, { fontWeight: "700", color: "#7c3aed" });
assert.equal(markedText.blocks[0].runs[0].text, "Mind");
assert.equal(markedText.blocks[0].runs[0].marks.color, "#7c3aed");
assert.equal(markedText.blocks[0].runs[1].text, "Map");
const wordLocalFormat = applyMarkToSelection(
  createRichTextFromPlainText("RuntimeProvider", { singleBlock: true }),
  { start: 0, end: 7 },
  { fontSize: 26, color: "#2563eb", underline: true },
);
assert.deepEqual(wordLocalFormat.blocks[0].runs.map((run) => run.text), ["Runtime", "Provider"], "local formatting must split only the selected run");
assert.equal(wordLocalFormat.blocks[0].runs[0].marks.fontSize, 26);
assert.equal(wordLocalFormat.blocks[0].runs[0].marks.color, "#2563eb");
assert.equal(wordLocalFormat.blocks[0].runs[0].marks.underline, true);
assert.deepEqual(wordLocalFormat.blocks[0].runs[1].marks, {}, "unselected text must keep its original marks");
const mixedFormat = applyMarkToSelection(wordLocalFormat, { start: 7, end: "RuntimeProvider".length }, { backgroundColor: "#fef3c7" });
const mixedMarks = marksAtSelection(mixedFormat, { start: 0, end: "RuntimeProvider".length }, { mixedValue: "mixed" });
assert.equal(mixedMarks.fontSize, "mixed", "selection summary must report mixed font size");
assert.equal(mixedMarks.color, "mixed", "selection summary must report mixed text color");
assert.equal(mixedMarks.backgroundColor, "mixed", "selection summary must report mixed highlight color");
const collapsedFutureInput = insertTextAtSelection(mixedFormat, { start: 7, end: 7 }, " + AI", { fontSize: 30, color: "#dc2626", backgroundColor: "#fee2e2" });
const insertedRun = collapsedFutureInput.blocks[0].runs.find((run) => run.text === " + AI");
assert.equal(insertedRun?.marks.fontSize, 30, "collapsed formatting must apply to the next inserted text");
assert.equal(insertedRun?.marks.color, "#dc2626");
assert.equal(insertedRun?.marks.backgroundColor, "#fee2e2");
assert.equal(richTextToPlainText(collapsedFutureInput, { singleBlock: true }), "Runtime + AIProvider");
const tiptapAdapterFixture = normalizeRichText({
  version: 1,
  blocks: [{
    type: "paragraph",
    align: "center",
    runs: [
      { text: "局部", marks: { fontFamily: "Noto Sans CJK SC, Microsoft YaHei, sans-serif", fontSize: 22, color: "#111827" } },
      { text: "格式", marks: { fontWeight: "700", italic: true, underline: true, strike: true, code: true, backgroundColor: "#e0f2fe", link: "https://example.com" } },
    ],
  }],
}, "", { singleBlock: true });
const adapterHtml = richTextToSafeHtml(tiptapAdapterFixture, { singleBlock: true });
assert.ok(adapterHtml.includes("font-size:22px"));
assert.ok(adapterHtml.includes("background-color:#e0f2fe"));
assert.ok(adapterHtml.includes('href="https://example.com"'));
assert.equal(richTextToPlainText(safeHtmlToRichText(adapterHtml, { singleBlock: true }), { singleBlock: true }), "局部格式");
assert.equal(isSafeLink("javascript:alert(1)"), false);
assert.equal(isSafeLink("/local"), false);
assert.equal(isSafeLink("https://example.com"), true);
assert.equal(isSafeLink("mailto:reviewer@example.com"), true);
assert.deepEqual(normalizeMarks({ fontFamily: "BadFont; color:red" }), {});
assert.equal(normalizeMarks({ fontFamily: "Georgia, serif" }).fontFamily, "Georgia, serif");
const editorPlacement = computeInlineEditorPlacement({ left: 900, top: 700, width: 200, height: 80 }, { left: 0, top: 0, width: 1024, height: 768 }, { minWidth: 320, minHeight: 108 });
assert.ok(editorPlacement.left + editorPlacement.width <= 1016);
assert.ok(editorPlacement.top + editorPlacement.minHeight <= 760);

const normalizedStyle = normalizeNodeStyle({ fontSize: 28, fontWeight: "bold", textColor: "#123456", fill: "#ffffff", borderColor: "#234567", borderWidth: 2, textAlign: "left", borderRadius: 10 });
assert.equal(normalizedStyle.fontWeight, 700);
assert.equal(normalizedStyle.fontSize, 28);
assert.equal(getCommonNodeStyle([normalizedStyle, { ...normalizedStyle, fill: "#fff7d6" }], { mixedValue: null }).fill, null);
const stylePatch = createNodeStylePatch(normalizedStyle, { fontSize: 32, fill: "#eef4ff" });
assert.equal(stylePatch.after.fontSize, 32);
assert.equal(stylePatch.inverse().after.fontSize, 28);

// Image assets are embedded, deduplicated, validated, and exported with the node.
const sourceIconBuffer = await fs.readFile(path.join(root, "app", "assets", "mindmap.png"));
const mediaDiagram = structuredClone(diagram);
const mediaResult = await addImageAssetToDiagram(mediaDiagram, new Blob([sourceIconBuffer], { type: "image/png" }), { name: "mindmap.png", alt: "MindMap icon" });
const duplicateMedia = await addImageAssetToDiagram(mediaDiagram, new Blob([sourceIconBuffer], { type: "image/png" }), { name: "duplicate.png" });
assert.equal(duplicateMedia.assetId, mediaResult.assetId);
assert.equal(duplicateMedia.deduped, true);
assignImageToNode(mediaDiagram.nodes[0], mediaResult.assetId, { placement: "left", fit: "contain", alt: "MindMap icon" });
assert.equal(validateImageAssets(mediaDiagram).ok, true);
const missingImageAlt = structuredClone(mediaDiagram);
missingImageAlt.nodes[0].image.alt = "";
assert.equal(validateImageAssets(missingImageAlt).ok, false);
assert.ok(renderSvg(mediaDiagram).includes(`href="${mediaResult.asset.dataUrl.slice(0, 32)}`));
const unsafeMedia = structuredClone(mediaDiagram);
unsafeMedia.assets[mediaResult.assetId].dataUrl = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
assert.equal(validateImageAssets(unsafeMedia).ok, false);

// Architecture/dependency routes avoid obstacles; MindMap routes remain curved.
const routeNodes = [
  { id: "route-a", x: 0, y: 100, width: 120, height: 70 },
  { id: "route-block", x: 220, y: 70, width: 150, height: 130 },
  { id: "route-b", x: 500, y: 100, width: 120, height: 70 },
];
const orthogonalRoute = routeDiagramEdges({ nodes: routeNodes, edges: [{ id: "route-edge", from: "route-a", to: "route-b", label: "avoids obstacle" }], viewType: "architecture" })[0];
assert.equal(orthogonalRoute.routeStyle, "orthogonal");
assert.ok(orthogonalRoute.waypoints.length >= 2);
assert.equal(orthogonalRoute.waypoints.some((point) => pointInRect(point, rectFromNode(routeNodes[1]), 0)), false);
const routeStart = { x: routeNodes[0].x + routeNodes[0].width, y: routeNodes[0].y + routeNodes[0].height / 2 };
const routeEnd = { x: routeNodes[2].x, y: routeNodes[2].y + routeNodes[2].height / 2 };
const routedPoints = [routeStart, ...orthogonalRoute.waypoints, routeEnd];
assert.equal(routedPoints.slice(0, -1).some((point, index) => segmentIntersectsRect(point, routedPoints[index + 1], rectFromNode(routeNodes[1]), 1)), false);
assert.equal(pointInRect(orthogonalRoute.labelAt, rectFromNode(routeNodes[1]), 2), false);
const parallelRoutes = routeDiagramEdges({ nodes: routeNodes, edges: [{ id: "parallel-a", from: "route-a", to: "route-b" }, { id: "parallel-b", from: "route-a", to: "route-b" }], viewType: "dependency" });
assert.notDeepEqual(parallelRoutes[0].waypoints, parallelRoutes[1].waypoints);
const curvedRoute = routeDiagramEdges({ nodes: routeNodes.filter((node) => node.id !== "route-block"), edges: [{ id: "curve-edge", from: "route-a", to: "route-b" }], viewType: "mindmap" })[0];
assert.equal(curvedRoute.routeStyle, "curved");
assert.equal(curvedRoute.curveControlPoints.length, 2);
const lockedRoute = routeDiagramEdges({ nodes: routeNodes, edges: [{ id: "locked", from: "route-a", to: "route-b", routeMode: "manual", lockedRoute: true, waypoints: [{ x: 160, y: 20 }, { x: 460, y: 20 }] }], viewType: "architecture" })[0];
assert.deepEqual(lockedRoute.waypoints, [{ x: 160, y: 20 }, { x: 460, y: 20 }]);

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
const tiptapAdapter = await fs.readFile(path.join(root, "app", "editor", "tiptap-adapter.mjs"), "utf8");
const desktopMain = await fs.readFile(path.join(root, "desktop", "main.mjs"), "utf8");
for (const id of ["app-shell", "graph-canvas", "marquee", "lasso-overlay", "minimap", "node-list", "layer-list", "inspector-content", "selection-toolbar", "zoom-percent", "add-node", "toggle-left", "toggle-right", "error-banner", "new-project-button", "projects-button", "project-dialog", "project-form", "project-name", "project-list", "unsaved-dialog"]) {
  assert.ok(appIndex.includes(`id="${id}"`), `app index missing ${id}`);
}
for (const snippet of ["new Graph(", "new Selection(", "new Scroller(", "new MiniMap(", "selectByMarquee", "pasteSubgraph", "createInlineEditor", "applySelectedNodeStyle", "edge:connected", "autoLayout", "exportPdf", "exportMermaid", "data-view-mode", "createBlankDiagram", "createNewProject", "window.mindmapDesktop.projects.create", "mod && key === \"n\""]) {
  assert.ok(appScript.includes(snippet), `app script missing ${snippet}`);
}
const editorFiles = await fs.readdir(path.join(root, "app", "editor"));
assert.ok(editorFiles.some((file) => /tiptap|prosemirror/i.test(file)), "Word-style editing must use a Tiptap/ProseMirror adapter module");
for (const id of [
  "quick-font-family",
  "quick-title-size",
  "quick-font-grow",
  "quick-font-shrink",
  "quick-text-color-apply",
  "quick-text-color-menu",
  "text-color-palette",
  "quick-highlight-apply",
  "quick-highlight-menu",
  "highlight-color-palette",
  "quick-link",
  "link-popover",
]) {
  assert.ok(appIndex.includes(`id="${id}"`), `Word-style floating toolbar missing ${id}`);
}
for (const mark of ["fontWeight", "italic", "underline", "strike"]) {
  assert.ok(appIndex.includes(`data-rich-mark="${mark}"`), `Word-style floating toolbar missing ${mark} mark control`);
}
for (const action of ["clear-format", "link"]) {
  assert.ok(appIndex.includes(`data-rich-action="${action}"`), `Word-style floating toolbar missing ${action} action`);
}
assert.ok(appIndex.includes('data-rich-mark="code"'), "Word-style floating toolbar missing inline code mark control");
assert.ok(appIndex.includes('data-rich-block="bullet-list-item"'), "Word-style floating toolbar missing list control");
assert.ok(appIndex.includes('data-rich-align="left"'), "Word-style floating toolbar missing alignment control");
for (const removedId of ["quick-fill-color", "quick-border-color"]) {
  assert.ok(!appIndex.includes(`id="${removedId}"`), `text toolbar must not expose node-level control ${removedId}`);
}
assert.ok(!appIndex.includes("text-style-menu"), "A mega menu must be replaced with direct Word-style controls");
assert.ok(!appScript.includes("window.prompt"), "link editing must use a safe popover, not window.prompt");
assert.ok(tiptapAdapter.includes("isComposing") && tiptapAdapter.includes("compositionstart"), "IME composition must be explicitly guarded");
assert.ok(tiptapAdapter.includes("application/x-mindmap-rich-text"), "local text clipboard must preserve supported rich text");
for (const selector of [".app-shell", ".topbar", ".sidebar", ".inspector", ".canvas-controls", ".selection-toolbar", ".minimap-shell", ".x6-widget-selection-box"]) {
  assert.ok(appStyles.includes(selector), `app styles missing ${selector}`);
}
assert.ok(appStyles.includes("body:has(.project-library-dialog[open]) #app-shell"), "project dialog must quiet the canvas background");
assert.ok(appScript.indexOf('mod && key === "s"') < appScript.indexOf("if (typing) return"), "Ctrl/Cmd+S must work while editing text");
assert.ok(appScript.indexOf('mod && key === "n"') < appScript.indexOf("if (typing) return"), "Ctrl/Cmd+N must work while editing text");
for (const key of ["c", "x", "v", "z", "y"]) {
  assert.ok(appScript.indexOf(`mod && key === "${key}"`) > appScript.indexOf("if (typing) return"), `Ctrl/Cmd+${key.toUpperCase()} must remain text-local while editing`);
}
assert.ok(svg.includes('class="node-card"'));
assert.ok(svg.includes('class="layer-tag"'));
assert.ok(desktopMain.includes("protocol.handle(scheme"));
assert.ok(desktopMain.includes("BrowserWindow"));
assert.ok(desktopMain.includes("icon: iconPath"));
assert.ok(desktopMain.includes('path.join(root, "projects")'));
for (const channel of ["mindmap:projects:list", "mindmap:projects:create", "mindmap:projects:open", "mindmap:projects:authorize"]) {
  assert.ok(desktopMain.includes(channel), `desktop main missing ${channel}`);
}
assert.ok(desktopMain.includes("StartupWMClass") || (await fs.readFile(path.join(root, "scripts", "install-desktop.mjs"), "utf8")).includes("StartupWMClass"));

const builtIndex = await fs.readFile(path.join(root, "dist", "app", "index.html"), "utf8");
assert.ok(builtIndex.includes("./assets/app-"));
assert.match(builtIndex, /\.\/assets\/manifest-[^"']+\.webmanifest/);
await fs.access(path.join(root, "dist", "app", "service-worker.js"));
const sourceIcon = sourceIconBuffer;
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

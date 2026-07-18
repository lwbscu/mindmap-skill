import { Graph, Rectangle } from "@antv/x6";
import { Selection } from "@antv/x6-plugin-selection";
import { History as X6History } from "@antv/x6-plugin-history";
import { Clipboard } from "@antv/x6-plugin-clipboard";
import { Keyboard } from "@antv/x6-plugin-keyboard";
import { Snapline } from "@antv/x6-plugin-snapline";
import { MiniMap } from "@antv/x6-plugin-minimap";
import { Scroller } from "@antv/x6-plugin-scroller";
import { Export } from "@antv/x6-plugin-export";
import { Transform } from "@antv/x6-plugin-transform";
import {
  AlignHorizontalDistributeCenter, AlignLeft, AlignStartHorizontal, Braces,
  ChevronDown, CircleAlert, CircleCheck, CircleDot, ClipboardCopy, Cloud,
  createIcons, Download, EyeOff, FileCode2, FileImage, FileText, Focus,
  FolderOpen, GitBranch, Grid3X3, Group, Hand, Image as ImageIcon, Minus,
  MousePointer2, Network, PanelLeft, PanelRight, Plus, Redo2, Scan, Search,
  Square, StickyNote, Trash2, Undo2, WandSparkles, Workflow, X,
} from "lucide";

import "@antv/x6/dist/index.css";
import "@antv/x6-plugin-selection/es/index.css";
import "@antv/x6-plugin-minimap/es/index.css";
import "@antv/x6-plugin-transform/es/index.css";
import "./styles.css";

import { assertValidDiagram, validateDiagram } from "./diagram-validator.mjs";
import { renderStandaloneHtml, renderSvg } from "./render-svg.mjs";
import { command, createCommandHistory } from "./editor/command-history.mjs";
import { copySubgraph, pasteSubgraph } from "./editor/clipboard.mjs";
import { createInteractionStateMachine, InteractionState } from "./editor/interaction-state.mjs";
import { boundsForItems, isSignificantDrag, selectByMarquee } from "./editor/selection-geometry.mjs";
import { activate, capture, ensureViews, stableEdgeId } from "./views/view-model.mjs";
import { filterDependencies, shortestPath } from "./views/graph-query.mjs";
import { layoutWithElk } from "./views/layout-profiles.mjs";
import { resolveView } from "./views/view-resolver.mjs";

const DEFAULT_DIAGRAM_URL = "../examples/rpent-libero-behavior.diagram.json";
const GRID_SIZE = 8;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.15;
const AUTO_SAVE_DELAY = 500;
const CARD_WIDTH = 224;
const CARD_HEIGHT = 78;
const GROUP_WIDTH = 440;
const GROUP_HEIGHT = 260;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const appShell = $("#app-shell");
const graphShell = $("#graph-shell");
const graphContainer = $("#graph-canvas");
const minimapContainer = $("#minimap");
const marqueeElement = $("#marquee");
const lassoOverlay = $("#lasso-overlay");
const selectionToolbar = $("#selection-toolbar");
const inspectorContent = $("#inspector-content");
const searchInput = $("#search");
const searchResults = $("#search-results");
const zoomInput = $("#zoom-percent");
const openFileInput = $("#open-file");
const commandPalette = $("#command-palette");
const commandSearch = $("#command-search");
const commandList = $("#command-list");
const contextMenu = $("#context-menu");

let diagram = null;
let currentFilePath = "";
let graph = null;
let scrollerPlugin = null;
let selectionPlugin = null;
let x6HistoryPlugin = null;
let activeTool = "select";
let activeInspectorTab = "details";
let activeSidebarTab = "outline";
let spaceDown = false;
let gridEnabled = true;
let suppressGraphEvents = false;
let autosaveTimer = null;
let toastTimer = null;
let copiedPayload = null;
let pasteCount = 0;
let dragSnapshot = null;
let panState = null;
let selectionBeforePointer = [];
let marqueeState = null;
let lassoState = null;
let viewNavigation = [];
let selectedBeforeViewSwitch = [];

const history = createCommandHistory({ limit: 100 });
const interaction = createInteractionStateMachine();

const lucideIcons = {
  AlignHorizontalDistributeCenter, AlignLeft, AlignStartHorizontal, Braces,
  ChevronDown, CircleAlert, CircleCheck, CircleDot, ClipboardCopy, Cloud,
  Download, EyeOff, FileCode2, FileImage, FileText, Focus, FolderOpen,
  GitBranch, Grid3x3: Grid3X3, Group, Hand, Image: ImageIcon, Minus,
  MousePointer2, Network, PanelLeft, PanelRight, Plus, Redo2, Scan, Search,
  Square, StickyNote, Trash2, Undo2, WandSparkles, Workflow, X,
};

const statusLabels = {
  implemented: "已解析",
  external: "外部",
  planned: "规划",
  unknown: "待确认",
  risk: "风险",
};

const kindVisuals = {
  root: { accent: "#2563eb", badge: "ROOT", badgeFill: "#eaf1ff", badgeText: "#2456b8" },
  module: { accent: "#2563eb", badge: "MOD", badgeFill: "#eaf1ff", badgeText: "#2456b8" },
  api: { accent: "#13a37b", badge: "API", badgeFill: "#e5f8f1", badgeText: "#087a5a" },
  service: { accent: "#7651d6", badge: "RUN", badgeFill: "#eee8ff", badgeText: "#6541c4" },
  process: { accent: "#7651d6", badge: "RUN", badgeFill: "#eee8ff", badgeText: "#6541c4" },
  external: { accent: "#e58a08", badge: "EXT", badgeFill: "#fff1d5", badgeText: "#b86500" },
  data: { accent: "#1684c7", badge: "DATA", badgeFill: "#e4f4ff", badgeText: "#126a9e" },
  storage: { accent: "#1684c7", badge: "DB", badgeFill: "#e4f4ff", badgeText: "#126a9e" },
  risk: { accent: "#d94b69", badge: "RISK", badgeFill: "#ffe8ed", badgeText: "#b52d4b" },
  output: { accent: "#d94b69", badge: "OUT", badgeFill: "#ffe8ed", badgeText: "#b52d4b" },
  note: { accent: "#d39a16", badge: "NOTE", badgeFill: "#fff6d8", badgeText: "#956600" },
  group: { accent: "#677489", badge: "GROUP", badgeFill: "#eef1f5", badgeText: "#4e596a" },
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function textOf(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function slug(value) {
  return String(value || "mindmap")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "") || "mindmap";
}

function refreshIcons(root = document) {
  createIcons({ icons: lucideIcons, root, attrs: { "stroke-width": 1.9 } });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2100);
}

function showError(error) {
  $("#error-message").textContent = error instanceof Error ? error.message : String(error);
  $("#error-banner").hidden = false;
  $("#validation-status").className = "status-error";
  $("#validation-status").innerHTML = '<i data-lucide="circle-alert"></i>结构错误';
  refreshIcons($("#validation-status"));
}

function clearError() {
  $("#error-banner").hidden = true;
  $("#validation-status").className = "status-ok";
  $("#validation-status").innerHTML = '<i data-lucide="circle-check"></i>结构有效';
  refreshIcons($("#validation-status"));
}

function visualFor(node) {
  const kind = node.kind || (node.status === "external" ? "external" : node.status === "risk" ? "risk" : "module");
  return kindVisuals[kind] || kindVisuals.module;
}

function registerShapes() {
  Graph.registerNode("mindmap-card", {
    inherit: "rect",
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "accent" },
      { tagName: "rect", selector: "badgeBody" },
      { tagName: "text", selector: "badgeText" },
      { tagName: "text", selector: "title" },
      { tagName: "text", selector: "subtitle" },
      { tagName: "rect", selector: "statusBody" },
      { tagName: "text", selector: "statusText" },
      { tagName: "text", selector: "relationCount" },
    ],
    attrs: {
      body: { refWidth: "100%", refHeight: "100%", rx: 6, ry: 6, fill: "#ffffff", stroke: "#cbd5e1", strokeWidth: 1 },
      accent: { width: 4, refHeight: "100%", rx: 3, ry: 3, fill: "#2563eb", stroke: "none" },
      badgeBody: { x: 12, y: 17, width: 34, height: 34, rx: 6, ry: 6, fill: "#eaf1ff", stroke: "none" },
      badgeText: { x: 29, y: 34, fontSize: 8, fontWeight: 800, textAnchor: "middle", textVerticalAnchor: "middle", fill: "#2456b8" },
      title: { x: 56, y: 20, fontSize: 15, fontWeight: 750, fill: "#172033", textAnchor: "start", textVerticalAnchor: "middle" },
      subtitle: { x: 56, y: 39, fontSize: 11, fill: "#667085", textAnchor: "start", textVerticalAnchor: "middle" },
      statusBody: { x: 56, y: 52, width: 42, height: 15, rx: 3, ry: 3, fill: "#e7f8f1", stroke: "none" },
      statusText: { x: 77, y: 60, fontSize: 8, fontWeight: 750, fill: "#087a5a", textAnchor: "middle", textVerticalAnchor: "middle" },
      relationCount: { x: 210, y: 60, fontSize: 9, fill: "#8893a3", textAnchor: "end", textVerticalAnchor: "middle" },
    },
    ports: {
      groups: {
        top: { position: "top", attrs: { circle: { r: 5.5, magnet: true, stroke: "#4e79d9", strokeWidth: 1.5, fill: "#ffffff", class: "x6-port-body" } } },
        right: { position: "right", attrs: { circle: { r: 5.5, magnet: true, stroke: "#4e79d9", strokeWidth: 1.5, fill: "#ffffff", class: "x6-port-body" } } },
        bottom: { position: "bottom", attrs: { circle: { r: 5.5, magnet: true, stroke: "#4e79d9", strokeWidth: 1.5, fill: "#ffffff", class: "x6-port-body" } } },
        left: { position: "left", attrs: { circle: { r: 5.5, magnet: true, stroke: "#4e79d9", strokeWidth: 1.5, fill: "#ffffff", class: "x6-port-body" } } },
      },
      items: [
        { id: "top", group: "top" },
        { id: "right", group: "right" },
        { id: "bottom", group: "bottom" },
        { id: "left", group: "left" },
      ],
    },
  }, true);

  Graph.registerNode("mindmap-layer", {
    inherit: "rect",
    width: 800,
    height: 220,
    attrs: {
      body: { rx: 5, ry: 5, fill: "#f7fafc", fillOpacity: .72, stroke: "#a9bfd7", strokeWidth: 1, strokeDasharray: "4 3" },
      label: { refX: 12, refY: 15, fontSize: 11, fontWeight: 750, fill: "#53647a", textAnchor: "start", textVerticalAnchor: "middle" },
    },
  }, true);

  Graph.registerNode("mindmap-group", {
    inherit: "rect",
    width: GROUP_WIDTH,
    height: GROUP_HEIGHT,
    attrs: {
      body: { rx: 6, ry: 6, fill: "#f8fafc", fillOpacity: .55, stroke: "#8593a7", strokeWidth: 1.3, strokeDasharray: "7 4" },
      label: { refX: 12, refY: 17, fontSize: 12, fontWeight: 750, fill: "#425066", textAnchor: "start", textVerticalAnchor: "middle" },
    },
  }, true);
}

function initGraph() {
  registerShapes();
  graph = new Graph({
    container: graphContainer,
    autoResize: true,
    virtual: true,
    background: { color: "#ffffff" },
    grid: { visible: true, size: GRID_SIZE, type: "dot", args: { color: "#c8d5e5", thickness: 1 } },
    interacting(cellView) {
      const data = cellView.cell.getData() || {};
      if (activeTool === "connect" && data.type !== "layer") {
        return { magnetConnectable: true, nodeMovable: false, edgeMovable: false, labelMovable: false, arrowheadMovable: false, vertexMovable: false };
      }
      if (activeTool !== "select" || spaceDown || data.locked || data.type === "layer") return false;
      return { nodeMovable: true, edgeMovable: false, labelMovable: false, arrowheadMovable: false, vertexMovable: false };
    },
    connecting: {
      allowBlank: true,
      allowLoop: false,
      allowNode: false,
      allowEdge: false,
      snap: { radius: 28 },
      router: { name: "orth", args: { padding: 12 } },
      connector: { name: "rounded", args: { radius: 12 } },
      connectionPoint: "boundary",
      anchor: "center",
      validateMagnet() { return activeTool === "connect"; },
      createEdge() {
        return graph.createEdge({
          zIndex: 4,
          attrs: { line: { stroke: "#6f88aa", strokeWidth: 1.6, targetMarker: { name: "block", width: 7, height: 6 }, strokeLinecap: "round" } },
          data: { type: "edge", manual: true, pending: true },
        });
      },
    },
    highlighting: {
      magnetAvailable: { name: "stroke", args: { padding: 4, attrs: { stroke: "#14966f", strokeWidth: 3 } } },
      magnetAdsorbed: { name: "stroke", args: { padding: 4, attrs: { stroke: "#2563eb", strokeWidth: 4 } } },
    },
    mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], minScale: MIN_ZOOM, maxScale: MAX_ZOOM, factor: 1.08, zoomAtMousePosition: true },
  });

  scrollerPlugin = new Scroller({ enabled: true, autoResize: true, pageVisible: false, pageBreak: false, padding: 180, background: { color: "#ffffff" } });
  selectionPlugin = new Selection({ enabled: true, multiple: true, rubberband: false, showNodeSelectionBox: true, showEdgeSelectionBox: true, movable: true, following: true, multipleSelectionModifiers: ["shift", "ctrl", "meta"], pointerEvents: "none" });
  x6HistoryPlugin = new X6History({ enabled: true, stackSize: 100, beforeAddCommand: (_event, args) => !args?.options?.appRender });
  graph.use(scrollerPlugin);
  graph.use(selectionPlugin);
  graph.use(x6HistoryPlugin);
  graph.use(new Clipboard({ enabled: true, useLocalStorage: false }));
  graph.use(new Keyboard({ enabled: true, global: false }));
  graph.use(new Snapline({ enabled: true, sharp: true, tolerance: 4 }));
  graph.use(new Transform({ resizing: { enabled: true, minWidth: 140, minHeight: 52, orthogonal: false, restrict: false }, rotating: false }));
  graph.use(new MiniMap({ container: minimapContainer, width: 178, height: 96, padding: 8, scalable: false, minScale: .01, maxScale: .25 }));
  graph.use(new Export());

  bindGraphEvents();
}

function activeView() {
  return diagram?.views?.find((view) => view.id === diagram.activeViewId || view.type === diagram.activeViewId)
    || diagram?.views?.[0];
}

function activeBlueprint(options = {}) {
  return resolveView(diagram, diagram?.activeViewId, options);
}

function relationCount(nodeId, blueprint = activeBlueprint()) {
  return (blueprint.edges || []).filter((edge) => edge.from === nodeId || edge.to === nodeId).length;
}

function x6NodeConfig(node, blueprint) {
  const visual = visualFor(node);
  const width = clamp(Number(node.width || CARD_WIDTH), node.kind === "group" ? 280 : 140, 1400);
  const height = clamp(Number(node.height || CARD_HEIGHT), node.kind === "group" ? 160 : 52, 900);
  if (node.kind === "group") {
    return {
      id: node.id,
      shape: "mindmap-group",
      x: Number(node.x || 0),
      y: Number(node.y || 0),
      width,
      height,
      zIndex: 2,
      attrs: { body: { fill: node.fill || "#f8fafc", stroke: node.stroke || "#8593a7" }, label: { text: node.title || "分组" } },
      data: { type: "node", nodeId: node.id, node: clone(node), locked: Boolean(node.locked), group: true },
    };
  }
  const status = statusLabels[node.status] || statusLabels.implemented;
  const statusWidth = Math.max(38, status.length * 10 + 9);
  const titleSize = clamp(Number(node.titleSize || 15), 11, 24);
  const subtitleSize = clamp(Number(node.subtitleSize || 11), 9, 18);
  const titleLength = Math.max(8, Math.floor((width - 72) / Math.max(6, titleSize * .58)));
  const subtitleLength = Math.max(10, Math.floor((width - 72) / Math.max(5, subtitleSize * .54)));
  return {
    id: node.id,
    shape: "mindmap-card",
    x: Number(node.x || 0),
    y: Number(node.y || 0),
    width,
    height,
    zIndex: 10,
    attrs: {
      body: { fill: node.fill || "#ffffff", stroke: node.stroke || "#cbd5e1", strokeWidth: Number(node.strokeWidth || 1) },
      accent: { fill: node.stroke || visual.accent },
      badgeBody: { fill: visual.badgeFill },
      badgeText: { text: visual.badge, fill: visual.badgeText },
      title: { text: truncateText(node.title || "未命名", titleLength), fill: node.textColor || "#172033", fontSize: titleSize },
      subtitle: { text: truncateText(node.subtitle || "未填写说明", subtitleLength), fill: node.subtitleColor || "#667085", fontSize: subtitleSize },
      statusBody: { width: statusWidth, fill: node.status === "risk" ? "#ffe8ed" : node.status === "unknown" ? "#fff1d5" : "#e7f8f1" },
      statusText: { x: 56 + statusWidth / 2, text: status, fill: node.status === "risk" ? "#b52d4b" : node.status === "unknown" ? "#a56800" : "#087a5a" },
      relationCount: { x: width - 14, text: `${relationCount(node.id, blueprint)} 条关系` },
    },
    data: { type: "node", nodeId: node.id, node: clone(node), locked: Boolean(node.locked), manual: Boolean(node.manual) },
  };
}

function x6LayerConfig(layer) {
  return {
    id: `layer:${layer.id}`,
    shape: "mindmap-layer",
    x: Number(layer.x || 0),
    y: Number(layer.y || 0),
    width: Math.max(200, Number(layer.width || 800)),
    height: Math.max(120, Number(layer.height || 220)),
    zIndex: 0,
    attrs: {
      body: { fill: layer.fill || "#f7fafc", stroke: layer.stroke || "#a9bfd7", pointerEvents: "none" },
      label: { text: layer.label || layer.id, pointerEvents: "none" },
    },
    data: { type: "layer", layerId: layer.id, layer: clone(layer), locked: true },
  };
}

function x6EdgeConfig(edge, index) {
  const edgeId = stableEdgeId(edge, index);
  const label = edge.label || edge.relation || "";
  const sourceSide = edge.fromSide || "right";
  const targetSide = edge.toSide || "left";
  return {
    id: edgeId,
    shape: "edge",
    source: { cell: edge.from, port: sourceSide },
    target: { cell: edge.to, port: targetSide },
    vertices: Array.isArray(edge.waypoints) ? edge.waypoints : [],
    router: { name: "orth", args: { padding: 12 } },
    connector: { name: "rounded", args: { radius: 12 } },
    zIndex: 4,
    attrs: {
      line: {
        stroke: edge.stroke || "#8aa0bb",
        strokeWidth: Number(edge.strokeWidth || 1.5),
        strokeDasharray: edge.flagged ? "5 4" : undefined,
        targetMarker: { name: "block", width: 7, height: 6 },
        strokeLinecap: "round",
      },
    },
    labels: label ? [{
      position: Number(edge.labelRatio || .5),
      attrs: {
        body: { ref: "label", refWidth: "120%", refHeight: "150%", refX: "-10%", refY: "-25%", fill: "#ffffff", stroke: "#d9e0e9", strokeWidth: .7, rx: 3, ry: 3 },
        label: { text: label, fill: "#4e5c70", fontSize: clamp(Number(edge.labelSize || 10), 9, 16), fontWeight: 550 },
      },
    }] : [],
    data: { type: "edge", edgeId, edge: { ...clone(edge), id: edgeId }, manual: Boolean(edge.manual) },
  };
}

function renderGraph(options = {}) {
  if (!diagram || !graph) return;
  const blueprint = activeBlueprint();
  const selectedIds = options.selectionIds || selectedSemanticNodeIds();
  suppressGraphEvents = true;
  graph.model.startBatch("app-render", { appRender: true });
  graph.clearCells({ appRender: true });

  const layerCells = new Map();
  for (const layer of blueprint.layers || []) {
    const cell = graph.addNode(x6LayerConfig(layer), { appRender: true });
    layerCells.set(layer.id, cell);
  }

  const nodeCells = new Map();
  for (const node of blueprint.nodes || []) {
    const cell = graph.addNode(x6NodeConfig(node, blueprint), { appRender: true });
    nodeCells.set(node.id, cell);
  }
  for (const edge of blueprint.edges || []) {
    if (nodeCells.has(edge.from) && nodeCells.has(edge.to)) graph.addEdge(x6EdgeConfig(edge, blueprint.edges.indexOf(edge)), { appRender: true });
  }

  for (const node of blueprint.nodes || []) {
    const cell = nodeCells.get(node.id);
    const parent = node.groupId ? nodeCells.get(node.groupId) : layerCells.get(node.layer);
    if (parent && cell && parent.id !== cell.id) parent.addChild(cell, { appRender: true });
  }

  graph.model.stopBatch("app-render", { appRender: true });
  x6HistoryPlugin?.clean?.();
  graph.cleanSelection({ silent: true });
  for (const id of selectedIds) {
    const cell = graph.getCellById(id);
    if (cell) graph.select(cell, { silent: true });
  }
  suppressGraphEvents = false;

  updatePageChrome();
  renderSidebar();
  renderSavedViews();
  renderInspector();
  updateSelectionUI();
  updateZoomUI();
  $("#canvas-empty").hidden = (blueprint.nodes || []).length > 0;
}

function updatePageChrome() {
  const blueprint = activeBlueprint();
  const view = activeView();
  $("#diagram-title").textContent = diagram.title || "结构框图";
  $("#diagram-subtitle").textContent = viewNavigation.length ? `${view.label} / ${viewNavigation.at(-1).label}` : (diagram.subtitle || view.label);
  $("#node-count").textContent = String(diagram.nodes.length);
  $("#visible-node-count").textContent = String(blueprint.nodes.length);
  $("#edge-count").textContent = String(blueprint.edges.length);
  appShell.dataset.view = view.type;
  for (const button of $$('[data-view-mode]')) button.classList.toggle("is-active", button.dataset.viewMode === view.type);
  $("#inspector-title").textContent = view.label;
  $("#inspector-subtitle").textContent = view.type === "dependency" ? "检查依赖方向、深度、路径和证据" : view.type === "mindmap" ? "从核心主题逐层展开结构" : "检查分层边界、模块与跨层关系";
  $("#save-status").textContent = currentFilePath ? currentFilePath.split(/[\\/]/).at(-1) : "本地编辑";
}

function selectedCells() {
  return graph?.getSelectedCells?.() || [];
}

function selectedSemanticNodes() {
  return selectedCells().filter((cell) => cell.isNode?.() && cell.getData()?.type === "node");
}

function selectedSemanticNodeIds() {
  return selectedSemanticNodes().map((cell) => cell.id);
}

function selectedSemanticEdge() {
  return selectedCells().find((cell) => cell.isEdge?.() && cell.getData()?.type === "edge") || null;
}

function beginCanvasPan(event) {
  if (!interaction.begin(InteractionState.PANNING, { event })) return;
  const scroll = scrollerPlugin.getScrollbarPosition();
  panState = { clientX: event.clientX, clientY: event.clientY, left: scroll.left, top: scroll.top };
  graphShell.classList.add("is-panning");
}

function semanticNode(id) {
  return diagram.nodes.find((node) => node.id === id);
}

function semanticEdge(id) {
  return diagram.edges.find((edge, index) => stableEdgeId(edge, index) === id);
}

function currentViewIndex() {
  return diagram.views.findIndex((view) => view.id === diagram.activeViewId);
}

function syncGraphLayoutToDiagram() {
  if (!diagram || !graph) return;
  const index = currentViewIndex();
  if (index < 0) return;
  const view = diagram.views[index];
  view.layout ||= { profile: view.type, nodes: {}, layers: {}, edges: {} };
  view.layout.nodes ||= {};
  view.layout.layers ||= {};
  view.layout.edges ||= {};
  for (const cell of graph.getNodes()) {
    const data = cell.getData() || {};
    const pos = cell.position();
    const size = cell.size();
    if (data.type === "node") {
      view.layout.nodes[cell.id] = { ...(view.layout.nodes[cell.id] || {}), x: pos.x, y: pos.y, width: size.width, height: size.height };
      if (view.type === "architecture") {
        const node = semanticNode(cell.id);
        if (node) Object.assign(node, { x: pos.x, y: pos.y, width: size.width, height: size.height });
      }
    } else if (data.type === "layer") {
      view.layout.layers[data.layerId] = { ...(view.layout.layers[data.layerId] || {}), x: pos.x, y: pos.y, width: size.width, height: size.height };
      if (view.type === "architecture") {
        const layer = diagram.layers.find((item) => item.id === data.layerId);
        if (layer) Object.assign(layer, { x: pos.x, y: pos.y, width: size.width, height: size.height });
      }
    }
  }
  for (const cell of graph.getEdges()) {
    const data = cell.getData() || {};
    if (data.type !== "edge") continue;
    const vertices = cell.getVertices().map(({ x, y }) => ({ x, y }));
    view.layout.edges[data.edgeId] = { ...(view.layout.edges[data.edgeId] || {}), waypoints: vertices };
  }
  view.camera = currentCamera();
}

function currentCamera() {
  const rect = graphShell.getBoundingClientRect();
  const origin = scrollerPlugin?.clientToLocalPoint?.(rect.left, rect.top) || new Rectangle(0, 0, 0, 0);
  return { x: origin.x, y: origin.y, zoom: graph.zoom() };
}

function restoreCamera(camera, fallbackFit = false) {
  if (!camera || fallbackFit) {
    fitAll();
    return;
  }
  graph.zoomTo(clamp(Number(camera.zoom || 1), MIN_ZOOM, MAX_ZOOM));
  scrollerPlugin.centerPoint(Number(camera.x || 0) + graphShell.clientWidth / (2 * graph.zoom()), Number(camera.y || 0) + graphShell.clientHeight / (2 * graph.zoom()));
  updateZoomUI();
}

function snapshot() {
  syncGraphLayoutToDiagram();
  return { diagram: clone(diagram), filePath: currentFilePath };
}

function restoreSnapshot(value, options = {}) {
  suppressGraphEvents = true;
  diagram = ensureViews(clone(value.diagram));
  currentFilePath = value.filePath || currentFilePath;
  renderGraph({ selectionIds: options.selectionIds || [] });
  suppressGraphEvents = false;
  scheduleAutosave();
}

function runMutation(label, mutate, options = {}) {
  const before = snapshot();
  const after = clone(before);
  mutate(after.diagram);
  history.execute(command(label, () => restoreSnapshot(after, options), () => restoreSnapshot(before, options)));
  updateHistoryButtons();
  return after.diagram;
}

function recordAppliedMutation(label, before, after, options = {}) {
  history.record(command(label, () => restoreSnapshot(after, options), () => restoreSnapshot(before, options)));
  updateHistoryButtons();
  scheduleAutosave();
}

function updateHistoryButtons() {
  $("#undo").disabled = !history.canUndo;
  $("#redo").disabled = !history.canRedo;
  if (activeInspectorTab === "history") renderInspector();
}

function undo() {
  const item = history.undo();
  if (item) showToast(`已撤销：${item.label || "操作"}`);
  updateHistoryButtons();
}

function redo() {
  const item = history.redo();
  if (item) showToast(`已重做：${item.label || "操作"}`);
  updateHistoryButtons();
}

function scheduleAutosave() {
  $("#save-status").textContent = "有未保存修改";
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem("mindmap:last-diagram", JSON.stringify(diagram));
      localStorage.setItem("mindmap:last-file", currentFilePath || "");
      $("#save-status").textContent = currentFilePath ? "已自动保存视图" : "已保存到本地";
    } catch {
      $("#save-status").textContent = "自动保存失败";
    }
  }, AUTO_SAVE_DELAY);
}

function renderSidebar() {
  const blueprint = activeBlueprint();
  const nodeList = $("#node-list");
  const selected = new Set(selectedSemanticNodeIds());
  const layers = new Map((blueprint.layers || []).map((layer) => [layer.id, layer]));
  const groups = new Map();
  for (const node of blueprint.nodes || []) {
    const groupId = node.layer || "__ungrouped";
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(node);
  }
  nodeList.innerHTML = "";
  for (const [groupId, nodes] of groups) {
    const section = document.createElement("div");
    section.className = "outline-group";
    const heading = document.createElement("div");
    heading.className = "outline-group-title";
    heading.textContent = layers.get(groupId)?.label || "未分组";
    section.append(heading);
    for (const node of nodes) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.nodeId = node.id;
      button.classList.toggle("is-active", selected.has(node.id));
      const visual = visualFor(node);
      button.innerHTML = `<span class="node-dot" style="background:${node.stroke || visual.accent}"></span><span class="node-list-copy"><span class="node-list-title"></span><span class="node-list-subtitle"></span></span><span class="relation-count">${relationCount(node.id, blueprint)}</span>`;
      $(".node-list-title", button).textContent = node.title || "未命名";
      $(".node-list-subtitle", button).textContent = node.subtitle || statusLabels[node.status] || "模块";
      button.addEventListener("click", (event) => selectNode(node.id, { additive: event.shiftKey || event.ctrlKey || event.metaKey, center: true }));
      section.append(button);
    }
    nodeList.append(section);
  }
  $("#sidebar-node-count").textContent = String(blueprint.nodes.length);

  const layerList = $("#layer-list");
  const view = activeView();
  const hidden = new Set(view.hiddenLayers || []);
  layerList.innerHTML = "";
  for (const layer of diagram.layers || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.layerId = layer.id;
    button.classList.toggle("is-hidden", hidden.has(layer.id));
    button.innerHTML = `<span class="layer-swatch" style="background:${layer.fill || "#f7fafc"};border-color:${layer.stroke || "#a9bfd7"}"></span><span class="node-list-copy"><span class="node-list-title"></span><span class="node-list-subtitle"></span></span><span class="layer-actions"></span>`;
    $(".node-list-title", button).textContent = layer.label || layer.id;
    $(".node-list-subtitle", button).textContent = `${diagram.nodes.filter((node) => node.layer === layer.id).length} 个节点`;
    button.addEventListener("click", () => toggleLayer(layer.id));
    layerList.append(button);
  }
}

function renderSavedViews() {
  const list = $("#saved-view-list");
  list.innerHTML = "";
  const builtIns = diagram.views.map((view) => ({ id: view.id, label: view.label, viewId: view.id, camera: view.camera, builtIn: true }));
  const saved = [...builtIns, ...(diagram.savedViews || [])];
  for (const item of saved) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<span class="node-dot" style="background:${item.viewId === diagram.activeViewId ? "#2563eb" : "#9aa6b5"}"></span><span class="node-list-copy"><span class="node-list-title"></span><span class="node-list-subtitle"></span></span>`;
    $(".node-list-title", button).textContent = item.label;
    $(".node-list-subtitle", button).textContent = item.builtIn ? "基础视图" : "保存的相机与筛选";
    button.addEventListener("click", () => {
      if (item.viewId !== diagram.activeViewId) switchView(item.viewId);
      requestAnimationFrame(() => restoreCamera(item.camera));
    });
    list.append(button);
  }
}

function inspectorNodeIds() {
  return selectedSemanticNodeIds();
}

function field(label, key, value, options = {}) {
  const type = options.type || "text";
  const nodeId = options.nodeId || "";
  if (type === "textarea") return `<label class="field"><span>${label}</span><textarea data-node-field="${key}" data-node-id="${nodeId}"></textarea></label>`;
  if (type === "select") return `<label class="field"><span>${label}</span><select data-node-field="${key}" data-node-id="${nodeId}">${options.items.map(([itemValue, itemLabel]) => `<option value="${itemValue}"${String(value) === String(itemValue) ? " selected" : ""}>${itemLabel}</option>`).join("")}</select></label>`;
  return `<label class="field ${type === "color" ? "color-field" : ""}"><span>${label}</span><input type="${type}" value="${String(value ?? "").replace(/"/g, "&quot;")}" data-node-field="${key}" data-node-id="${nodeId}"></label>`;
}

function setTextareaValues(root, values) {
  for (const [selector, value] of values) {
    const element = $(selector, root);
    if (element) element.value = value || "";
  }
}

function renderViewInspector() {
  const view = activeView();
  const blueprint = activeBlueprint();
  const relationTypes = [...new Set(diagram.edges.map((edge) => edge.relation).filter(Boolean))];
  if (activeInspectorTab === "relations") {
    inspectorContent.innerHTML = `<section class="inspector-section"><h3>关系概览</h3><div class="metric-grid"><div class="metric"><b>${blueprint.edges.length}</b><span>当前可见</span></div><div class="metric"><b>${diagram.edges.length - blueprint.edges.length}</b><span>被筛选</span></div></div></section>${relationTypes.map((relation) => `<div class="relation-item"><span class="relation-direction">${relation}</span><strong>${diagram.edges.filter((edge) => edge.relation === relation).length} 条关系</strong></div>`).join("") || '<div class="empty-copy">当前没有关系类型。</div>'}`;
    return;
  }
  if (activeInspectorTab === "evidence") {
    const evidence = [...new Set([...diagram.nodes.flatMap((node) => node.evidence || []), ...diagram.edges.flatMap((edge) => edge.evidence || [])])];
    inspectorContent.innerHTML = `<section class="inspector-section"><h3>证据覆盖</h3>${evidence.map((item) => `<div class="evidence-item"><strong>来源</strong><span>${String(item).replace(/</g, "&lt;")}</span></div>`).join("") || '<div class="empty-copy">当前图表没有证据条目。</div>'}</section>`;
    return;
  }
  if (activeInspectorTab === "history") {
    inspectorContent.innerHTML = `<section class="inspector-section"><h3>操作历史</h3>${[...history.undoStack].reverse().map((item, index) => `<div class="history-item"><strong>${index === 0 ? "当前 · " : ""}${item.label || "画布操作"}</strong><span>可撤销</span></div>`).join("") || '<div class="empty-copy">本次会话还没有画布修改。</div>'}</section>`;
    return;
  }
  if (activeInspectorTab === "style") {
    inspectorContent.innerHTML = '<div class="empty-copy">选择节点或关系后可编辑样式。视图背景保持白色，主文字保持黑色。</div>';
    return;
  }

  let modeControls = "";
  if (view.type === "dependency") {
    modeControls = `<section class="inspector-section"><h3>依赖探索</h3>${field("方向", "view:direction", view.filters?.direction || "both", { type: "select", items: [["inbound","入站"],["outbound","出站"],["both","双向"]] })}${field("深度", "view:depth", view.filters?.depth || 2, { type: "number" })}<div class="inspector-actions"><button type="button" data-view-action="shortest-path">显示所选最短路径</button><button type="button" data-view-action="clear-filter">清除聚焦</button></div></section>`;
  } else if (view.type === "mindmap") {
    modeControls = `<section class="inspector-section"><h3>MindMap 布局</h3>${field("布局", "view:layout", view.modeOptions?.layout || "radial", { type: "select", items: [["radial","环形"],["right","向右"],["left","向左"],["both","左右双向"]] })}<div class="inspector-actions"><button type="button" data-view-action="set-root">将所选设为根节点</button><button type="button" data-view-action="focus-branch">只看当前分支</button></div></section>`;
  } else {
    modeControls = `<section class="inspector-section"><h3>架构布局</h3>${field("布局模式", "view:layout", view.modeOptions?.layout || "layered", { type: "select", items: [["layered","分层"],["domain","领域"],["service","服务"],["deployment","部署"],["custom","自定义"]] })}<div class="inspector-actions"><button type="button" data-view-action="reset-drilldown">返回系统全景</button></div></section>`;
  }
  inspectorContent.innerHTML = `<section class="inspector-section"><h3>当前视图</h3><div class="metric-grid"><div class="metric"><b>${blueprint.nodes.length}</b><span>可见节点</span></div><div class="metric"><b>${blueprint.edges.length}</b><span>可见关系</span></div><div class="metric"><b id="inspector-zoom">${Math.round(graph.zoom()*100)}%</b><span>缩放</span></div><div class="metric"><b>${view.fixedNodes?.length || 0}</b><span>固定节点</span></div></div></section>${modeControls}<section class="inspector-section"><h3>说明</h3><div class="empty-copy">所有主画布文字始终保留。使用空白拖动框选，Alt+拖动套索，Space 或中键拖动画布。</div></section>`;
}

function renderNodeInspector(nodes) {
  const primary = nodes.at(-1);
  if (!primary) return renderViewInspector();
  $("#inspector-kicker").textContent = nodes.length > 1 ? `已选择 ${nodes.length} 个节点` : (primary.kind || "模块");
  $("#inspector-title").textContent = nodes.length > 1 ? `${nodes.length} 个节点` : primary.title;
  $("#inspector-subtitle").textContent = nodes.length > 1 ? "批量移动、样式、分组或隐藏" : (primary.subtitle || "未填写说明");

  if (activeInspectorTab === "relations") {
    const ids = new Set(nodes.map((node) => node.id));
    const related = diagram.edges.filter((edge) => ids.has(edge.from) || ids.has(edge.to));
    inspectorContent.innerHTML = `<section class="inspector-section"><h3>关系</h3>${related.map((edge, index) => `<button class="relation-item" type="button" data-edge-id="${stableEdgeId(edge, diagram.edges.indexOf(edge))}"><span class="relation-direction">${edge.relation || "关系"}</span><strong>${semanticNode(edge.from)?.title || edge.from} → ${semanticNode(edge.to)?.title || edge.to}</strong><span>${edge.label || "点击在画布中定位"}</span></button>`).join("") || '<div class="empty-copy">选中节点没有可见关系。</div>'}</section>`;
    return;
  }
  if (activeInspectorTab === "evidence") {
    const evidence = [...new Set(nodes.flatMap((node) => node.evidence || []))];
    const risks = [...new Set(nodes.flatMap((node) => node.risks || []))];
    inspectorContent.innerHTML = `<section class="inspector-section"><h3>源码与文档证据</h3>${evidence.map((item) => `<div class="evidence-item"><strong>来源</strong><span>${String(item).replace(/</g,"&lt;")}</span></div>`).join("") || '<div class="empty-copy">当前节点没有证据条目。</div>'}</section><section class="inspector-section"><h3>风险与待确认</h3>${risks.map((item) => `<div class="evidence-item"><strong>风险</strong><span>${String(item).replace(/</g,"&lt;")}</span></div>`).join("") || '<div class="empty-copy">当前节点没有风险条目。</div>'}</section>`;
    return;
  }
  if (activeInspectorTab === "style") {
    inspectorContent.innerHTML = `<section class="inspector-section"><h3>${nodes.length > 1 ? "批量样式" : "节点样式"}</h3><div class="field-row">${field("填充", "fill", primary.fill || "#ffffff", { type: "color", nodeId: primary.id })}${field("边框", "stroke", primary.stroke || visualFor(primary).accent, { type: "color", nodeId: primary.id })}</div><div class="field-row">${field("标题字号", "titleSize", primary.titleSize || 15, { type: "number", nodeId: primary.id })}${field("说明字号", "subtitleSize", primary.subtitleSize || 11, { type: "number", nodeId: primary.id })}</div><label class="toggle-row"><span>锁定位置</span><input type="checkbox" data-node-field="locked" data-node-id="${primary.id}"${primary.locked ? " checked" : ""}></label><div class="inspector-actions"><button type="button" data-node-action="duplicate">复制</button><button type="button" data-node-action="hide">从视图隐藏</button><button class="danger-button" type="button" data-node-action="delete">删除</button></div></section>`;
    return;
  }
  if (activeInspectorTab === "history") return renderViewInspector();

  inspectorContent.innerHTML = `<section class="inspector-section"><h3>属性</h3>${field("名称", "title", primary.title, { nodeId: primary.id })}${field("职责说明", "subtitle", primary.subtitle || "", { type: "textarea", nodeId: primary.id })}<div class="field-row">${field("类型", "kind", primary.kind || "module", { type: "select", nodeId: primary.id, items: Object.keys(kindVisuals).map((kind) => [kind, kind]) })}${field("状态", "status", primary.status || "implemented", { type: "select", nodeId: primary.id, items: Object.entries(statusLabels).map(([value,label]) => [value,label]) })}</div>${field("所属图层", "layer", primary.layer || "", { type: "select", nodeId: primary.id, items: [["","未分组"], ...diagram.layers.map((layer) => [layer.id,layer.label || layer.id])] })}</section><section class="inspector-section"><h3>位置</h3><div class="field-row">${field("X", "x", Math.round(graph.getCellById(primary.id)?.position().x || primary.x || 0), { type: "number", nodeId: primary.id })}${field("Y", "y", Math.round(graph.getCellById(primary.id)?.position().y || primary.y || 0), { type: "number", nodeId: primary.id })}</div></section><div class="inspector-actions"><button type="button" data-node-action="duplicate">复制</button><button type="button" data-node-action="focus">聚焦</button><button class="danger-button" type="button" data-node-action="delete">删除/隐藏</button></div>`;
  setTextareaValues(inspectorContent, [[`textarea[data-node-field="subtitle"]`, primary.subtitle || ""]]);
}

function renderEdgeInspector(cell) {
  const data = cell.getData();
  const edge = semanticEdge(data.edgeId) || data.edge;
  $("#inspector-kicker").textContent = edge.manual ? "手动关系" : "分析关系";
  $("#inspector-title").textContent = edge.label || edge.relation || "关系";
  $("#inspector-subtitle").textContent = `${semanticNode(edge.from)?.title || edge.from} → ${semanticNode(edge.to)?.title || edge.to}`;
  if (activeInspectorTab === "evidence") {
    inspectorContent.innerHTML = `<section class="inspector-section"><h3>关系证据</h3>${(edge.evidence || []).map((item) => `<div class="evidence-item"><strong>来源</strong><span>${String(item).replace(/</g,"&lt;")}</span></div>`).join("") || '<div class="empty-copy">当前关系没有证据条目。</div>'}</section>`;
    return;
  }
  if (activeInspectorTab === "style") {
    inspectorContent.innerHTML = `<section class="inspector-section"><h3>关系样式</h3><div class="field-row">${field("颜色", "edge:stroke", edge.stroke || "#8aa0bb", { type: "color" })}${field("线宽", "edge:strokeWidth", edge.strokeWidth || 1.5, { type: "number" })}</div></section>`;
    return;
  }
  inspectorContent.innerHTML = `<section class="inspector-section"><h3>关系属性</h3>${field("标签", "edge:label", edge.label || "")}${field("关系类型", "edge:relation", edge.relation || "depends_on", { type: "select", items: [["depends_on","depends_on"],["calls","calls"],["routes","routes"],["reads","reads"],["writes","writes"],["evaluates","evaluates"],["guards","guards"],["unknown","unknown"]] })}<div class="inspector-actions"><button type="button" data-edge-action="focus">聚焦两端</button><button type="button" data-edge-action="hide">隐藏关系</button>${edge.manual ? '<button class="danger-button" type="button" data-edge-action="delete">删除关系</button>' : '<button type="button" data-edge-action="flag">标记错误</button>'}</div></section>`;
}

function renderInspector() {
  if (!diagram) return;
  const nodes = selectedSemanticNodeIds().map(semanticNode).filter(Boolean);
  const edge = selectedSemanticEdge();
  if (nodes.length) renderNodeInspector(nodes);
  else if (edge) renderEdgeInspector(edge);
  else {
    $("#inspector-kicker").textContent = "当前视图";
    $("#inspector-title").textContent = activeView().label;
    $("#inspector-subtitle").textContent = "选择节点或关系以查看和编辑属性";
    renderViewInspector();
  }
}

function updateSelectionUI() {
  const nodes = selectedSemanticNodes();
  const count = nodes.length;
  selectionToolbar.hidden = count < 2;
  $("#selection-count").textContent = `${count} 个已选`;
  $("#selection-hint").textContent = count ? `已选择 ${count} 个节点；拖动任一节点可整体移动` : "空白拖动框选，Space 拖动画布";
  renderSidebar();
  renderInspector();
}

function updateZoomUI() {
  if (!graph) return;
  zoomInput.value = String(Math.round(graph.zoom() * 100));
  const inspectorZoom = $("#inspector-zoom");
  if (inspectorZoom) inspectorZoom.textContent = `${Math.round(graph.zoom()*100)}%`;
}

function setTool(tool) {
  activeTool = ["select", "pan", "connect"].includes(tool) ? tool : "select";
  appShell.dataset.tool = activeTool;
  graphShell.dataset.tool = activeTool;
  for (const button of $$('[data-tool]')) button.classList.toggle("is-active", button.dataset.tool === activeTool);
  const copy = activeTool === "pan" ? ["hand", "抓手工具"] : activeTool === "connect" ? ["git-branch", "连线工具"] : ["mouse-pointer-2", "选择工具"];
  $("#tool-status").innerHTML = `<i data-lucide="${copy[0]}"></i>${copy[1]}`;
  refreshIcons($("#tool-status"));
  if (activeTool !== "select") graph.cleanSelection();
  interaction.forceIdle();
}

function selectNode(id, options = {}) {
  const cell = graph.getCellById(id);
  if (!cell) return;
  if (!options.additive) graph.cleanSelection();
  if (options.additive && graph.isSelected(cell)) graph.unselect(cell);
  else graph.select(cell);
  if (options.center) scrollerPlugin.centerCell(cell);
  updateSelectionUI();
}

function selectEdge(id) {
  const cell = graph.getCellById(id);
  if (!cell) return;
  graph.cleanSelection();
  graph.select(cell);
  scrollerPlugin.centerCell(cell);
  updateSelectionUI();
}

function fitAll() {
  if (!graph.getNodes().length) return;
  const bounds = graph.getCellsBBox(graph.getNodes());
  const padding = 64;
  const availableWidth = Math.max(160, graphShell.clientWidth - padding * 2);
  const availableHeight = Math.max(160, graphShell.clientHeight - padding * 2);
  const scale = clamp(Math.min(availableWidth / Math.max(bounds.width, 1), availableHeight / Math.max(bounds.height, 1)), MIN_ZOOM, 1);
  graph.zoomTo(scale);
  scrollerPlugin.centerPoint(bounds.getCenter().x, bounds.getCenter().y);
  updateZoomUI();
}

function fitSelection() {
  const cells = selectedSemanticNodes();
  if (!cells.length) return fitAll();
  const bbox = graph.getCellsBBox(cells);
  scrollerPlugin.zoomToRect(bbox, { padding: 90, maxScale: 1.6, minScale: MIN_ZOOM });
  updateZoomUI();
}

function zoomBy(factor) {
  scrollerPlugin.zoom(factor - 1, { minScale: MIN_ZOOM, maxScale: MAX_ZOOM });
  updateZoomUI();
}

function setZoom(percent) {
  const target = clamp(Number(percent) / 100, MIN_ZOOM, MAX_ZOOM);
  graph.zoomTo(target);
  updateZoomUI();
}

function switchView(viewIdOrType) {
  const selectionIds = selectedSemanticNodeIds();
  syncGraphLayoutToDiagram();
  const current = activeView();
  const nextType = diagram.views.find((view) => view.id === viewIdOrType || view.type === viewIdOrType)?.type || viewIdOrType;
  if (nextType === "dependency" && selectionIds.length === 1) currentDependencyRoot(selectionIds[0]);
  if (nextType === "mindmap" && selectionIds.length === 1) currentMindmapRoot(selectionIds[0]);
  diagram = activate(diagram, viewIdOrType);
  selectedBeforeViewSwitch = selectionIds;
  renderGraph({ selectionIds });
  const next = activeView();
  requestAnimationFrame(() => restoreCamera(next.camera, !next.camera));
  scheduleAutosave();
}

function currentDependencyRoot(id) {
  const view = diagram.views.find((item) => item.type === "dependency");
  if (!view || !id) return;
  view.filters = { ...(view.filters || {}), rootId: id };
}

function currentMindmapRoot(id) {
  const view = diagram.views.find((item) => item.type === "mindmap");
  if (!view || !id) return;
  view.modeOptions = { ...(view.modeOptions || {}), rootId: id };
}

async function autoLayout() {
  const before = snapshot();
  const view = activeView();
  $("#background-status").textContent = "正在自动布局…";
  try {
    const blueprint = activeBlueprint();
    const laidOut = await runLayoutWorker(blueprint, view.type);
    const index = currentViewIndex();
    const nextDiagram = clone(diagram);
    const nextView = nextDiagram.views[index];
    nextView.layout.nodes = Object.fromEntries(laidOut.nodes.map((node) => [node.id, { x: node.x, y: node.y, width: node.width, height: node.height }]));
    nextView.layout.layers = Object.fromEntries((laidOut.layers || []).map((layer) => [layer.id, { x: layer.x, y: layer.y, width: layer.width, height: layer.height }]));
    nextView.layout.engine = "elk";
    nextView.layout.mode = "auto";
    const after = { diagram: nextDiagram, filePath: currentFilePath };
    history.execute(command("自动布局", () => restoreSnapshot(after), () => restoreSnapshot(before)));
    requestAnimationFrame(fitAll);
    showToast("当前视图已重新布局");
  } catch (error) {
    showError(error);
  } finally {
    $("#background-status").textContent = "";
    updateHistoryButtons();
  }
}

function runLayoutWorker(blueprint, type) {
  if (typeof Worker === "undefined") return layoutWithElk(blueprint, type);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./views/layout-worker.mjs", import.meta.url), { type: "module" });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("自动布局超时")); }, 20000);
    worker.addEventListener("message", (event) => {
      clearTimeout(timer);
      worker.terminate();
      if (event.data?.ok) resolve(event.data.diagram);
      else reject(new Error(event.data?.error || "自动布局失败"));
    });
    worker.addEventListener("error", (error) => { clearTimeout(timer); worker.terminate(); reject(error); });
    worker.postMessage({ diagram: blueprint, viewType: type });
  });
}

function addManualNode(kind = "module") {
  const visibleArea = currentCamera();
  const point = {
    x: visibleArea.x + graphShell.clientWidth / (2 * visibleArea.zoom),
    y: visibleArea.y + graphShell.clientHeight / (2 * visibleArea.zoom),
  };
  const id = `manual-${kind}-${Date.now().toString(36)}`;
  runMutation(`新建${kind === "note" ? "便签" : kind === "group" ? "分组" : "模块"}`, (next) => {
    const node = {
      id,
      title: kind === "note" ? "新便签" : kind === "group" ? "新分组" : kind === "external" ? "外部系统" : "新模块",
      subtitle: kind === "note" ? "双击或在检查器中编辑" : "填写职责说明",
      kind,
      status: kind === "external" ? "external" : "planned",
      manual: true,
      x: Math.round((point.x - (kind === "group" ? GROUP_WIDTH : CARD_WIDTH) / 2) / GRID_SIZE) * GRID_SIZE,
      y: Math.round((point.y - (kind === "group" ? GROUP_HEIGHT : CARD_HEIGHT) / 2) / GRID_SIZE) * GRID_SIZE,
      width: kind === "group" ? GROUP_WIDTH : CARD_WIDTH,
      height: kind === "group" ? GROUP_HEIGHT : CARD_HEIGHT,
      evidence: [],
    };
    next.nodes.push(node);
    const view = next.views.find((item) => item.id === next.activeViewId);
    view.layout.nodes[id] = { x: node.x, y: node.y, width: node.width, height: node.height };
  }, { selectionIds: [id] });
  requestAnimationFrame(() => selectNode(id, { center: true }));
}

function addChildOrSibling(asChild) {
  const parentId = selectedSemanticNodeIds().at(-1);
  if (!parentId || activeView().type !== "mindmap") return addManualNode("module");
  const parent = semanticNode(parentId);
  const id = `manual-node-${Date.now().toString(36)}`;
  runMutation(asChild ? "新建子节点" : "新建同级节点", (next) => {
    const node = { id, title: asChild ? "新子节点" : "新同级节点", subtitle: "填写职责说明", kind: "module", status: "planned", manual: true, parentId: asChild ? parentId : parent.parentId, x: Number(parent.x || 0) + 260, y: Number(parent.y || 0) + 90, width: CARD_WIDTH, height: CARD_HEIGHT };
    next.nodes.push(node);
    next.edges.push({ id: `manual-edge-${Date.now().toString(36)}`, from: asChild ? parentId : (parent.parentId || parentId), to: id, relation: "contains", manual: true });
  }, { selectionIds: [id] });
}

function copySelection() {
  const nodeIds = selectedSemanticNodeIds();
  if (!nodeIds.length) return;
  const blueprint = activeBlueprint();
  copiedPayload = copySubgraph(blueprint, nodeIds);
  graph.copy(selectedCells());
  pasteCount = 0;
  showToast(`已复制 ${nodeIds.length} 个节点`);
}

function cutSelection() {
  copySelection();
  deleteSelection({ cut: true });
}

function pasteSelection() {
  if (!copiedPayload?.nodes?.length) return;
  pasteCount += 1;
  const offset = pasteCount * 24;
  const pasted = pasteSubgraph(copiedPayload, { offset });
  const newIds = pasted.nodeIds;
  runMutation("粘贴", (next) => {
    next.nodes.push(...pasted.nodes);
    next.edges.push(...pasted.edges);
  }, { selectionIds: newIds });
  showToast(`已粘贴 ${newIds.length} 个节点`);
}

function hideSelection() {
  const ids = selectedSemanticNodeIds();
  const edge = selectedSemanticEdge();
  if (!ids.length && !edge) return;
  runMutation("从视图隐藏", (next) => {
    const view = next.views.find((item) => item.id === next.activeViewId);
    view.hiddenNodes = [...new Set([...(view.hiddenNodes || []), ...ids])];
    if (edge) view.hiddenEdges = [...new Set([...(view.hiddenEdges || []), edge.getData().edgeId])];
  });
}

function deleteSelection(options = {}) {
  const ids = selectedSemanticNodeIds();
  const selectedEdge = selectedSemanticEdge();
  if (!ids.length && !selectedEdge) return;
  runMutation(options.cut ? "剪切" : "删除/隐藏", (next) => {
    const view = next.views.find((item) => item.id === next.activeViewId);
    const trulyDelete = new Set(next.nodes.filter((node) => ids.includes(node.id) && node.manual).map((node) => node.id));
    const generated = ids.filter((id) => !trulyDelete.has(id));
    next.nodes = next.nodes.filter((node) => !trulyDelete.has(node.id));
    next.edges = next.edges.filter((edge, index) => {
      if (trulyDelete.has(edge.from) || trulyDelete.has(edge.to)) return false;
      if (selectedEdge && stableEdgeId(edge, index) === selectedEdge.getData().edgeId && edge.manual) return false;
      return true;
    });
    view.hiddenNodes = [...new Set([...(view.hiddenNodes || []), ...generated])];
    if (selectedEdge && !selectedEdge.getData().manual) view.hiddenEdges = [...new Set([...(view.hiddenEdges || []), selectedEdge.getData().edgeId])];
  });
}

function toggleLayer(layerId) {
  runMutation("切换图层", (next) => {
    const view = next.views.find((item) => item.id === next.activeViewId);
    const set = new Set(view.hiddenLayers || []);
    if (set.has(layerId)) set.delete(layerId); else set.add(layerId);
    view.hiddenLayers = [...set];
  });
}

function saveCurrentView() {
  syncGraphLayoutToDiagram();
  const id = `saved-${Date.now().toString(36)}`;
  runMutation("保存视图", (next) => {
    next.savedViews ||= [];
    next.savedViews.push({ id, label: `${activeView().label} ${next.savedViews.length + 1}`, viewId: next.activeViewId, camera: currentCamera(), createdAt: new Date().toISOString() });
  });
  showToast("已保存当前视图位置");
}

function groupSelected() {
  const ids = selectedSemanticNodeIds();
  if (ids.length < 2) return;
  const cells = ids.map((id) => graph.getCellById(id)).filter(Boolean);
  const bbox = graph.getCellsBBox(cells).inflate(42);
  const groupId = `manual-group-${Date.now().toString(36)}`;
  runMutation("创建分组", (next) => {
    next.nodes.push({ id: groupId, title: "节点分组", subtitle: `${ids.length} 个成员`, kind: "group", status: "planned", manual: true, x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height });
    for (const node of next.nodes) if (ids.includes(node.id)) node.groupId = groupId;
  }, { selectionIds: ids });
}

function alignSelection(mode) {
  const cells = selectedSemanticNodes();
  if (cells.length < 2) return;
  const before = snapshot();
  const boxes = cells.map((cell) => ({ cell, bbox: cell.getBBox() }));
  if (mode === "align-left") {
    const x = Math.min(...boxes.map((item) => item.bbox.x));
    for (const { cell } of boxes) cell.setPosition(x, cell.position().y);
  } else if (mode === "align-top") {
    const y = Math.min(...boxes.map((item) => item.bbox.y));
    for (const { cell } of boxes) cell.setPosition(cell.position().x, y);
  } else {
    const sorted = boxes.sort((a,b) => a.bbox.x - b.bbox.x);
    const left = sorted[0].bbox.x;
    const right = sorted.at(-1).bbox.x;
    const step = (right - left) / Math.max(1, sorted.length - 1);
    sorted.forEach((item,index) => item.cell.setPosition(Math.round((left + step*index)/GRID_SIZE)*GRID_SIZE, item.cell.position().y));
  }
  syncGraphLayoutToDiagram();
  const after = snapshot();
  recordAppliedMutation("对齐与分布", before, after, { selectionIds: cells.map((cell) => cell.id) });
}

function shortestPathForSelection() {
  const ids = selectedSemanticNodeIds();
  if (ids.length !== 2) return showToast("请选择两个节点以显示最短路径");
  const result = shortestPath(diagram, ids[0], ids[1]);
  if (!result?.nodeIds?.length) return showToast("两个节点之间没有可见路径");
  const view = activeView();
  const keep = new Set(result.nodeIds);
  runMutation("聚焦最短路径", (next) => {
    const target = next.views.find((item) => item.id === next.activeViewId);
    target.hiddenNodes = next.nodes.filter((node) => !keep.has(node.id)).map((node) => node.id);
  }, { selectionIds: ids });
}

function bindGraphEvents() {
  graph.on("selection:changed", () => {
    if (suppressGraphEvents) return;
    updateSelectionUI();
  });

  graph.on("node:mousedown", ({ node, e }) => {
    const data = node.getData() || {};
    if (data.type === "layer") return;
    contextMenu.hidden = true;
    if (activeTool === "pan" || spaceDown || e.button === 1) {
      e.preventDefault();
      beginCanvasPan(e);
      return;
    }
    if (activeTool !== "select") return;
    dragSnapshot = snapshot();
    interaction.begin(InteractionState.DRAGGING, { nodeId: node.id });
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive && !graph.isSelected(node)) graph.cleanSelection();
    if (additive && graph.isSelected(node)) graph.unselect(node); else graph.select(node);
    selectionBeforePointer = selectedSemanticNodeIds();
  });

  graph.on("node:moved", ({ node }) => {
    if (suppressGraphEvents || !dragSnapshot) return;
    syncGraphLayoutToDiagram();
    maybeEmbedNode(node);
    const after = snapshot();
    recordAppliedMutation("移动节点", dragSnapshot, after, { selectionIds: selectedSemanticNodeIds() });
    dragSnapshot = null;
    interaction.end();
  });

  graph.on("node:resized", ({ node }) => {
    if (suppressGraphEvents) return;
    const before = dragSnapshot || snapshot();
    syncGraphLayoutToDiagram();
    const after = snapshot();
    recordAppliedMutation("调整节点尺寸", before, after, { selectionIds: [node.id] });
    dragSnapshot = null;
  });

  graph.on("node:dblclick", ({ node }) => {
    const data = node.getData() || {};
    if (data.type === "layer") return drillIntoLayer(data.layerId);
    if (data.group) return drillIntoGroup(node.id);
    selectNode(node.id);
    activeInspectorTab = "details";
    updateInspectorTabs();
    renderInspector();
    requestAnimationFrame(() => inspectorContent.querySelector('[data-node-field="title"]')?.focus());
  });

  graph.on("edge:click", ({ edge, e }) => {
    e.stopPropagation();
    graph.cleanSelection();
    graph.select(edge);
  });

  graph.on("edge:connected", ({ edge, isNew, currentCell, currentMagnet, currentView, terminalType }) => {
    if (!isNew || suppressGraphEvents) return;
    const before = snapshot();
    const source = edge.getSourceCellId();
    let target = edge.getTargetCellId();
    if (!target) {
      const point = edge.getTargetPoint();
      target = `manual-node-${Date.now().toString(36)}`;
      const node = { id: target, title: "新关联模块", subtitle: "由连线创建", kind: "module", status: "planned", manual: true, x: point.x - CARD_WIDTH/2, y: point.y - CARD_HEIGHT/2, width: CARD_WIDTH, height: CARD_HEIGHT };
      diagram.nodes.push(node);
    }
    if (!source || !target || source === target) {
      edge.remove();
      return;
    }
    const id = `manual-edge-${Date.now().toString(36)}`;
    diagram.edges.push({ id, from: source, to: target, relation: activeView().type === "mindmap" ? "contains" : activeView().type === "dependency" ? "depends_on" : "calls", label: "手动关系", manual: true, evidence: [] });
    const after = snapshot();
    recordAppliedMutation("创建关系", before, after, { selectionIds: [source, target] });
    renderGraph({ selectionIds: [source, target] });
  });

  graph.on("blank:mousedown", ({ e, x, y }) => {
    contextMenu.hidden = true;
    if (e.button === 1 || activeTool === "pan" || spaceDown) {
      beginCanvasPan(e);
      return;
    }
    if (e.button !== 0 || activeTool !== "select") return;
    const rect = graphShell.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = { x, y };
    if (e.altKey) {
      interaction.begin(InteractionState.LASSO, { start: world });
      lassoState = { points: [world], screenPoints: [screen], baseSelection: selectedSemanticNodeIds(), additive: e.shiftKey };
      drawLasso();
    } else {
      interaction.begin(InteractionState.MARQUEE, { start: world });
      marqueeState = { startWorld: world, startScreen: screen, currentWorld: world, currentScreen: screen, baseSelection: selectedSemanticNodeIds(), additive: e.shiftKey };
      marqueeElement.hidden = false;
      updateMarqueeElement();
    }
  });

  graph.on("blank:click", () => {
    if (interaction.state === InteractionState.IDLE && activeTool === "select") graph.cleanSelection();
  });

  graph.on("scale", updateZoomUI);
}

function maybeEmbedNode(node) {
  if (node.getData()?.type !== "node" || node.getData()?.group) return;
  const center = node.getBBox().getCenter();
  const group = graph.getNodes().find((candidate) => candidate.id !== node.id && candidate.getData()?.group && candidate.getBBox().containsPoint(center));
  const previous = semanticNode(node.id)?.groupId;
  if (group?.id === previous) return;
  const semantic = semanticNode(node.id);
  if (!semantic) return;
  semantic.groupId = group?.id;
  if (group) group.addChild(node); else node.setParent(null);
}

function updateMarqueeElement() {
  if (!marqueeState) return;
  const left = Math.min(marqueeState.startScreen.x, marqueeState.currentScreen.x);
  const top = Math.min(marqueeState.startScreen.y, marqueeState.currentScreen.y);
  const width = Math.abs(marqueeState.currentScreen.x - marqueeState.startScreen.x);
  const height = Math.abs(marqueeState.currentScreen.y - marqueeState.startScreen.y);
  Object.assign(marqueeElement.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  marqueeElement.classList.toggle("is-crossing", marqueeState.currentWorld.x < marqueeState.startWorld.x);
}

function drawLasso() {
  if (!lassoState) {
    lassoOverlay.innerHTML = "";
    return;
  }
  const points = lassoState.screenPoints.map((point) => `${point.x},${point.y}`).join(" L ");
  lassoOverlay.innerHTML = `<path d="M ${points} Z"></path>`;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) && point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function finishMarquee() {
  if (!marqueeState) return;
  const items = graph.getNodes().filter((cell) => cell.getData()?.type === "node").map((cell) => ({ id: cell.id, ...cell.getBBox().toJSON(), locked: false, hidden: false }));
  const result = selectByMarquee(items, marqueeState.startWorld, marqueeState.currentWorld, marqueeState.baseSelection, { shift: marqueeState.additive });
  graph.cleanSelection();
  for (const id of result.selectionIds) if (graph.getCellById(id)) graph.select(id);
  marqueeElement.hidden = true;
  marqueeState = null;
  interaction.end();
  updateSelectionUI();
}

function finishLasso() {
  if (!lassoState) return;
  const ids = graph.getNodes().filter((cell) => cell.getData()?.type === "node" && pointInPolygon(cell.getBBox().getCenter(), lassoState.points)).map((cell) => cell.id);
  const selected = new Set(lassoState.additive ? lassoState.baseSelection : []);
  for (const id of ids) lassoState.additive && selected.has(id) ? selected.delete(id) : selected.add(id);
  graph.cleanSelection();
  for (const id of selected) graph.select(id);
  lassoState = null;
  lassoOverlay.innerHTML = "";
  interaction.end();
  updateSelectionUI();
}

function drillIntoLayer(layerId) {
  const layer = diagram.layers.find((item) => item.id === layerId);
  if (!layer) return;
  const before = snapshot();
  viewNavigation.push({ type: "layer", id: layerId, label: layer.label || layerId, before });
  const view = activeView();
  view.hiddenLayers = diagram.layers.filter((item) => item.id !== layerId).map((item) => item.id);
  renderGraph();
  requestAnimationFrame(fitAll);
}

function drillIntoGroup(groupId) {
  const group = semanticNode(groupId);
  if (!group) return;
  const before = snapshot();
  viewNavigation.push({ type: "group", id: groupId, label: group.title, before });
  const members = new Set([groupId, ...diagram.nodes.filter((node) => node.groupId === groupId).map((node) => node.id)]);
  activeView().hiddenNodes = diagram.nodes.filter((node) => !members.has(node.id)).map((node) => node.id);
  renderGraph({ selectionIds: [groupId] });
  requestAnimationFrame(fitAll);
}

function resetDrilldown() {
  if (!viewNavigation.length) return;
  const first = viewNavigation[0].before;
  viewNavigation = [];
  restoreSnapshot(first);
  requestAnimationFrame(fitAll);
}

function returnFromDrilldown() {
  const entry = viewNavigation.pop();
  if (!entry) return false;
  restoreSnapshot(entry.before);
  requestAnimationFrame(() => restoreCamera(activeView().camera));
  return true;
}

function bindPointerWindowEvents() {
  window.addEventListener("pointermove", (event) => {
    const rect = graphShell.getBoundingClientRect();
    if (panState) {
      scrollerPlugin.setScrollbarPosition(
        panState.left - (event.clientX - panState.clientX),
        panState.top - (event.clientY - panState.clientY),
      );
      return;
    }
    const nearEdge = event.clientX < rect.left + 32 || event.clientX > rect.right - 32 || event.clientY < rect.top + 32 || event.clientY > rect.bottom - 32;
    if (nearEdge && (marqueeState || lassoState)) scrollerPlugin.autoScroll(event.clientX, event.clientY);
    if (marqueeState) {
      marqueeState.currentScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      marqueeState.currentWorld = graph.clientToLocal({ x: event.clientX, y: event.clientY });
      if (isSignificantDrag(marqueeState.startScreen, marqueeState.currentScreen)) updateMarqueeElement();
    }
    if (lassoState) {
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const last = lassoState.screenPoints.at(-1);
      if (!last || Math.hypot(screen.x-last.x, screen.y-last.y) > 4) {
        lassoState.screenPoints.push(screen);
        lassoState.points.push(graph.clientToLocal({ x: event.clientX, y: event.clientY }));
        drawLasso();
      }
    }
  });
  window.addEventListener("pointerup", () => {
    if (interaction.state === InteractionState.PANNING) {
      graphShell.classList.remove("is-panning");
      panState = null;
      interaction.end();
    }
    finishMarquee();
    finishLasso();
    if (interaction.state === InteractionState.DRAGGING && !dragSnapshot) interaction.end();
  });
}

function renderSearchResults() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    searchResults.hidden = true;
    for (const cell of graph.getNodes()) cell.attr("body/opacity", 1);
    return;
  }
  const matches = diagram.nodes.filter((node) => [node.title,node.subtitle,node.kind,node.status,...(node.evidence||[])].join(" ").toLowerCase().includes(query));
  searchResults.hidden = false;
  searchResults.innerHTML = matches.slice(0,30).map((node) => `<button type="button" data-search-id="${node.id}"><strong>${node.title}</strong><span>${node.subtitle || node.id}</span></button>`).join("") || '<div class="empty-copy">没有匹配结果。</div>';
  const matchIds = new Set(matches.map((node) => node.id));
  for (const cell of graph.getNodes()) if (cell.getData()?.type === "node") cell.attr("body/opacity", matchIds.has(cell.id) ? 1 : .22);
}

function updateInspectorTabs() {
  for (const button of $$('[data-inspector-tab]')) button.classList.toggle("is-active", button.dataset.inspectorTab === activeInspectorTab);
}

function applyInspectorChange(target) {
  const key = target.dataset.nodeField;
  if (!key) return;
  if (key.startsWith("view:")) {
    const property = key.slice(5);
    runMutation("修改视图设置", (next) => {
      const view = next.views.find((item) => item.id === next.activeViewId);
      if (property === "direction") view.filters.direction = target.value;
      else if (property === "depth") view.filters.depth = clamp(Number(target.value), 1, 5);
      else view.modeOptions.layout = target.value;
    });
    return;
  }
  if (key.startsWith("edge:")) {
    const edgeCell = selectedSemanticEdge();
    if (!edgeCell) return;
    const edgeId = edgeCell.getData().edgeId;
    const property = key.slice(5);
    runMutation("编辑关系", (next) => {
      const edge = next.edges.find((item,index) => stableEdgeId(item,index) === edgeId);
      if (edge) edge[property] = property === "strokeWidth" ? clamp(Number(target.value), .5, 12) : target.value;
    });
    return;
  }
  const ids = selectedSemanticNodeIds();
  if (!ids.length) return;
  const value = target.type === "checkbox" ? target.checked : target.type === "number" ? Number(target.value) : target.value;
  runMutation("编辑节点", (next) => {
    for (const node of next.nodes) {
      if (!ids.includes(node.id)) continue;
      if (key === "x" || key === "y") {
        const view = next.views.find((item) => item.id === next.activeViewId);
        view.layout.nodes[node.id] ||= {};
        view.layout.nodes[node.id][key] = Math.round(Number(value)/GRID_SIZE)*GRID_SIZE;
        if (view.type === "architecture") node[key] = view.layout.nodes[node.id][key];
      } else if (key === "title") node.title = textOf(value).trim() || "未命名";
      else if (key === "titleSize") node.titleSize = clamp(Number(value), 11, 24);
      else if (key === "subtitleSize") node.subtitleSize = clamp(Number(value), 9, 18);
      else node[key] = value;
    }
  }, { selectionIds: ids });
}

function exportBlueprint() {
  syncGraphLayoutToDiagram();
  return resolveView(diagram, diagram.activeViewId, { routeEdges: true });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportSvg() {
  const blueprint = exportBlueprint();
  downloadBlob(new Blob([renderSvg(blueprint)], { type: "image/svg+xml" }), `${slug(diagram.title)}.svg`);
}

async function exportPng() {
  const blueprint = exportBlueprint();
  const svg = renderSvg(blueprint);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const image = new Image();
  const url = URL.createObjectURL(blob);
  await new Promise((resolve,reject) => { image.onload=resolve; image.onerror=reject; image.src=url; });
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = blueprint.canvas.width * scale;
  canvas.height = blueprint.canvas.height * scale;
  const context = canvas.getContext("2d");
  context.fillStyle = blueprint.canvas.background || "#ffffff";
  context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(image,0,0,canvas.width,canvas.height);
  URL.revokeObjectURL(url);
  const output = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  downloadBlob(output, `${slug(diagram.title)}.png`);
}

async function exportPdf() {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import("jspdf"),
    import("svg2pdf.js"),
  ]);
  const blueprint = exportBlueprint();
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-99999px";
  holder.innerHTML = renderSvg(blueprint);
  document.body.append(holder);
  const svg = holder.querySelector("svg");
  const landscape = blueprint.canvas.width >= blueprint.canvas.height;
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: [blueprint.canvas.width, blueprint.canvas.height] });
  await svg2pdf(svg, pdf, { xOffset: 0, yOffset: 0, scale: 1 });
  pdf.save(`${slug(diagram.title)}.pdf`);
  holder.remove();
}

function exportJson() {
  syncGraphLayoutToDiagram();
  downloadBlob(new Blob([`${JSON.stringify(diagram,null,2)}\n`], { type: "application/json" }), `${slug(diagram.title)}.diagram.json`);
}

function exportHtml() {
  const blueprint = exportBlueprint();
  downloadBlob(new Blob([renderStandaloneHtml(blueprint, renderSvg(blueprint))], { type: "text/html" }), `${slug(diagram.title)}.html`);
}

function mermaidFor(blueprint) {
  const lines = ["flowchart TD"];
  for (const node of blueprint.nodes) lines.push(`  ${node.id.replace(/[^a-zA-Z0-9_]/g,"_")}["${String(node.title).replace(/"/g,"'")}"]`);
  for (const edge of blueprint.edges) lines.push(`  ${edge.from.replace(/[^a-zA-Z0-9_]/g,"_")} -->|${String(edge.label || edge.relation || "").replace(/\|/g,"/")}| ${edge.to.replace(/[^a-zA-Z0-9_]/g,"_")}`);
  return `${lines.join("\n")}\n`;
}

function exportMermaid() {
  downloadBlob(new Blob([mermaidFor(exportBlueprint())], { type: "text/plain" }), `${slug(diagram.title)}.mmd`);
}

async function saveDiagram(saveAs = false) {
  syncGraphLayoutToDiagram();
  if (window.mindmapDesktop?.isDesktop) {
    const result = saveAs || !currentFilePath
      ? await window.mindmapDesktop.saveJsonAs({ filePath: currentFilePath || `${slug(diagram.title)}.diagram.json`, diagram })
      : await window.mindmapDesktop.saveJson({ filePath: currentFilePath, diagram });
    if (result?.ok) {
      currentFilePath = result.filePath;
      $("#save-status").textContent = "已保存";
      showToast(`已保存 ${result.filePath.split(/[\\/]/).at(-1)}`);
    } else if (!result?.canceled) showError(result?.error || "保存失败");
    return;
  }
  exportJson();
  $("#save-status").textContent = "已下载 JSON";
}

async function openDiagram() {
  if (window.mindmapDesktop?.isDesktop) {
    const result = await window.mindmapDesktop.openJson();
    if (result?.ok) return loadDiagram(result.diagram, { filePath: result.filePath, fit: true });
    if (!result?.canceled) showError(result?.error || "打开失败");
    return;
  }
  openFileInput.click();
}

async function copySummary() {
  const blueprint = activeBlueprint();
  const text = `${diagram.title}\n${diagram.subtitle || ""}\n${blueprint.nodes.length} 个节点，${blueprint.edges.length} 条关系\n${blueprint.nodes.map((node) => `- ${node.title}: ${node.subtitle || ""}`).join("\n")}`;
  await navigator.clipboard.writeText(text);
  showToast("摘要已复制");
}

function loadDiagram(input, options = {}) {
  try {
    const validated = assertValidDiagram(clone(input));
    diagram = ensureViews(validated);
    currentFilePath = options.filePath || "";
    history.clear();
    viewNavigation = [];
    renderGraph();
    clearError();
    updateHistoryButtons();
    requestAnimationFrame(() => options.fit === false ? restoreCamera(activeView().camera) : fitAll());
    scheduleAutosave();
  } catch (error) {
    showError(error);
  }
}

async function loadDefault() {
  try {
    const stored = localStorage.getItem("mindmap:last-diagram");
    if (stored) {
      loadDiagram(JSON.parse(stored), { filePath: localStorage.getItem("mindmap:last-file") || "", fit: true });
      return;
    }
  } catch {
    // Ignore stale local state and load the shipped example.
  }
  const response = await fetch(DEFAULT_DIAGRAM_URL);
  if (!response.ok) throw new Error(`无法载入默认示例：HTTP ${response.status}`);
  loadDiagram(await response.json(), { fit: true });
}

function commandDefinitions() {
  return [
    ["选择工具", "V", () => setTool("select")], ["抓手工具", "H", () => setTool("pan")], ["连线工具", "C", () => setTool("connect")],
    ["新建模块", "B", () => addManualNode("module")], ["新建便签", "N", () => addManualNode("note")], ["新建分组", "G", groupSelected],
    ["自动布局", "L", autoLayout], ["适应全部", "0", fitAll], ["适应选中", "Shift+0", fitSelection],
    ["保存", "Ctrl/Cmd+S", () => saveDiagram(false)], ["另存为", "Ctrl/Cmd+Shift+S", () => saveDiagram(true)], ["打开", "Ctrl/Cmd+O", openDiagram],
    ["导出 SVG", "", exportSvg], ["导出 PNG", "", exportPng], ["导出 PDF", "", exportPdf], ["导出 Mermaid", "", exportMermaid],
  ];
}

function renderCommandPalette(query = "") {
  const normalized = query.trim().toLowerCase();
  const commands = commandDefinitions().filter(([label]) => label.toLowerCase().includes(normalized));
  commandList.innerHTML = commands.map(([label,shortcut], index) => `<button type="button" data-command-index="${commandDefinitions().indexOf(commands[index])}"><span>${label}</span>${shortcut ? `<kbd>${shortcut}</kbd>` : ""}</button>`).join("");
}

function openCommandPalette() {
  renderCommandPalette();
  commandPalette.showModal();
  commandSearch.value = "";
  commandSearch.focus();
}

function showContextMenu(event, items) {
  contextMenu.innerHTML = items.map(([label, action]) => `<button type="button" data-context-action="${action}">${label}</button>`).join("");
  contextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 200)}px`;
  contextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - items.length*34 - 16)}px`;
  contextMenu.hidden = false;
}

function bindDomEvents() {
  $("#dismiss-error").addEventListener("click", clearError);
  $("#toggle-left").addEventListener("click", () => appShell.classList.toggle("is-left-collapsed"));
  $("#toggle-right").addEventListener("click", () => appShell.classList.toggle("is-right-collapsed"));
  for (const button of $$('[data-tool]')) button.addEventListener("click", () => setTool(button.dataset.tool));
  for (const button of $$('[data-view-mode]')) button.addEventListener("click", () => switchView(button.dataset.viewMode));
  $("#add-node").addEventListener("click", () => addManualNode("module"));
  $("#add-note").addEventListener("click", () => addManualNode("note"));
  $("#add-group").addEventListener("click", () => addManualNode("group"));
  $("#add-external").addEventListener("click", () => addManualNode("external"));
  $("#empty-add").addEventListener("click", () => addManualNode("module"));
  $("#auto-layout").addEventListener("click", autoLayout);
  $("#undo").addEventListener("click", undo);
  $("#redo").addEventListener("click", redo);
  $("#open-file-button").addEventListener("click", openDiagram);
  openFileInput.addEventListener("change", async () => {
    const file = openFileInput.files?.[0];
    if (!file) return;
    try { loadDiagram(JSON.parse(await file.text()), { filePath: file.name, fit: true }); } catch (error) { showError(error); }
    openFileInput.value = "";
  });
  $("#copy-summary").addEventListener("click", () => copySummary().catch(showError));
  for (const button of $$('[data-export]')) button.addEventListener("click", () => {
    const actions = { svg: exportSvg, png: exportPng, pdf: exportPdf, json: exportJson, html: exportHtml, mermaid: exportMermaid };
    Promise.resolve(actions[button.dataset.export]?.()).catch(showError);
    button.closest("details")?.removeAttribute("open");
  });
  $("#zoom-out").addEventListener("click", () => zoomBy(1 / ZOOM_STEP));
  $("#zoom-in").addEventListener("click", () => zoomBy(ZOOM_STEP));
  $("#fit").addEventListener("click", fitAll);
  $("#fit-selection").addEventListener("click", fitSelection);
  $("#actual-size").addEventListener("click", () => setZoom(100));
  zoomInput.addEventListener("change", () => setZoom(zoomInput.value));
  $("#toggle-minimap").addEventListener("click", () => $(".minimap-shell").classList.toggle("is-collapsed"));
  $("#toggle-grid").addEventListener("click", () => {
    gridEnabled = !gridEnabled;
    graph.showGrid(gridEnabled);
    graph.options.grid.size = gridEnabled ? GRID_SIZE : 1;
    $("#toggle-grid span").textContent = gridEnabled ? "8px" : "关闭";
  });
  $("#show-all-layers").addEventListener("click", () => runMutation("显示全部图层", (next) => { next.views.find((view) => view.id === next.activeViewId).hiddenLayers = []; }));
  $("#save-view").addEventListener("click", saveCurrentView);

  for (const button of $$('[data-sidebar-tab]')) button.addEventListener("click", () => {
    activeSidebarTab = button.dataset.sidebarTab;
    for (const item of $$('[data-sidebar-tab]')) item.classList.toggle("is-active", item === button);
    for (const panel of $$('[data-sidebar-panel]')) panel.hidden = panel.dataset.sidebarPanel !== activeSidebarTab;
  });
  for (const button of $$('[data-inspector-tab]')) button.addEventListener("click", () => {
    activeInspectorTab = button.dataset.inspectorTab;
    updateInspectorTabs();
    renderInspector();
  });

  searchInput.addEventListener("input", renderSearchResults);
  searchResults.addEventListener("click", (event) => {
    const id = event.target.closest("[data-search-id]")?.dataset.searchId;
    if (id) { selectNode(id, { center: true }); searchResults.hidden = true; }
  });
  inspectorContent.addEventListener("change", (event) => applyInspectorChange(event.target));
  inspectorContent.addEventListener("click", (event) => {
    const edgeId = event.target.closest("[data-edge-id]")?.dataset.edgeId;
    if (edgeId) return selectEdge(edgeId);
    const nodeAction = event.target.closest("[data-node-action]")?.dataset.nodeAction;
    if (nodeAction === "duplicate") { copySelection(); pasteSelection(); }
    if (nodeAction === "hide") hideSelection();
    if (nodeAction === "delete") deleteSelection();
    if (nodeAction === "focus") fitSelection();
    const edgeAction = event.target.closest("[data-edge-action]")?.dataset.edgeAction;
    if (edgeAction === "focus") {
      const edge = selectedSemanticEdge()?.getData()?.edge;
      if (edge) { graph.cleanSelection(); graph.select([edge.from,edge.to]); fitSelection(); }
    }
    if (edgeAction === "hide") hideSelection();
    if (edgeAction === "delete") deleteSelection();
    if (edgeAction === "flag") applyInspectorEdgeFlag();
    const viewAction = event.target.closest("[data-view-action]")?.dataset.viewAction;
    if (viewAction === "shortest-path") shortestPathForSelection();
    if (viewAction === "clear-filter") runMutation("清除依赖聚焦", (next) => { const view=next.views.find((item)=>item.id===next.activeViewId); delete view.filters.rootId; view.hiddenNodes=[]; });
    if (viewAction === "set-root") { const id=selectedSemanticNodeIds().at(-1); if(id){runMutation("设置 MindMap 根节点",(next)=>{next.views.find((item)=>item.id===next.activeViewId).modeOptions.rootId=id;}); autoLayout();} }
    if (viewAction === "reset-drilldown") resetDrilldown();
  });

  selectionToolbar.addEventListener("click", (event) => {
    const action = event.target.closest("[data-batch-action]")?.dataset.batchAction;
    if (action === "align-left" || action === "align-top" || action === "distribute") alignSelection(action);
    else if (action === "group") groupSelected();
    else if (action === "hide") hideSelection();
    else if (action === "delete") deleteSelection();
  });

  commandSearch.addEventListener("input", () => renderCommandPalette(commandSearch.value));
  commandList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-command-index]");
    if (!button) return;
    commandPalette.close();
    commandDefinitions()[Number(button.dataset.commandIndex)]?.[2]?.();
  });
  commandPalette.addEventListener("click", (event) => { if (event.target === commandPalette) commandPalette.close(); });

  graphShell.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const selected = selectedSemanticNodeIds().length;
    showContextMenu(event, selected ? [["聚焦", "focus"],["复制", "copy"],["创建分组", "group"],["从视图隐藏", "hide"],["删除/隐藏", "delete"]] : [["新建模块", "add"],["新建便签", "note"],["新建分组框", "add-group"],["自动布局", "layout"],["适应全部", "fit"]]);
  });
  contextMenu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-context-action]")?.dataset.contextAction;
    const actions = { focus: fitSelection, copy: copySelection, group: groupSelected, hide: hideSelection, delete: deleteSelection, add: () => addManualNode("module"), note: () => addManualNode("note"), "add-group": () => addManualNode("group"), layout: autoLayout, fit: fitAll };
    actions[action]?.();
    contextMenu.hidden = true;
  });
  document.addEventListener("pointerdown", (event) => { if (!event.target.closest?.("#context-menu")) contextMenu.hidden = true; });

  bindResizer($("#left-resizer"), "--sidebar-width", 220, 420, 1);
  bindResizer($("#right-resizer"), "--inspector-width", 280, 500, -1);
}

function applyInspectorEdgeFlag() {
  const cell = selectedSemanticEdge();
  if (!cell) return;
  const id = cell.getData().edgeId;
  runMutation("标记关系错误", (next) => { const edge=next.edges.find((item,index)=>stableEdgeId(item,index)===id); if(edge) edge.flagged=!edge.flagged; });
}

function bindResizer(handle, property, min, max, direction) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const start = event.clientX;
    const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(property));
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent) => document.documentElement.style.setProperty(property, `${clamp(current + (moveEvent.clientX-start)*direction,min,max)}px`);
    const end = () => { handle.removeEventListener("pointermove",move); handle.removeEventListener("pointerup",end); };
    handle.addEventListener("pointermove",move);
    handle.addEventListener("pointerup",end);
  });
}

function bindKeyboard() {
  window.addEventListener("keydown", (event) => {
    const typing = event.target.matches?.("input,textarea,select,[contenteditable=true]");
    if (event.code === "Space" && !typing) {
      event.preventDefault();
      spaceDown = true;
      graphShell.classList.add("is-space-pan");
      return;
    }
    if (typing) return;
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (mod && key === "k") { event.preventDefault(); return openCommandPalette(); }
    if (mod && key === "f") { event.preventDefault(); searchInput.focus(); return; }
    if (mod && key === "o") { event.preventDefault(); return openDiagram(); }
    if (mod && key === "s") { event.preventDefault(); return saveDiagram(event.shiftKey); }
    if (mod && key === "z") { event.preventDefault(); return event.shiftKey ? redo() : undo(); }
    if (mod && key === "y") { event.preventDefault(); return redo(); }
    if (mod && key === "c") { event.preventDefault(); document.documentElement.dataset.lastShortcut = "copy"; return copySelection(); }
    if (mod && key === "x") { event.preventDefault(); document.documentElement.dataset.lastShortcut = "cut"; return cutSelection(); }
    if (mod && key === "v") { event.preventDefault(); document.documentElement.dataset.lastShortcut = "paste"; return pasteSelection(); }
    if (mod && key === "a") { event.preventDefault(); graph.cleanSelection(); graph.select(graph.getNodes().filter((cell)=>cell.getData()?.type==="node")); return; }
    if (key === "v") return setTool("select");
    if (key === "h") return setTool("pan");
    if (key === "c") return setTool("connect");
    if (key === "b") { document.documentElement.dataset.lastShortcut = "add-node"; return addManualNode("module"); }
    if (key === "n") return addManualNode("note");
    if (key === "g" && !event.shiftKey) return groupSelected();
    if (key === "l") return autoLayout();
    if (event.key === "0" && event.shiftKey) { event.preventDefault(); return fitSelection(); }
    if (event.key === "0") { event.preventDefault(); return fitAll(); }
    if (event.key === "1") { event.preventDefault(); return setZoom(100); }
    if (event.key === "+" || event.key === "=") return zoomBy(ZOOM_STEP);
    if (event.key === "-") return zoomBy(1/ZOOM_STEP);
    if (event.key === "Delete") { event.preventDefault(); return deleteSelection(); }
    if (event.key === "Backspace") {
      if (returnFromDrilldown()) { event.preventDefault(); return; }
      if (selectedSemanticNodeIds().length || selectedSemanticEdge()) { event.preventDefault(); return deleteSelection(); }
    }
    if (event.key === "Escape") {
      contextMenu.hidden = true;
      if (commandPalette.open) commandPalette.close();
      else if (activeTool !== "select") setTool("select");
      else graph.cleanSelection();
      return;
    }
    if (activeView()?.type === "mindmap" && event.key === "Tab") { event.preventDefault(); return addChildOrSibling(true); }
    if (activeView()?.type === "mindmap" && event.key === "Enter") { event.preventDefault(); return addChildOrSibling(false); }
    if (event.key === "?") openCommandPalette();
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      spaceDown = false;
      graphShell.classList.remove("is-space-pan");
    }
  });
  window.addEventListener("blur", () => { spaceDown=false; graphShell.classList.remove("is-space-pan"); interaction.forceIdle(); });
}

async function init() {
  refreshIcons();
  if (window.innerWidth <= 900) appShell.classList.add("is-left-collapsed", "is-right-collapsed");
  else if (window.innerWidth <= 1024) appShell.classList.add("is-right-collapsed");
  initGraph();
  bindDomEvents();
  bindPointerWindowEvents();
  bindKeyboard();
  setTool("select");
  updateHistoryButtons();
  await loadDefault();
  if ("serviceWorker" in navigator && location.protocol !== "mindmap:") {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Offline caching is optional; the editor remains fully usable without it.
    });
  }
}

init().catch(showError);

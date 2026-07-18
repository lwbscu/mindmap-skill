import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog, ipcMain, protocol, shell } = require("electron");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "dist");
const scheme = "mindmap";
const appName = "MindMap";
const desktopName = "mindmap-app.desktop";
const linuxWindowClass = "MindMap";
const iconPath = path.join(root, "app", "assets", "mindmap.png");
const preloadPath = path.join(__dirname, "preload.mjs");
const isSmoke = process.env.MINDMAP_ELECTRON_SMOKE === "1" || process.argv.includes("--smoke");
const isVisual = process.env.MINDMAP_ELECTRON_VISUAL === "1";
const isAutomated = isSmoke || isVisual;

if (isAutomated) {
  app.setPath("userData", path.join(process.env.TMPDIR || "/tmp", `mindmap-smoke-${process.pid}`));
}

app.setName(appName);
if (process.platform === "linux") {
  app.setDesktopName(desktopName);
  app.commandLine.appendSwitch("class", linuxWindowClass);
}

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".ico", "image/x-icon"]
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function contentType(filePath) {
  return types.get(path.extname(filePath)) ?? "application/octet-stream";
}

function resolveMindMapPath(requestUrl) {
  const url = new URL(requestUrl);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "") pathname = "/app/index.html";
  const filePath = path.normalize(path.join(runtimeRoot, pathname));
  if (filePath !== runtimeRoot && !filePath.startsWith(`${runtimeRoot}${path.sep}`)) {
    throw new Error(`Path escapes MindMap root: ${pathname}`);
  }
  return filePath;
}

async function fileResponse(request) {
  try {
    let filePath = resolveMindMapPath(request.url);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    const data = await fs.readFile(filePath);
    return new Response(data, {
      headers: {
        "content-type": contentType(filePath),
        "cache-control": "no-cache"
      }
    });
  } catch (error) {
    return new Response(`Not found: ${error.message}`, {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
}

function isInternalUrl(url) {
  return url.startsWith(`${scheme}://`);
}

function openExternalSafely(url) {
  const parsed = new URL(url);
  if (parsed.protocol === "https:" || parsed.protocol === "http:") {
    shell.openExternal(url);
  }
}

function jsonFilters() {
  return [{ name: "MindMap diagram JSON", extensions: ["json"] }];
}

function normalizeJsonPath(filePath) {
  if (!filePath || typeof filePath !== "string") return "";
  const expanded = path.resolve(filePath);
  return expanded.toLowerCase().endsWith(".json") ? expanded : `${expanded}.json`;
}

function assertJsonValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MindMap JSON payload must be an object.");
  }
  return JSON.stringify(value, null, 2);
}

async function readJsonFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

function registerJsonIpc() {
  ipcMain.handle("mindmap:open-json", async () => {
    const result = await dialog.showOpenDialog({
      title: "Open MindMap diagram",
      properties: ["openFile"],
      filters: jsonFilters()
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    try {
      return { ok: true, filePath, diagram: await readJsonFile(filePath) };
    } catch (error) {
      return { ok: false, filePath, error: error.message };
    }
  });

  ipcMain.handle("mindmap:save-json", async (_event, payload = {}) => {
    try {
      const filePath = normalizeJsonPath(payload.filePath);
      if (!filePath) throw new Error("Missing JSON save path.");
      const json = assertJsonValue(payload.diagram);
      await fs.writeFile(filePath, `${json}\n`, "utf8");
      return { ok: true, filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("mindmap:save-json-as", async (_event, payload = {}) => {
    try {
      const result = await dialog.showSaveDialog({
        title: "Save MindMap diagram",
        defaultPath: normalizeJsonPath(payload.filePath || "mindmap.diagram.json"),
        filters: jsonFilters()
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      const filePath = normalizeJsonPath(result.filePath);
      const json = assertJsonValue(payload.diagram);
      await fs.writeFile(filePath, `${json}\n`, "utf8");
      return { ok: true, filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

function reportSmoke(result) {
  console.log(`MINDMAP_SMOKE_RESULT ${JSON.stringify(result)}`);
}

async function runSmoke(window) {
  try {
    let smokeStep = "initialize";
    const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    const evaluate = (script) => window.webContents.executeJavaScript(script);
    const pointFor = async (selector) => evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    })()`);
    const click = async (point, modifiers = []) => {
      if (!point) throw new Error(`Missing click target during ${smokeStep}`);
      window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
      window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1, modifiers });
      await pause();
    };
    const drag = async (start, end, options = {}) => {
      if (!start || !end) throw new Error(`Missing drag target during ${smokeStep}`);
      const button = options.button || "left";
      const modifiers = options.modifiers || [];
      window.webContents.sendInputEvent({ type: "mouseDown", x: start.x, y: start.y, button, clickCount: 1, modifiers });
      if (options.hold) await pause(options.hold);
      for (let step = 1; step <= 6; step += 1) {
        window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(start.x + (end.x-start.x)*step/6), y: Math.round(start.y + (end.y-start.y)*step/6), button, modifiers });
        await pause(options.stepDelay || 18);
      }
      if (options.beforeUp) await pause(options.beforeUp);
      window.webContents.sendInputEvent({ type: "mouseUp", x: end.x, y: end.y, button, clickCount: 1, modifiers });
      await pause(120);
    };
    const shortcut = async (keyCode, modifiers = ["control"]) => {
      const normalized = keyCode.length === 1 ? keyCode.toLowerCase() : keyCode;
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: normalized, modifiers });
      window.webContents.sendInputEvent({ type: "char", keyCode: normalized, modifiers });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: normalized, modifiers });
      await pause(90);
    };
    const semanticNodeCount = () => evaluate('Number(document.querySelector("#node-count")?.textContent || 0)');
    const semanticEdgeCount = () => evaluate('Number(document.querySelector("#edge-count")?.textContent || 0)');
    const renderedNodeCount = () => evaluate("document.querySelectorAll('#graph-canvas .x6-node[data-cell-id]').length");

    for (let attempt = 0; attempt < 160; attempt += 1) {
      const count = await renderedNodeCount();
      if (count >= 2) break;
      await pause(30);
    }
    const initial = await evaluate(`(() => ({
      nodes: Number(document.querySelector('#node-count')?.textContent || 0),
      edges: Number(document.querySelector('#edge-count')?.textContent || 0),
      error: document.querySelector('#error-message')?.textContent || '',
      hasGraph: document.querySelectorAll('#graph-canvas .x6-node').length > 0
    }))()`);
    if (!initial.hasGraph || initial.nodes < 2) throw new Error(`graph did not load: ${JSON.stringify(initial)}`);

    smokeStep = "marquee selection";
    const marquee = await evaluate(`(() => {
      const nodes = [...document.querySelectorAll('#graph-canvas .x6-node[data-cell-id]')]
        .filter((element) => !element.getAttribute('data-cell-id').startsWith('layer:'))
        .map((element) => ({ id: element.getAttribute('data-cell-id'), rect: element.getBoundingClientRect() }))
        .filter((item) => item.rect.width > 1 && item.rect.height > 1);
      let best = null;
      for (let i=0;i<nodes.length;i+=1) for (let j=i+1;j<nodes.length;j+=1) {
        const left=Math.min(nodes[i].rect.left,nodes[j].rect.left)-8, top=Math.min(nodes[i].rect.top,nodes[j].rect.top)-8;
        const right=Math.max(nodes[i].rect.right,nodes[j].rect.right)+8, bottom=Math.max(nodes[i].rect.bottom,nodes[j].rect.bottom)+8;
        const contained=nodes.filter((node)=>node.rect.left>=left&&node.rect.right<=right&&node.rect.top>=top&&node.rect.bottom<=bottom).length;
        const area=(right-left)*(bottom-top);
        if(contained===2&&(!best||area<best.area)) best={ start:{x:Math.round(left),y:Math.round(top)}, end:{x:Math.round(right),y:Math.round(bottom)}, area };
      }
      return best;
    })()`);
    await drag(marquee?.start, marquee?.end);
    const marqueeSelectedCount = await evaluate("document.querySelectorAll('.x6-widget-selection-box').length");

    smokeStep = "select nodes";
    const first = await pointFor('#node-list button[data-node-id]');
    const second = await evaluate(`(() => {
      const element = document.querySelectorAll('#node-list button[data-node-id]')[1];
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2) };
    })()`);
    await click(first);
    await click(second, ["shift"]);
    const multiSelectedCount = await evaluate("document.querySelectorAll('.x6-widget-selection-box').length");

    smokeStep = "group selection";
    await shortcut("G", []);
    const nodesAfterGroup = await semanticNodeCount();
    await shortcut("Z");
    await pause(140);
    const nodesAfterGroupUndo = await semanticNodeCount();

    smokeStep = "copy paste";
    await evaluate("document.querySelector('#graph-canvas')?.focus()");
    await shortcut("C");
    await shortcut("V");
    let nodesAfterPaste = await semanticNodeCount();
    const pasteShortcutSeen = await evaluate('document.documentElement.dataset.lastShortcut === "paste"');
    if (nodesAfterPaste !== initial.nodes + 2) {
      const duplicatePoint = await pointFor('[data-node-action="duplicate"]');
      if (duplicatePoint) await click(duplicatePoint);
      nodesAfterPaste = await semanticNodeCount();
    }
    smokeStep = "undo paste";
    await shortcut("Z");
    await pause(180);
    const nodesAfterUndo = await semanticNodeCount();
    const pasteUndoRestored = nodesAfterUndo === initial.nodes;

    smokeStep = "add node";
    await evaluate("document.querySelector('#graph-canvas')?.focus()");
    await shortcut("B", []);
    await pause(180);
    let nodesAfterAdd = await semanticNodeCount();
    const addShortcutSeen = await evaluate('document.documentElement.dataset.lastShortcut === "add-node"');
    if (nodesAfterAdd !== initial.nodes + 1) {
      const menuPoint = await pointFor('.new-menu > summary');
      await click(menuPoint);
      const addPoint = await pointFor("#add-node");
      await click(addPoint);
      nodesAfterAdd = await semanticNodeCount();
    }
    await shortcut("Z");
    await pause(140);
    const nodesAfterAddUndo = await semanticNodeCount();

    smokeStep = "space pan";
    await evaluate('document.querySelector("#fit")?.click()');
    await pause(100);
    const scrollBeforePan = await evaluate(`(() => { const element=document.querySelector('.x6-graph-scroller'); return { left: element?.scrollLeft || 0, top: element?.scrollTop || 0 }; })()`);
    const panPoint = await pointFor("#graph-canvas");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
    await drag(panPoint, { x: panPoint.x - 90, y: panPoint.y - 55 });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
    await pause(80);
    const scrollAfterPan = await evaluate(`(() => { const element=document.querySelector('.x6-graph-scroller'); return { left: element?.scrollLeft || 0, top: element?.scrollTop || 0 }; })()`);
    const spacePanMoved = Math.abs(scrollAfterPan.left-scrollBeforePan.left) + Math.abs(scrollAfterPan.top-scrollBeforePan.top) > 10;

    smokeStep = "port connection";
    await evaluate('document.querySelector("#fit")?.click()');
    await pause(120);
    await click(await pointFor('[data-tool="connect"]'));
    const sourcePort = await pointFor('#graph-canvas .x6-node[data-cell-id="cli-dashboard"] .x6-port-body[port="right"]');
    const targetPort = await pointFor('#graph-canvas .x6-node[data-cell-id="cerebrums"] .x6-port-body[port="left"]');
    await drag(sourcePort, targetPort, { hold: 120, stepDelay: 55, beforeUp: 160 });
    const edgesAfterConnect = await semanticEdgeCount();
    await shortcut("Z");
    await pause(140);
    const edgesAfterConnectUndo = await semanticEdgeCount();
    await click(await pointFor('[data-tool="select"]'));

    smokeStep = "dependency view";
    const dependencyPoint = await pointFor('[data-view-mode="dependency"]');
    await click(dependencyPoint);
    const dependencyViewActive = await evaluate('document.querySelector("#app-shell")?.dataset.view === "dependency"');

    smokeStep = "zoom";
    const canvasPoint = await pointFor("#graph-canvas");
    window.webContents.sendInputEvent({ type: "mouseWheel", x: canvasPoint.x, y: canvasPoint.y, deltaY: -120, deltaX: 0, canScroll: true, modifiers: ["control"] });
    await pause(100);
    const zoomValue = await evaluate('Number(document.querySelector("#zoom-percent")?.value || 0)');

    smokeStep = "architecture view";
    await evaluate('document.querySelector(\'[data-view-mode="architecture"]\')?.click()');
    await pause(100);
    await evaluate('document.querySelector("#fit")?.click()');
    await pause(100);

    const image = await window.webContents.capturePage();
    const screenshotPath = path.join(process.env.TMPDIR || "/tmp", "mindmap-smoke.png");
    await fs.writeFile(screenshotPath, image.toPNG());
    const result = await evaluate(`(() => ({
      ok: document.querySelectorAll('#graph-canvas .x6-node').length > 0,
      url: location.href,
      protocol: location.protocol,
      hasWorkbench: Boolean(document.querySelector('#app-shell')),
      hasSidebar: Boolean(document.querySelector('.sidebar #node-list')),
      hasInspector: Boolean(document.querySelector('.inspector #inspector-content')),
      hasCanvasControls: Boolean(document.querySelector('.canvas-controls')),
      hasMarquee: Boolean(document.querySelector('#marquee')),
      hasMinimap: Boolean(document.querySelector('#minimap .x6-widget-minimap')),
      hasViewSwitcher: document.querySelectorAll('[data-view-mode]').length === 3,
      hasStyleTab: Boolean(document.querySelector('[data-inspector-tab="style"]')),
      hasHistoryTab: Boolean(document.querySelector('[data-inspector-tab="history"]')),
      title: document.title,
      viewport: { innerWidth, innerHeight, dpr: devicePixelRatio, graphWidth: document.querySelector('#graph-shell')?.clientWidth, graphHeight: document.querySelector('#graph-shell')?.clientHeight }
    }))()`);
    Object.assign(result, {
      nodesBefore: initial.nodes,
      edgesBefore: initial.edges,
      marqueeSelectedCount,
      multiSelectedCount,
      nodesAfterGroup,
      nodesAfterGroupUndo,
      groupCreated: nodesAfterGroup === initial.nodes + 1,
      groupUndoRestored: nodesAfterGroupUndo === initial.nodes,
      nodesAfterPaste,
      nodesAfterUndo,
      copyPasteAdded: nodesAfterPaste === initial.nodes + 2,
      pasteShortcutSeen,
      pasteUndoRestored,
      nodesAfterAdd,
      nodeAdded: nodesAfterAdd === initial.nodes + 1,
      nodesAfterAddUndo,
      addUndoRestored: nodesAfterAddUndo === initial.nodes,
      spacePanMoved,
      edgesAfterConnect,
      edgesAfterConnectUndo,
      connectionCreated: edgesAfterConnect === initial.edges + 1,
      connectionUndoRestored: edgesAfterConnectUndo === initial.edges,
      addShortcutSeen,
      dependencyViewActive,
      zoomValue,
      screenshotPath
    });
    reportSmoke(result);
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    reportSmoke({ ok: false, error: error.message });
    app.exit(1);
  }
}

async function runVisualSmoke(window) {
  try {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const ready = await window.webContents.executeJavaScript(`Number(document.querySelector('#node-count')?.textContent || 0) > 0 && document.querySelectorAll('#graph-canvas .x6-node').length > 0`);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    await window.webContents.executeJavaScript('document.querySelector("#fit")?.click()');
    await new Promise((resolve) => setTimeout(resolve, 180));
    const screenshotPath = process.env.MINDMAP_SCREENSHOT_PATH || path.join(process.env.TMPDIR || "/tmp", "mindmap-visual.png");
    await fs.writeFile(screenshotPath, (await window.webContents.capturePage()).toPNG());
    const result = await window.webContents.executeJavaScript(`(() => {
      const topbar = document.querySelector('.topbar');
      const statusbar = document.querySelector('.statusbar');
      const shell = document.querySelector('#app-shell');
      const graphRect = document.querySelector('#graph-shell').getBoundingClientRect();
      const layerRects = [...document.querySelectorAll('#graph-canvas .x6-node[data-cell-id^="layer:"]')].map((element) => element.getBoundingClientRect());
      return {
        ok: Number(document.querySelector('#node-count')?.textContent || 0) > 0,
        innerWidth,
        innerHeight,
        dpr: devicePixelRatio,
        topbarOverflow: topbar.scrollWidth > topbar.clientWidth + 1,
        statusbarOverflow: statusbar.scrollWidth > statusbar.clientWidth + 1,
        leftCollapsed: shell.classList.contains('is-left-collapsed'),
        rightCollapsed: shell.classList.contains('is-right-collapsed'),
        zoom: Number(document.querySelector('#zoom-percent')?.value || 0),
        nodes: Number(document.querySelector('#node-count')?.textContent || 0),
        edges: Number(document.querySelector('#edge-count')?.textContent || 0),
        graphRect: { left: Math.round(graphRect.left), top: Math.round(graphRect.top), right: Math.round(graphRect.right), bottom: Math.round(graphRect.bottom), width: Math.round(graphRect.width), height: Math.round(graphRect.height) },
        layerBounds: layerRects.length ? { left: Math.round(Math.min(...layerRects.map((rect) => rect.left))), top: Math.round(Math.min(...layerRects.map((rect) => rect.top))), right: Math.round(Math.max(...layerRects.map((rect) => rect.right))), bottom: Math.round(Math.max(...layerRects.map((rect) => rect.bottom))) } : null
      };
    })()`);
    result.screenshotPath = screenshotPath;
    console.log(`MINDMAP_VISUAL_RESULT ${JSON.stringify(result)}`);
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.log(`MINDMAP_VISUAL_RESULT ${JSON.stringify({ ok: false, error: error.message })}`);
    app.exit(1);
  }
}

async function createWindow() {
  const requestedWidth = Number(process.env.MINDMAP_WINDOW_WIDTH || 1400);
  const requestedHeight = Number(process.env.MINDMAP_WINDOW_HEIGHT || 900);
  const window = new BrowserWindow({
    width: requestedWidth,
    height: requestedHeight,
    minWidth: isVisual ? 320 : 760,
    minHeight: isVisual ? 480 : 680,
    title: appName,
    icon: iconPath,
    show: !isAutomated,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalUrl(url)) openExternalSafely(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    openExternalSafely(url);
  });

  window.webContents.once("did-finish-load", () => {
    if (isVisual) runVisualSmoke(window);
    else if (isSmoke) runSmoke(window);
  });

  await window.loadURL(`${scheme}://local/app/index.html`);
  return window;
}

app.whenReady().then(async () => {
  registerJsonIpc();
  protocol.handle(scheme, fileResponse);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

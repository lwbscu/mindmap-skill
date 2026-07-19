import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectStore } from "./project-store.mjs";

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
const preloadPath = path.join(__dirname, "preload.cjs");
const isSmoke = process.env.MINDMAP_ELECTRON_SMOKE === "1" || process.argv.includes("--smoke");
const isVisual = process.env.MINDMAP_ELECTRON_VISUAL === "1";
const isAutomated = isSmoke || isVisual;
const projectsDir = isAutomated && process.env.MINDMAP_PROJECTS_DIR
  ? path.resolve(process.env.MINDMAP_PROJECTS_DIR)
  : path.join(root, "projects");
const projectStore = createProjectStore({ projectsDir });
let authorizedJsonPath = "";
let authorizedProjectFileName = "";

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
  if (["https:", "http:", "mailto:"].includes(parsed.protocol)) {
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
      const diagram = await readJsonFile(filePath);
      return { ok: true, filePath, diagram };
    } catch (error) {
      return { ok: false, filePath, error: error.message };
    }
  });

  ipcMain.handle("mindmap:save-json", async (_event, payload = {}) => {
    try {
      if (authorizedProjectFileName) {
        const result = await projectStore.save({
          fileName: authorizedProjectFileName,
          diagram: payload.diagram
        });
        authorizedJsonPath = result.filePath;
        return { ok: true, filePath: result.filePath };
      }
      const filePath = normalizeJsonPath(authorizedJsonPath);
      if (!filePath) throw new Error("No authorized JSON save path. Use Save As first.");
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
        defaultPath: normalizeJsonPath(path.basename(payload.suggestedName || authorizedJsonPath || "mindmap.diagram.json")),
        filters: jsonFilters()
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      const filePath = normalizeJsonPath(result.filePath);
      const json = assertJsonValue(payload.diagram);
      await fs.writeFile(filePath, `${json}\n`, "utf8");
      authorizedJsonPath = filePath;
      authorizedProjectFileName = "";
      return { ok: true, filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("mindmap:projects:list", async () => {
    try {
      return { ok: true, projects: await projectStore.list() };
    } catch (error) {
      return { ok: false, projects: [], error: error.message };
    }
  });

  ipcMain.handle("mindmap:projects:create", async (_event, payload = {}) => {
    try {
      const result = await projectStore.create({
        name: payload.name,
        diagram: payload.diagram
      });
      authorizedJsonPath = result.filePath;
      authorizedProjectFileName = result.fileName;
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("mindmap:projects:open", async (_event, payload = {}) => {
    try {
      const result = await projectStore.open({ fileName: payload.fileName });
      authorizedJsonPath = result.filePath;
      authorizedProjectFileName = result.fileName;
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("mindmap:projects:authorize", async (_event, payload = {}) => {
    try {
      const result = await projectStore.authorize({ filePath: payload.filePath });
      authorizedJsonPath = result.filePath;
      authorizedProjectFileName = result.fileName;
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

function reportSmoke(result) {
  console.log(`MINDMAP_SMOKE_RESULT ${JSON.stringify(result)}`);
}

async function runSmoke(window) {
  let smokeStep = "initialize";
  const watchdog = setTimeout(() => {
    reportSmoke({ ok: false, error: `smoke timeout during ${smokeStep}` });
    app.exit(1);
  }, 40000);
  try {
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
    const doubleClick = async (point) => {
      if (!point) throw new Error(`Missing double-click target during ${smokeStep}`);
      for (const clickCount of [1, 2]) {
        window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount });
        window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount });
        await pause(45);
      }
      await pause(100);
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

    smokeStep = "inline text editing";
    await doubleClick(await pointFor('#graph-canvas .x6-node[data-cell-id="cli-dashboard"]'));
    await pause(180);
    const inlineEditorOpened = await evaluate('Boolean(document.querySelector(".inline-editor"))');
    let inlineValueEntered = false;
    for (let attempt = 0; attempt < 3 && !inlineValueEntered; attempt += 1) {
      await evaluate(`(() => { const input=document.querySelector('.inline-editor__prosemirror--title'); if(!input) return false; input.focus(); const range=document.createRange(); range.selectNodeContents(input); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); return document.activeElement === input; })()`);
      await pause(100);
      await window.webContents.insertText("CLI / Dashboard 已编辑");
      await pause(80);
      inlineValueEntered = await evaluate('document.querySelector(".inline-editor__prosemirror--title")?.textContent === "CLI / Dashboard 已编辑"');
    }
    await evaluate(`(() => {
      const input = document.querySelector('.inline-editor__prosemirror--title');
      const text = input ? document.createTreeWalker(input, NodeFilter.SHOW_TEXT).nextNode() : null;
      if (!input || !text) return false;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(3, text.textContent.length));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      input.dispatchEvent(new Event('mouseup', { bubbles: true }));
      return true;
    })()`);
    await pause(80);
    await click(await pointFor("#quick-bold"));
    await pause(120);
    const inlineBoldApplied = await evaluate(`(() => {
      const input = document.querySelector('.inline-editor__input--title');
      return [...(input?.querySelectorAll('strong,b,span') || [])].some((span) => Number(getComputedStyle(span).fontWeight) >= 700 && span.textContent.includes('CLI'));
    })()`);
    await evaluate(`(() => { const input=document.querySelector('#quick-title-size'); input.value='28'; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await pause(90);
    await evaluate(`document.querySelector('#text-color-palette [data-color="#2563eb"]')?.click()`);
    await pause(90);
    await evaluate(`document.querySelector('#highlight-color-palette [data-color="#fef3c7"]')?.click()`);
    await pause(120);
    const localFormatState = await evaluate(`(() => {
      const editor = document.querySelector('.inline-editor__prosemirror--title');
      const styled = [...(editor?.querySelectorAll('span') || [])].find((span) => span.textContent.includes('CLI'));
      const dashboardText = [...(document.createTreeWalker(editor, NodeFilter.SHOW_TEXT) ? (() => { const values=[]; const walker=document.createTreeWalker(editor, NodeFilter.SHOW_TEXT); let node; while((node=walker.nextNode())) values.push(node); return values; })() : [])].find((node) => node.textContent.includes('Dashboard'));
      const selectedStyle = styled ? getComputedStyle(styled) : null;
      const unselectedStyle = dashboardText?.parentElement ? getComputedStyle(dashboardText.parentElement) : null;
      return {
        fontSize: selectedStyle?.fontSize || '',
        color: selectedStyle?.color || '',
        backgroundColor: selectedStyle?.backgroundColor || '',
        unselectedFontSize: unselectedStyle?.fontSize || '',
        unselectedColor: unselectedStyle?.color || '',
        unselectedBackgroundColor: unselectedStyle?.backgroundColor || ''
      };
    })()`);
    const localFontSizeApplied = localFormatState.fontSize === "28px";
    const localTextColorApplied = /rgb\(37,\s*99,\s*235\)/.test(localFormatState.color);
    const localHighlightApplied = /rgb\(254,\s*243,\s*199\)/.test(localFormatState.backgroundColor);
    const unselectedRunsUnchanged = localFormatState.unselectedFontSize !== "28px"
      && !/rgb\(37,\s*99,\s*235\)/.test(localFormatState.unselectedColor)
      && !/rgb\(254,\s*243,\s*199\)/.test(localFormatState.unselectedBackgroundColor);
    await evaluate(`document.querySelector('.inline-editor__prosemirror')?.focus()`);
    await shortcut("Z");
    const textUndoWorked = await evaluate(`(() => {
      const span=[...document.querySelectorAll('.inline-editor__prosemirror--title span')].find((item)=>item.textContent.includes('CLI'));
      return Boolean(span) && !/rgb\(254,\s*243,\s*199\)/.test(getComputedStyle(span).backgroundColor);
    })()`);
    await evaluate(`document.querySelector('#highlight-color-palette [data-color="#fef3c7"]')?.click()`);
    const textClipboardStayedLocal = await evaluate(`(() => {
      const editor=document.querySelector('.inline-editor__prosemirror--title');
      const text=[...document.createTreeWalker(editor,NodeFilter.SHOW_TEXT) ? (()=>{const result=[];const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))result.push(node);return result;})() : []].find((node)=>node.textContent.includes('CLI'));
      if(!editor||!text)return false;
      const range=document.createRange(); range.setStart(text,0); range.setEnd(text,3);
      const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const transfer=new DataTransfer();
      editor.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:transfer}));
      selection.removeAllRanges(); selection.addRange(range);
      editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));
      return editor.textContent==='CLI / Dashboard 已编辑' && Boolean(transfer.getData('application/x-mindmap-rich-text'));
    })()`);
    const imeSafe = await evaluate(`(() => {
      const editor=document.querySelector('.inline-editor__prosemirror');
      if(!editor)return false;
      editor.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'中'}));
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true}));
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,isComposing:true}));
      const stayedOpen=Boolean(document.querySelector('.inline-editor'));
      editor.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'}));
      return stayedOpen;
    })()`);
    const inlineToolbarPreservedEditor = await evaluate('Boolean(document.querySelector(".inline-editor")) && !document.querySelector("#selection-toolbar")?.hidden');
    await evaluate(`(() => { const input=document.querySelector('.inline-editor__prosemirror--title'); input?.focus(); input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
    await pause(140);
    const inlineCommitState = await evaluate(`(() => ({
      editorOpen: Boolean(document.querySelector('.inline-editor')),
      sidebarTitle: document.querySelector('#node-list button[data-node-id="cli-dashboard"] .node-list-title')?.textContent || '',
      canvasTitle: document.querySelector('#graph-canvas .x6-node[data-cell-id="cli-dashboard"] text:nth-of-type(2)')?.textContent || ''
    }))()`);
    const inlineEditCommitted = inlineCommitState.sidebarTitle === "CLI / Dashboard 已编辑";
    await shortcut("Z");
    const inlineEditUndoRestored = await evaluate('document.querySelector(\'#node-list button[data-node-id="cli-dashboard"] .node-list-title\')?.textContent === "CLI / Dashboard"');

    smokeStep = "marquee selection";
    const marquee = await evaluate(`(() => {
      const nodes = ['cli-dashboard', 'output-artifacts'].map((id) => document.querySelector('#graph-canvas .x6-node[data-cell-id="'+id+'"]')?.getBoundingClientRect()).filter(Boolean);
      if (nodes.length !== 2) return null;
      const left=Math.min(...nodes.map((rect)=>rect.left))-10, top=Math.min(...nodes.map((rect)=>rect.top))-10;
      const right=Math.max(...nodes.map((rect)=>rect.right))+10, bottom=Math.max(...nodes.map((rect)=>rect.bottom))+10;
      return { start:{x:Math.round(left),y:Math.round(top)}, end:{x:Math.round(right),y:Math.round(bottom)} };
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

    smokeStep = "batch typography and color";
    await evaluate(`document.querySelector('[data-inspector-tab="style"]')?.click()`);
    await pause(80);
    await evaluate(`(() => { const input=document.querySelector('[data-node-field="titleSize"]'); if(!input)return false; input.value='24'; input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    await pause(140);
    const batchFontApplied = await evaluate(`['cli-dashboard','output-artifacts'].every((id) => document.querySelector('#graph-canvas .x6-node[data-cell-id="'+id+'"] text:nth-of-type(2)')?.getAttribute('font-size') === '24')`);
    await evaluate(`(() => { const input=document.querySelector('[data-node-field="fill"]'); if(!input)return false; input.value='#fff4cc'; input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    await pause(140);
    const batchFillApplied = await evaluate(`['cli-dashboard','output-artifacts'].every((id) => document.querySelector('#graph-canvas .x6-node[data-cell-id="'+id+'"] rect')?.getAttribute('fill') === '#fff4cc')`);
    await shortcut("Z");
    await shortcut("Z");

    smokeStep = "paste image into selected node";
    const imagePasteDispatch = await evaluate(`(async () => {
      delete document.documentElement.dataset.lastImageImport;
      delete document.documentElement.dataset.lastImageNode;
      document.querySelector('#node-list button[data-node-id="cli-dashboard"]')?.click();
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      const context = canvas.getContext('2d');
      context.fillStyle = '#7c3aed'; context.fillRect(0, 0, 32, 32);
      context.fillStyle = '#ffffff'; context.fillRect(8, 8, 16, 16);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'mindmap-smoke.png', { type: 'image/png' }));
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
      const target = document.querySelector('#graph-canvas');
      const dispatched = target?.dispatchEvent(event);
      return {
        dispatched,
        items: [...transfer.items].map((item) => ({ kind: item.kind, type: item.type })),
        files: [...transfer.files].map((file) => ({ name: file.name, type: file.type, size: file.size })),
        selected: document.querySelectorAll('.x6-widget-selection-box').length
      };
    })()`);
    let imagePasteApplied = false;
    for (let attempt = 0; attempt < 240 && !imagePasteApplied; attempt += 1) {
      imagePasteApplied = await evaluate(`document.documentElement.dataset.lastImageNode === 'cli-dashboard'`);
      if (!imagePasteApplied) await pause(50);
    }
    if (imagePasteApplied) {
      await evaluate(`document.querySelector('[data-inspector-tab="details"]')?.click()`);
      await pause(100);
      imagePasteApplied = await evaluate(`Boolean(document.querySelector('[data-node-field="image:alt"]'))`);
    }
    const imagePasteError = imagePasteApplied ? "" : await evaluate(`document.querySelector('#error-message')?.textContent || ''`);
    await shortcut("Z");
    await pause(160);
    const imagePasteUndoRestored = await evaluate(`!document.querySelector('[data-node-field="image:alt"]')`);

    await click(await pointFor('#node-list button[data-node-id="cli-dashboard"]'));
    await click(await pointFor('#node-list button[data-node-id="output-artifacts"]'), ["shift"]);

    smokeStep = "group selection";
    await shortcut("G", []);
    const nodesAfterGroup = await semanticNodeCount();
    await shortcut("Z");
    await pause(140);
    const nodesAfterGroupUndo = await semanticNodeCount();

    smokeStep = "copy paste";
    await click(await pointFor('#node-list button[data-node-id="cli-dashboard"]'));
    await click(await pointFor('#node-list button[data-node-id="output-artifacts"]'), ["shift"]);
    const copySelectionCount = await evaluate("document.querySelectorAll('.x6-widget-selection-box').length");
    await evaluate("document.querySelector('#graph-canvas')?.focus()");
    await shortcut("C");
    const copiedNodeCount = await evaluate('Number(document.documentElement.dataset.lastCopyCount || 0)');
    await shortcut("V");
    await pause(180);
    let nodesAfterPaste = await semanticNodeCount();
    const pasteShortcutSeen = await evaluate('document.documentElement.dataset.lastShortcut === "paste"');
    if (nodesAfterPaste !== initial.nodes + 2) {
      await evaluate("document.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))");
      await pause(180);
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
    await evaluate(`document.querySelector('.inline-editor__input--title')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await pause(100);
    await shortcut("Z");
    await pause(140);
    const nodesAfterAddUndo = await semanticNodeCount();

    smokeStep = "space pan";
    await evaluate('document.querySelector("#fit")?.click()');
    await pause(100);
    await evaluate(`(() => { const input=document.querySelector('#zoom-percent'); input.value='100'; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await pause(100);
    const scrollBeforePan = await evaluate(`(() => { const element=document.querySelector('.x6-graph-scroller'); return { left: element?.scrollLeft || 0, top: element?.scrollTop || 0 }; })()`);
    const nodeBeforePan = await pointFor('#graph-canvas .x6-node[data-cell-id="cli-dashboard"]');
    const panPoint = await pointFor("#graph-canvas");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: " " });
    await pause(80);
    const spacePanActivated = await evaluate('document.documentElement.dataset.spacePanActive === "true"');
    await drag(panPoint, { x: panPoint.x - 90, y: panPoint.y - 55 });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: " " });
    await pause(80);
    const scrollAfterPan = await evaluate(`(() => { const element=document.querySelector('.x6-graph-scroller'); return { left: element?.scrollLeft || 0, top: element?.scrollTop || 0 }; })()`);
    const nodeAfterPan = await pointFor('#graph-canvas .x6-node[data-cell-id="cli-dashboard"]');
    const spacePanMoved = Math.abs(scrollAfterPan.left-scrollBeforePan.left) + Math.abs(scrollAfterPan.top-scrollBeforePan.top) > 10
      || Math.abs((nodeAfterPan?.x || 0) - (nodeBeforePan?.x || 0)) + Math.abs((nodeAfterPan?.y || 0) - (nodeBeforePan?.y || 0)) > 10;

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

    smokeStep = "new blank project";
    const desktopProjectApi = await evaluate(`(() => ({
      desktop: Boolean(window.mindmapDesktop?.isDesktop),
      keys: Object.keys(window.mindmapDesktop || {}),
      projectKeys: Object.keys(window.mindmapDesktop?.projects || {})
    }))()`);
    await evaluate('document.querySelector("#graph-canvas")?.focus()');
    await shortcut("N");
    const unsavedGuardShown = await evaluate('Boolean(document.querySelector("#unsaved-dialog")?.open)');
    if (unsavedGuardShown) {
      await evaluate(`document.querySelector('[data-unsaved-choice="discard"]')?.click()`);
      await pause(80);
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await evaluate('Boolean(document.querySelector("#project-dialog")?.open)')) break;
      await pause(30);
    }
    const newProjectCommandSeen = await evaluate(`document.documentElement.dataset.lastShortcut === 'new-project-dialog'`);
    const projectDialogOpened = await evaluate('Boolean(document.querySelector("#project-dialog")?.open)');
    if (!projectDialogOpened) throw new Error(`project dialog did not open; shortcutSeen=${newProjectCommandSeen}`);
    const projectDialogMetrics = await evaluate(`(() => {
      const element = document.querySelector('#project-dialog');
      const rect = element?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, withinViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight } : null;
    })()`);
    const projectDialogFocusState = await evaluate(`(() => {
      const shell = document.querySelector('#app-shell');
      const dialog = document.querySelector('#project-dialog');
      const shellStyle = shell ? getComputedStyle(shell) : null;
      const backdropStyle = dialog ? getComputedStyle(dialog, '::backdrop') : null;
      return {
        shellOpacity: Number(shellStyle?.opacity || 1),
        shellFilter: shellStyle?.filter || '',
        backdropColor: backdropStyle?.backgroundColor || '',
        backdropFilter: backdropStyle?.backdropFilter || ''
      };
    })()`);
    const projectDialogScreenshotPath = path.join(process.env.TMPDIR || "/tmp", "mindmap-project-dialog.png");
    await fs.writeFile(projectDialogScreenshotPath, (await window.webContents.capturePage()).toPNG());
    await evaluate(`(() => {
      const input = document.querySelector('#project-name');
      const form = document.querySelector('#project-form');
      if (!input || !form) return false;
      input.value = 'Smoke Blank Project';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
      return true;
    })()`);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const ready = await evaluate(`document.documentElement.dataset.lastShortcut === 'new-project' && Number(document.querySelector('#node-count')?.textContent || -1) === 0`);
      if (ready) break;
      await pause(35);
    }
    const newProjectShortcutSeen = await evaluate(`document.documentElement.dataset.lastShortcut === 'new-project'`);
    const blankProjectNodeCount = await semanticNodeCount();
    const blankProjectEdgeCount = await semanticEdgeCount();
    const blankProjectCreated = newProjectShortcutSeen && blankProjectNodeCount === 0 && blankProjectEdgeCount === 0 && Boolean(authorizedProjectFileName);
    const blankProjectError = await evaluate(`document.querySelector('#error-message')?.textContent || ''`);

    smokeStep = "save blank project";
    await shortcut("S");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await evaluate(`document.querySelector('#save-status')?.textContent === '已保存'`)) break;
      await pause(30);
    }
    const saveShortcutSeen = await evaluate(`document.documentElement.dataset.lastShortcut === 'save'`);
    const projectSaved = await evaluate(`document.querySelector('#save-status')?.textContent === '已保存'`);
    const projectFilePath = authorizedJsonPath;
    const projectFileExists = Boolean(projectFilePath) && await fs.access(projectFilePath).then(() => true, () => false);

    Object.assign(result, {
      nodesBefore: initial.nodes,
      edgesBefore: initial.edges,
      marqueeSelectedCount,
      multiSelectedCount,
      inlineEditorOpened,
      inlineValueEntered,
      inlineBoldApplied,
      inlineToolbarPreservedEditor,
      localFontSizeApplied,
      localTextColorApplied,
      localHighlightApplied,
      unselectedRunsUnchanged,
      textUndoWorked,
      textClipboardStayedLocal,
      imeSafe,
      inlineCommitState,
      inlineEditCommitted,
      inlineEditUndoRestored,
      imagePasteApplied,
      imagePasteError,
      imagePasteDispatch,
      imagePasteUndoRestored,
      batchFontApplied,
      batchFillApplied,
      nodesAfterGroup,
      nodesAfterGroupUndo,
      groupCreated: nodesAfterGroup === initial.nodes + 1,
      groupUndoRestored: nodesAfterGroupUndo === initial.nodes,
      nodesAfterPaste,
      copySelectionCount,
      copiedNodeCount,
      nodesAfterUndo,
      copyPasteAdded: nodesAfterPaste === initial.nodes + 2,
      pasteShortcutSeen,
      pasteUndoRestored,
      nodesAfterAdd,
      nodeAdded: nodesAfterAdd === initial.nodes + 1,
      nodesAfterAddUndo,
      addUndoRestored: nodesAfterAddUndo === initial.nodes,
      spacePanMoved,
      spacePanActivated,
      edgesAfterConnect,
      edgesAfterConnectUndo,
      connectionCreated: edgesAfterConnect === initial.edges + 1,
      connectionUndoRestored: edgesAfterConnectUndo === initial.edges,
      addShortcutSeen,
      dependencyViewActive,
      newProjectShortcutSeen,
      unsavedGuardShown,
      newProjectCommandSeen,
      projectDialogOpened,
      blankProjectCreated,
      blankProjectNodeCount,
      blankProjectEdgeCount,
      blankProjectError,
      desktopProjectApi,
      saveShortcutSeen,
      projectSaved,
      projectFileExists,
      projectFilePath,
      projectDialogMetrics,
      projectDialogFocusState,
      projectDialogScreenshotPath,
      zoomValue,
      screenshotPath
    });
    reportSmoke(result);
    clearTimeout(watchdog);
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    clearTimeout(watchdog);
    reportSmoke({ ok: false, error: `${smokeStep}: ${error.message}` });
    app.exit(1);
  }
}

async function runVisualSmoke(window) {
  try {
    window.showInactive();
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const ready = await window.webContents.executeJavaScript(`Number(document.querySelector('#node-count')?.textContent || 0) > 0 && document.querySelectorAll('#graph-canvas .x6-node').length > 0`);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    await window.webContents.executeJavaScript('document.querySelector("#fit")?.click()');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const screenshotPath = process.env.MINDMAP_SCREENSHOT_PATH || path.join(process.env.TMPDIR || "/tmp", "mindmap-visual.png");
    await fs.writeFile(screenshotPath, (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('#node-list button[data-node-id="cli-dashboard"]')?.click()`);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const editPoint = await window.webContents.executeJavaScript(`(() => {
      const element = document.querySelector('#graph-canvas .x6-node[data-cell-id="cli-dashboard"]');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    if (editPoint) {
      for (const clickCount of [1, 2]) {
        window.webContents.sendInputEvent({ type: "mouseDown", x: editPoint.x, y: editPoint.y, button: "left", clickCount });
        window.webContents.sendInputEvent({ type: "mouseUp", x: editPoint.x, y: editPoint.y, button: "left", clickCount });
        await new Promise((resolve) => setTimeout(resolve, 55));
      }
    }
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const editingReady = await window.webContents.executeJavaScript(`(() => {
        const toolbar = document.querySelector('#selection-toolbar');
        const style = toolbar ? getComputedStyle(toolbar) : null;
        return Boolean(document.querySelector('.inline-editor')) && Boolean(toolbar) && !toolbar.hidden && style.display !== 'none' && Number(style.opacity || 1) > 0;
      })()`);
      if (editingReady) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const toolbarScreenshotPath = screenshotPath.endsWith(".png") ? screenshotPath.replace(/\.png$/i, "-toolbar.png") : `${screenshotPath}-toolbar.png`;
    await fs.writeFile(toolbarScreenshotPath, (await window.webContents.capturePage()).toPNG());
    const controlMetrics = await window.webContents.executeJavaScript(`(() => {
      const within = (rect) => Boolean(rect) && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
      const font = document.querySelector('#quick-font-family')?.getBoundingClientRect();
      const size = document.querySelector('#quick-title-size')?.getBoundingClientRect();
      const toolbar = document.querySelector('#selection-toolbar');
      const style = toolbar ? getComputedStyle(toolbar) : null;
      return {
        fontMenuWithinViewport: within(font),
        sizeMenuWithinViewport: within(size),
        singleLineScrollable: style?.flexWrap === 'nowrap' && (toolbar.scrollWidth <= toolbar.clientWidth + 1 || ['auto','scroll'].includes(style.overflowX))
      };
    })()`);
    await window.webContents.executeJavaScript(`document.querySelector('#quick-text-color-menu').open=true`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const textPaletteMetrics = await window.webContents.executeJavaScript(`(() => {
      const palette=document.querySelector('#text-color-palette')?.getBoundingClientRect();
      const editor=document.querySelector('.inline-editor')?.getBoundingClientRect();
      const within=Boolean(palette)&&palette.left>=0&&palette.top>=0&&palette.right<=innerWidth+1&&palette.bottom<=innerHeight+1;
      const overlaps=Boolean(palette&&editor)&&palette.left<editor.right&&palette.right>editor.left&&palette.top<editor.bottom&&palette.bottom>editor.top;
      return {within,overlaps};
    })()`);
    await window.webContents.executeJavaScript(`(() => { document.querySelector('#quick-text-color-menu').open=false; document.querySelector('#quick-highlight-menu').open=true; })()`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const highlightPaletteMetrics = await window.webContents.executeJavaScript(`(() => {
      const palette=document.querySelector('#highlight-color-palette')?.getBoundingClientRect();
      const editor=document.querySelector('.inline-editor')?.getBoundingClientRect();
      const within=Boolean(palette)&&palette.left>=0&&palette.top>=0&&palette.right<=innerWidth+1&&palette.bottom<=innerHeight+1;
      const overlaps=Boolean(palette&&editor)&&palette.left<editor.right&&palette.right>editor.left&&palette.top<editor.bottom&&palette.bottom>editor.top;
      return {within,overlaps};
    })()`);
    await window.webContents.executeJavaScript(`document.querySelector('#quick-highlight-menu').open=false`);
    const result = await window.webContents.executeJavaScript(`(() => {
      const topbar = document.querySelector('.topbar');
      const statusbar = document.querySelector('.statusbar');
      const shell = document.querySelector('#app-shell');
      const graphRect = document.querySelector('#graph-shell').getBoundingClientRect();
      const layerRects = [...document.querySelectorAll('#graph-canvas .x6-node[data-cell-id^="layer:"]')].map((element) => element.getBoundingClientRect());
      const sampleNode = document.querySelector('#graph-canvas .x6-node[data-cell-id]:not([data-cell-id^="layer:"])');
      const sampleTitle = sampleNode?.querySelector('text:nth-of-type(2)');
      const sampleNodeRect = sampleNode?.getBoundingClientRect();
      const sampleTitleRect = sampleTitle?.getBoundingClientRect();
      const toolbar = document.querySelector('#selection-toolbar');
      const editor = document.querySelector('.inline-editor');
      const toolbarRect = toolbar?.getBoundingClientRect();
      const editorRect = editor?.getBoundingClientRect();
      const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
      const overlaps = toolbarRect && editorRect
        ? toolbarRect.left < editorRect.right && toolbarRect.right > editorRect.left && toolbarRect.top < editorRect.bottom && toolbarRect.bottom > editorRect.top
        : false;
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
        renderedNodes: [...document.querySelectorAll('#graph-canvas .x6-node[data-cell-id]')]
          .filter((element) => !element.getAttribute('data-cell-id').startsWith('layer:')).length,
        renderedEdges: document.querySelectorAll('#graph-canvas .x6-edge[data-cell-id]').length,
        inlineEditorActive: Boolean(editor),
        inlineEditorVisible: Boolean(editorRect) && getComputedStyle(editor).display !== 'none' && getComputedStyle(editor).visibility !== 'hidden' && editorRect.width > 0 && editorRect.height > 0 && editorRect.left >= 0 && editorRect.right <= innerWidth && editorRect.top >= 0 && editorRect.bottom <= innerHeight,
        inlineEditingClass: shell.classList.contains('is-inline-editing'),
        structuralControlsDisplay: getComputedStyle(document.querySelector('.toolbar-mode-node')).display,
        edgePaths: [...document.querySelectorAll('#graph-canvas .x6-edge[data-cell-id] path')].slice(0, 3).map((path) => ({ d: path.getAttribute('d'), stroke: path.getAttribute('stroke'), opacity: getComputedStyle(path).opacity })),
        toolbar: toolbarRect ? {
          visible: !toolbar.hidden && toolbarStyle.display !== 'none' && toolbarStyle.visibility !== 'hidden' && Number(toolbarStyle.opacity || 1) > 0,
          display: toolbarStyle.display,
          opacity: toolbarStyle.opacity,
          left: Math.round(toolbarRect.left),
          top: Math.round(toolbarRect.top),
          right: Math.round(toolbarRect.right),
          bottom: Math.round(toolbarRect.bottom),
          width: Math.round(toolbarRect.width),
          height: Math.round(toolbarRect.height),
          scrollWidth: toolbar.scrollWidth,
          clientWidth: toolbar.clientWidth,
          withinViewport: toolbarRect.left >= 0 && toolbarRect.right <= innerWidth + 1 && toolbarRect.top >= 0 && toolbarRect.bottom <= innerHeight + 1,
          overlapsEditor: overlaps,
        } : null,
        sampleTypography: sampleTitle ? {
          x: sampleTitle.getAttribute('x'),
          y: sampleTitle.getAttribute('y'),
          anchor: sampleTitle.getAttribute('text-anchor'),
          fontSize: sampleTitle.getAttribute('font-size'),
          transform: sampleTitle.getAttribute('transform'),
          nodeLeft: Math.round(sampleNodeRect.left),
          nodeWidth: Math.round(sampleNodeRect.width),
          titleLeft: Math.round(sampleTitleRect.left),
          titleWidth: Math.round(sampleTitleRect.width)
        } : null,
        graphRect: { left: Math.round(graphRect.left), top: Math.round(graphRect.top), right: Math.round(graphRect.right), bottom: Math.round(graphRect.bottom), width: Math.round(graphRect.width), height: Math.round(graphRect.height) },
        layerBounds: layerRects.length ? { left: Math.round(Math.min(...layerRects.map((rect) => rect.left))), top: Math.round(Math.min(...layerRects.map((rect) => rect.top))), right: Math.round(Math.max(...layerRects.map((rect) => rect.right))), bottom: Math.round(Math.max(...layerRects.map((rect) => rect.bottom))) } : null
      };
    })()`);
    Object.assign(result.toolbar, controlMetrics, {
      textColorPaletteWithinViewport: textPaletteMetrics.within,
      highlightPaletteWithinViewport: highlightPaletteMetrics.within,
      paletteOverlapsEditor: textPaletteMetrics.overlaps || highlightPaletteMetrics.overlaps,
    });
    result.screenshotPath = screenshotPath;
    result.toolbarScreenshotPath = toolbarScreenshotPath;
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

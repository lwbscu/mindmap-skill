#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EDITABLE_DIAGRAM_PLACEHOLDER,
  EDITABLE_HTML_FORMAT,
  EMBEDDED_DIAGRAM_SCRIPT_ID,
  renderEditableHtml,
} from "../app/editable-html.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const templatePath = path.join(dist, "app", "editable-template.html");
const childFlag = "--electron-child";
const resultPrefix = "MINDMAP_EDITABLE_HTML_RESULT ";

const fixtureDiagram = {
  schemaVersion: "mindmap-app/v1",
  title: "Editable </script><script>window.__titlePayloadExecuted=true</script>",
  subtitle: "single-file roundtrip & > line\u2028paragraph\u2029separator",
  language: "zh-CN",
  canvas: { width: 900, height: 620, background: "#ffffff" },
  layers: [{ id: "layer-main", label: "Main", x: 60, y: 70, width: 520, height: 300, fill: "#f8fbff", stroke: "#9bb6d8" }],
  assets: {
    "asset-pixel": {
      id: "asset-pixel",
      type: "image",
      mime: "image/png",
      name: "pixel.png",
      alt: "trusted embedded pixel",
      sha256: "4b5c5c92cec3b23e6a294fc0eea43234ef5126c5a64f4c6c531ac8430ab0b844",
      size: 68,
      width: 1,
      height: 1,
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
    }
  },
  nodes: [{
    id: "node-editable",
    title: "Editable Node",
    subtitle: "loaded from HTML",
    kind: "module",
    status: "implemented",
    layer: "layer-main",
    x: 120,
    y: 150,
    width: 250,
    height: 116,
    image: { assetId: "asset-pixel", placement: "left", fit: "contain", alt: "trusted embedded pixel", padding: 8, opacity: 1 },
    richText: {
      title: { version: 1, blocks: [{ type: "paragraph", align: "left", runs: [{ text: "Editable Node", marks: { fontWeight: "700" } }] }] },
      subtitle: { version: 1, blocks: [{ type: "paragraph", align: "left", runs: [{ text: "loaded from HTML", marks: {} }] }] }
    }
  }],
  edges: [],
  views: [
    { id: "architecture", type: "architecture", label: "架构图", hiddenLayers: [], layout: { profile: "architecture", nodes: {}, layers: {}, edges: {} } },
    { id: "mindmap", type: "mindmap", label: "MindMap", hiddenLayers: [], layout: { profile: "mindmap", nodes: {}, layers: {}, edges: {} } },
    { id: "dependency", type: "dependency", label: "依赖图", hiddenLayers: [], layout: { profile: "dependency", nodes: {}, layers: {}, edges: {} } }
  ],
  activeViewId: "architecture",
  savedViews: [{ id: "saved-main", label: "Saved Main", viewId: "architecture", camera: { x: 0, y: 0, zoom: 1 }, createdAt: "2026-07-19T00:00:00.000Z" }]
};

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".svg", "image/svg+xml; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function embeddedDiagramFromHtml(html) {
  const pattern = new RegExp(`<script\\b(?=[^>]*\\bid=["']${EMBEDDED_DIAGRAM_SCRIPT_ID}["'])(?=[^>]*\\btype=["']application/json["'])[^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const match = String(html).match(pattern);
  assert.ok(match, `missing script#${EMBEDDED_DIAGRAM_SCRIPT_ID}`);
  return JSON.parse(match[1]);
}

function relativeDependencies(html) {
  return [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi),
    ...html.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/gi),
    ...html.matchAll(/new\s+Worker\s*\(\s*["'](\.?\.?\/[^"']+)["']/gi),
  ].map((match) => match[1]).filter(Boolean);
}

async function staticChecks() {
  const template = await fs.readFile(templatePath, "utf8");
  assert.equal(relativeDependencies(template).length, 0, "editable HTML must contain no external JS, CSS, or worker dependency");
  assert.ok(template.includes(`name="mindmap-editable-format" content="${EDITABLE_HTML_FORMAT}"`));
  assert.ok(template.includes("Content-Security-Policy"));
  assert.equal(template.includes("script-src 'unsafe-inline'"), false, "editable HTML scripts must be CSP-hashed");
  assert.equal(template.includes(EDITABLE_DIAGRAM_PLACEHOLDER), false, "built editable template must contain diagram data, not a placeholder");
  const defaultDiagram = embeddedDiagramFromHtml(template);
  assert.equal(defaultDiagram.schemaVersion, "mindmap-app/v1");
  assert.ok(defaultDiagram.assets && Array.isArray(defaultDiagram.views) && defaultDiagram.views.length === 3);

  const exported = renderEditableHtml(template, fixtureDiagram);
  assert.equal(exported.includes("</script><script>window.__titlePayloadExecuted"), false, "diagram JSON must not break out of its data script");
  const roundtrip = embeddedDiagramFromHtml(exported);
  assert.equal(roundtrip.title, fixtureDiagram.title);
  assert.equal(roundtrip.assets["asset-pixel"].dataUrl, fixtureDiagram.assets["asset-pixel"].dataUrl);
  assert.equal(roundtrip.views.length, 3);
  return { template, exported, bytes: Buffer.byteLength(exported) };
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      let filePath = path.resolve(dist, `.${pathname}`);
      if (filePath !== dist && !filePath.startsWith(`${dist}${path.sep}`)) throw new Error("path escapes dist");
      if ((await fs.stat(filePath)).isDirectory()) filePath = path.join(filePath, "index.html");
      const data = await fs.readFile(filePath);
      response.writeHead(200, { "content-type": mimeTypes.get(path.extname(filePath)) || "application/octet-stream", "cache-control": "no-store" });
      response.end(data);
    } catch (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.message);
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function waitFor(window, expression, timeoutMs = 20000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      if (await window.webContents.executeJavaScript(`Boolean(${expression})`, true)) return;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const snapshot = await window.webContents.executeJavaScript(`({
    title: document.querySelector('#diagram-title')?.textContent || '',
    nodes: document.querySelector('#node-count')?.textContent || '',
    error: document.querySelector('#error-message')?.textContent || '',
    ready: document.readyState,
    url: location.href
  })`, true).catch(() => null);
  throw new Error(`Timed out waiting for ${expression}${lastError ? `: ${lastError}` : ""}; state=${JSON.stringify(snapshot)}`);
}

async function evaluate(window, body) {
  const result = await window.webContents.executeJavaScript(`(async () => { try { return { ok: true, value: await (${body})() }; } catch (error) { return { ok: false, error: error?.stack || String(error) }; } })()`, true);
  if (!result?.ok) throw new Error(result?.error || "renderer evaluation failed");
  return result.value;
}

async function openEditorAndReplaceTitle(window, nodeId, title) {
  await evaluate(window, `() => { document.querySelector('#node-list button[data-node-id=${JSON.stringify(nodeId)}]')?.click(); document.querySelector('#quick-edit')?.click(); return true; }`);
  await waitFor(window, `document.querySelector('.inline-editor__prosemirror--title')`);
  await evaluate(window, `() => { const input=document.querySelector('.inline-editor__prosemirror--title'); input.focus(); const range=document.createRange(); range.selectNodeContents(input); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); return true; }`);
  await window.webContents.insertText(title);
  await evaluate(window, `() => { const input=document.querySelector('.inline-editor__prosemirror--title'); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return true; }`);
  await waitFor(window, `document.querySelector('#node-list button[data-node-id=${JSON.stringify(nodeId)}] .node-list-title')?.textContent === ${JSON.stringify(title)}`);
}

async function installDownloadProbe(window) {
  await evaluate(window, `() => {
    window.__mindmapDownloads = [];
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, value() {
      window.__mindmapDownloads.push({ download: this.download, href: this.href });
    }});
    return true;
  }`);
}

async function createWindow(BrowserWindow) {
  return new BrowserWindow({
    show: false,
    width: 1280,
    height: 860,
    backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
}

async function checkWebEditor(BrowserWindow, baseUrl) {
  const window = await createWindow(BrowserWindow);
  await window.loadURL(`${baseUrl}/app/`);
  await waitFor(window, `Number(document.querySelector('#node-count')?.textContent || 0) > 0`);
  await evaluate(window, `() => {
    if (window.mindmapDesktop) throw new Error('web editor must not expose desktop preload');
    const input=document.querySelector('#open-file');
    const transfer=new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(JSON.stringify(fixtureDiagram))}], 'web.diagram.json', {type:'application/json'}));
    input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }`);
  await waitFor(window, `document.querySelector('#diagram-title')?.textContent?.includes('Editable') && Number(document.querySelector('#node-count')?.textContent || 0) === 1`);
  await openEditorAndReplaceTitle(window, "node-editable", "Web Edited Node");
  await installDownloadProbe(window);
  await evaluate(window, `() => { window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true})); return true; }`);
  await waitFor(window, `window.__mindmapDownloads?.length > 0`);
  const result = await evaluate(window, `async () => {
    const item=window.__mindmapDownloads.at(-1);
    const saved=JSON.parse(await fetch(item.href).then((response)=>response.text()));
    if(saved.nodes?.[0]?.title!=='Web Edited Node') throw new Error('web JSON save lost the edit');
    return { protocol: location.protocol, file: item.download, title: saved.nodes[0].title };
  }`);
  window.destroy();
  assert.equal(result.protocol, "http:");
  return result;
}

async function checkEditableFile(BrowserWindow, exportedPath) {
  const window = await createWindow(BrowserWindow);
  const consoleErrors = [];
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });
  await window.loadFile(exportedPath);
  await waitFor(window, `Number(document.querySelector('#node-count')?.textContent || 0) === 1 && document.querySelector('#diagram-title')?.textContent?.includes('Editable')`);
  await waitFor(window, `typeof window.__MINDMAP_EDITABLE_HTML_SOURCE__ === 'string'`);
  const security = await evaluate(window, `() => ({ protocol: location.protocol, payloadExecuted: Boolean(window.__titlePayloadExecuted), desktop: Boolean(window.mindmapDesktop) })`);
  assert.deepEqual(security, { protocol: "file:", payloadExecuted: false, desktop: false });

  const maliciousImport = `<!doctype html><html><body><script>window.__importPayloadExecuted=true</script><script id="${EMBEDDED_DIAGRAM_SCRIPT_ID}" type="application/json">${JSON.stringify(fixtureDiagram).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")}</script></body></html>`;
  await evaluate(window, `() => {
    window.__importPayloadExecuted=false;
    const input=document.querySelector('#open-file');
    const transfer=new DataTransfer(); transfer.items.add(new File([${JSON.stringify(maliciousImport)}],'untrusted.editable.html',{type:'text/html'}));
    input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }`);
  await waitFor(window, `Number(document.querySelector('#node-count')?.textContent || 0) === 1`);
  assert.equal(await evaluate(window, `() => Boolean(window.__importPayloadExecuted)`), false, "HTML import must not execute untrusted scripts");

  await openEditorAndReplaceTitle(window, "node-editable", "Offline HTML Edited");
  await installDownloadProbe(window);
  await evaluate(window, `() => { document.querySelector('[data-export="editable-html"]')?.click(); return true; }`);
  await waitFor(window, `window.__mindmapDownloads?.some((item)=>item.download.endsWith('.editable.html'))`);
  const result = await evaluate(window, `async () => {
    const item=window.__mindmapDownloads.find((entry)=>entry.download.endsWith('.editable.html'));
    const html=await fetch(item.href).then((response)=>response.text());
    const doc=new DOMParser().parseFromString(html,'text/html');
    const script=doc.getElementById(${JSON.stringify(EMBEDDED_DIAGRAM_SCRIPT_ID)});
    if(!script) throw new Error('re-export lost embedded diagram');
    const saved=JSON.parse(script.textContent);
    if(saved.nodes?.[0]?.title!=='Offline HTML Edited') throw new Error('editable HTML re-export lost the edit');
    if(!saved.assets?.['asset-pixel'] || saved.views?.length!==3) throw new Error('editable HTML re-export lost assets or views');
    const input=document.querySelector('#open-file');
    const transfer=new DataTransfer(); transfer.items.add(new File([html],'roundtrip.editable.html',{type:'text/html'}));
    input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    return { file:item.download, bytes:html.length, title:saved.nodes[0].title, assets:Object.keys(saved.assets).length, views:saved.views.length };
  }`);
  await waitFor(window, `document.querySelector('#node-list button[data-node-id="node-editable"] .node-list-title')?.textContent === 'Offline HTML Edited'`);
  window.destroy();
  assert.equal(consoleErrors.some((message) => /content security policy.*refused to execute/i.test(message)), false, consoleErrors.join("\n"));
  return result;
}

async function electronChild() {
  const { app, BrowserWindow } = createRequire(import.meta.url)("electron");
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "mindmap-editable-electron-"));
  app.setPath("userData", userData);
  app.on("window-all-closed", () => {});
  let server;
  try {
    await app.whenReady();
    const local = await startStaticServer();
    server = local.server;
    const web = await checkWebEditor(BrowserWindow, local.url);
    const standalone = await checkEditableFile(BrowserWindow, process.env.MINDMAP_EDITABLE_FIXTURE);
    console.log(`${resultPrefix}${JSON.stringify({ ok: true, web, standalone })}`);
    app.exit(0);
  } catch (error) {
    console.error(error?.stack || error);
    app.exit(1);
  } finally {
    server?.close();
    await fs.rm(userData, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const checked = await staticChecks();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "mindmap-editable-html-"));
  const exportedPath = path.join(temp, "fixture.editable.html");
  await fs.writeFile(exportedPath, checked.exported, "utf8");
  const electron = createRequire(import.meta.url)("electron");
  const env = { ...process.env, MINDMAP_EDITABLE_FIXTURE: exportedPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [fileURLToPath(import.meta.url), childFlag], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  await fs.rm(temp, { recursive: true, force: true });
  assert.equal(code, 0, `editable HTML browser checks failed:\n${stdout}\n${stderr}`);
  const match = stdout.match(new RegExp(`${resultPrefix}(.+)`));
  assert.ok(match, `editable HTML browser checks returned no result:\n${stdout}\n${stderr}`);
  const browser = JSON.parse(match[1]);
  assert.equal(browser.ok, true);
  console.log(JSON.stringify({ ok: true, static: { bytes: checked.bytes }, ...browser }, null, 2));
}

if (process.versions?.electron || process.argv.includes(childFlag)) electronChild();
else main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });

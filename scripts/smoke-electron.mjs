#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "desktop", "main.mjs");
const require = createRequire(import.meta.url);
const electron = require("electron");
const smokeSandbox = await fs.mkdtemp(path.join(os.tmpdir(), "mindmap-electron-smoke-"));
const smokeProjectsDir = path.join(smokeSandbox, "projects");
const mainSource = await fs.readFile(mainPath, "utf8");
assert.ok(mainSource.includes('["https:", "http:", "mailto:"].includes(parsed.protocol)'), "external URL policy must only allow http/https/mailto");
assert.ok(mainSource.includes("openExternalSafely(url);"), "external links must pass through allowlist helper");

function processList() {
  return new Promise((resolve) => {
    execFile("ps", ["-eo", "pid=,args="], (error, stdout) => {
      if (error) resolve("");
      else resolve(stdout);
    });
  });
}

function hasServeApp(output) {
  return output.split("\n").some((line) => {
    if (!line.includes("scripts/serve-app.mjs")) return false;
    return !line.includes("smoke-electron.mjs")
      && !line.includes("npm run app:smoke")
      && !line.includes("rg scripts/serve-app.mjs")
      && !line.includes("grep");
  });
}

const before = await processList();
assert.equal(hasServeApp(before), false, "serve-app is already running before Electron smoke");

const child = spawn(electron, [mainPath, "--smoke"], {
  cwd: root,
  env: (() => {
    const env = { ...process.env, MINDMAP_ELECTRON_SMOKE: "1", MINDMAP_PROJECTS_DIR: smokeProjectsDir };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  })(),
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const code = await new Promise((resolve) => {
  child.on("close", resolve);
});

assert.equal(code, 0, `Electron smoke failed:\n${stdout}\n${stderr}`);
const match = stdout.match(/MINDMAP_SMOKE_RESULT (.+)/);
assert.ok(match, `Electron smoke did not report result:\n${stdout}\n${stderr}`);
const result = JSON.parse(match[1]);
assert.equal(result.ok, true);
assert.equal(result.protocol, "mindmap:");
assert.ok(!result.url.includes("127.0.0.1"), `expected local protocol URL, got ${result.url}`);
assert.equal(result.hasWorkbench, true);
assert.equal(result.hasSidebar, true);
assert.equal(result.hasInspector, true);
assert.equal(result.hasCanvasControls, true);
assert.equal(result.hasMarquee, true);
assert.equal(result.hasMinimap, true);
assert.equal(result.hasViewSwitcher, true);
assert.equal(result.hasStyleTab, true);
assert.equal(result.hasHistoryTab, true);
assert.equal(result.marqueeSelectedCount, 2);
assert.equal(result.multiSelectedCount, 2);
assert.equal(result.inlineEditorOpened, true);
assert.equal(result.inlineValueEntered, true);
assert.equal(result.inlineBoldApplied, true);
assert.equal(result.inlineToolbarPreservedEditor, true);
assert.equal(result.inlineEditCommitted, true);
assert.equal(result.inlineEditUndoRestored, true);
assert.equal(result.imagePasteApplied, true);
assert.equal(result.imagePasteUndoRestored, true);
assert.equal(result.batchFontApplied, true);
assert.equal(result.batchFillApplied, true);
assert.equal(result.groupCreated, true);
assert.equal(result.groupUndoRestored, true);
assert.equal(result.copySelectionCount, 2);
assert.equal(result.copiedNodeCount, 2);
assert.equal(result.pasteShortcutSeen, true);
assert.equal(result.copyPasteAdded, true);
assert.equal(result.pasteUndoRestored, true);
assert.equal(result.nodeAdded, true);
assert.equal(result.addShortcutSeen, true);
assert.equal(result.addUndoRestored, true);
assert.equal(result.spacePanActivated, true);
assert.equal(result.spacePanMoved, true);
assert.equal(result.connectionCreated, true);
assert.equal(result.connectionUndoRestored, true);
assert.equal(result.dependencyViewActive, true);
assert.equal(result.unsavedGuardShown, true, "switching a dirty project must show the unsaved-changes guard");
assert.equal(result.newProjectCommandSeen, true, "Ctrl/Cmd+N must invoke the project dialog command");
assert.equal(result.projectDialogOpened, true, "Ctrl/Cmd+N must open the project dialog");
assert.equal(result.projectDialogMetrics?.withinViewport, true, "project dialog must stay inside the viewport");
assert.ok(result.projectDialogFocusState?.shellOpacity <= 0.2, "project dialog must visually quiet the canvas behind it");
assert.match(result.projectDialogFocusState?.shellFilter || "", /blur\(/, "project dialog must soften the canvas behind it");
assert.equal(result.newProjectShortcutSeen, true, "Ctrl/Cmd+N must invoke the blank-project command");
assert.equal(result.blankProjectCreated, true, "Ctrl/Cmd+N must create a blank diagram");
assert.equal(result.blankProjectNodeCount, 0, "a new blank project must contain no nodes");
assert.equal(result.blankProjectEdgeCount, 0, "a new blank project must contain no edges");
assert.equal(result.saveShortcutSeen, true, "Ctrl/Cmd+S must invoke the project save command");
assert.equal(result.projectSaved, true, "Ctrl/Cmd+S must persist the current blank project");
assert.equal(result.projectFileExists, true, "the saved project file must exist");
assert.match(result.projectFilePath, /[\\/]projects[\\/][^\\/]+\.diagram\.json$/);
assert.ok(result.zoomValue > 0, "zoom control should report a numeric value");
await fs.access(result.screenshotPath);
await fs.access(result.projectDialogScreenshotPath);

const after = await processList();
assert.equal(hasServeApp(after), false, "Electron smoke must not start serve-app");
await fs.rm(smokeSandbox, { recursive: true, force: true });

console.log(JSON.stringify({ ok: true, result }, null, 2));

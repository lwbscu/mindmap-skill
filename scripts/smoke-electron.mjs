#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "desktop", "main.mjs");
const require = createRequire(import.meta.url);
const electron = require("electron");
const mainSource = await fs.readFile(mainPath, "utf8");
assert.ok(mainSource.includes('parsed.protocol === "https:" || parsed.protocol === "http:"'), "external URL policy must only allow http/https");
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
    const env = { ...process.env, MINDMAP_ELECTRON_SMOKE: "1" };
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
assert.equal(result.groupCreated, true);
assert.equal(result.groupUndoRestored, true);
assert.equal(result.pasteShortcutSeen, true);
assert.equal(result.copyPasteAdded, true);
assert.equal(result.pasteUndoRestored, true);
assert.equal(result.nodeAdded, true);
assert.equal(result.addShortcutSeen, true);
assert.equal(result.addUndoRestored, true);
assert.equal(result.spacePanMoved, true);
assert.equal(result.connectionCreated, true);
assert.equal(result.connectionUndoRestored, true);
assert.equal(result.dependencyViewActive, true);
assert.ok(result.zoomValue > 0, "zoom control should report a numeric value");
await fs.access(result.screenshotPath);

const after = await processList();
assert.equal(hasServeApp(after), false, "Electron smoke must not start serve-app");

console.log(JSON.stringify({ ok: true, result }, null, 2));

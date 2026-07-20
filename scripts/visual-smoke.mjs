#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const electron = createRequire(import.meta.url)("electron");
const mainPath = path.join(root, "desktop", "main.mjs");
const sizes = [[1440, 900], [1024, 768], [760, 720], [390, 760]];

function capture(width, height) {
  return new Promise((resolve, reject) => {
    const screenshotPath = path.join(process.env.TMPDIR || "/tmp", `mindmap-${width}x${height}.png`);
    const env = {
      ...process.env,
      MINDMAP_ELECTRON_VISUAL: "1",
      MINDMAP_WINDOW_WIDTH: String(width),
      MINDMAP_WINDOW_HEIGHT: String(height),
      MINDMAP_SCREENSHOT_PATH: screenshotPath,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [mainPath], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      const match = stdout.match(/MINDMAP_VISUAL_RESULT (.+)/);
      if (code !== 0 || !match) return reject(new Error(`visual smoke ${width}x${height} failed\n${stdout}\n${stderr}`));
      resolve(JSON.parse(match[1]));
    });
  });
}

const results = [];
for (const [width, height] of sizes) {
  const result = await capture(width, height);
  assert.equal(result.ok, true);
  assert.equal(result.nodes, 15);
  assert.equal(result.edges, 18);
  assert.equal(result.renderedNodes, result.nodes, `${width}x${height} did not render every semantic node`);
  assert.equal(result.renderedEdges, result.edges, `${width}x${height} did not render every semantic edge`);
  assert.ok(result.edgePaths.some((path) => path.d && path.d.length > 4), `${width}x${height} edge paths are blank`);
  assert.equal(result.topbarOverflow, false, `${width}x${height} topbar overflowed`);
  assert.equal(result.statusbarOverflow, false, `${width}x${height} statusbar overflowed`);
  assert.ok(result.layerBounds, `${width}x${height} did not render layer bounds`);
  assert.ok(result.layerBounds.right >= result.graphRect.left && result.layerBounds.left <= result.graphRect.right, `${width}x${height} content is outside the horizontal viewport`);
  assert.ok(result.layerBounds.bottom >= result.graphRect.top && result.layerBounds.top <= result.graphRect.bottom, `${width}x${height} content is outside the vertical viewport`);
  assert.ok(result.zoom >= (width <= 620 ? 42 : 55), `${width}x${height} fit zoom is too small to read`);
  assert.ok(Number(result.sampleTypography?.fontSize) >= 18, `${width}x${height} node title is too small`);
  assert.equal(result.sampleTypography?.transform, null, `${width}x${height} inherited text transform shifted card copy`);
  assert.equal(result.inlineEditorActive, true, `${width}x${height} inline editor did not open`);
  assert.equal(result.inlineEditorVisible, true, `${width}x${height} inline editor is outside the visible viewport`);
  assert.equal(result.structuralControlsDisplay, "none", `${width}x${height} structural controls remained visible during text editing`);
  assert.equal(result.toolbar?.visible, true, `${width}x${height} rich-text toolbar is not visible`);
  assert.equal(result.toolbar?.withinViewport, true, `${width}x${height} rich-text toolbar escaped the viewport`);
  assert.equal(result.toolbar?.overlapsEditor, false, `${width}x${height} rich-text toolbar overlaps the editor`);
  assert.equal(result.toolbar?.fontMenuWithinViewport, true, `${width}x${height} font menu escaped the viewport`);
  assert.equal(result.toolbar?.sizeMenuWithinViewport, true, `${width}x${height} size menu escaped the viewport`);
  assert.equal(result.toolbar?.textColorPaletteWithinViewport, true, `${width}x${height} text color palette escaped the viewport`);
  assert.equal(result.toolbar?.highlightPaletteWithinViewport, true, `${width}x${height} highlight palette escaped the viewport`);
  assert.equal(result.toolbar?.paletteOverlapsEditor, false, `${width}x${height} rich-text palette overlaps the editor`);
  assert.equal(result.toolbar?.singleLineScrollable, true, `${width}x${height} rich-text toolbar must stay single-line and horizontally scrollable when narrow`);
  await fs.access(result.screenshotPath);
  await fs.access(result.toolbarScreenshotPath);
  results.push({ requested: `${width}x${height}`, ...result });
}

console.log(JSON.stringify({ ok: true, results }, null, 2));

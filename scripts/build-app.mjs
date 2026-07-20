#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { assertValidDiagram } from "../app/diagram-validator.mjs";
import { renderStandaloneHtml, renderSvg } from "../app/render-svg.mjs";
import { ensureViews } from "../app/views/view-model.mjs";
import { resolveView } from "../app/views/view-resolver.mjs";
import { buildEditableTemplate } from "./editable-template-builder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appRoot = path.join(root, "app");
const dist = path.join(root, "dist");
const appOut = path.join(dist, "app");
const examplesOut = path.join(dist, "examples");
const exportsOut = path.join(dist, "exports");

function slugFromTitle(title) {
  return String(title || "mindmap")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "mindmap";
}

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

await build({
  root: appRoot,
  base: "./",
  publicDir: false,
  logLevel: process.env.CI ? "info" : "warn",
  build: {
    outDir: appOut,
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: path.join(appRoot, "index.html"),
      output: {
        entryFileNames: "assets/app-[hash].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

await fs.cp(path.join(appRoot, "assets"), path.join(appOut, "assets"), { recursive: true });
await fs.copyFile(path.join(appRoot, "manifest.webmanifest"), path.join(appOut, "manifest.webmanifest"));
await fs.copyFile(path.join(appRoot, "service-worker.js"), path.join(appOut, "service-worker.js"));

const exampleNames = (await fs.readdir(path.join(root, "examples")))
  .filter((file) => file.endsWith(".diagram.json"))
  .sort();
const copiedExamples = [];
const generated = [];
await fs.mkdir(examplesOut, { recursive: true });
await fs.mkdir(exportsOut, { recursive: true });
for (const file of exampleNames) {
  const source = path.join(root, "examples", file);
  const target = path.join(examplesOut, file);
  await fs.copyFile(source, target);
  copiedExamples.push(target);
  const diagram = ensureViews(assertValidDiagram(JSON.parse(await fs.readFile(source, "utf8"))));
  const blueprint = resolveView(diagram, diagram.activeViewId, { routeEdges: true });
  const svg = renderSvg(blueprint);
  const html = renderStandaloneHtml(blueprint, svg);
  const slug = slugFromTitle(blueprint.title);
  const svgPath = path.join(exportsOut, `${slug}.svg`);
  const htmlPath = path.join(exportsOut, `${slug}.html`);
  await fs.writeFile(svgPath, svg, "utf8");
  await fs.writeFile(htmlPath, html, "utf8");
  generated.push(svgPath, htmlPath);
}

const redirect = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url=./app/">
  <title>MindMap</title>
</head>
<body><a href="./app/">Open MindMap</a></body>
</html>
`;
await fs.writeFile(path.join(dist, "index.html"), redirect, "utf8");

const editableTemplate = await buildEditableTemplate({ root, appRoot, appOut });

console.log(JSON.stringify({
  ok: true,
  dist,
  copied: {
    app: appOut,
    examples: copiedExamples,
    icon: path.join(appOut, "assets", "mindmap.png"),
    editableTemplate: editableTemplate.path
  },
  editableTemplate,
  generated
}, null, 2));

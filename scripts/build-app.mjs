#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderStandaloneHtml, renderSvg } from "../app/render-svg.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const appOut = path.join(dist, "app");
const examplesOut = path.join(dist, "examples");
const exportsOut = path.join(dist, "exports");

async function copyFileInto(source, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, path.basename(source));
  await fs.copyFile(source, target);
  return target;
}

function slugFromTitle(title) {
  return String(title || "mindmap")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "mindmap";
}

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

const appFiles = [
  "index.html",
  "app.js",
  "styles.css",
  "render-svg.mjs",
  "manifest.webmanifest",
  "service-worker.js"
];
const copiedApp = [];
for (const file of appFiles) {
  copiedApp.push(await copyFileInto(path.join(root, "app", file), appOut));
}
await fs.cp(path.join(root, "app", "assets"), path.join(appOut, "assets"), { recursive: true });

const exampleNames = (await fs.readdir(path.join(root, "examples")))
  .filter((file) => file.endsWith(".diagram.json"))
  .sort();
const copiedExamples = [];
const generated = [];
for (const file of exampleNames) {
  const source = path.join(root, "examples", file);
  copiedExamples.push(await copyFileInto(source, examplesOut));
  const diagram = JSON.parse(await fs.readFile(source, "utf8"));
  if (diagram.schemaVersion !== "mindmap-app/v1") {
    throw new Error(`${file} schemaVersion must be mindmap-app/v1`);
  }
  const svg = renderSvg(diagram);
  const html = renderStandaloneHtml(diagram, svg);
  const slug = slugFromTitle(diagram.title);
  await fs.mkdir(exportsOut, { recursive: true });
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
<body>
  <a href="./app/">Open MindMap</a>
</body>
</html>
`;
await fs.writeFile(path.join(dist, "index.html"), redirect, "utf8");

console.log(JSON.stringify({
  ok: true,
  dist,
  copied: {
    app: copiedApp,
    examples: copiedExamples,
    assets: [path.join(appOut, "assets", "mindmap.svg")]
  },
  generated
}, null, 2));

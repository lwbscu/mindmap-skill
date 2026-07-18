#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertValidDiagram } from "../app/diagram-validator.mjs";
import { renderStandaloneHtml, renderSvg } from "../app/render-svg.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultInput = path.join(root, "examples", "rpent-libero-behavior.diagram.json");
const input = process.argv[2] && !process.argv[2].startsWith("--")
  ? path.resolve(process.argv[2])
  : defaultInput;
const outputDirIndex = process.argv.indexOf("--out-dir");
const outputDir = outputDirIndex >= 0 && process.argv[outputDirIndex + 1]
  ? path.resolve(process.argv[outputDirIndex + 1])
  : path.join(root, "dist", "exports");

function slugFromTitle(title) {
  return String(title || "mindmap")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "mindmap";
}

const diagram = assertValidDiagram(JSON.parse(await fs.readFile(input, "utf8")));
const svg = renderSvg(diagram);
const html = renderStandaloneHtml(diagram, svg);
const slug = slugFromTitle(diagram.title);
await fs.mkdir(outputDir, { recursive: true });
const svgPath = path.join(outputDir, `${slug}.svg`);
const htmlPath = path.join(outputDir, `${slug}.html`);
await fs.writeFile(svgPath, svg, "utf8");
await fs.writeFile(htmlPath, html, "utf8");

console.log(JSON.stringify({
  ok: true,
  input,
  output: {
    svg: svgPath,
    html: htmlPath
  }
}, null, 2));

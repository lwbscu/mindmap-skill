import { renderStandaloneHtml, renderSvg } from "./render-svg.mjs";

const stage = document.querySelector("#stage");
const stageWrap = document.querySelector(".stage-wrap");
const downloadSvg = document.querySelector("#download-svg");
const downloadHtml = document.querySelector("#download-html");
const openFile = document.querySelector("#open-file");
const diagramTitle = document.querySelector("#diagram-title");
const diagramSubtitle = document.querySelector("#diagram-subtitle");
const diagramNote = document.querySelector("#diagram-note");
const layerCount = document.querySelector("#layer-count");
const nodeCount = document.querySelector("#node-count");
const edgeCount = document.querySelector("#edge-count");
const MIN_READABLE_ZOOM = 0.52;
const DEFAULT_DIAGRAM = "../examples/rpent-libero-behavior.diagram.json";

let zoom = 0.58;
let svgText = "";
let htmlText = "";
let canvasWidth = 2400;
let canvasHeight = 1650;
let currentObjectUrls = [];

function resetObjectUrls() {
  for (const url of currentObjectUrls) {
    URL.revokeObjectURL(url);
  }
  currentObjectUrls = [];
}

function setZoom(next) {
  zoom = Math.max(0.5, Math.min(1.35, next));
  stage.style.transform = `scale(${zoom})`;
  stage.style.width = `${canvasWidth * zoom + 64}px`;
  stage.style.height = `${canvasHeight * zoom + 64}px`;
}

function fitReadable() {
  const fitWidth = (stageWrap.clientWidth - 64) / canvasWidth;
  const fitHeight = (stageWrap.clientHeight - 64) / canvasHeight;
  const fit = Math.min(fitWidth, fitHeight);
  setZoom(Math.max(MIN_READABLE_ZOOM, Math.min(0.72, fit)));
}

function validateDiagram(diagram) {
  if (diagram?.schemaVersion !== "mindmap-app/v1") {
    throw new Error("diagram schemaVersion must be mindmap-app/v1");
  }
  if (!Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) {
    throw new Error("diagram nodes and edges must be arrays");
  }
}

function setDownload(link, text, type, filename) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  currentObjectUrls.push(url);
  link.href = url;
  link.download = filename;
}

function render(diagram) {
  validateDiagram(diagram);
  resetObjectUrls();
  canvasWidth = diagram.canvas?.width ?? canvasWidth;
  canvasHeight = diagram.canvas?.height ?? canvasHeight;
  svgText = renderSvg(diagram);
  htmlText = renderStandaloneHtml(diagram, svgText);
  stage.innerHTML = svgText;
  diagramTitle.textContent = diagram.title ?? "结构框图";
  diagramSubtitle.textContent = diagram.subtitle ?? "交互式结构框图";
  diagramNote.textContent = diagram.language ? `language: ${diagram.language}` : "";
  layerCount.textContent = String(diagram.layers?.length ?? 0);
  nodeCount.textContent = String(diagram.nodes.length);
  edgeCount.textContent = String(diagram.edges.length);
  const slug = (diagram.title ?? "mindmap").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mindmap";
  setDownload(downloadSvg, svgText, "image/svg+xml", `${slug}.svg`);
  setDownload(downloadHtml, htmlText, "text/html", `${slug}.html`);
  requestAnimationFrame(fitReadable);
}

async function loadDefault() {
  const response = await fetch(DEFAULT_DIAGRAM);
  if (!response.ok) {
    throw new Error(`Unable to load default diagram: ${response.status}`);
  }
  render(await response.json());
}

openFile.addEventListener("change", async () => {
  const [file] = openFile.files;
  if (!file) return;
  const text = await file.text();
  render(JSON.parse(text));
});

document.querySelector("#fit").addEventListener("click", fitReadable);
document.querySelector("#zoom-out").addEventListener("click", () => setZoom(zoom - 0.06));
document.querySelector("#zoom-in").addEventListener("click", () => setZoom(zoom + 0.08));
window.addEventListener("resize", fitReadable);

loadDefault().catch((error) => {
  stage.textContent = error.stack || error.message;
});

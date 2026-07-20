import { assertValidDiagram } from "./diagram-validator.mjs";

export const EMBEDDED_DIAGRAM_SCRIPT_ID = "mindmap-embedded-diagram";
export const EDITABLE_TEMPLATE_URL = "editable-template.html";
export const EDITABLE_DIAGRAM_PLACEHOLDER = "<!--__MINDMAP_EDITABLE_DIAGRAM_PLACEHOLDER__-->";
export const EDITABLE_HTML_FORMAT = "mindmap-editable-html/v1";
export const MAX_EDITABLE_HTML_BYTES = 64 * 1024 * 1024;

function embeddedScriptMarkup(json) {
  return `<script id="${EMBEDDED_DIAGRAM_SCRIPT_ID}" type="application/json">\n${json}\n</script>`;
}

export function safeJsonForScript(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function parseEmbeddedDiagramText(text, sourceLabel) {
  const raw = String(text || "").trim();
  if (!raw || raw === EDITABLE_DIAGRAM_PLACEHOLDER) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${sourceLabel} 中的可编辑 MindMap diagram 不是合法 JSON：${error.message}`);
  }
  return assertValidDiagram(parsed);
}

function placeholderCount(source) {
  return source.split(EDITABLE_DIAGRAM_PLACEHOLDER).length - 1;
}

function replaceEmbeddedScriptWithPlaceholder(source) {
  const pattern = new RegExp(
    `<script\\b(?=[^>]*\\bid=["']${EMBEDDED_DIAGRAM_SCRIPT_ID}["'])[^>]*>[\\s\\S]*?<\\/script>`,
    "i",
  );
  return pattern.test(source) ? source.replace(pattern, EDITABLE_DIAGRAM_PLACEHOLDER) : source;
}

export function normalizeEditableTemplate(source) {
  const text = replaceEmbeddedScriptWithPlaceholder(String(source || ""));
  const count = placeholderCount(text);
  if (count !== 1) {
    throw new Error(`可编辑 HTML 模板必须包含唯一占位符 ${EDITABLE_DIAGRAM_PLACEHOLDER}，当前数量为 ${count}。`);
  }
  return text;
}

export async function loadEditableHtmlTemplate() {
  if (typeof fetch === "function") {
    try {
      const response = await fetch(EDITABLE_TEMPLATE_URL, { cache: "no-store" });
      if (response.ok) return normalizeEditableTemplate(await response.text());
    } catch {
      // File URLs and offline exports may not allow fetch; fall back to the captured document source.
    }
  }
  const captured = globalThis.window?.__MINDMAP_EDITABLE_HTML_SOURCE__;
  if (captured) return normalizeEditableTemplate(captured);
  throw new Error(`无法读取 ${EDITABLE_TEMPLATE_URL}，且当前页面没有可复用的可编辑 HTML 模板。`);
}

export function renderEditableHtml(templateSource, diagram) {
  const template = normalizeEditableTemplate(templateSource);
  const validated = assertValidDiagram(diagram);
  const html = template.replace(EDITABLE_DIAGRAM_PLACEHOLDER, embeddedScriptMarkup(safeJsonForScript(validated)));
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > MAX_EDITABLE_HTML_BYTES) {
    throw new Error(`可编辑 HTML 为 ${(bytes / 1024 / 1024).toFixed(1)} MB，超过 64 MB 上限。请压缩或删除部分图片后重试。`);
  }
  return html;
}

export function readEmbeddedDiagramFromDocument(doc = globalThis.document) {
  const script = doc?.getElementById?.(EMBEDDED_DIAGRAM_SCRIPT_ID);
  if (!script) return null;
  return parseEmbeddedDiagramText(script.textContent, "当前 HTML");
}

export function extractEmbeddedDiagramFromHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html || ""), "text/html");
  const script = doc.getElementById(EMBEDDED_DIAGRAM_SCRIPT_ID);
  if (!script) {
    throw new Error(`HTML 中没有 script#${EMBEDDED_DIAGRAM_SCRIPT_ID}，无法作为可编辑 MindMap 导入。`);
  }
  const diagram = parseEmbeddedDiagramText(script.textContent, "导入 HTML");
  if (!diagram) {
    throw new Error(`HTML 中的 script#${EMBEDDED_DIAGRAM_SCRIPT_ID} 没有嵌入 mindmap-app/v1 diagram。`);
  }
  return diagram;
}

export const RICH_TEXT_VERSION = 1;
export const RICH_TEXT_BLOCK_TYPES = Object.freeze(["paragraph", "bullet-list-item", "ordered-list-item"]);
export const RICH_TEXT_ALIGNS = Object.freeze(["left", "center", "right"]);
export const SAFE_RICH_TEXT_FONT_FAMILIES = Object.freeze([
  "Inter, ui-sans-serif, system-ui, sans-serif",
  "Noto Sans CJK SC, Microsoft YaHei, PingFang SC, sans-serif",
  "Source Han Sans SC, Noto Sans CJK SC, sans-serif",
  "Georgia, serif",
  "ui-monospace, SFMono-Regular, Consolas, monospace",
  // Preserve font stacks emitted by earlier MindMap versions.
  "Inter, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
  "Noto Sans CJK SC, Microsoft YaHei, sans-serif",
]);
export const RICH_TEXT_MARKS = Object.freeze([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "italic",
  "underline",
  "strike",
  "code",
  "color",
  "backgroundColor",
  "link",
]);

const DEFAULT_BLOCK_TYPE = "paragraph";
const DEFAULT_ALIGN = "left";
const MAX_FONT_SIZE = 96;
const MIN_FONT_SIZE = 8;
const URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_FONT_FAMILIES = new Set(SAFE_RICH_TEXT_FONT_FAMILIES);

function textOf(value, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLineEndings(value) {
  return textOf(value).replace(/\r\n?/g, "\n");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function escapeHtml(value) {
  return textOf(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function decodeHtmlEntities(value) {
  return textOf(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

export function isSafeLink(value) {
  const href = textOf(value).trim();
  if (!href) return false;
  try {
    const url = new URL(href);
    return URL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function normalizeColor(value) {
  const color = textOf(value).trim();
  if (!color) return undefined;
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return color;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(color)) return color;
  if (/^[a-z]+$/i.test(color)) return color;
  return undefined;
}

export function normalizeMarks(marks = {}) {
  const next = {};
  const fontFamily = typeof marks.fontFamily === "string" ? marks.fontFamily.trim() : "";
  if (SAFE_FONT_FAMILIES.has(fontFamily)) next.fontFamily = fontFamily;
  if (marks.fontSize !== undefined) next.fontSize = clamp(Math.round(finiteNumber(marks.fontSize, 0)), MIN_FONT_SIZE, MAX_FONT_SIZE);
  if (marks.fontWeight !== undefined) {
    next.fontWeight = String(marks.fontWeight) === "700" || String(marks.fontWeight).toLowerCase() === "bold" ? "700" : "400";
  }
  if (marks.italic) next.italic = true;
  if (marks.underline) next.underline = true;
  if (marks.strike) next.strike = true;
  if (marks.code) next.code = true;
  const color = normalizeColor(marks.color);
  if (color) next.color = color;
  const backgroundColor = normalizeColor(marks.backgroundColor);
  if (backgroundColor) next.backgroundColor = backgroundColor;
  if (isSafeLink(marks.link)) next.link = textOf(marks.link).trim();
  return next;
}

export function marksEqual(left = {}, right = {}) {
  const a = normalizeMarks(left);
  const b = normalizeMarks(right);
  return RICH_TEXT_MARKS.every((key) => a[key] === b[key]);
}

function normalizeRun(run = {}) {
  return {
    text: textOf(run.text),
    marks: normalizeMarks(run.marks),
  };
}

function mergeRuns(runs = []) {
  const merged = [];
  for (const source of runs.map(normalizeRun)) {
    if (!source.text) continue;
    const previous = merged.at(-1);
    if (previous && marksEqual(previous.marks, source.marks)) {
      previous.text += source.text;
    } else {
      merged.push(source);
    }
  }
  return merged.length ? merged : [{ text: "", marks: {} }];
}

function normalizeBlock(block = {}, options = {}) {
  const type = RICH_TEXT_BLOCK_TYPES.includes(block.type) ? block.type : DEFAULT_BLOCK_TYPE;
  const align = RICH_TEXT_ALIGNS.includes(block.align) ? block.align : DEFAULT_ALIGN;
  return {
    type: options.singleBlock ? DEFAULT_BLOCK_TYPE : type,
    align,
    runs: mergeRuns(Array.isArray(block.runs) ? block.runs : [{ text: textOf(block.text), marks: block.marks || {} }]),
  };
}

export function createRichTextFromPlainText(value = "", options = {}) {
  const text = normalizeLineEndings(value);
  const lines = options.singleBlock ? [text.replace(/\n+/g, " ")] : text.split("\n");
  return {
    version: RICH_TEXT_VERSION,
    blocks: (lines.length ? lines : [""]).map((line) => ({
      type: DEFAULT_BLOCK_TYPE,
      align: DEFAULT_ALIGN,
      runs: [{ text: line, marks: normalizeMarks(options.marks) }],
    })),
  };
}

export function normalizeRichText(value, fallbackPlainText = "", options = {}) {
  if (!value || typeof value !== "object" || !Array.isArray(value.blocks)) {
    return createRichTextFromPlainText(fallbackPlainText, options);
  }
  const blocks = value.blocks.map((block) => normalizeBlock(block, options));
  if (options.singleBlock && blocks.length > 1) {
    return {
      version: RICH_TEXT_VERSION,
      blocks: [{
        type: DEFAULT_BLOCK_TYPE,
        align: blocks[0]?.align || DEFAULT_ALIGN,
        runs: mergeRuns(blocks.flatMap((block, index) => [
          ...(index ? [{ text: " ", marks: {} }] : []),
          ...block.runs,
        ])),
      }],
    };
  }
  return {
    version: RICH_TEXT_VERSION,
    blocks: blocks.length ? blocks : createRichTextFromPlainText(fallbackPlainText, options).blocks,
  };
}

export function richTextToPlainText(value, options = {}) {
  const richText = normalizeRichText(value, "", options);
  const text = richText.blocks.map((block) => block.runs.map((run) => run.text).join("")).join("\n");
  return options.singleBlock ? text.replace(/\s*\n\s*/g, " ") : text;
}

export function normalizeNodeRichText(source = {}, options = {}) {
  const title = normalizeRichText(source.richText?.title, source.title ?? options.defaultTitle ?? "", { singleBlock: true });
  const subtitle = normalizeRichText(source.richText?.subtitle, source.subtitle ?? options.defaultSubtitle ?? "", { singleBlock: false });
  return { title, subtitle };
}

export function syncPlainTextFields(source = {}) {
  const richText = normalizeNodeRichText(source);
  return {
    title: richTextToPlainText(richText.title, { singleBlock: true }),
    subtitle: richTextToPlainText(richText.subtitle),
    richText,
  };
}

function totalTextLength(richText) {
  return richText.blocks.reduce((sum, block, index) => (
    sum + block.runs.reduce((inner, run) => inner + run.text.length, 0) + (index ? 1 : 0)
  ), 0);
}

export function normalizeRichTextSelection(richText, selection = {}) {
  const normalized = normalizeRichText(richText);
  const length = totalTextLength(normalized);
  const rawStart = selection === "all" ? 0 : finiteNumber(selection.start, length);
  const rawEnd = selection === "all" ? length : finiteNumber(selection.end, rawStart);
  const start = clamp(Math.min(rawStart, rawEnd), 0, length);
  const end = clamp(Math.max(rawStart, rawEnd), 0, length);
  return { start, end, collapsed: start === end };
}

function mapRunsWithOffsets(richText) {
  const parts = [];
  let cursor = 0;
  richText.blocks.forEach((block, blockIndex) => {
    if (blockIndex) cursor += 1;
    block.runs.forEach((run, runIndex) => {
      const start = cursor;
      const end = start + run.text.length;
      parts.push({ blockIndex, runIndex, run, start, end });
      cursor = end;
    });
  });
  return parts;
}

function patchMarks(baseMarks, patch = {}) {
  const next = { ...normalizeMarks(baseMarks) };
  for (const key of RICH_TEXT_MARKS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === false || value == null || value === "") {
      delete next[key];
    } else {
      Object.assign(next, normalizeMarks({ [key]: value }));
    }
  }
  return next;
}

export function marksAtSelection(richText, selection = {}, options = {}) {
  const summary = selectionMarksSummary(richText, selection);
  if (options.mixedValue === undefined) return summary.marks;
  const marks = { ...summary.marks };
  for (const key of Object.keys(summary.mixed)) marks[key] = options.mixedValue;
  return marks;
}

export function selectionMarksSummary(richText, selection = {}) {
  const normalized = normalizeRichText(richText);
  const range = normalizeRichTextSelection(normalized, selection);
  const parts = mapRunsWithOffsets(normalized);
  if (range.collapsed) {
    const active = parts.find((part) => range.start > part.start && range.start <= part.end)
      || parts.find((part) => range.start >= part.start && range.start <= part.end)
      || parts.at(-1);
    return {
      collapsed: true,
      marks: normalizeMarks(active?.run?.marks),
      mixed: {},
    };
  }

  const selected = parts
    .map((part) => {
      const start = clamp(range.start - part.start, 0, part.run.text.length);
      const end = clamp(range.end - part.start, 0, part.run.text.length);
      return end > start ? { marks: normalizeMarks(part.run.marks), length: end - start } : null;
    })
    .filter(Boolean);
  if (!selected.length) return { collapsed: false, marks: {}, mixed: {} };

  const marks = {};
  const mixed = {};
  for (const key of RICH_TEXT_MARKS) {
    const values = new Map();
    for (const item of selected) {
      const value = item.marks[key] ?? "";
      values.set(String(value), value);
    }
    if (values.size === 1) {
      const value = values.values().next().value;
      if (value !== "") marks[key] = value;
    } else {
      mixed[key] = true;
      const firstMeaningful = Array.from(values.values()).find((value) => value !== "");
      if (firstMeaningful !== undefined) marks[key] = firstMeaningful;
    }
  }
  return { collapsed: false, marks: normalizeMarks(marks), mixed };
}

export function applyMarkToSelection(richText, selection, markPatch = {}) {
  const normalized = normalizeRichText(richText);
  const range = normalizeRichTextSelection(normalized, selection);
  if (range.collapsed) return normalized;
  const blocks = normalized.blocks.map((block) => ({ ...block, runs: [] }));
  for (const part of mapRunsWithOffsets(normalized)) {
    const beforeLength = clamp(range.start - part.start, 0, part.run.text.length);
    const afterStart = clamp(range.end - part.start, 0, part.run.text.length);
    const chunks = [
      { text: part.run.text.slice(0, beforeLength), marks: part.run.marks },
      { text: part.run.text.slice(beforeLength, afterStart), marks: patchMarks(part.run.marks, markPatch) },
      { text: part.run.text.slice(afterStart), marks: part.run.marks },
    ];
    blocks[part.blockIndex].runs.push(...chunks.filter((chunk) => chunk.text));
  }
  return {
    version: RICH_TEXT_VERSION,
    blocks: blocks.map((block) => ({ ...block, runs: mergeRuns(block.runs) })),
  };
}

export function clearFormattingAtSelection(richText, selection = {}) {
  const patch = Object.fromEntries(RICH_TEXT_MARKS.map((key) => [key, false]));
  return applyMarkToSelection(richText, selection, patch);
}

export function insertTextAtSelection(richText, selection, text, marks = {}) {
  const normalized = normalizeRichText(richText);
  const range = normalizeRichTextSelection(normalized, selection);
  const replacement = textOf(text);
  if (replacement.includes("\n")) return applyReplaceSelection(normalized, range, replacement, marks);
  const blockRanges = [];
  let cursor = 0;
  normalized.blocks.forEach((block, index) => {
    if (index) cursor += 1;
    const start = cursor;
    cursor += block.runs.reduce((sum, run) => sum + run.text.length, 0);
    blockRanges.push({ index, start, end: cursor });
  });
  const target = blockRanges.find((blockRange) => range.start >= blockRange.start && range.end <= blockRange.end);
  if (!target) return applyReplaceSelection(normalized, range, replacement, marks);

  const blocks = normalized.blocks.map((block, index) => {
    if (index !== target.index) return block;
    const localStart = range.start - target.start;
    const localEnd = range.end - target.start;
    const runs = [];
    let runCursor = 0;
    let inserted = false;
    for (const run of block.runs) {
      const runStart = runCursor;
      const runEnd = runCursor + run.text.length;
      runCursor = runEnd;
      if (runEnd <= localStart || runStart >= localEnd) {
        if (!inserted && runStart >= localEnd) {
          runs.push({ text: replacement, marks: normalizeMarks(marks) });
          inserted = true;
        }
        runs.push(run);
        continue;
      }
      const keepBefore = run.text.slice(0, clamp(localStart - runStart, 0, run.text.length));
      const keepAfter = run.text.slice(clamp(localEnd - runStart, 0, run.text.length));
      if (keepBefore) runs.push({ text: keepBefore, marks: run.marks });
      if (!inserted) {
        runs.push({ text: replacement, marks: normalizeMarks(marks) });
        inserted = true;
      }
      if (keepAfter) runs.push({ text: keepAfter, marks: run.marks });
    }
    if (!inserted) runs.push({ text: replacement, marks: normalizeMarks(marks) });
    return { ...block, runs: mergeRuns(runs) };
  });
  return { version: RICH_TEXT_VERSION, blocks };
}

function applyReplaceSelection(richText, selection, replacement = "", marks = {}) {
  const normalized = normalizeRichText(richText);
  const range = normalizeRichTextSelection(normalized, selection);
  const plain = richTextToPlainText(normalized);
  const nextPlain = `${plain.slice(0, range.start)}${replacement}${plain.slice(range.end)}`;
  const next = createRichTextFromPlainText(nextPlain);
  if (!replacement) return next;
  return applyMarkToSelection(next, { start: range.start, end: range.start + replacement.length }, marks);
}

export function setBlockTypeAtSelection(richText, selection, type = DEFAULT_BLOCK_TYPE) {
  const normalized = normalizeRichText(richText);
  const range = normalizeRichTextSelection(normalized, selection);
  const nextType = RICH_TEXT_BLOCK_TYPES.includes(type) ? type : DEFAULT_BLOCK_TYPE;
  let offset = 0;
  return {
    ...normalized,
    blocks: normalized.blocks.map((block, index) => {
      const start = offset + (index ? 1 : 0);
      offset = start + block.runs.reduce((sum, run) => sum + run.text.length, 0);
      const end = offset;
      return end >= range.start && start <= range.end ? { ...block, type: nextType } : block;
    }),
  };
}

export function setBlockAlignAtSelection(richText, selection, align = DEFAULT_ALIGN) {
  const normalized = normalizeRichText(richText);
  const nextAlign = RICH_TEXT_ALIGNS.includes(align) ? align : DEFAULT_ALIGN;
  const range = normalizeRichTextSelection(normalized, selection);
  let offset = 0;
  return {
    ...normalized,
    blocks: normalized.blocks.map((block, index) => {
      const start = offset + (index ? 1 : 0);
      offset = start + block.runs.reduce((sum, run) => sum + run.text.length, 0);
      const end = offset;
      return end >= range.start && start <= range.end ? { ...block, align: nextAlign } : block;
    }),
  };
}

export function sliceRichTextSelection(richText, selection = {}, options = {}) {
  const normalized = normalizeRichText(richText, "", options);
  const range = normalizeRichTextSelection(normalized, selection);
  if (range.collapsed) return createRichTextFromPlainText("", options);
  const blocks = [];
  let blockStart = 0;
  normalized.blocks.forEach((block, blockIndex) => {
    if (blockIndex) blockStart += 1;
    const blockLength = block.runs.reduce((sum, run) => sum + run.text.length, 0);
    const blockEnd = blockStart + blockLength;
    if (blockEnd >= range.start && blockStart <= range.end) {
      const runs = [];
      let runStart = blockStart;
      for (const run of block.runs) {
        const runEnd = runStart + run.text.length;
        if (runEnd > range.start && runStart < range.end) {
          const start = clamp(range.start - runStart, 0, run.text.length);
          const end = clamp(range.end - runStart, 0, run.text.length);
          runs.push({ text: run.text.slice(start, end), marks: run.marks });
        }
        runStart = runEnd;
      }
      blocks.push({ ...block, runs: mergeRuns(runs) });
    }
    blockStart = blockEnd;
  });
  return normalizeRichText({ version: RICH_TEXT_VERSION, blocks }, "", options);
}

function styleForMarks(marks = {}) {
  const style = [];
  if (marks.fontFamily) style.push(`font-family:${escapeHtml(marks.fontFamily)}`);
  if (marks.fontSize) style.push(`font-size:${marks.fontSize}px`);
  if (marks.fontWeight === "700") style.push("font-weight:700");
  if (marks.italic) style.push("font-style:italic");
  if (marks.underline || marks.strike) {
    style.push(`text-decoration:${[marks.underline && "underline", marks.strike && "line-through"].filter(Boolean).join(" ")}`);
  }
  if (marks.color) style.push(`color:${escapeHtml(marks.color)}`);
  if (marks.backgroundColor) style.push(`background-color:${escapeHtml(marks.backgroundColor)}`);
  return style.join(";");
}

function renderRun(run) {
  const marks = normalizeMarks(run.marks);
  let html = escapeHtml(run.text).replace(/\n/g, "<br>");
  if (marks.code) html = `<code>${html}</code>`;
  const style = styleForMarks(marks);
  if (style) html = `<span style="${style}">${html}</span>`;
  if (marks.link && isSafeLink(marks.link)) {
    html = `<a href="${escapeHtml(marks.link)}" rel="noopener noreferrer">${html}</a>`;
  }
  return html;
}

export function richTextToSafeHtml(value, options = {}) {
  const richText = normalizeRichText(value, "", options);
  return richText.blocks.map((block) => {
    const text = block.runs.map(renderRun).join("") || "<br>";
    const type = block.type === "bullet-list-item" ? "li" : block.type === "ordered-list-item" ? "li" : "div";
    const list = block.type === "bullet-list-item" ? "ul" : block.type === "ordered-list-item" ? "ol" : "";
    const attrs = `data-block-type="${block.type}" style="text-align:${block.align}"`;
    const inner = `<${type} ${attrs}>${text}</${type}>`;
    return list ? `<${list}>${inner}</${list}>` : inner;
  }).join("");
}

function parseStyleMarks(style = "") {
  const marks = {};
  for (const item of textOf(style).split(";")) {
    const [rawKey, ...rawValue] = item.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (!key || !value) continue;
    if (key === "font-family") marks.fontFamily = value.replace(/^["']|["']$/g, "");
    if (key === "font-size") marks.fontSize = Number.parseInt(value, 10);
    if (key === "font-weight" && (value === "700" || value === "bold")) marks.fontWeight = "700";
    if (key === "font-style" && value === "italic") marks.italic = true;
    if (key === "text-decoration" && value.includes("underline")) marks.underline = true;
    if (key === "text-decoration" && value.includes("line-through")) marks.strike = true;
    if (key === "color") marks.color = value;
    if (key === "background-color") marks.backgroundColor = value;
  }
  return normalizeMarks(marks);
}

export function richTextFromElement(element, options = {}) {
  if (!element) return createRichTextFromPlainText("", options);
  const blocks = [];
  const readNode = (node, marks = {}) => {
    if (node.nodeType === 3) return [{ text: node.nodeValue || "", marks }];
    if (node.nodeType !== 1) return [];
    const tag = node.tagName.toLowerCase();
    const nextMarks = { ...marks, ...parseStyleMarks(node.getAttribute("style")) };
    if (tag === "b" || tag === "strong") nextMarks.fontWeight = "700";
    if (tag === "i" || tag === "em") nextMarks.italic = true;
    if (tag === "u") nextMarks.underline = true;
    if (tag === "s" || tag === "strike" || tag === "del") nextMarks.strike = true;
    if (tag === "code") nextMarks.code = true;
    if (tag === "a" && isSafeLink(node.getAttribute("href"))) nextMarks.link = node.getAttribute("href").trim();
    if (tag === "br") return [{ text: "\n", marks: nextMarks }];
    return Array.from(node.childNodes).flatMap((child) => readNode(child, nextMarks));
  };
  const children = Array.from(element.children).length ? Array.from(element.children) : [element];
  for (const child of children) {
    const tag = child.tagName?.toLowerCase?.();
    if (tag === "ul" || tag === "ol") {
      for (const li of Array.from(child.children).filter((item) => item.tagName?.toLowerCase() === "li")) {
        blocks.push({
          type: tag === "ul" ? "bullet-list-item" : "ordered-list-item",
          align: RICH_TEXT_ALIGNS.includes(li.style.textAlign) ? li.style.textAlign : DEFAULT_ALIGN,
          runs: mergeRuns(readNode(li)),
        });
      }
    } else {
      blocks.push({
        type: child.dataset?.blockType && RICH_TEXT_BLOCK_TYPES.includes(child.dataset.blockType) ? child.dataset.blockType : DEFAULT_BLOCK_TYPE,
        align: RICH_TEXT_ALIGNS.includes(child.style?.textAlign) ? child.style.textAlign : DEFAULT_ALIGN,
        runs: mergeRuns(readNode(child)),
      });
    }
  }
  return normalizeRichText({ version: RICH_TEXT_VERSION, blocks }, "", options);
}

export function safeHtmlToRichText(html = "", options = {}) {
  const plain = decodeHtmlEntities(
    textOf(html)
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*(div|p|li|ul|ol|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\n{3,}/g, "\n\n").trim();
  return createRichTextFromPlainText(plain, options);
}

export function serializeRichText(value, options = {}) {
  return clone(normalizeRichText(value, "", options));
}

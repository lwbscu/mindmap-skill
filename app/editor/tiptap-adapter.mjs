import { Editor, posToDOMRect } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";

import {
  createRichTextFromPlainText,
  isSafeLink,
  normalizeMarks,
  normalizeRichText,
  normalizeRichTextSelection,
  richTextToPlainText,
  selectionMarksSummary,
  serializeRichText,
  sliceRichTextSelection,
} from "./rich-text.mjs";

const BLOCK_TYPES = new Set(["paragraph", "bullet-list-item", "ordered-list-item"]);
const ALIGNMENTS = new Set(["left", "center", "right"]);
const MARK_KEYS = ["fontFamily", "fontSize", "fontWeight", "italic", "underline", "strike", "code", "color", "backgroundColor", "link"];

function textOf(value, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeFontSize(value) {
  if (value == null || value === "") return undefined;
  const number = Number.parseInt(String(value).replace("px", ""), 10);
  return Number.isFinite(number) ? clamp(number, 8, 96) : undefined;
}

function normalizeAlign(value) {
  return ALIGNMENTS.has(value) ? value : "left";
}

function textStyleAttrsFromMarks(marks = {}) {
  const normalized = normalizeMarks(marks);
  const attrs = {};
  if (normalized.fontFamily) attrs.fontFamily = normalized.fontFamily;
  if (normalized.fontSize) attrs.fontSize = `${normalized.fontSize}px`;
  if (normalized.color) attrs.color = normalized.color;
  if (normalized.backgroundColor) attrs.backgroundColor = normalized.backgroundColor;
  return attrs;
}

function tiptapMarksFromRichMarks(marks = {}) {
  const normalized = normalizeMarks(marks);
  const tiptapMarks = [];
  const textStyleAttrs = textStyleAttrsFromMarks(normalized);
  if (Object.keys(textStyleAttrs).length) tiptapMarks.push({ type: "textStyle", attrs: textStyleAttrs });
  if (normalized.fontWeight === "700") tiptapMarks.push({ type: "bold" });
  if (normalized.italic) tiptapMarks.push({ type: "italic" });
  if (normalized.underline) tiptapMarks.push({ type: "underline" });
  if (normalized.strike) tiptapMarks.push({ type: "strike" });
  if (normalized.code) tiptapMarks.push({ type: "code" });
  if (normalized.link && isSafeLink(normalized.link)) tiptapMarks.push({ type: "link", attrs: { href: normalized.link } });
  return tiptapMarks.length ? tiptapMarks : undefined;
}

function richMarksFromTiptapMarks(marks = []) {
  const richMarks = {};
  for (const mark of marks || []) {
    if (mark.type === "bold") richMarks.fontWeight = "700";
    if (mark.type === "italic") richMarks.italic = true;
    if (mark.type === "underline") richMarks.underline = true;
    if (mark.type === "strike") richMarks.strike = true;
    if (mark.type === "code") richMarks.code = true;
    if (mark.type === "link" && isSafeLink(mark.attrs?.href)) richMarks.link = mark.attrs.href.trim();
    if (mark.type === "textStyle") {
      if (mark.attrs?.fontFamily) richMarks.fontFamily = mark.attrs.fontFamily;
      const fontSize = normalizeFontSize(mark.attrs?.fontSize);
      if (fontSize) richMarks.fontSize = fontSize;
      if (mark.attrs?.color) richMarks.color = mark.attrs.color;
      if (mark.attrs?.backgroundColor) richMarks.backgroundColor = mark.attrs.backgroundColor;
    }
  }
  return normalizeMarks(richMarks);
}

function tiptapTextNodeFromRun(run = {}) {
  const text = textOf(run.text);
  if (!text) return null;
  const node = { type: "text", text };
  const marks = tiptapMarksFromRichMarks(run.marks);
  if (marks) node.marks = marks;
  return node;
}

function paragraphNodeFromBlock(block = {}) {
  const content = (block.runs || []).map(tiptapTextNodeFromRun).filter(Boolean);
  const attrs = { textAlign: normalizeAlign(block.align) };
  return content.length ? { type: "paragraph", attrs, content } : { type: "paragraph", attrs };
}

function listItemFromBlock(block = {}) {
  return { type: "listItem", content: [paragraphNodeFromBlock(block)] };
}

export function richTextToTiptapJson(value, options = {}) {
  const richText = normalizeRichText(value, "", { singleBlock: Boolean(options.singleBlock) });
  const content = [];
  let pendingList = null;
  const flushList = () => {
    if (pendingList) content.push(pendingList);
    pendingList = null;
  };

  for (const block of richText.blocks) {
    const type = options.singleBlock ? "paragraph" : block.type;
    if (type === "bullet-list-item" || type === "ordered-list-item") {
      const listType = type === "bullet-list-item" ? "bulletList" : "orderedList";
      if (!pendingList || pendingList.type !== listType) {
        flushList();
        pendingList = { type: listType, content: [] };
      }
      pendingList.content.push(listItemFromBlock(block));
    } else {
      flushList();
      content.push(paragraphNodeFromBlock(block));
    }
  }
  flushList();
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function runsFromInlineContent(content = []) {
  const runs = [];
  for (const child of content || []) {
    if (child.type === "text") runs.push({ text: textOf(child.text), marks: richMarksFromTiptapMarks(child.marks) });
    if (child.type === "hardBreak") runs.push({ text: "\n", marks: {} });
    if (Array.isArray(child.content)) runs.push(...runsFromInlineContent(child.content));
  }
  return runs.length ? runs : [{ text: "", marks: {} }];
}

function blockFromParagraph(node = {}, type = "paragraph") {
  return {
    type: BLOCK_TYPES.has(type) ? type : "paragraph",
    align: normalizeAlign(node.attrs?.textAlign),
    runs: runsFromInlineContent(node.content),
  };
}

function blocksFromTiptapNode(node = {}, listType = null) {
  if (node.type === "paragraph") {
    return [blockFromParagraph(node, listType || "paragraph")];
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const childType = node.type === "bulletList" ? "bullet-list-item" : "ordered-list-item";
    return (node.content || []).flatMap((child) => blocksFromTiptapNode(child, childType));
  }
  if (node.type === "listItem") {
    const firstParagraph = (node.content || []).find((child) => child.type === "paragraph");
    return firstParagraph ? [blockFromParagraph(firstParagraph, listType || "bullet-list-item")] : [];
  }
  if (Array.isArray(node.content)) return node.content.flatMap((child) => blocksFromTiptapNode(child, listType));
  return [];
}

export function tiptapJsonToRichText(json = {}, options = {}) {
  const blocks = (json.content || []).flatMap((node) => blocksFromTiptapNode(node));
  if (!options.singleBlock) return normalizeRichText({ version: 1, blocks });
  const normalized = normalizeRichText({ version: 1, blocks });
  const mergedRuns = [];
  normalized.blocks.forEach((block, index) => {
    if (index) mergedRuns.push({ text: " ", marks: {} });
    mergedRuns.push(...(block.runs || []));
  });
  return normalizeRichText({
    version: 1,
    blocks: [{
      type: "paragraph",
      align: normalized.blocks[0]?.align || "left",
      runs: mergedRuns.length ? mergedRuns : [{ text: "", marks: {} }],
    }],
  }, richTextToPlainText(normalized, { singleBlock: true }), { singleBlock: true });
}

function plainTextFromDoc(doc) {
  return doc?.textBetween?.(0, doc.content.size, "\n", "\n") || "";
}

function plainOffsetAtPosition(doc, position) {
  return doc.textBetween(0, clamp(position, 0, doc.content.size), "\n", "\n").length;
}

function flattenTextPositions(doc) {
  const parts = [];
  let offset = 0;
  let previousBlock = false;
  doc.descendants((node, pos) => {
    if (node.isBlock && node.type.name !== "doc") {
      if (previousBlock) offset += 1;
      previousBlock = true;
    }
    if (node.isText) {
      parts.push({ start: offset, end: offset + node.text.length, from: pos, to: pos + node.nodeSize });
      offset += node.text.length;
    }
  });
  return { parts, length: plainTextFromDoc(doc).length };
}

function positionAtPlainOffset(doc, targetOffset) {
  const { parts, length } = flattenTextPositions(doc);
  const offset = clamp(targetOffset, 0, length);
  for (const part of parts) {
    if (offset <= part.end) return part.from + clamp(offset - part.start, 0, part.end - part.start);
  }
  return Math.max(1, doc.content.size - 1);
}

function selectionRangeFromEditor(editor) {
  const { from, to } = editor.state.selection;
  const doc = editor.state.doc;
  const start = plainOffsetAtPosition(doc, Math.min(from, to));
  const end = plainOffsetAtPosition(doc, Math.max(from, to));
  return normalizeRichTextSelection(tiptapJsonToRichText(editor.getJSON()), { start, end });
}

function anchorRectFromEditor(editor, windowRef) {
  try {
    const { from, to } = editor.state.selection;
    const rect = posToDOMRect(editor.view, from, to);
    if (rect && Number.isFinite(rect.left)) return rect;
  } catch {
    // Fall back to the browser selection below.
  }
  const selection = windowRef.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  return rect && Number.isFinite(rect.left) ? rect : null;
}

function applyTextStyleCommand(editor, key, value) {
  const chain = editor.chain().focus();
  if (value === false || value == null || value === "" || value === "400") {
    if (key === "fontFamily") return chain.unsetFontFamily().run();
    if (key === "fontSize") return chain.unsetFontSize().run();
    if (key === "color") return chain.unsetColor().run();
    if (key === "backgroundColor") return chain.unsetBackgroundColor().run();
  }
  if (key === "fontFamily") return chain.setFontFamily(textOf(value)).run();
  if (key === "fontSize") return chain.setFontSize(`${normalizeMarks({ fontSize: value }).fontSize || 14}px`).run();
  if (key === "color") return chain.setColor(textOf(value)).run();
  if (key === "backgroundColor") return chain.setBackgroundColor(textOf(value)).run();
  return false;
}

function applyBooleanMarkCommand(editor, key, value) {
  const enable = value !== false && value != null && value !== "" && value !== "400";
  const chain = editor.chain().focus();
  if (key === "fontWeight") return enable ? chain.setBold().run() : chain.unsetBold().run();
  if (key === "italic") return enable ? chain.setItalic().run() : chain.unsetItalic().run();
  if (key === "underline") return enable ? chain.setUnderline().run() : chain.unsetUnderline().run();
  if (key === "strike") return enable ? chain.setStrike().run() : chain.unsetStrike().run();
  if (key === "code") return enable ? chain.setCode().run() : chain.unsetCode().run();
  return false;
}

function applyLinkCommand(editor, value) {
  const chain = editor.chain().focus();
  if (!value || value === false) return chain.unsetLink().run();
  const href = textOf(value).trim();
  if (!isSafeLink(href)) return false;
  return chain.setLink({ href }).run();
}

function marksAtCursorFromEditor(editor) {
  const textStyle = editor.getAttributes("textStyle") || {};
  const link = editor.getAttributes("link")?.href;
  return normalizeMarks({
    fontFamily: textStyle.fontFamily,
    fontSize: normalizeFontSize(textStyle.fontSize),
    color: textStyle.color,
    backgroundColor: textStyle.backgroundColor,
    fontWeight: editor.isActive("bold") ? "700" : undefined,
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    link: isSafeLink(link) ? link : undefined,
  });
}

function insertPlainText(editor, text, options = {}) {
  const clean = options.singleBlock ? textOf(text).replace(/\s*\n\s*/g, " ") : textOf(text).replace(/\r\n?/g, "\n");
  return editor.chain().focus().insertContent(clean).run();
}

export function createTiptapFieldEditor(options = {}) {
  const element = options.element;
  const singleBlock = Boolean(options.singleBlock);
  const windowRef = options.window || element?.ownerDocument?.defaultView || window;
  const onUpdate = options.onUpdate || (() => {});
  const onSelectionChange = options.onSelectionChange || (() => {});
  let isComposing = false;
  let lastRange = null;
  let api = null;

  const emitSelection = () => {
    if (api) onSelectionChange(api.getSelectionState());
  };

  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: false, protocols: ["mailto"] },
      }),
      TextStyleKit,
      TextAlign.configure({ types: ["paragraph"], alignments: ["left", "center", "right"] }),
    ],
    content: richTextToTiptapJson(options.richText, { singleBlock }),
    editorProps: {
      attributes: {
        class: `inline-editor__prosemirror inline-editor__prosemirror--${singleBlock ? "title" : "subtitle"}`,
        spellcheck: "false",
        role: "textbox",
        "aria-multiline": singleBlock ? "false" : "true",
      },
      handleDOMEvents: {
        compositionstart: () => {
          isComposing = true;
          return false;
        },
        compositionend: () => {
          isComposing = false;
          windowRef.requestAnimationFrame(() => onUpdate("composition"));
          return false;
        },
        copy: (_view, event) => {
          if (editor.state.selection.empty) return false;
          const richText = api.getSelectedRichText();
          event.clipboardData?.setData("application/x-mindmap-rich-text", JSON.stringify(richText));
          event.clipboardData?.setData("text/plain", richTextToPlainText(richText, { singleBlock }));
          event.preventDefault();
          event.stopPropagation();
          return true;
        },
        cut: (_view, event) => {
          if (editor.state.selection.empty) return false;
          const richText = api.getSelectedRichText();
          event.clipboardData?.setData("application/x-mindmap-rich-text", JSON.stringify(richText));
          event.clipboardData?.setData("text/plain", richTextToPlainText(richText, { singleBlock }));
          editor.chain().focus().deleteSelection().run();
          event.preventDefault();
          event.stopPropagation();
          return true;
        },
        paste: (_view, event) => {
          event.preventDefault();
          event.stopPropagation();
          const richPayload = event.clipboardData?.getData("application/x-mindmap-rich-text");
          if (richPayload) {
            try {
              const richText = serializeRichText(JSON.parse(richPayload), { singleBlock });
              const content = richTextToTiptapJson(richText, { singleBlock }).content || [];
              const insertable = singleBlock ? (content[0]?.content || richTextToPlainText(richText, { singleBlock })) : content;
              editor.chain().focus().insertContent(insertable).run();
              return true;
            } catch {
              // Fall through to plain text.
            }
          }
          insertPlainText(editor, event.clipboardData?.getData("text/plain") || "", { singleBlock });
          return true;
        },
        keydown: (_view, event) => {
          if (event.isComposing) isComposing = true;
          return false;
        },
      },
    },
    onUpdate: () => onUpdate("input"),
    onSelectionUpdate: () => {
      lastRange = selectionRangeFromEditor(editor);
      emitSelection();
    },
    onTransaction: () => {
      lastRange = selectionRangeFromEditor(editor);
    },
  });

  api = {
    editor,
    destroy: () => editor.destroy(),
    isComposing: () => isComposing,
    focus: (selection = null) => {
      editor.commands.focus();
      if (selection) api.setSelection(selection);
      return true;
    },
    getRichText: () => tiptapJsonToRichText(editor.getJSON(), { singleBlock }),
    getPlainText: () => richTextToPlainText(api.getRichText(), { singleBlock }),
    setRichText: (richText, selection = null) => {
      editor.commands.setContent(richTextToTiptapJson(richText, { singleBlock }), false);
      if (selection) api.setSelection(selection);
      return true;
    },
    getSelection: () => {
      lastRange = selectionRangeFromEditor(editor);
      return { ...lastRange };
    },
    setSelection: (selection = {}) => {
      const range = selection === "all"
        ? { start: 0, end: api.getPlainText().length }
        : selection === "end"
          ? { start: api.getPlainText().length, end: api.getPlainText().length }
          : normalizeRichTextSelection(api.getRichText(), selection);
      const doc = editor.state.doc;
      const from = positionAtPlainOffset(doc, range.start);
      const to = positionAtPlainOffset(doc, range.end);
      editor.commands.setTextSelection({ from, to });
      lastRange = range;
      return { ...range };
    },
    getSelectedRichText: () => {
      const range = api.getSelection();
      const richText = api.getRichText();
      if (range.start === range.end) return richText;
      return sliceRichTextSelection(richText, range, { singleBlock });
    },
    getSelectionState: () => {
      const richText = api.getRichText();
      const range = api.getSelection();
      const summary = selectionMarksSummary(richText, range);
      const collapsed = range.start === range.end;
      return {
        range,
        collapsed,
        marks: collapsed ? marksAtCursorFromEditor(editor) : summary.marks,
        mixed: collapsed ? {} : summary.mixed,
        richText,
        anchorRect: anchorRectFromEditor(editor, windowRef),
      };
    },
    applyMark: (markPatch = {}) => {
      editor.commands.focus();
      let changed = false;
      for (const key of MARK_KEYS) {
        if (!(key in markPatch)) continue;
        const value = markPatch[key];
        if (["fontFamily", "fontSize", "color", "backgroundColor"].includes(key)) {
          changed = applyTextStyleCommand(editor, key, value) || changed;
        } else if (key === "link") {
          changed = applyLinkCommand(editor, value) || changed;
        } else {
          changed = applyBooleanMarkCommand(editor, key, value) || changed;
        }
      }
      onSelectionChange(api.getSelectionState());
      return changed;
    },
    clearFormatting: () => {
      const result = editor.chain().focus().unsetAllMarks().run();
      onSelectionChange(api.getSelectionState());
      return result;
    },
    setBlockType: (type = "paragraph") => {
      if (singleBlock) return editor.chain().focus().setParagraph().run();
      if (type === "bullet-list-item") return editor.chain().focus().toggleBulletList().run();
      if (type === "ordered-list-item") return editor.chain().focus().toggleOrderedList().run();
      return editor.chain().focus().setParagraph().run();
    },
    setBlockAlign: (align = "left") => editor.chain().focus().setTextAlign(normalizeAlign(align)).run(),
    insertPlainText: (text) => insertPlainText(editor, text, { singleBlock }),
    undo: () => editor.commands.undo(),
    redo: () => editor.commands.redo(),
  };

  return api;
}

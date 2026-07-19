import {
  applyMarkToSelection,
  createRichTextFromPlainText,
  insertTextAtSelection,
  marksAtSelection,
  normalizeNodeRichText,
  normalizeRichText,
  richTextFromElement,
  sliceRichTextSelection,
  richTextToPlainText,
  richTextToSafeHtml,
  safeHtmlToRichText,
  serializeRichText,
  setBlockAlignAtSelection,
  setBlockTypeAtSelection,
} from "./rich-text.mjs";

export const INLINE_EDIT_FIELDS = Object.freeze(["title", "subtitle"]);

const DEFAULT_TITLE = "未命名";
const DEFAULT_SUBTITLE = "";
const DEFAULT_GAP = 6;
const DEFAULT_PADDING = 8;
const DEFAULT_MIN_WIDTH = 180;
const DEFAULT_MAX_WIDTH = 520;
const DEFAULT_MIN_HEIGHT = 88;

function identity(value) {
  return value;
}

function noop() {}

function isElement(value) {
  return Boolean(value?.nodeType === 1);
}

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

export function isInlineEditField(field) {
  return INLINE_EDIT_FIELDS.includes(field);
}

export function normalizeInlineEditField(field, fallback = "title") {
  return isInlineEditField(field) ? field : fallback;
}

export function createInlineEditDraft(source = {}, options = {}) {
  const richText = normalizeNodeRichText(source, {
    defaultTitle: options.defaultTitle ?? DEFAULT_TITLE,
    defaultSubtitle: options.defaultSubtitle ?? DEFAULT_SUBTITLE,
  });
  return {
    title: richTextToPlainText(richText.title, { singleBlock: true }) || normalizeLineEndings(source.title ?? options.defaultTitle ?? DEFAULT_TITLE),
    subtitle: richTextToPlainText(richText.subtitle) || normalizeLineEndings(source.subtitle ?? options.defaultSubtitle ?? DEFAULT_SUBTITLE),
    richText,
  };
}

export function normalizeInlineEditDraft(draft = {}, options = {}) {
  const richText = normalizeNodeRichText(draft, {
    defaultTitle: draft.title ?? options.fallbackTitle ?? DEFAULT_TITLE,
    defaultSubtitle: draft.subtitle ?? DEFAULT_SUBTITLE,
  });
  const title = normalizeLineEndings(richTextToPlainText(richText.title, { singleBlock: true }) || draft.title).trim();
  const subtitle = normalizeLineEndings(richTextToPlainText(richText.subtitle) || draft.subtitle).trim();
  return {
    title: title || textOf(options.fallbackTitle ?? DEFAULT_TITLE),
    subtitle,
    richText: {
      title: title ? richText.title : createRichTextFromPlainText(textOf(options.fallbackTitle ?? DEFAULT_TITLE), { singleBlock: true }),
      subtitle: richText.subtitle,
    },
  };
}

export function inlineEditDraftChanged(before = {}, after = {}, options = {}) {
  const previous = normalizeInlineEditDraft(before, options);
  const next = normalizeInlineEditDraft(after, options);
  return previous.title !== next.title
    || previous.subtitle !== next.subtitle
    || JSON.stringify(previous.richText) !== JSON.stringify(next.richText);
}

export function selectionForText(value, selection = {}) {
  const text = textOf(value);
  if (selection === "all") {
    return { start: 0, end: text.length };
  }
  if (selection === "end") {
    return { start: text.length, end: text.length };
  }
  const start = clamp(finiteNumber(selection.start, text.length), 0, text.length);
  const end = clamp(finiteNumber(selection.end, start), 0, text.length);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function normalizeRect(rect, fallback = {}) {
  const left = finiteNumber(rect?.left ?? rect?.x, finiteNumber(fallback.left ?? fallback.x, 0));
  const top = finiteNumber(rect?.top ?? rect?.y, finiteNumber(fallback.top ?? fallback.y, 0));
  const width = Math.max(0, finiteNumber(rect?.width, finiteNumber(fallback.width, 0)));
  const height = Math.max(0, finiteNumber(rect?.height, finiteNumber(fallback.height, 0)));
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

export function computeInlineEditorPlacement(anchorRect, viewportRect, options = {}) {
  const anchor = normalizeRect(anchorRect);
  const viewport = normalizeRect(viewportRect, {
    left: 0,
    top: 0,
    width: 1024,
    height: 768,
  });
  const padding = finiteNumber(options.padding, DEFAULT_PADDING);
  const gap = finiteNumber(options.gap, DEFAULT_GAP);
  const minWidth = finiteNumber(options.minWidth, DEFAULT_MIN_WIDTH);
  const maxWidth = finiteNumber(options.maxWidth, DEFAULT_MAX_WIDTH);
  const availableWidth = Math.max(minWidth, viewport.width - padding * 2);
  const width = clamp(finiteNumber(options.width, Math.max(anchor.width, minWidth)), minWidth, Math.min(maxWidth, availableWidth));
  const minHeight = finiteNumber(options.minHeight, Math.max(DEFAULT_MIN_HEIGHT, anchor.height));
  const aboveTop = anchor.top - gap - minHeight;
  const belowTop = anchor.bottom + gap;
  const hasRoomBelow = belowTop + minHeight <= viewport.bottom - padding;
  const hasRoomAbove = aboveTop >= viewport.top + padding;
  const preferredTop = options.prefer === "above" && hasRoomAbove
    ? aboveTop
    : options.prefer === "below" && hasRoomBelow
      ? belowTop
      : anchor.top;
  const left = clamp(anchor.left, viewport.left + padding, viewport.right - padding - width);
  const top = clamp(preferredTop, viewport.top + padding, viewport.bottom - padding - minHeight);

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    minHeight: Math.round(minHeight),
    transformOrigin: `${Math.round(anchor.left + anchor.width / 2 - left)}px ${Math.round(anchor.top + anchor.height / 2 - top)}px`,
  };
}

export function formatInlineEditorStyle(placement) {
  return {
    position: "fixed",
    left: `${placement.left}px`,
    top: `${placement.top}px`,
    width: `${placement.width}px`,
    minHeight: `${placement.minHeight}px`,
    transformOrigin: placement.transformOrigin,
  };
}

export function applyStyle(element, style) {
  for (const [key, value] of Object.entries(style || {})) {
    element.style[key] = value;
  }
}

export function applyInputSelection(input, selection) {
  if (!input || typeof input.setSelectionRange !== "function") return false;
  const range = selectionForText(input.value, selection);
  input.setSelectionRange(range.start, range.end);
  return true;
}

export function createInlineEditor(options = {}) {
  const root = options.root || document.body;
  const eventTarget = options.eventTarget || root;
  const windowRef = options.window || root.ownerDocument?.defaultView || window;
  const documentRef = options.document || root.ownerDocument || document;
  const getContextFromEvent = options.getContextFromEvent || (() => null);
  const getContextFromSelection = options.getContextFromSelection || (() => null);
  const getAnchorRect = options.getAnchorRect || ((context) => context?.anchorRect);
  const getViewportRect = options.getViewportRect || (() => ({
    left: 0,
    top: 0,
    width: windowRef.innerWidth,
    height: windowRef.innerHeight,
  }));
  const getValues = options.getValues || ((context) => context?.values || context?.node || context || {});
  const getIdentity = options.getIdentity || ((context) => context?.id ?? context?.nodeId ?? context?.node?.id);
  const shouldStartFromKeyboard = options.shouldStartFromKeyboard || (() => true);
  const onCommit = options.onCommit || noop;
  const onCancel = options.onCancel || noop;
  const onBegin = options.onBegin || noop;
  const onEnd = options.onEnd || noop;
  const onActiveChange = options.onActiveChange || noop;
  const className = options.className || "inline-editor";
  const transformDraft = options.transformDraft || identity;
  const defaultSelection = options.selection || "all";
  const onSelectionChange = options.onSelectionChange || noop;
  const onDraftChange = options.onDraftChange || noop;
  const isExternalEditorControl = options.isExternalEditorControl || (() => false);

  let state = null;
  let overlay = null;
  let titleInput = null;
  let subtitleInput = null;
  let blurTimer = null;
  let savedSelection = null;
  let pendingMarks = { title: {}, subtitle: {} };

  function emitEnd(payload) {
    onActiveChange(false, payload);
    onEnd(payload);
  }

  function removeOverlay() {
    clearTimeout(blurTimer);
    blurTimer = null;
    overlay?.remove();
    overlay = null;
    titleInput = null;
    subtitleInput = null;
  }

  function editorForField(field) {
    return field === "subtitle" ? subtitleInput : titleInput;
  }

  function fieldForEditor(element) {
    return normalizeInlineEditField(element?.dataset?.inlineField, "title");
  }

  function activeEditor() {
    const active = documentRef.activeElement;
    if (titleInput?.contains(active) || active === titleInput) return titleInput;
    if (subtitleInput?.contains(active) || active === subtitleInput) return subtitleInput;
    return null;
  }

  function richTextOptionsForField(field) {
    return { singleBlock: field === "title" };
  }

  function readRichTextFromField(field) {
    return richTextFromElement(editorForField(field), richTextOptionsForField(field));
  }

  function currentRichText() {
    return {
      title: readRichTextFromField("title"),
      subtitle: readRichTextFromField("subtitle"),
    };
  }

  function currentDraft() {
    const richText = currentRichText();
    return {
      title: richTextToPlainText(richText.title, { singleBlock: true }),
      subtitle: richTextToPlainText(richText.subtitle),
      richText,
    };
  }

  function selectionRangeForEditor(editor) {
    if (!editor) return { start: 0, end: 0 };
    const selection = windowRef.getSelection?.();
    if (!selection || selection.rangeCount === 0) return savedSelection?.range || { start: 0, end: 0 };
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return savedSelection?.field === fieldForEditor(editor) ? savedSelection.range : { start: 0, end: 0 };
    }
    const beforeStart = documentRef.createRange();
    beforeStart.selectNodeContents(editor);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = documentRef.createRange();
    beforeEnd.selectNodeContents(editor);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    const start = beforeStart.toString().length;
    const end = beforeEnd.toString().length;
    beforeStart.detach?.();
    beforeEnd.detach?.();
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  function textNodesOf(editor) {
    const walker = documentRef.createTreeWalker(editor, windowRef.NodeFilter?.SHOW_TEXT ?? 4);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function restoreEditorSelection(editor, range = {}) {
    if (!editor) return false;
    const selection = windowRef.getSelection?.();
    if (!selection) return false;
    const textNodes = textNodesOf(editor);
    const locate = (offset) => {
      let cursor = 0;
      for (const node of textNodes) {
        const length = node.nodeValue.length;
        if (offset <= cursor + length) return { node, offset: clamp(offset - cursor, 0, length) };
        cursor += length;
      }
      const fallback = textNodes.at(-1) || editor;
      return { node: fallback, offset: fallback.nodeType === 3 ? fallback.nodeValue.length : fallback.childNodes.length };
    };
    const start = locate(finiteNumber(range.start, 0));
    const end = locate(finiteNumber(range.end, range.start ?? 0));
    const domRange = documentRef.createRange();
    domRange.setStart(start.node, start.offset);
    domRange.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(domRange);
    return true;
  }

  function renderRichTextField(field, richText, selection = null) {
    const editor = editorForField(field);
    if (!editor) return false;
    const richTextOptions = richTextOptionsForField(field);
    editor.innerHTML = richTextToSafeHtml(normalizeRichText(richText, "", richTextOptions), richTextOptions);
    if (selection) restoreEditorSelection(editor, selection);
    return true;
  }

  function saveSelection() {
    const editor = activeEditor();
    if (!editor) return savedSelection;
    const field = fieldForEditor(editor);
    savedSelection = { field, range: selectionRangeForEditor(editor) };
    return savedSelection;
  }

  function restoreSelection(selection = savedSelection) {
    if (!selection) return false;
    const editor = editorForField(selection.field);
    editor?.focus({ preventScroll: true });
    return restoreEditorSelection(editor, selection.range);
  }

  function emitSelectionChange() {
    if (!state) return;
    const selection = saveSelection();
    if (!selection) return;
    const richText = readRichTextFromField(selection.field);
    onSelectionChange({
      id: state.id,
      context: state.context,
      field: selection.field,
      range: { ...selection.range },
      marks: { ...marksAtSelection(richText, selection.range), ...pendingMarks[selection.field] },
      richText,
      api,
    });
  }

  function emitDraftChange(reason = "input") {
    if (!state) return;
    onDraftChange({ id: state.id, context: state.context, draft: currentDraft(), reason, api });
  }

  function mutateActiveRichText(mutator, options = {}) {
    const selection = options.selection || savedSelection || saveSelection();
    if (!selection) return false;
    const field = normalizeInlineEditField(options.field || selection.field, "title");
    const editor = editorForField(field);
    const range = selection.field === field ? selection.range : selectionRangeForEditor(editor);
    const after = mutator(readRichTextFromField(field), range, field);
    const restoreRange = options.restoreRange || range;
    renderRichTextField(field, after, restoreRange);
    editor?.focus({ preventScroll: true });
    savedSelection = { field, range: restoreRange };
    emitSelectionChange();
    emitDraftChange(options.reason || "format");
    return true;
  }

  function applyMark(markPatch = {}, options = {}) {
    const selection = options.selection || savedSelection || saveSelection();
    const field = normalizeInlineEditField(options.field || selection?.field, "title");
    if (!selection || selection.range.start === selection.range.end) {
      pendingMarks[field] = { ...pendingMarks[field], ...markPatch };
      emitSelectionChange();
      return true;
    }
    return mutateActiveRichText((richText, range) => applyMarkToSelection(richText, range, markPatch), {
      ...options,
      selection,
      reason: "mark",
    });
  }

  function setBlockType(type, options = {}) {
    return mutateActiveRichText((richText, range) => setBlockTypeAtSelection(richText, range, type), {
      ...options,
      reason: "block-type",
    });
  }

  function setBlockAlign(align, options = {}) {
    return mutateActiveRichText((richText, range) => setBlockAlignAtSelection(richText, range, align), {
      ...options,
      reason: "block-align",
    });
  }

  function insertPlainText(text, options = {}) {
    const selection = options.selection || savedSelection || saveSelection();
    if (!selection) return false;
    const field = normalizeInlineEditField(options.field || selection.field, "title");
    const range = selection.field === field ? selection.range : { start: 0, end: 0 };
    const cleanText = normalizeLineEndings(text);
    const inserted = field === "title" ? cleanText.replace(/\s*\n\s*/g, " ") : cleanText;
    const restoreRange = { start: range.start + inserted.length, end: range.start + inserted.length };
    return mutateActiveRichText(
      (richText) => insertTextAtSelection(richText, range, inserted, pendingMarks[field]),
      { ...options, selection: { field, range }, restoreRange, reason: "insert-text" },
    );
  }

  function finish(type, reason = type) {
    if (!state) return null;
    const previous = state;
    const rawDraft = currentDraft();
    const nextDraft = normalizeInlineEditDraft(transformDraft(rawDraft, previous.context), {
      fallbackTitle: previous.previous.title || DEFAULT_TITLE,
    });
    const changed = inlineEditDraftChanged(previous.previous, nextDraft, {
      fallbackTitle: previous.previous.title || DEFAULT_TITLE,
    });
    state = null;
    removeOverlay();

    const payload = {
      id: previous.id,
      context: previous.context,
      previous: previous.previous,
      values: type === "commit"
        ? { title: nextDraft.title, subtitle: nextDraft.subtitle }
        : { title: previous.previous.title, subtitle: previous.previous.subtitle },
      richText: type === "commit" ? nextDraft.richText : previous.previous.richText,
      draft: rawDraft,
      changed,
      reason,
    };

    if (type === "commit") {
      onCommit(payload);
    } else {
      onCancel(payload);
    }
    emitEnd(payload);
    return payload;
  }

  function commit(reason = "commit") {
    return finish("commit", reason);
  }

  function cancel(reason = "cancel") {
    return finish("cancel", reason);
  }

  function buildOverlay() {
    const wrapper = documentRef.createElement("div");
    wrapper.className = className;
    wrapper.setAttribute("role", "dialog");
    wrapper.setAttribute("aria-modal", "false");
    wrapper.innerHTML = [
      '<div class="inline-editor__input inline-editor__input--title" data-inline-field="title" contenteditable="true" spellcheck="false" role="textbox" aria-label="Title"></div>',
      '<div class="inline-editor__input inline-editor__input--subtitle" data-inline-field="subtitle" contenteditable="true" spellcheck="false" role="textbox" aria-label="Subtitle" aria-multiline="true"></div>',
    ].join("");

    applyStyle(wrapper, {
      zIndex: "120",
      display: "grid",
      gap: "4px",
      padding: "7px",
      border: "1px solid #9bb8f3",
      borderRadius: "6px",
      background: "#ffffff",
      boxShadow: "0 10px 28px rgba(25, 36, 55, 0.18)",
    });

    titleInput = wrapper.querySelector('[data-inline-field="title"]');
    subtitleInput = wrapper.querySelector('[data-inline-field="subtitle"]');
    titleInput.dataset.placeholder = "输入主题";
    subtitleInput.dataset.placeholder = "输入说明";
    for (const input of [titleInput, subtitleInput]) {
      applyStyle(input, {
        width: "100%",
        minWidth: "0",
        border: "0",
        outline: "0",
        background: "transparent",
        color: "#172033",
        lineHeight: "1.35",
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      });
      input.addEventListener("input", () => {
        saveSelection();
        emitSelectionChange();
        emitDraftChange();
      });
      input.addEventListener("keyup", emitSelectionChange);
      input.addEventListener("mouseup", emitSelectionChange);
      input.addEventListener("focus", emitSelectionChange);
      input.addEventListener("paste", (event) => {
        event.preventDefault();
        const richPayload = event.clipboardData?.getData("application/x-mindmap-rich-text");
        if (richPayload) {
          try {
            const richText = serializeRichText(JSON.parse(richPayload), richTextOptionsForField(fieldForEditor(input)));
            renderRichTextField(fieldForEditor(input), richText);
            emitSelectionChange();
            emitDraftChange("paste-rich-text");
            return;
          } catch {
            // Use plain text fallback for malformed internal clipboard data.
          }
        }
        insertPlainText(event.clipboardData?.getData("text/plain") || "");
      });
      input.addEventListener("copy", (event) => {
        const field = fieldForEditor(input);
        const selection = selectionRangeForEditor(input);
        const sourceRichText = readRichTextFromField(field);
        const richText = selection.start === selection.end
          ? sourceRichText
          : sliceRichTextSelection(sourceRichText, selection, richTextOptionsForField(field));
        event.clipboardData?.setData("application/x-mindmap-rich-text", JSON.stringify(richText));
        event.clipboardData?.setData("text/plain", richTextToPlainText(richText, richTextOptionsForField(field)));
        event.preventDefault();
      });
      input.addEventListener("beforeinput", (event) => {
        const field = fieldForEditor(input);
        if (event.inputType !== "insertText" || !event.data || !Object.keys(pendingMarks[field] || {}).length) return;
        event.preventDefault();
        insertPlainText(event.data, { field });
      });
    }
    applyStyle(titleInput, {
      fontSize: "20px",
      fontWeight: "700",
    });
    applyStyle(subtitleInput, {
      fontSize: "13px",
      color: "#667085",
    });

    wrapper.addEventListener("keydown", (event) => {
      const activeField = fieldForEditor(activeEditor());
      if ((event.key === "Enter" && activeField === "title") || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        commit("enter");
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel("escape");
      } else {
        windowRef.requestAnimationFrame(emitSelectionChange);
      }
    });
    wrapper.addEventListener("focusout", () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!overlay?.contains(documentRef.activeElement) && !isExternalEditorControl(documentRef.activeElement)) commit("blur");
      }, 0);
    });
    wrapper.addEventListener("pointerdown", (event) => event.stopPropagation());
    wrapper.addEventListener("dblclick", (event) => event.stopPropagation());
    return wrapper;
  }

  function positionOverlay(context) {
    if (!overlay) return;
    const placement = computeInlineEditorPlacement(
      getAnchorRect(context),
      getViewportRect(context),
      options.placement || {},
    );
    applyStyle(overlay, formatInlineEditorStyle(placement));
  }

  function begin(context, beginOptions = {}) {
    if (!context) return null;
    if (state) commit("replace");

    const values = createInlineEditDraft(getValues(context), options);
    const id = getIdentity(context);
    const activeField = normalizeInlineEditField(beginOptions.field || context.field || options.startField, "title");
    state = {
      id,
      context,
      previous: normalizeInlineEditDraft(values, { fallbackTitle: values.title || DEFAULT_TITLE }),
      activeField,
    };

    overlay = buildOverlay();
    root.append(overlay);
    renderRichTextField("title", values.richText.title);
    renderRichTextField("subtitle", values.richText.subtitle);
    positionOverlay(context);

    const input = activeField === "subtitle" ? subtitleInput : titleInput;
    const selection = beginOptions.selection ?? context.selection ?? defaultSelection;
    windowRef.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      const text = richTextToPlainText(values.richText[activeField], richTextOptionsForField(activeField));
      const range = selectionForText(text, selection);
      restoreEditorSelection(input, range);
      savedSelection = { field: activeField, range };
      emitSelectionChange();
    });

    const payload = { id, context, values: { title: values.title, subtitle: values.subtitle }, richText: values.richText, field: activeField, api };
    onActiveChange(true, payload);
    onBegin(payload);
    return payload;
  }

  function beginFromEvent(event, beginOptions = {}) {
    const context = getContextFromEvent(event);
    if (!context) return null;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return begin(context, beginOptions);
  }

  function beginFromSelection(beginOptions = {}) {
    const context = getContextFromSelection();
    if (!context) return null;
    return begin(context, beginOptions);
  }

  function handleDblClick(event) {
    beginFromEvent(event, { selection: "all" });
  }

  function handleKeyDown(event) {
    if (state) return;
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target?.matches?.("input,textarea,select,[contenteditable=true]")) return;
    if (!shouldStartFromKeyboard(event)) return;
    const result = beginFromSelection({ selection: "all" });
    if (result) event.preventDefault();
  }

  function refresh(context = state?.context) {
    if (!context || !state) return false;
    state.context = context;
    positionOverlay(context);
    return true;
  }

  function destroy() {
    if (state) cancel("destroy");
    eventTarget.removeEventListener("dblclick", handleDblClick);
    windowRef.removeEventListener("keydown", handleKeyDown, true);
    removeOverlay();
  }

  eventTarget.addEventListener("dblclick", handleDblClick);
  windowRef.addEventListener("keydown", handleKeyDown, true);

  const api = {
    begin,
    beginFromEvent,
    beginFromSelection,
    commit,
    cancel,
    refresh,
    destroy,
    applyMark,
    setBlockType,
    setBlockAlign,
    insertPlainText,
    saveSelection,
    restoreSelection,
    getSelection: () => savedSelection && { field: savedSelection.field, range: { ...savedSelection.range } },
    getDraft: () => state ? currentDraft() : null,
    getRichText: () => state ? currentRichText() : null,
    focusField: (field = "title", selection = "all") => {
      const normalizedField = normalizeInlineEditField(field, "title");
      const editor = editorForField(normalizedField);
      if (!editor) return false;
      const text = richTextToPlainText(readRichTextFromField(normalizedField), richTextOptionsForField(normalizedField));
      const range = selectionForText(text, selection);
      editor.focus({ preventScroll: true });
      restoreEditorSelection(editor, range);
      savedSelection = { field: normalizedField, range };
      emitSelectionChange();
      return true;
    },
    readRichTextFromHtml: safeHtmlToRichText,
    renderRichTextToHtml: richTextToSafeHtml,
    isActive: () => Boolean(state),
    getState: () => state && {
      id: state.id,
      context: state.context,
      previous: { ...state.previous },
      activeField: state.activeField,
      draft: currentDraft(),
    },
  };
  return api;
}

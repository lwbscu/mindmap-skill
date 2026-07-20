import {
  createRichTextFromPlainText,
  normalizeNodeRichText,
  normalizeRichText,
  richTextToPlainText,
  richTextToSafeHtml,
  safeHtmlToRichText,
} from "./rich-text.mjs";
import { createTiptapFieldEditor } from "./tiptap-adapter.mjs";

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
  let fieldEditors = {};
  let blurTimer = null;
  let savedSelection = null;

  function emitEnd(payload) {
    onActiveChange(false, payload);
    onEnd(payload);
  }

  function removeOverlay() {
    clearTimeout(blurTimer);
    blurTimer = null;
    for (const controller of Object.values(fieldEditors)) controller?.destroy?.();
    fieldEditors = {};
    overlay?.remove();
    overlay = null;
    titleInput = null;
    subtitleInput = null;
  }

  function editorForField(field) {
    return field === "subtitle" ? subtitleInput : titleInput;
  }

  function controllerForField(field) {
    return fieldEditors[normalizeInlineEditField(field, "title")] || null;
  }

  function fieldForEditor(element) {
    const target = element?.closest?.("[data-inline-field]") || element;
    return normalizeInlineEditField(target?.dataset?.inlineField, "title");
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
    return controllerForField(field)?.getRichText() || createRichTextFromPlainText("", richTextOptionsForField(field));
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
    if (!editor) return savedSelection?.range || { start: 0, end: 0 };
    return controllerForField(fieldForEditor(editor))?.getSelection() || savedSelection?.range || { start: 0, end: 0 };
  }

  function restoreEditorSelection(editor, range = {}) {
    if (!editor) return false;
    return Boolean(controllerForField(fieldForEditor(editor))?.setSelection(range));
  }

  function renderRichTextField(field, richText, selection = null) {
    return Boolean(controllerForField(field)?.setRichText(normalizeRichText(richText, "", richTextOptionsForField(field)), selection));
  }

  function saveSelection() {
    const editor = activeEditor();
    if (!editor) return savedSelection;
    const field = fieldForEditor(editor);
    const selectionState = controllerForField(field)?.getSelectionState();
    savedSelection = {
      field,
      range: selectionState?.range || selectionRangeForEditor(editor),
      anchorRect: selectionState?.anchorRect || null,
    };
    return savedSelection;
  }

  function restoreSelection(selection = savedSelection) {
    if (!selection) return false;
    const editor = editorForField(selection.field);
    controllerForField(selection.field)?.focus();
    return restoreEditorSelection(editor, selection.range);
  }

  function emitSelectionChange() {
    if (!state) return;
    const selection = saveSelection();
    if (!selection) return;
    const controller = controllerForField(selection.field);
    const selectionState = controller?.getSelectionState();
    const richText = selectionState?.richText || readRichTextFromField(selection.field);
    onSelectionChange({
      id: state.id,
      context: state.context,
      field: selection.field,
      range: { ...(selectionState?.range || selection.range) },
      marks: { ...(selectionState?.marks || {}) },
      mixed: { ...(selectionState?.mixed || {}) },
      collapsed: Boolean(selectionState?.collapsed),
      anchorRect: selectionState?.anchorRect || selection.anchorRect || null,
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
    const controller = controllerForField(field);
    if (!controller) return false;
    const range = selection.field === field ? selection.range : controller.getSelection();
    const after = mutator(readRichTextFromField(field), range, field);
    const restoreRange = options.restoreRange || range;
    renderRichTextField(field, after, restoreRange);
    controller.focus(restoreRange);
    savedSelection = { field, range: restoreRange };
    emitSelectionChange();
    emitDraftChange(options.reason || "format");
    return true;
  }

  function applyMark(markPatch = {}, options = {}) {
    const selection = options.selection || savedSelection || saveSelection();
    const field = normalizeInlineEditField(options.field || selection?.field, "title");
    const controller = controllerForField(field);
    if (!controller) return false;
    if (selection?.field === field) controller.setSelection(selection.range);
    const changed = controller.applyMark(markPatch);
    savedSelection = { field, range: controller.getSelection(), anchorRect: controller.getSelectionState().anchorRect };
    emitSelectionChange();
    emitDraftChange(options.reason || "mark");
    return changed;
  }

  function setBlockType(type, options = {}) {
    const selection = options.selection || savedSelection || saveSelection();
    const field = normalizeInlineEditField(options.field || selection?.field, "subtitle");
    const controller = controllerForField(field);
    if (!controller) return false;
    if (selection?.field === field) controller.setSelection(selection.range);
    const changed = controller.setBlockType(type);
    savedSelection = { field, range: controller.getSelection(), anchorRect: controller.getSelectionState().anchorRect };
    emitSelectionChange();
    emitDraftChange("block-type");
    return changed;
  }

  function setBlockAlign(align, options = {}) {
    const selection = options.selection || savedSelection || saveSelection();
    const field = normalizeInlineEditField(options.field || selection?.field, "title");
    const controller = controllerForField(field);
    if (!controller) return false;
    if (selection?.field === field) controller.setSelection(selection.range);
    const changed = controller.setBlockAlign(align);
    savedSelection = { field, range: controller.getSelection(), anchorRect: controller.getSelectionState().anchorRect };
    emitSelectionChange();
    emitDraftChange("block-align");
    return changed;
  }

  function insertPlainText(text, options = {}) {
    const selection = options.selection || savedSelection || saveSelection();
    if (!selection) return false;
    const field = normalizeInlineEditField(options.field || selection.field, "title");
    const controller = controllerForField(field);
    if (!controller) return false;
    if (selection.field === field) controller.setSelection(selection.range);
    const range = controller.getSelection();
    const cleanText = normalizeLineEndings(text);
    const inserted = field === "title" ? cleanText.replace(/\s*\n\s*/g, " ") : cleanText;
    const restoreRange = { start: range.start + inserted.length, end: range.start + inserted.length };
    const changed = controller.insertPlainText(inserted);
    controller.setSelection(restoreRange);
    savedSelection = { field, range: restoreRange, anchorRect: controller.getSelectionState().anchorRect };
    emitSelectionChange();
    emitDraftChange(options.reason || "insert-text");
    return changed;
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
      '<div class="inline-editor__input inline-editor__input--title" data-inline-field="title" aria-label="Title"></div>',
      '<div class="inline-editor__input inline-editor__input--subtitle" data-inline-field="subtitle" aria-label="Subtitle"></div>',
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
    }
    applyStyle(titleInput, {
      fontSize: "20px",
      fontWeight: "700",
    });
    applyStyle(subtitleInput, {
      fontSize: "13px",
      color: "#667085",
    });

    fieldEditors = {
      title: createTiptapFieldEditor({
        element: titleInput,
        singleBlock: true,
        window: windowRef,
        richText: createRichTextFromPlainText("", { singleBlock: true }),
        onUpdate: (reason) => {
          saveSelection();
          emitSelectionChange();
          emitDraftChange(reason);
        },
        onSelectionChange: () => emitSelectionChange(),
      }),
      subtitle: createTiptapFieldEditor({
        element: subtitleInput,
        singleBlock: false,
        window: windowRef,
        richText: createRichTextFromPlainText(""),
        onUpdate: (reason) => {
          saveSelection();
          emitSelectionChange();
          emitDraftChange(reason);
        },
        onSelectionChange: () => emitSelectionChange(),
      }),
    };

    wrapper.addEventListener("keydown", (event) => {
      const activeField = fieldForEditor(activeEditor());
      const controller = controllerForField(activeField);
      if (event.isComposing || controller?.isComposing?.()) return;
      if ((event.key === "Enter" && activeField === "title") || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        event.stopPropagation();
        commit("enter");
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel("escape");
      } else {
        windowRef.requestAnimationFrame(emitSelectionChange);
      }
    }, true);
    wrapper.addEventListener("focusout", () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!overlay?.contains(documentRef.activeElement) && !isExternalEditorControl(documentRef.activeElement)) commit("blur");
      }, 30);
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
      const text = richTextToPlainText(values.richText[activeField], richTextOptionsForField(activeField));
      const range = selectionForText(text, selection);
      controllerForField(activeField)?.focus(range);
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
    getSelectionState: () => {
      const selection = savedSelection || saveSelection();
      const field = normalizeInlineEditField(selection?.field, "title");
      const selectionState = controllerForField(field)?.getSelectionState();
      return selectionState ? { field, ...selectionState } : null;
    },
    getDraft: () => state ? currentDraft() : null,
    getRichText: () => state ? currentRichText() : null,
    clearFormatting: () => {
      const selection = savedSelection || saveSelection();
      const field = normalizeInlineEditField(selection?.field, "title");
      const controller = controllerForField(field);
      if (!controller) return false;
      if (selection?.field === field) controller.setSelection(selection.range);
      const changed = controller.clearFormatting();
      savedSelection = { field, range: controller.getSelection(), anchorRect: controller.getSelectionState().anchorRect };
      emitSelectionChange();
      emitDraftChange("clear-formatting");
      return changed;
    },
    undo: () => {
      const field = normalizeInlineEditField((savedSelection || saveSelection())?.field, "title");
      const changed = controllerForField(field)?.undo?.();
      emitSelectionChange();
      emitDraftChange("undo");
      return Boolean(changed);
    },
    redo: () => {
      const field = normalizeInlineEditField((savedSelection || saveSelection())?.field, "title");
      const changed = controllerForField(field)?.redo?.();
      emitSelectionChange();
      emitDraftChange("redo");
      return Boolean(changed);
    },
    focusField: (field = "title", selection = "all") => {
      const normalizedField = normalizeInlineEditField(field, "title");
      const controller = controllerForField(normalizedField);
      if (!controller) return false;
      const text = controller.getPlainText();
      const range = selectionForText(text, selection);
      controller.focus(range);
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

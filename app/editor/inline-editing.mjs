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
  return {
    title: normalizeLineEndings(source.title ?? options.defaultTitle ?? DEFAULT_TITLE),
    subtitle: normalizeLineEndings(source.subtitle ?? options.defaultSubtitle ?? DEFAULT_SUBTITLE),
  };
}

export function normalizeInlineEditDraft(draft = {}, options = {}) {
  const title = normalizeLineEndings(draft.title).trim();
  const subtitle = normalizeLineEndings(draft.subtitle).trim();
  return {
    title: title || textOf(options.fallbackTitle ?? DEFAULT_TITLE),
    subtitle,
  };
}

export function inlineEditDraftChanged(before = {}, after = {}, options = {}) {
  const previous = normalizeInlineEditDraft(before, options);
  const next = normalizeInlineEditDraft(after, options);
  return previous.title !== next.title || previous.subtitle !== next.subtitle;
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

  let state = null;
  let overlay = null;
  let titleInput = null;
  let subtitleInput = null;
  let blurTimer = null;

  function currentDraft() {
    return {
      title: titleInput?.value ?? "",
      subtitle: subtitleInput?.value ?? "",
    };
  }

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
      values: type === "commit" ? nextDraft : previous.previous,
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
      '<textarea class="inline-editor__input inline-editor__input--title" data-inline-field="title" rows="1" spellcheck="false" aria-label="Title"></textarea>',
      '<textarea class="inline-editor__input inline-editor__input--subtitle" data-inline-field="subtitle" rows="2" spellcheck="false" aria-label="Subtitle"></textarea>',
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
    for (const input of [titleInput, subtitleInput]) {
      applyStyle(input, {
        width: "100%",
        minWidth: "0",
        resize: "vertical",
        border: "0",
        outline: "0",
        background: "transparent",
        color: "#172033",
        lineHeight: "1.35",
        overflow: "hidden",
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
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commit("enter");
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel("escape");
      }
    });
    wrapper.addEventListener("focusout", () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!overlay?.contains(documentRef.activeElement)) commit("blur");
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
    titleInput.value = values.title;
    subtitleInput.value = values.subtitle;
    root.append(overlay);
    positionOverlay(context);

    const input = activeField === "subtitle" ? subtitleInput : titleInput;
    const selection = beginOptions.selection ?? context.selection ?? defaultSelection;
    windowRef.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      applyInputSelection(input, selection);
    });

    const payload = { id, context, values, field: activeField };
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

  return {
    begin,
    beginFromEvent,
    beginFromSelection,
    commit,
    cancel,
    refresh,
    destroy,
    isActive: () => Boolean(state),
    getState: () => state && {
      id: state.id,
      context: state.context,
      previous: { ...state.previous },
      activeField: state.activeField,
      draft: currentDraft(),
    },
  };
}

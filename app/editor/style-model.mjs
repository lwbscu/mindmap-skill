const FONT_WEIGHT_NAMES = Object.freeze({
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
});

const TEXT_ALIGN_TO_ATTRS = Object.freeze({
  left: Object.freeze({ textAnchor: 'start', refX: '8px' }),
  center: Object.freeze({ textAnchor: 'middle', refX: '50%' }),
  right: Object.freeze({ textAnchor: 'end', refX: 'calc(100% - 8px)' }),
});

const STYLE_FIELD_SET = new Set([
  'fontSize',
  'fontWeight',
  'textColor',
  'fill',
  'borderColor',
  'borderWidth',
  'textAlign',
  'borderRadius',
]);

const PATCH_FIELD_TO_ATTR_PATHS = Object.freeze({
  fontSize: Object.freeze([['attrs', 'label', 'fontSize']]),
  fontWeight: Object.freeze([['attrs', 'label', 'fontWeight']]),
  textColor: Object.freeze([['attrs', 'label', 'fill']]),
  fill: Object.freeze([['attrs', 'body', 'fill']]),
  borderColor: Object.freeze([['attrs', 'body', 'stroke']]),
  borderWidth: Object.freeze([['attrs', 'body', 'strokeWidth']]),
  textAlign: Object.freeze([
    ['attrs', 'label', 'textAlign'],
    ['attrs', 'label', 'textAnchor'],
    ['attrs', 'label', 'refX'],
  ]),
  borderRadius: Object.freeze([
    ['attrs', 'body', 'rx'],
    ['attrs', 'body', 'ry'],
  ]),
});

export const STYLE_FIELDS = Object.freeze([...STYLE_FIELD_SET]);

export const MIXED_VALUE = Symbol('mixed-node-style-value');

export const DEFAULT_NODE_STYLE = Object.freeze({
  fontSize: 14,
  fontWeight: 400,
  textColor: '#1f2937',
  fill: '#ffffff',
  borderColor: '#94a3b8',
  borderWidth: 1,
  textAlign: 'center',
  borderRadius: 8,
});

export function isStyleField(field) {
  return STYLE_FIELD_SET.has(field);
}

export function normalizeNodeStyle(style = {}, options = {}) {
  const { partial = false } = options;
  const source = normalizeAliases(style);
  const normalized = partial ? {} : { ...DEFAULT_NODE_STYLE };

  for (const field of STYLE_FIELDS) {
    if (source[field] === undefined) {
      continue;
    }

    normalized[field] = normalizeStyleValue(field, source[field]);
  }

  return normalized;
}

export function validateNodeStyle(style = {}, options = {}) {
  const errors = [];
  const source = normalizeAliases(style);
  const { partial = false } = options;

  for (const field of STYLE_FIELDS) {
    if (source[field] === undefined) {
      if (!partial) {
        errors.push({
          field,
          reason: 'required',
          value: undefined,
        });
      }
      continue;
    }

    try {
      normalizeStyleValue(field, source[field]);
    } catch (error) {
      errors.push({
        field,
        reason: error.message,
        value: source[field],
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function nodeStyleToX6Attrs(style = {}) {
  const normalized = normalizeNodeStyle(style);
  const alignAttrs = TEXT_ALIGN_TO_ATTRS[normalized.textAlign];

  return {
    body: {
      fill: normalized.fill,
      stroke: normalized.borderColor,
      strokeWidth: normalized.borderWidth,
      rx: normalized.borderRadius,
      ry: normalized.borderRadius,
    },
    label: {
      fontSize: normalized.fontSize,
      fontWeight: normalized.fontWeight,
      fill: normalized.textColor,
      textAlign: normalized.textAlign,
      textAnchor: alignAttrs.textAnchor,
      refX: alignAttrs.refX,
      textVerticalAnchor: 'middle',
      refY: '50%',
    },
  };
}

export function getNodeStyleFromX6Attrs(attrs = {}) {
  return normalizeNodeStyle({
    fill: attrs.body?.fill,
    borderColor: attrs.body?.stroke,
    borderWidth: attrs.body?.strokeWidth,
    borderRadius: attrs.body?.rx ?? attrs.body?.ry,
    fontSize: attrs.label?.fontSize,
    fontWeight: attrs.label?.fontWeight,
    textColor: attrs.label?.fill,
    textAlign: attrs.label?.textAlign ?? textAnchorToTextAlign(attrs.label?.textAnchor),
  });
}

export function getCommonNodeStyle(styles = [], options = {}) {
  const { mixedValue = MIXED_VALUE, partial = false } = options;

  if (!Array.isArray(styles) || styles.length === 0) {
    return partial ? {} : { ...DEFAULT_NODE_STYLE };
  }

  const normalizedStyles = styles.map((style) => normalizeNodeStyle(style));
  const common = {};

  for (const field of STYLE_FIELDS) {
    const firstValue = normalizedStyles[0][field];
    common[field] = normalizedStyles.every((style) => style[field] === firstValue)
      ? firstValue
      : mixedValue;
  }

  return common;
}

export function getCommonNodeStyleFromNodes(nodes = [], options = {}) {
  return getCommonNodeStyle(nodes.map(readNodeStyle), options);
}

export function createNodeStylePatch(currentStyle = {}, nextStyle = {}, options = {}) {
  const { includeAttrs = true } = options;
  const before = normalizeNodeStyle(currentStyle);
  const after = {
    ...before,
    ...normalizeNodeStyle(nextStyle, { partial: true }),
  };
  const changes = {};

  for (const field of STYLE_FIELDS) {
    if (before[field] !== after[field]) {
      changes[field] = {
        before: before[field],
        after: after[field],
      };
    }
  }

  const patch = {
    before,
    after,
    changes,
    empty: Object.keys(changes).length === 0,
    inverse() {
      return createNodeStylePatch(after, before, options);
    },
  };

  if (includeAttrs) {
    patch.attrs = {
      before: nodeStyleToX6Attrs(before),
      after: nodeStyleToX6Attrs(after),
    };
    patch.attrChanges = createAttrChangesFromStyleChanges(changes, after);
  }

  return patch;
}

export function createNodeStyleTransactionPatch(nodes = [], nextStyle = {}, options = {}) {
  const normalizedNextStyle = normalizeNodeStyle(nextStyle, { partial: true });

  return nodes.map((node) => {
    const id = getNodeId(node);
    const before = readNodeStyle(node);
    const patch = createNodeStylePatch(before, normalizedNextStyle, options);

    return {
      id,
      node,
      ...patch,
    };
  });
}

function createAttrChangesFromStyleChanges(changes, afterStyle) {
  const afterAttrs = nodeStyleToX6Attrs(afterStyle);
  const attrChanges = [];

  for (const field of Object.keys(changes)) {
    for (const path of PATCH_FIELD_TO_ATTR_PATHS[field] ?? []) {
      attrChanges.push({
        field,
        path,
        value: readPath(afterAttrs, path.slice(1)),
      });
    }
  }

  return attrChanges;
}

function readNodeStyle(node) {
  if (!node) {
    return DEFAULT_NODE_STYLE;
  }

  if (typeof node.getData === 'function') {
    const data = node.getData() ?? {};
    if (data.style) {
      return normalizeNodeStyle(data.style);
    }
  }

  if (node.data?.style) {
    return normalizeNodeStyle(node.data.style);
  }

  if (typeof node.getAttrs === 'function') {
    return getNodeStyleFromX6Attrs(node.getAttrs());
  }

  if (node.attrs) {
    return getNodeStyleFromX6Attrs(node.attrs);
  }

  return DEFAULT_NODE_STYLE;
}

function getNodeId(node) {
  if (!node) {
    return undefined;
  }

  if (typeof node.id === 'string' || typeof node.id === 'number') {
    return node.id;
  }

  if (typeof node.getId === 'function') {
    return node.getId();
  }

  return undefined;
}

function normalizeAliases(style) {
  if (!style || typeof style !== 'object') {
    return {};
  }

  const normalized = { ...style };

  if (normalized.textColor === undefined && normalized.color !== undefined) {
    normalized.textColor = normalized.color;
  }

  if (normalized.borderColor === undefined && normalized.stroke !== undefined) {
    normalized.borderColor = normalized.stroke;
  }

  if (normalized.borderWidth === undefined && normalized.strokeWidth !== undefined) {
    normalized.borderWidth = normalized.strokeWidth;
  }

  if (normalized.borderRadius === undefined && normalized.radius !== undefined) {
    normalized.borderRadius = normalized.radius;
  }

  if (normalized.textAlign === undefined && normalized.align !== undefined) {
    normalized.textAlign = normalized.align;
  }

  return normalized;
}

function normalizeStyleValue(field, value) {
  switch (field) {
    case 'fontSize':
      return normalizeNumber(field, value, { min: 6, max: 96, integer: true });
    case 'fontWeight':
      return normalizeFontWeight(value);
    case 'textColor':
    case 'fill':
    case 'borderColor':
      return normalizeColor(field, value);
    case 'borderWidth':
      return normalizeNumber(field, value, { min: 0, max: 24 });
    case 'textAlign':
      return normalizeTextAlign(value);
    case 'borderRadius':
      return normalizeNumber(field, value, { min: 0, max: 64 });
    default:
      throw new TypeError(`unknown style field: ${field}`);
  }
}

function normalizeNumber(field, value, options) {
  const number = typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value;

  if (!Number.isFinite(number)) {
    throw new TypeError(`${field} must be a finite number`);
  }

  if (number < options.min || number > options.max) {
    throw new RangeError(`${field} must be between ${options.min} and ${options.max}`);
  }

  return options.integer ? Math.round(number) : number;
}

function normalizeFontWeight(value) {
  const namedWeight = typeof value === 'string'
    ? FONT_WEIGHT_NAMES[value.trim().toLowerCase()]
    : undefined;
  const number = namedWeight ?? (typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value);

  if (!Number.isFinite(number)) {
    throw new TypeError('fontWeight must be a finite number or named weight');
  }

  if (number < 100 || number > 900) {
    throw new RangeError('fontWeight must be between 100 and 900');
  }

  return Math.round(number / 100) * 100;
}

function normalizeColor(field, value) {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be a color string`);
  }

  const color = value.trim();

  if (color === '') {
    throw new TypeError(`${field} must not be empty`);
  }

  return color;
}

function normalizeTextAlign(value) {
  if (typeof value !== 'string') {
    throw new TypeError('textAlign must be left, center, or right');
  }

  const align = value.trim().toLowerCase();

  if (!Object.hasOwn(TEXT_ALIGN_TO_ATTRS, align)) {
    throw new RangeError('textAlign must be left, center, or right');
  }

  return align;
}

function textAnchorToTextAlign(textAnchor) {
  switch (textAnchor) {
    case 'start':
      return 'left';
    case 'end':
      return 'right';
    case 'middle':
    default:
      return 'center';
  }
}

function readPath(source, path) {
  return path.reduce((value, key) => value?.[key], source);
}

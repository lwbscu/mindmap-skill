const XML_ESCAPE = /[&<>"']/g;
const XML_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&apos;"
};

function esc(value) {
  return String(value ?? "").replace(XML_ESCAPE, (char) => XML_MAP[char]);
}

function cssText(value) {
  return String(value ?? "").replace(/[<>{}]/g, "");
}

function center(node) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2
  };
}

function anchor(node, side) {
  if (side === "top") return { x: node.x + node.width / 2, y: node.y };
  if (side === "bottom") return { x: node.x + node.width / 2, y: node.y + node.height };
  if (side === "left") return { x: node.x, y: node.y + node.height / 2 };
  return { x: node.x + node.width, y: node.y + node.height / 2 };
}

function estimateTextWidth(text, size) {
  let width = 0;
  for (const char of String(text ?? "")) {
    if (char === " ") {
      width += size * 0.32;
    } else if (/[\u3400-\u9fff\uff00-\uffef]/u.test(char)) {
      width += size;
    } else {
      width += size * 0.58;
    }
  }
  return width;
}

function sideFor(source, target, isFrom) {
  const a = center(source);
  const b = center(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (isFrom) return dx > 0 ? "right" : "left";
    return dx > 0 ? "left" : "right";
  }
  if (isFrom) return dy > 0 ? "bottom" : "top";
  return dy > 0 ? "top" : "bottom";
}

function normalizePoint(point) {
  return {
    x: Number(point.x),
    y: Number(point.y)
  };
}

function linePoint(points, ratio = 0.5) {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const lengths = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    total += length;
  }
  let target = total * ratio;
  for (let i = 0; i < lengths.length; i += 1) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const a = points[i];
      const b = points[i + 1];
      const local = lengths[i] === 0 ? 0 : target / lengths[i];
      return {
        x: a.x + (b.x - a.x) * local,
        y: a.y + (b.y - a.y) * local
      };
    }
    target -= lengths[i];
  }
  return points.at(-1);
}

function edgePath(edge, source, target) {
  const fromSide = edge.fromSide ?? sideFor(source, target, true);
  const toSide = edge.toSide ?? sideFor(source, target, false);
  const a = anchor(source, fromSide);
  const b = anchor(target, toSide);
  const waypoints = (edge.waypoints ?? edge.points ?? []).map(normalizePoint);
  const points = [a, ...waypoints, b];

  if (waypoints.length > 0) {
    return {
      d: points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" "),
      labelPoint: linePoint(points, edge.labelRatio ?? 0.5)
    };
  }

  if (fromSide === "bottom" && toSide === "top") {
    const midY = (a.y + b.y) / 2;
    return {
      d: `M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`,
      labelPoint: { x: (a.x + b.x) / 2, y: midY }
    };
  }
  if (fromSide === "right" && toSide === "left") {
    const midX = (a.x + b.x) / 2;
    return {
      d: `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`,
      labelPoint: { x: midX, y: (a.y + b.y) / 2 }
    };
  }
  return {
    d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`,
    labelPoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  };
}

function textLine(text, x, y, opts = {}) {
  const weight = opts.weight ?? 700;
  const size = opts.size ?? 42;
  const anchorValue = opts.anchor ?? "middle";
  return `<text x="${x}" y="${y}" text-anchor="${anchorValue}" font-size="${size}" font-weight="${weight}" fill="${esc(opts.fill ?? "#111827")}">${esc(text)}</text>`;
}

function renderLabel(text, x, y, style, opts = {}) {
  const size = opts.size ?? 26;
  const paddingX = opts.paddingX ?? 18;
  const paddingY = opts.paddingY ?? 9;
  const width = estimateTextWidth(text, size) + paddingX * 2;
  const height = size + paddingY * 2;
  const left = x - width / 2;
  const top = y - height / 2;
  return [
    `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="10" fill="${esc(opts.fill ?? "#ffffff")}" stroke="${esc(opts.stroke ?? style.labelStroke)}" stroke-width="${opts.strokeWidth ?? 2}"/>`,
    textLine(text, x, y + 1, { size, weight: opts.weight ?? 750, fill: opts.textFill ?? style.text })
  ].join("\n");
}

function renderMultiline(lines, x, firstY, opts = {}) {
  return lines.map((line, index) => textLine(line, x, firstY + index * (opts.lineHeight ?? 31), opts)).join("\n");
}

function renderNode(node, style) {
  const stroke = node.stroke
    ?? (node.kind === "data" ? style.dataStroke : node.kind === "risk" ? style.riskStroke : style.nodeStroke);
  const rx = node.radius ?? 6;
  const titleSize = node.titleSize ?? 38;
  const subtitleSize = node.subtitleSize ?? (node.subtitle && node.subtitle.length > 28 ? 22 : 25);
  const subtitleLines = Array.isArray(node.subtitle) ? node.subtitle : (node.subtitle ? [node.subtitle] : []);
  const blockHeight = titleSize + (subtitleLines.length ? 16 + subtitleLines.length * 30 : 0);
  const titleY = node.y + node.height / 2 - blockHeight / 2 + titleSize / 2;
  const subtitleY = titleY + titleSize / 2 + 24;
  return [
    `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${rx}" fill="${esc(node.fill ?? style.nodeFill)}" stroke="${esc(stroke)}" stroke-width="${node.strokeWidth ?? 4}"/>`,
    textLine(node.title, node.x + node.width / 2, titleY, { size: titleSize, fill: style.text, weight: node.titleWeight ?? 760 }),
    subtitleLines.length ? renderMultiline(subtitleLines, node.x + node.width / 2, subtitleY, {
      size: subtitleSize,
      weight: node.subtitleWeight ?? 520,
      fill: node.subtitleFill ?? style.muted,
      lineHeight: node.subtitleLineHeight ?? 31
    }) : ""
  ].join("\n");
}

function renderLayer(layer, style) {
  const fill = layer.fill ?? style.panelFill;
  const stroke = layer.stroke ?? style.panelStroke;
  const band = `<rect x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" rx="${layer.radius ?? 16}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${layer.strokeWidth ?? 3}"/>`;
  if (layer.labelMode === "tab") {
    const tabWidth = layer.labelWidth ?? 210;
    const tabHeight = layer.labelHeight ?? Math.min(86, layer.height - 24);
    const tabX = layer.labelX ?? 36;
    const tabY = layer.labelY ?? (layer.y + (layer.height - tabHeight) / 2);
    const notch = Math.min(36, tabWidth / 5);
    const points = [
      [tabX, tabY],
      [tabX + tabWidth - notch, tabY],
      [tabX + tabWidth, tabY + tabHeight / 2],
      [tabX + tabWidth - notch, tabY + tabHeight],
      [tabX, tabY + tabHeight],
      [tabX + notch, tabY + tabHeight / 2]
    ].map((point) => point.join(",")).join(" ");
    return [
      band,
      `<polygon points="${points}" fill="${esc(layer.tabFill ?? fill)}" stroke="${esc(stroke)}" stroke-width="${layer.strokeWidth ?? 3}"/>`,
      textLine(layer.label, tabX + tabWidth / 2 + 8, tabY + tabHeight / 2 + 1, {
        size: layer.labelSize ?? 31,
        weight: 760,
        fill: style.text
      })
    ].join("\n");
  }
  return [
    band,
    textLine(layer.label, layer.x + 36, layer.y + 48, { anchor: "start", size: 32, weight: 800, fill: style.text })
  ].join("\n");
}

function renderSeparator(separator, style, width) {
  const x1 = separator.x1 ?? 270;
  const x2 = separator.x2 ?? width - 80;
  return `<line x1="${x1}" y1="${separator.y}" x2="${x2}" y2="${separator.y}" stroke="${esc(separator.stroke ?? style.separator)}" stroke-width="${separator.strokeWidth ?? 4}" stroke-dasharray="${esc(separator.dash ?? "3 12")}" stroke-linecap="round"/>`;
}

function renderEdge(edge, nodesById, style) {
  const from = nodesById.get(edge.from);
  const to = nodesById.get(edge.to);
  if (!from || !to) {
      throw new Error(`edge references missing node: ${edge.from} -> ${edge.to}`);
  }
  const path = edgePath(edge, from, to);
  const labelPoint = edge.labelAt
    ? normalizePoint(edge.labelAt)
    : path.labelPoint;
  const label = edge.label
    ? renderLabel(
      edge.label,
      labelPoint.x + (edge.labelDx ?? 0),
      labelPoint.y + (edge.labelDy ?? -4),
      style,
      { size: edge.labelSize ?? 25 }
    )
    : "";
  const stroke = edge.stroke ?? style.edge;
  const marker = stroke === style.riskStroke || stroke === "#ef4444" ? "arrow-risk" : "arrow";
  return [
    `<path d="${path.d}" fill="none" stroke="${esc(stroke)}" stroke-width="${edge.strokeWidth ?? 4}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${marker})"/>`,
    label
  ].join("\n");
}

export function renderSvg(blueprint) {
  const canvas = blueprint.canvas ?? {};
  const style = {
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    text: "#111827",
    muted: "#374151",
    panelFill: "#ffffff",
    panelStroke: "#c8cdd6",
    separator: "#3f3f46",
    nodeFill: "#ffffff",
    nodeStroke: "#8b5cf6",
    dataStroke: "#0284c7",
    riskStroke: "#dc2626",
    edge: "#111827",
    labelStroke: "#d4d4d8",
    ...(blueprint.style ?? {})
  };
  const width = canvas.width ?? 2400;
  const height = canvas.height ?? 1600;
  const nodesById = new Map((blueprint.nodes ?? []).map((node) => [node.id, node]));
  const separators = (blueprint.separators ?? []).map((separator) => renderSeparator(separator, style, width)).join("\n");
  const layers = (blueprint.layers ?? []).map((layer) => renderLayer(layer, style)).join("\n");
  const edges = (blueprint.edges ?? []).map((edge) => renderEdge(edge, nodesById, style)).join("\n");
  const nodes = (blueprint.nodes ?? []).map((node) => renderNode(node, style)).join("\n");
  const title = textLine(blueprint.title, width / 2, 96, { size: 54, weight: 850, fill: style.text });
  const subtitle = blueprint.subtitle
    ? textLine(blueprint.subtitle, width / 2, 146, { size: 28, weight: 500, fill: style.text })
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(blueprint.title)}">
  <defs>
    <marker id="arrow" markerWidth="20" markerHeight="16" refX="18" refY="8" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M 0 0 L 20 8 L 0 16 z" fill="${esc(style.edge)}"/>
    </marker>
    <marker id="arrow-risk" markerWidth="20" markerHeight="16" refX="18" refY="8" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M 0 0 L 20 8 L 0 16 z" fill="${esc(style.riskStroke)}"/>
    </marker>
    <style>
      text { font-family: ${cssText(style.fontFamily)}; dominant-baseline: middle; }
    </style>
  </defs>
	  <rect x="0" y="0" width="${width}" height="${height}" fill="${esc(canvas.background ?? "#ffffff")}"/>
	  ${title}
	  ${subtitle}
	  ${separators}
	  ${layers}
	  ${edges}
	  ${nodes}
</svg>
`;
}

export function renderStandaloneHtml(blueprint, svg) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(blueprint.title)}</title>
  <style>
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    main { max-width: 1280px; margin: 24px auto; padding: 0 20px; }
    .frame { background: white; border: 1px solid #d1d5db; overflow: auto; box-shadow: 0 16px 40px rgb(15 23 42 / 12%); }
    svg { display: block; max-width: none; }
  </style>
</head>
<body>
  <main>
    <div class="frame">${svg}</div>
  </main>
</body>
</html>
`;
}

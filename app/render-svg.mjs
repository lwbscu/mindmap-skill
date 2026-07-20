import { validateDiagram } from "./diagram-validator.mjs";
import { normalizeNodeRichText } from "./editor/rich-text.mjs";

const XML_ESCAPE = /[&<>"']/g;
const XML_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&apos;"
};

const STATUS_LABELS = new Map([
  ["implemented", "已实现"],
  ["external", "外部依赖"],
  ["planned", "拟介入"],
  ["unknown", "待确认"],
  ["risk", "风险"]
]);

function esc(value) {
  return String(value ?? "").replace(XML_ESCAPE, (char) => XML_MAP[char]);
}

function cssText(value) {
  return String(value ?? "").replace(/[<>{}]/g, "");
}

function attr(value) {
  return esc(value).replace(/`/g, "");
}

function assertDiagram(diagram) {
  const result = validateDiagram(diagram);
  if (result && result.ok === false) {
    throw new Error(`Invalid MindMap diagram:\n${result.errors.join("\n")}`);
  }
  return diagram;
}

function normalizeStatus(status) {
  if (!status) return "";
  const key = String(status).trim().toLowerCase();
  return STATUS_LABELS.has(key) ? key : "unknown";
}

function statusLabel(status) {
  const key = normalizeStatus(status);
  return key ? STATUS_LABELS.get(key) : "";
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

function roundedPolyline(points, radius = 18) {
  if (points.length < 3) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  }
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incoming = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outgoing = Math.hypot(next.x - current.x, next.y - current.y);
    const localRadius = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: current.x + (previous.x - current.x) * (localRadius / incoming || 0),
      y: current.y + (previous.y - current.y) * (localRadius / incoming || 0)
    };
    const after = {
      x: current.x + (next.x - current.x) * (localRadius / outgoing || 0),
      y: current.y + (next.y - current.y) * (localRadius / outgoing || 0)
    };
    commands.push(`L ${before.x} ${before.y}`, `Q ${current.x} ${current.y} ${after.x} ${after.y}`);
  }
  const last = points.at(-1);
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(" ");
}

function edgePath(edge, source, target) {
  const fromSide = edge.fromSide ?? sideFor(source, target, true);
  const toSide = edge.toSide ?? sideFor(source, target, false);
  const a = anchor(source, fromSide);
  const b = anchor(target, toSide);
  const waypoints = (edge.waypoints ?? edge.points ?? []).map(normalizePoint);
  const points = [a, ...waypoints, b];

  if (edge.routeStyle === "curved" && Array.isArray(edge.curveControlPoints) && edge.curveControlPoints.length >= 2) {
    const [first, second] = edge.curveControlPoints.map(normalizePoint);
    return {
      d: `M ${a.x} ${a.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${b.x} ${b.y}`,
      labelPoint: edge.labelAt ? normalizePoint(edge.labelAt) : { x: (a.x + 3 * first.x + 3 * second.x + b.x) / 8, y: (a.y + 3 * first.y + 3 * second.y + b.y) / 8 }
    };
  }

  if (waypoints.length > 0) {
    return {
      d: roundedPolyline(points, edge.cornerRadius ?? 18),
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
  const horizontal = fromSide === "left" || fromSide === "right";
  const bend = horizontal
    ? Math.max(48, Math.abs(b.x - a.x) * 0.45)
    : Math.max(48, Math.abs(b.y - a.y) * 0.45);
  return horizontal
    ? {
      d: `M ${a.x} ${a.y} C ${a.x + (fromSide === "right" ? bend : -bend)} ${a.y}, ${b.x + (toSide === "left" ? -bend : bend)} ${b.y}, ${b.x} ${b.y}`,
      labelPoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }
    : {
      d: `M ${a.x} ${a.y} C ${a.x} ${a.y + (fromSide === "bottom" ? bend : -bend)}, ${b.x} ${b.y + (toSide === "top" ? -bend : bend)}, ${b.x} ${b.y}`,
      labelPoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    };
}

function textLine(text, x, y, opts = {}) {
  const weight = opts.weight ?? 700;
  const size = opts.size ?? 42;
  const anchorValue = opts.anchor ?? "middle";
  return `<text x="${x}" y="${y}" text-anchor="${anchorValue}" font-size="${size}" font-weight="${weight}" fill="${esc(opts.fill ?? "#111827")}">${esc(text)}</text>`;
}

function richTextLine(richText, x, y, opts = {}) {
  const lineHeight = opts.lineHeight ?? Math.round((opts.size ?? 16) * 1.35);
  const width = opts.width ?? 240;
  const baseSize = opts.size ?? 16;
  const baseWeight = opts.weight ?? 500;
  const baseFill = opts.fill ?? "#111827";
  const highlights = [];
  const lines = [];
  for (const [blockIndex, block] of (richText?.blocks || []).entries()) {
    const align = ["left", "center", "right"].includes(block.align) ? block.align : "left";
    const blockX = align === "center" ? x + width / 2 : align === "right" ? x + width : x;
    const anchorValue = align === "center" ? "middle" : align === "right" ? "end" : "start";
    let leftCursor = x;
    const renderedRuns = [];
    for (const [runIndex, run] of (block.runs || []).entries()) {
      const marks = run.marks || {};
      const prefix = runIndex === 0 && block.type === "bullet-list-item" ? "• " : runIndex === 0 && block.type === "ordered-list-item" ? `${blockIndex + 1}. ` : "";
      const value = `${prefix}${run.text || ""}`;
      const size = Math.max(8, Math.min(96, Number(marks.fontSize || baseSize)));
      if (marks.backgroundColor && align === "left" && value) {
        const highlightWidth = estimateTextWidth(value, size) + 4;
        highlights.push(`<rect x="${leftCursor - 2}" y="${y + blockIndex * lineHeight - size * .58}" width="${highlightWidth}" height="${Math.round(size * 1.15)}" rx="3" fill="${esc(marks.backgroundColor)}"/>`);
        leftCursor += highlightWidth - 4;
      } else if (align === "left") {
        leftCursor += estimateTextWidth(value, size);
      }
      const decorations = [marks.underline ? "underline" : "", marks.strike ? "line-through" : ""].filter(Boolean).join(" ");
      const attributes = [
        `font-size="${size}"`,
        `font-weight="${esc(marks.fontWeight || baseWeight)}"`,
        `fill="${esc(marks.color || baseFill)}"`,
        marks.fontFamily ? `font-family="${attr(marks.fontFamily)}"` : "",
        marks.italic ? 'font-style="italic"' : "",
        decorations ? `text-decoration="${decorations}"` : "",
        marks.code ? 'font-family="ui-monospace, SFMono-Regular, Consolas, monospace"' : "",
      ].filter(Boolean).join(" ");
      const tspan = `<tspan ${attributes}>${esc(value)}</tspan>`;
      renderedRuns.push(marks.link ? `<a href="${attr(marks.link)}" target="_blank" rel="noopener noreferrer">${tspan}</a>` : tspan);
    }
    lines.push(`<text x="${blockX}" y="${y + blockIndex * lineHeight}" text-anchor="${anchorValue}" dominant-baseline="middle">${renderedRuns.join("")}</text>`);
  }
  return [...highlights, ...lines].join("\n");
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

function statusColors(status) {
  const key = normalizeStatus(status);
  if (key === "implemented") return { fill: "#dcfce7", stroke: "#16a34a", text: "#14532d" };
  if (key === "external") return { fill: "#e0f2fe", stroke: "#0284c7", text: "#0c4a6e" };
  if (key === "planned") return { fill: "#fef3c7", stroke: "#d97706", text: "#713f12" };
  if (key === "risk") return { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d" };
  if (key === "unknown") return { fill: "#f4f4f5", stroke: "#71717a", text: "#27272a" };
  return null;
}

function renderStatusBadge(node, style, x, y) {
  const label = statusLabel(node.status);
  const colors = statusColors(node.status);
  if (!label || !colors) return "";
  const size = node.statusSize ?? 17;
  const width = estimateTextWidth(label, size) + 20;
  const height = size + 10;
  return [
    `<rect class="node-status" x="${x - width}" y="${y}" width="${width}" height="${height}" rx="5" fill="${esc(colors.fill)}" stroke="${esc(colors.stroke)}" stroke-width="1.5"/>`,
    textLine(label, x - width / 2, y + height / 2 + 1, {
      size,
      weight: 760,
      fill: colors.text || style.text
    })
  ].join("\n");
}

function nodeIconLabel(node) {
  if (node.icon) return String(node.icon).slice(0, 5).toUpperCase();
  if (node.kind === "data") return "DATA";
  if (node.kind === "risk" || node.status === "risk") return "RISK";
  if (node.status === "external") return "EXT";
  if (node.status === "planned") return "PLAN";
  if (node.status === "unknown") return "?";
  if (/runtime|runner|provider/i.test(node.title)) return "RUN";
  if (/schema|spec|registry|prompt|toolkit/i.test(node.title)) return "API";
  if (/output|stage|result/i.test(node.title)) return "OUT";
  return "MOD";
}

function renderNode(node, style, layer, assets = {}) {
  const stroke = node.stroke
    ?? (node.kind === "data" ? style.dataStroke : node.kind === "risk" ? style.riskStroke : layer?.stroke ?? style.nodeStroke);
  const accent = node.accent ?? stroke;
  const rx = Math.min(32, node.borderRadius ?? node.radius ?? 8);
  const requestedTitleSize = node.titleSize ?? 20;
  const requestedSubtitleSize = node.subtitleSize ?? 13;
  const richText = normalizeNodeRichText(node);
  const asset = node.image?.assetId ? assets[node.image.assetId] : null;
  const hasImage = Boolean(asset?.type === "image" && /^data:image\/(?:png|jpeg|webp);base64,/i.test(asset.dataUrl || ""));
  const placement = node.kind === "image" ? "node" : node.image?.placement;
  const imageOnly = hasImage && placement === "node";
  const topImage = hasImage && placement === "top";
  const iconSize = Math.max(42, Math.min(56, node.height - 24));
  const iconX = node.x + 16;
  const iconY = node.y + (node.height - iconSize) / 2;
  const textX = imageOnly ? node.x + 14 : topImage ? node.x + 18 : iconX + iconSize + 18;
  const contentWidth = Math.max(80, node.x + node.width - textX - 18);
  const titleY = topImage ? node.y + node.height * .66 : node.y + (node.subtitle ? node.height * 0.36 : node.height / 2);
  const subtitleY = topImage ? node.y + node.height * .81 : node.y + node.height * 0.65;
  const clipId = `image-clip-${String(node.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const preserveAspectRatio = node.image?.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
  const imageOpacity = Math.max(0, Math.min(1, Number(node.image?.opacity ?? 1)));
  const imageGeometry = placement === "top"
    ? { x: node.x + 10, y: node.y + 10, width: node.width - 20, height: Math.max(48, node.height * .5) }
    : placement === "background" || placement === "node"
      ? { x: node.x + 2, y: node.y + 2, width: node.width - 4, height: node.height - 4 }
      : { x: iconX, y: iconY, width: iconSize, height: iconSize };
  const imageMarkup = hasImage ? [
    `<clipPath id="${clipId}"><rect x="${imageGeometry.x}" y="${imageGeometry.y}" width="${imageGeometry.width}" height="${imageGeometry.height}" rx="${placement === "left" ? Math.min(8, iconSize / 6) : rx}"/></clipPath>`,
    `<image href="${attr(asset.dataUrl)}" x="${imageGeometry.x}" y="${imageGeometry.y}" width="${imageGeometry.width}" height="${imageGeometry.height}" preserveAspectRatio="${preserveAspectRatio}" opacity="${placement === "background" ? Math.min(.35, imageOpacity) : imageOpacity}" clip-path="url(#${clipId})"/>`,
  ].join("\n") : "";
  const content = [
    `<rect class="node-card" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${rx}" fill="${esc(node.fill ?? style.nodeFill)}" stroke="${esc(stroke)}" stroke-width="${node.strokeWidth ?? 2}" filter="url(#node-shadow)"/>`,
    imageMarkup,
    `<path class="node-accent" d="M ${node.x + rx} ${node.y + 1} H ${node.x + 8} Q ${node.x + 1} ${node.y + 1} ${node.x + 1} ${node.y + rx} V ${node.y + node.height - rx} Q ${node.x + 1} ${node.y + node.height - 1} ${node.x + 8} ${node.y + node.height - 1} H ${node.x + rx}" fill="${esc(accent)}"/>`,
    !imageOnly && !(hasImage && placement === "left") ? `<rect class="node-icon" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="${Math.min(8, iconSize / 6)}" fill="${esc(accent)}"/>` : "",
    !imageOnly && !(hasImage && placement === "left") ? textLine(nodeIconLabel(node), iconX + iconSize / 2, iconY + iconSize / 2 + 1, { size: Math.max(14, iconSize * 0.3), fill: "#ffffff", weight: 850 }) : "",
    !imageOnly ? richTextLine(richText.title, textX, titleY, { width: contentWidth, size: requestedTitleSize, fill: node.textColor ?? node.titleFill ?? style.text, weight: node.fontWeight ?? node.titleWeight ?? 700 }) : "",
    !imageOnly && node.subtitle ? richTextLine(richText.subtitle, textX, subtitleY, { width: contentWidth, size: requestedSubtitleSize, weight: node.subtitleWeight ?? 520, fill: node.subtitleColor ?? node.subtitleFill ?? style.muted, lineHeight: node.subtitleLineHeight ?? 27 }) : "",
    !imageOnly ? renderStatusBadge(node, style, node.x + node.width - 10, node.y + node.height - (node.statusSize ?? 17) - 16) : ""
  ].join("\n");
  return `<g class="mindmap-node status-${attr(normalizeStatus(node.status) || "none")}" data-node-id="${attr(node.id)}" data-layer-id="${attr(node.layer ?? "")}" tabindex="0" role="button" aria-label="${attr(node.title)}">\n${content}\n</g>`;
}

function renderLayer(layer, style) {
  const fill = layer.fill ?? style.panelFill;
  const stroke = layer.stroke ?? style.panelStroke;
  const band = `<rect class="layer-band" x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" rx="${Math.min(8, layer.radius ?? 8)}" fill="${esc(fill)}" fill-opacity="${layer.fillOpacity ?? 0.42}" stroke="${esc(stroke)}" stroke-width="${layer.strokeWidth ?? 2}"/>`;
  if (layer.labelMode === "tab") {
    const labelSize = layer.labelSize ?? 25;
    const tabWidth = layer.labelWidth ?? Math.max(110, estimateTextWidth(layer.label, labelSize) + 34);
    const tabHeight = layer.labelHeight ?? 40;
    const tabX = layer.labelX ?? layer.x + 18;
    const tabY = layer.labelY ?? layer.y - tabHeight / 2;
    const content = [
      band,
      `<rect class="layer-tag" x="${tabX}" y="${tabY}" width="${tabWidth}" height="${tabHeight}" rx="6" fill="#ffffff" stroke="${esc(stroke)}" stroke-width="${layer.strokeWidth ?? 2}"/>`,
      textLine(layer.label, tabX + tabWidth / 2, tabY + tabHeight / 2 + 1, {
        size: labelSize,
        weight: 780,
        fill: stroke
      })
    ].join("\n");
    return `<g class="mindmap-layer" data-layer-id="${attr(layer.id)}" tabindex="0" role="button" aria-label="${attr(layer.label)}">\n${content}\n</g>`;
  }
  const content = [
    band,
    textLine(layer.label, layer.x + 22, layer.y + 32, { anchor: "start", size: 26, weight: 800, fill: stroke })
  ].join("\n");
  return `<g class="mindmap-layer" data-layer-id="${attr(layer.id)}" tabindex="0" role="button" aria-label="${attr(layer.label)}">\n${content}\n</g>`;
}

function renderSeparator(separator, style, width) {
  const x1 = separator.x1 ?? 270;
  const x2 = separator.x2 ?? width - 80;
  return `<line x1="${x1}" y1="${separator.y}" x2="${x2}" y2="${separator.y}" stroke="${esc(separator.stroke ?? style.separator)}" stroke-width="${separator.strokeWidth ?? 4}" stroke-dasharray="${esc(separator.dash ?? "3 12")}" stroke-linecap="round"/>`;
}

function renderEdge(edge, nodesById, style, index = 0) {
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
  const edgeId = edge.id ?? `${edge.from}->${edge.to}:${index}`;
  const content = [
    `<path class="edge-path" d="${path.d}" fill="none" stroke="${esc(stroke)}" stroke-width="${edge.strokeWidth ?? 3}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${marker})"/>`,
    label
  ].join("\n");
  return `<g class="mindmap-edge" data-edge-id="${attr(edgeId)}" data-edge-index="${index}" data-from="${attr(edge.from)}" data-to="${attr(edge.to)}" data-relation="${attr(edge.relation ?? "")}" tabindex="0" role="button" aria-label="${attr(edge.label ?? `${edge.from} to ${edge.to}`)}">\n${content}\n</g>`;
}

export function renderSvg(blueprint) {
  assertDiagram(blueprint);
  const canvas = blueprint.canvas ?? {};
  const style = {
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    text: "#111827",
    muted: "#374151",
    panelFill: "#ffffff",
    panelStroke: "#b8c4d4",
    separator: "#3f3f46",
    nodeFill: "#ffffff",
    nodeStroke: "#62799a",
    nodeBorder: "#b9c4d3",
    dataStroke: "#0f9f82",
    riskStroke: "#dc2626",
    edge: "#94a9c0",
    labelStroke: "#d4d4d8",
    ...(blueprint.style ?? {})
  };
  const width = canvas.width ?? 2400;
  const height = canvas.height ?? 1600;
  const nodesById = new Map((blueprint.nodes ?? []).map((node) => [node.id, node]));
  const layersById = new Map((blueprint.layers ?? []).map((layer) => [layer.id, layer]));
  const separators = (blueprint.separators ?? []).map((separator) => renderSeparator(separator, style, width)).join("\n");
  const layers = (blueprint.layers ?? []).map((layer) => renderLayer(layer, style)).join("\n");
  const edges = (blueprint.edges ?? []).map((edge, index) => renderEdge(edge, nodesById, style, index)).join("\n");
  const nodes = (blueprint.nodes ?? []).map((node) => renderNode(node, style, layersById.get(node.layer), blueprint.assets || {})).join("\n");
  const title = textLine(blueprint.title, width / 2, 86, { size: 48, weight: 850, fill: style.text });
  const subtitle = blueprint.subtitle
    ? textLine(blueprint.subtitle, width / 2, 132, { size: 25, weight: 500, fill: style.muted })
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(blueprint.title)}">
  <defs>
    <filter id="node-shadow" x="-20%" y="-30%" width="140%" height="170%">
      <feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#182538" flood-opacity="0.12"/>
    </filter>
    <marker id="arrow" markerWidth="14" markerHeight="12" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M 0 0 L 14 6 L 0 12 z" fill="${esc(style.edge)}"/>
    </marker>
    <marker id="arrow-risk" markerWidth="14" markerHeight="12" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M 0 0 L 14 6 L 0 12 z" fill="${esc(style.riskStroke)}"/>
    </marker>
    <style>
      text { font-family: ${cssText(style.fontFamily)}; dominant-baseline: middle; }
      .mindmap-node, .mindmap-edge { cursor: pointer; }
      .edge-path { opacity: .9; }
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

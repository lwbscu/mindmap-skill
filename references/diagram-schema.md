# Diagram Schema

MindMap uses `mindmap-app/v1` JSON. The app renders this JSON into an interactive local app-window diagram and supports SVG / standalone HTML export.

Diagrams are validated at script runtime by `app/diagram-validator.mjs`. The
validator is intentionally stricter than the renderer: render-only fields can be
minimal, but shipped examples must have valid boxes, unique node IDs, valid edge
references, and known status/relation tags.

## Top-Level Shape

```json
{
  "schemaVersion": "mindmap-app/v1",
  "title": "Architecture Map",
  "subtitle": "Evidence-backed structure diagram",
  "language": "zh-CN",
  "canvas": {
    "width": 2400,
    "height": 1480,
    "background": "#ffffff"
  },
  "style": {},
  "activeViewId": "architecture",
  "views": [],
  "savedViews": [],
  "separators": [],
  "layers": [],
  "nodes": [],
  "edges": []
}
```

Required fields:

- `schemaVersion`
- `title`
- `canvas.width`
- `canvas.height`
- `layers`
- `nodes`
- `edges`

Optional multi-view fields preserve compatibility with older `mindmap-app/v1` files:

- `activeViewId`: active view ID or type.
- `views`: MindMap, dependency, and architecture view state over the shared top-level graph.
- `savedViews`: named camera snapshots for quick navigation.

When these fields are absent, the app opens the old file as a compact architecture view and creates the other two views in memory.

## Views

```json
{
  "id": "dependency",
  "type": "dependency",
  "label": "Dependency",
  "camera": { "x": 0, "y": 0, "zoom": 1 },
  "layout": {
    "mode": "auto",
    "engine": "elk",
    "nodes": {},
    "layers": {},
    "edges": {}
  },
  "hiddenNodes": [],
  "hiddenEdges": [],
  "hiddenLayers": [],
  "collapsedNodes": [],
  "fixedNodes": [],
  "filters": { "direction": "both", "depth": 2, "relations": [] },
  "modeOptions": {}
}
```

Supported `type` values are `mindmap`, `dependency`, and `architecture`. View layout and visibility are private to the view; node titles, relations, evidence, status, and other semantic fields remain shared at the top level.

## Layers

Layers are pastel bands behind related nodes.

```json
{
  "id": "runtime",
  "label": "运行层",
  "x": 300,
  "y": 965,
  "width": 2020,
  "height": 290,
  "fill": "#bbf7d0",
  "stroke": "#22c55e",
  "labelMode": "tab"
}
```

Use left-side tabs for compact architecture diagrams. Keep layer labels short.

## Nodes

```json
{
  "id": "runtime-provider",
  "layer": "gateway",
  "title": "RuntimeProvider",
  "subtitle": "get_runtime_provider(env).start(...)",
  "x": 710,
  "y": 462,
  "width": 980,
  "height": 88,
  "status": "implemented",
  "evidence": ["src/runtime.ts:42"],
  "titleSize": 20,
  "subtitleSize": 13,
  "fontWeight": 700,
  "textColor": "#172033",
  "subtitleColor": "#667085",
  "textAlign": "left",
  "borderRadius": 8
}
```

Required node fields:

- `id`
- `title`
- `x`, `y`, `width`, `height`

Useful optional fields:

- `subtitle`
- `layer`
- `kind`: `data` or `risk`
- `status`: `implemented`, `external`, `planned`, `unknown`, or `risk`
- `evidence`: array of compact source strings
- `risks`: array of compact risk strings
- `links`: array of `{ "label": "...", "href": "..." }`
- `fill`, `stroke`, `strokeWidth`, `borderRadius`
- `titleSize`, `subtitleSize`, `fontWeight`
- `textColor`, `subtitleColor`, `textAlign`

Use absolute layout coordinates. Keep node titles readable at whole-diagram zoom.

Status labels are semantic metadata rendered as compact badges. Important
public statuses can also be included in node text:

- `implemented`: 已实现
- `external`: 外部依赖
- `planned`: 拟介入
- `unknown`: 待确认
- `risk`: 风险

## Edges

```json
{
  "id": "behavior-success",
  "from": "behavior-runtime",
  "to": "task-success",
  "fromSide": "bottom",
  "toSide": "top",
  "waypoints": [
    { "x": 2020, "y": 1288 },
    { "x": 1810, "y": 1288 }
  ],
  "label": "info.done.success only",
  "labelAt": { "x": 1870, "y": 1276 },
  "relation": "evaluates",
  "evidence": ["src/tools.ts:52"],
  "stroke": "#ef4444",
  "strokeWidth": 5
}
```

Required edge fields:

- `from`
- `to`

Useful optional fields:

- `id`: stable relation ID; legacy edges receive a deterministic compatibility ID.
- `fromSide`, `toSide`: `top`, `right`, `bottom`, `left`
- `waypoints`: absolute points for clean routing
- `label`, `labelAt`, `labelSize`
- `relation`: `calls`, `reads`, `writes`, `publishes`, `subscribes`,
  `depends_on`, `routes`, `transforms`, `evaluates`, `guards`, `observes`, or
  `unknown`
- `evidence`: array of compact source strings
- `stroke`, `strokeWidth`

Prefer explicit routes over automatic center-to-center arrows when readability matters.

## Render Contract

- The app must not require a server-side runtime.
- All app imports and fetches must be relative-path friendly for GitHub Pages.
- The default example lives under `examples/`.
- Generated Pages artifacts live under `dist/` and are not committed.

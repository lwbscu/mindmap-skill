# Diagram Schema

MindMap uses `mindmap-app/v1` JSON. The shared Electron/Web editor renders this JSON interactively and supports static exports plus a self-contained editable HTML artifact.

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
  "assets": {},
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
  "modeOptions": { "routing": "orthogonal" }
}
```

Supported `type` values are `mindmap`, `dependency`, and `architecture`. View layout and visibility are private to the view; node titles, relations, evidence, status, and other semantic fields remain shared at the top level.
Default `modeOptions.routing` is `curved` for MindMap and `orthogonal` for dependency/architecture.

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

### Rich Text And Images

Character-level formatting is optional and versioned. Keep compatibility text synchronized:

```json
{
  "title": "RuntimeProvider",
  "subtitle": "CLI 参数与生命周期",
  "richText": {
    "title": { "version": 1, "blocks": [{ "type": "paragraph", "align": "left", "runs": [{ "text": "Runtime", "marks": { "fontWeight": "700", "color": "#2563eb" } }, { "text": "Provider", "marks": {} }] }] },
    "subtitle": { "version": 1, "blocks": [{ "type": "paragraph", "align": "left", "runs": [{ "text": "CLI 参数与生命周期", "marks": {} }] }] }
  }
}
```

Supported run marks are `fontFamily`, `fontSize`, `fontWeight`, `italic`, `underline`, `strike`, `code`, `color`, `backgroundColor`, and a safe `http` / `https` / `mailto` `link`. Subtitle blocks may be paragraphs, bullet items, or ordered items. Titles stay a single paragraph.

Images are content-addressed assets embedded in the diagram JSON. Nodes reference them through `image.assetId` and store `placement`, `fit`, `padding`, `opacity`, and useful `alt` text. Input images are limited to PNG, JPEG, and WebP, normalized to at most 2048px on the longest side, 4MB per asset, and 32MB per diagram. `placement` is `left`, `top`, `background`, or `node`; `fit` is `contain` or `cover`.

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
- `routeMode`: `auto` or `manual`
- `routeStyle`: `orthogonal` or `curved`
- `lockedRoute`: preserve a user-confirmed route during layout
- `curveControlPoints`: exactly two points for a cubic MindMap curve

Default to `routeMode: "auto"`. Architecture and dependency views use orthogonal obstacle avoidance; MindMap uses smooth cubic curves. Do not generate large waypoint lists. Store waypoints or control points as a locked manual route only after a user intentionally adjusts it.

## Render Contract

- The app must not require a server-side runtime.
- All app imports and fetches must be relative-path friendly for GitHub Pages.
- The hosted `/app/` artifact is a full interactive editor. Browser save downloads JSON and does not imply direct filesystem or GitHub write access.
- The default example lives under `examples/`.
- Generated Pages artifacts live under `dist/` and are not committed.
- SVG, PNG, PDF, JSON, and read-only HTML exports carry embedded images and supported rich text; Mermaid degrades images to their node title and alt text.
- Editable HTML uses format marker `mindmap-editable-html/v1` and exactly one `script#mindmap-embedded-diagram[type="application/json"]` containing the complete diagram. It inlines the app runtime, CSS, icon, and layout worker, has no external runtime dependency, opens from `file://`, and can re-export itself.
- HTML import parses only the known embedded JSON script and never executes imported scripts. Diagram JSON is escaped for script context, including `<`, `>`, `&`, U+2028, and U+2029.
- Editable HTML preserves top-level `assets`, `views`, `savedViews`, rich text, evidence, automatic and locked route state. The exporter rejects files above 64MB.

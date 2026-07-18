# Diagram Schema

MindMap uses `mindmap-app/v1` JSON. The app renders this JSON into an interactive browser diagram and supports SVG / standalone HTML export.

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
  "titleSize": 39,
  "subtitleSize": 24
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
- `fill`, `stroke`, `strokeWidth`
- `titleSize`, `subtitleSize`

Use absolute layout coordinates. Keep node titles readable at whole-diagram zoom.

## Edges

```json
{
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
  "stroke": "#ef4444",
  "strokeWidth": 5
}
```

Required edge fields:

- `from`
- `to`

Useful optional fields:

- `fromSide`, `toSide`: `top`, `right`, `bottom`, `left`
- `waypoints`: absolute points for clean routing
- `label`, `labelAt`, `labelSize`
- `stroke`, `strokeWidth`

Prefer explicit routes over automatic center-to-center arrows when readability matters.

## Render Contract

- The app must not require a server-side runtime.
- All app imports and fetches must be relative-path friendly for GitHub Pages.
- The default example lives under `examples/`.
- Generated Pages artifacts live under `dist/` and are not committed.

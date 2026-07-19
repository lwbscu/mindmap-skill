# MindMap

MindMap is an interactive desktop app and agent skill for making evidence-based architecture maps. Agents produce a compact diagram JSON file, and the app renders it as a clean, zoomable structure diagram with SVG and standalone HTML exports.

MindMap 是一个面向 Claude Code 与 Codex 的本地桌面结构框图工具。它把用户描述、代码、文档和日志里的可验证事实整理为 `mindmap-app/v1` diagram JSON，并用 Electron 桌面窗口渲染成白底大字、分层清晰、箭头不遮挡的结构框图。

## Features

- Render architecture diagrams from stable `mindmap-app/v1` JSON.
- Use large readable text, pastel layer bands, explicit arrow routes, and label backgrounds.
- Switch between MindMap, dependency, and architecture views over one shared graph, with per-view camera, layout, filters, hidden state, and saved views.
- Work in a focused infinite canvas with rectangle/lasso selection, multi-node dragging, pan/zoom, ports, grouping, grid snapping, search, minimap, and responsive inspectors.
- Edit node titles and descriptions in place with double-click or `F2`. The reference-style floating toolbar applies fonts, sizes, emphasis, lists, alignment, links, code, text/highlight colors, and node colors to the current character selection without losing focus.
- Paste, upload, or drag PNG/JPEG/WebP images into nodes or onto the canvas. Assets are hash-deduplicated and embedded in JSON; image nodes remain connectable and export to SVG, PNG, PDF, JSON, and standalone HTML.
- Route architecture/dependency edges with orthogonal obstacle avoidance and MindMap branches with smooth curves. Manual bends can be locked and later returned to automatic routing.
- Use XMind-style topic creation in MindMap view: `Tab` adds a child and `Enter` adds a sibling. Use 100-step undo/redo and continuous paste offsets, run automatic layouts, and export SVG, PNG, PDF, JSON, standalone HTML, or Mermaid.
- Validate diagrams at script runtime, including every example, node IDs, edge references, status tags, and relation tags.
- Install MindMap as a local desktop launcher on Linux.
- Publish the static app to GitHub Pages without runtime dependencies.
- Keep architecture claims evidence-backed and mark unsupported facts as `Unknown / 待确认`.

## Requirements

- Node.js 20 or newer
- npm dependencies installed with `npm install`
- Claude Code or Codex for skill-driven diagram generation

The static renderer scripts use Node.js built-in modules. The local desktop window uses Electron as a development dependency.

## Installation

```bash
git clone https://github.com/lwbscu/mindmap-skill.git ~/Projects/MindMap
ln -s ~/Projects/MindMap ~/.claude/skills/mindmap-skill
ln -s ~/Projects/MindMap ~/.codex/skills/mindmap-skill
```

Restart the Claude Code or Codex session after installing the skill.

## Agent Usage

Invoke the skill when you want an architecture or system structure map:

```text
Use $mindmap-skill to inspect this repository and create an evidence-backed interactive architecture map.
```

The skill produces or updates a diagram JSON file, then uses the MindMap app for local preview and export.

## App Usage

Start the local desktop window:

```bash
npm run app:open
```

The normal entry is the Electron desktop window. It loads local files through the `mindmap://` protocol and does not start a `127.0.0.1` server. Use `npm run app:serve` only when debugging the static web server directly. The default example is [`examples/rpent-libero-behavior.diagram.json`](examples/rpent-libero-behavior.diagram.json), currently covering the RPent module architecture, BEHAVIOR first-pass integration, and next-stage planned interventions. Use **打开** to load another diagram and switch among **MindMap / 依赖图 / 架构图**. Double-click a card or press `F2` to edit its title and description; press `Enter` to commit, `Shift+Enter` for a line break, or `Esc` to cancel. Selecting nodes opens a compact floating format bar; while editing it keeps the character selection alive and mirrors the single-line grouped toolbar shown in the project reference. The right inspector contains complete node, image, route, and style controls. In MindMap view, use `Tab` for a child topic and `Enter` for a sibling topic.

Drag empty space to marquee-select, drag right-to-left for crossing selection, hold `Alt` for lasso, and hold `Shift` to toggle selection. Use **连线** or drag from ports to create relations, `Space`/middle mouse to pan, `Ctrl/Cmd` + wheel to zoom around the pointer, and standard copy/paste/undo shortcuts before exporting. Automatic layout uses compact 20px-title cards and reroutes stale edge waypoints so a whole-diagram overview stays legible.

Install a Linux desktop launcher so MindMap appears in Applications:

```bash
npm run app:install-desktop
```

After installation, search for **MindMap** in Applications. The launcher opens the Electron desktop window directly; it does not open a browser tab or start the local debug server.

Open MindMap from the command line using the same launcher behavior:

```bash
npm run app:open
```

Remove the desktop launcher:

```bash
npm run app:uninstall-desktop
```

The app also includes a web manifest, service worker, and PNG application icon for hosted `/app/` deployments.

Build the GitHub Pages artifact:

```bash
npm run app:build
```

Render the default example to standalone SVG and HTML:

```bash
npm run app:render
```

Validate and render a specific diagram:

```bash
npm run app:render -- examples/rpent-libero-behavior.diagram.json
```

## Diagram Format

MindMap diagrams use `schemaVersion: "mindmap-app/v1"` with these top-level fields:

- `title`, `subtitle`, `canvas`, `style`, optional embedded `assets`
- `layers`
- `nodes`
- `edges`
- optional `activeViewId`, `views`, and `savedViews`

Nodes use absolute layout fields such as `id`, `title`, `subtitle`, `x`, `y`, `width`, and `height`, with optional versioned `richText` and `image` references. Edges support stable IDs, side anchors, labels, automatic or locked routes, orthogonal waypoints, and curved control points.

Older `mindmap-app/v1` files without `views` open as the default architecture view and are compacted for readable whole-diagram preview. The app adds MindMap and dependency views in memory without changing the shared top-level nodes and edges.

Diagrams may also carry evidence metadata:

- Node `status`: `implemented`, `external`, `planned`, `unknown`, or `risk`.
- Edge `relation`: `calls`, `reads`, `writes`, `routes`, `guards`, `evaluates`, and other known relation tags.
- Node/edge `evidence`: compact source strings such as `src/file.ts:42` or `user: ...`.

The renderer shows status as a compact badge. Evidence metadata stays in JSON and exported artifacts, while visible labels are edited directly on the canvas. When a status is central to the story, it is still helpful to include the human label in node text: `已实现`, `外部依赖`, `拟介入`, `待确认`, or `风险`.

See [`references/diagram-schema.md`](references/diagram-schema.md) for the contract.

## Development

```bash
npm run check
npm test
npm run app:smoke
npm run app:visual
npm run app:build
```

The test suite validates all examples, renders SVG/HTML, exercises geometry, camera, history, clipboard remapping, view migration, shortest paths and ELK layout, then runs real Electron input smoke tests. `npm run app:visual` captures 1440x900, 1024x768, 760x720, and 390x760 responsive screenshots.

## License

MindMap is released under the [MIT License](LICENSE).

# MindMap

MindMap is an interactive desktop and web app plus an agent skill for making evidence-based architecture maps. Agents produce a compact diagram JSON file, and the shared editor renders it as a clean, zoomable structure diagram with static exports and a self-contained editable HTML export.

MindMap 是一个面向 Claude Code 与 Codex 的本地桌面结构框图工具。它把用户描述、代码、文档和日志里的可验证事实整理为 `mindmap-app/v1` diagram JSON，并用 Electron 桌面窗口渲染成白底大字、分层清晰、箭头不遮挡的结构框图。

## Features

- Render architecture diagrams from stable `mindmap-app/v1` JSON.
- Use large readable text, pastel layer bands, explicit arrow routes, and label backgrounds.
- Switch between MindMap, dependency, and architecture views over one shared graph, with per-view camera, layout, filters, hidden state, and saved views.
- Work in a focused infinite canvas with rectangle/lasso selection, multi-node dragging, pan/zoom, ports, grouping, grid snapping, search, minimap, and responsive inspectors.
- Edit node titles and descriptions in place with double-click or `F2`. The Word-style floating toolbar applies fonts, 8-96px sizes, emphasis, lists, alignment, safe links, code, text colors, and highlights to the current character selection without losing focus. Node fill, border, and radius stay in the inspector.
- Paste, upload, or drag PNG/JPEG/WebP images into nodes or onto the canvas. Assets are hash-deduplicated and embedded in JSON; image nodes remain connectable and export to SVG, PNG, PDF, JSON, static HTML, and editable HTML.
- Route architecture/dependency edges with orthogonal obstacle avoidance and MindMap branches with smooth curves. Manual bends can be locked and later returned to automatic routing.
- Use XMind-style topic creation in MindMap view: `Tab` adds a child and `Enter` adds a sibling. Use 100-step undo/redo and continuous paste offsets, run automatic layouts, and export SVG, PNG, PDF, JSON, read-only HTML, editable HTML, or Mermaid.
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

The normal entry is the Electron desktop window. It loads local files through the `mindmap://` protocol and does not start a `127.0.0.1` server. Use `npm run app:serve` only when debugging the static web server directly. Press `Ctrl/Cmd+N` or use the project menu to create a blank project; desktop projects are stored as `.diagram.json` files under the repository-root [`projects/`](projects/) directory, while the Web build falls back to a JSON download. The default example is [`examples/rpent-libero-behavior.diagram.json`](examples/rpent-libero-behavior.diagram.json), currently covering the RPent module architecture, BEHAVIOR first-pass integration, and next-stage planned interventions. Use the same project menu to reopen a local project or import an external diagram, and switch among **MindMap / 依赖图 / 架构图**. Double-click a card or press `F2` to edit its title and description; press `Enter` to commit, `Shift+Enter` for a line break, or `Esc` to cancel. Drag across part of the text to format only that selection; with a collapsed caret, formatting changes subsequent input. The compact Word-style floating toolbar reports mixed styles and keeps the selection alive while its font, size, color, highlight, link, list, and alignment controls are open. The right inspector contains node fill, border, radius, image, route, and other structural controls. In MindMap view, use `Tab` for a child topic and `Enter` for a sibling topic.

Drag empty space to marquee-select, drag right-to-left for crossing selection, hold `Alt` for lasso, and hold `Shift` to toggle selection. Use **连线** or drag from ports to create relations, `Space`/middle mouse to pan, `Ctrl/Cmd` + wheel to zoom around the pointer, and standard copy/paste/undo shortcuts before exporting. Automatic layout uses compact 20px-title cards and reroutes stale edge waypoints so a whole-diagram overview stays legible.

`Ctrl/Cmd+S` saves the current desktop project back to `projects/`, and `Ctrl/Cmd+Shift+S` creates a uniquely named project copy in the same directory. Switching away from a dirty canvas requires Save, Discard, or Cancel. `Ctrl/Cmd+C/X/V/Z/Y` operate on selected nodes on the canvas and switch to character clipboard/history behavior while a text editor is active. Runtime project JSON files are intentionally ignored by Git.

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

## Web Editor And Editable HTML

The GitHub Pages build is the same editor as the desktop app, not a read-only preview. Build and run it locally with:

```bash
npm run app:serve
```

Open the printed URL and edit directly in the browser. The generated [`dist/index.html`](dist/index.html) redirects to the interactive [`dist/app/`](dist/app/) editor, so the same artifact can be published under a GitHub Pages repository subpath. Browser `Ctrl/Cmd+S` downloads the complete diagram JSON; it does not request arbitrary filesystem or GitHub write access.

The export menu intentionally provides two HTML choices:

- **独立 HTML（只读）** exports the current rendered view as a lightweight presentation artifact.
- **可编辑 HTML（完整 App）** exports one self-contained `.editable.html` file with the editor runtime, diagram JSON, all views, rich text, images, and route state. Open it directly from `file://`, continue editing, and export another editable HTML or import it back into MindMap.

Editable HTML has no external JS, CSS, worker, image, or server dependency. Imported HTML is accepted only when it contains the known `script#mindmap-embedded-diagram` data block; MindMap parses that JSON without executing scripts from the imported document. The app rejects exports above 64MB and retains the existing 32MB total embedded-image budget.

The app also includes a web manifest, service worker, and PNG application icon for hosted `/app/` deployments. The service worker caches the editable template so one-click editable export remains available after the hosted app has been loaded once.

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
npm run app:test-editable
npm run app:smoke
npm run app:visual
npm run app:build
```

The test suite validates all examples, renders SVG/HTML, exercises geometry, camera, history, clipboard remapping, view migration, shortest paths and ELK layout, then runs real Electron input smoke tests. `npm run app:test-editable` opens the web editor over HTTP and the single-file editor over `file://`, edits nodes, saves/re-exports, and verifies assets and all views survive. `npm run app:visual` captures 1440x900, 1024x768, 760x720, and 390x760 responsive screenshots.

## License

MindMap is released under the [MIT License](LICENSE).

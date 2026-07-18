# MindMap

MindMap is an interactive web app and agent skill for making evidence-based architecture maps. Agents produce a compact diagram JSON file, and the app renders it as a clean, zoomable structure diagram with SVG and standalone HTML exports.

MindMap 是一个面向 Claude Code 与 Codex 的交互式结构框图工具。它把用户描述、代码、文档和日志里的可验证事实整理为 `mindmap-app/v1` diagram JSON，并用 Web 小程序渲染成白底大字、分层清晰、箭头不遮挡的结构框图。

## Features

- Render architecture diagrams from stable `mindmap-app/v1` JSON.
- Use large readable text, pastel layer bands, explicit arrow routes, and label backgrounds.
- Preview diagrams in a browser with zoom, scroll, JSON loading, SVG download, and standalone HTML download.
- Install MindMap as a local desktop launcher on Linux and as a browser PWA when supported.
- Publish the static app to GitHub Pages without runtime dependencies.
- Keep architecture claims evidence-backed and mark unsupported facts as `Unknown / 待确认`.

## Requirements

- Node.js 20 or newer
- A modern browser for interactive preview
- Claude Code or Codex for skill-driven diagram generation

The app and scripts use Node.js built-in modules only. There are no npm runtime dependencies.

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

Start the local app:

```bash
npm run app:serve
```

Open the printed `/app/` URL in a browser. The default example is [`examples/rpent-libero-behavior.diagram.json`](examples/rpent-libero-behavior.diagram.json). Use **打开 JSON** in the app to load another diagram file.

Install a Linux desktop launcher so MindMap appears in Applications:

```bash
npm run app:install-desktop
```

After installation, search for **MindMap** in Applications. The launcher starts the local app server when needed and opens the app in your browser.

Open MindMap from the command line using the same launcher behavior:

```bash
npm run app:open
```

Remove the desktop launcher:

```bash
npm run app:uninstall-desktop
```

The app also includes a web manifest, service worker, and SVG icon so supported browsers can install it from the hosted `/app/` page.

Build the GitHub Pages artifact:

```bash
npm run app:build
```

Render the default example to standalone SVG and HTML:

```bash
npm run app:render
```

## Diagram Format

MindMap diagrams use `schemaVersion: "mindmap-app/v1"` with these top-level fields:

- `title`, `subtitle`, `canvas`, `style`
- `layers`
- `nodes`
- `edges`

Nodes use absolute layout fields such as `id`, `title`, `subtitle`, `x`, `y`, `width`, and `height`. Edges support `from`, `to`, side anchors, explicit `waypoints`, labels, and label positions.

See [`references/diagram-schema.md`](references/diagram-schema.md) for the contract.

## Development

```bash
npm run check
npm test
npm run app:build
```

The test suite validates the default example, renders SVG/HTML, checks key architecture labels, and builds the static site.

## License

MindMap is released under the [MIT License](LICENSE).

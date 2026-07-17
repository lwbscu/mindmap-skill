# MindMap

MindMap is an agent skill for creating and safely updating evidence-based software, system, and model architecture diagrams in [Obsidian Canvas](https://obsidian.md/canvas).

MindMap 是一个面向 Claude Code 与 Codex 的架构制图 Skill。它把用户描述、文档和代码中的可验证事实整理为可交互的 Obsidian `.canvas` 文件，并在增量更新时保留人工布局与样式。

## Features

- Generate deterministic JSON Canvas 1.0 files from a stable architecture blueprint.
- Build left-to-right data flows, subsystem groups, external boundaries, and dashed feedback loops.
- Merge into an existing Canvas without deleting manual nodes or overwriting human positions and styles.
- Mark unsupported assumptions as `Unknown / 待确认` instead of inventing architecture facts.
- Validate IDs, edge references, geometry, overlaps, colors, isolated nodes, and Advanced Canvas fields.
- Optionally install and configure Advanced Canvas 6.5.0 with reusable MindMap node templates.

## Scope

Version 1 focuses on architecture diagrams in Obsidian Canvas.

It does not generate Mermaid, draw.io, HTML courseware, SVG/PNG exports, or traditional radial mind maps. Functional roles such as `data`, `model`, `loss`, and `external` describe architecture responsibilities, not a fixed model taxonomy.

## Requirements

- Node.js 20 or newer
- Obsidian when interactive Canvas editing is required
- Claude Code or Codex for skill-driven use
- Network access only when Advanced Canvas must be installed

The core builder and validator use Node.js built-in modules and have no npm runtime dependencies.

## Installation

Clone the repository and link the same working tree into the agent skill directories:

```bash
git clone https://github.com/lwbscu/mindmap-skill.git ~/Projects/MindMap
ln -s ~/Projects/MindMap ~/.claude/skills/mindmap-skill
ln -s ~/Projects/MindMap ~/.codex/skills/mindmap-skill
```

Restart the Claude Code or Codex session after installing the skill.

## Agent Usage

Invoke the skill explicitly when needed:

```text
Use $mindmap-skill to inspect this repository and create an Obsidian Canvas architecture diagram.
```

The skill supports four workflows:

1. Create a new architecture Canvas.
2. Merge evidence-backed components into an existing Canvas.
3. Review an existing Canvas for structural or evidence problems.
4. Repair a Canvas while preserving human-authored content.

See [`SKILL.md`](SKILL.md) for the orchestration rules and [`references/`](references/) for the architecture, Canvas, and quality contracts.

## Script Usage

Build or merge a Canvas:

```bash
node scripts/build-canvas.mjs \
  --input architecture.blueprint.json \
  --output architecture.canvas \
  --mode create \
  --advanced auto
```

Validate the result:

```bash
node scripts/validate-canvas.mjs architecture.canvas --strict
```

Check or install Advanced Canvas in a selected vault:

```bash
node scripts/ensure-advanced-canvas.mjs --vault "/path/to/Obsidian Vault" --check
node scripts/ensure-advanced-canvas.mjs --vault "/path/to/Obsidian Vault" --version 6.5.0
```

The blueprint interface is documented in [`references/obsidian-canvas-contract.md`](references/obsidian-canvas-contract.md).

## Safety

- Architecture facts must come from user input, documentation, or code evidence.
- Merge mode uses deterministic IDs and rejects conflicting semantic keys.
- Existing manual nodes, text, coordinates, colors, unknown fields, and Advanced Canvas styles are preserved.
- Existing Canvas files are validated before replacement and backed up under the user cache directory.
- Advanced Canvas downloads are restricted to official GitHub asset hosts and pinned by version, size, and SHA-256.
- A failed plugin download does not prevent standard JSON Canvas generation.

Advanced Canvas is a separate third-party project and is not bundled with MindMap. Its repository is available at [Developer-Mike/obsidian-advanced-canvas](https://github.com/Developer-Mike/obsidian-advanced-canvas).

## Development

```bash
npm run check
npm test
```

The regression suite covers deterministic generation, 40-node layouts, non-destructive merge behavior, malformed Canvas input, Advanced Canvas compatibility, plugin installation recovery, and download policy checks.

## License

MindMap is released under the [MIT License](LICENSE).

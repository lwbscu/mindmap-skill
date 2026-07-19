---
name: mindmap-skill
description: Build evidence-based interactive architecture maps for models, systems, repositories, services, dependencies, and code paths using the MindMap desktop app.
---

# MindMap

## Purpose

Create or safely update high-quality interactive architecture maps from evidence. The output is a compact `mindmap-app/v1` diagram JSON rendered by the MindMap desktop app, with clear layers, readable nodes, explicit relations, clickable evidence details, and uncertain facts marked as `Unknown` or `待确认`.

Use this skill for architecture diagrams of models, systems, repositories, services, components, data flows, dependency structures, or code paths. Do not switch to other diagram workflows unless the user explicitly asks.

## Operating Rules

- Work map-first: establish the whole architecture before filling details.
- Preserve evidence: every important node and edge should trace to a file, doc, quote, command output, or user statement when available.
- Do not invent facts. Mark missing ownership, runtime behavior, protocols, data contracts, or model internals as `Unknown` / `待确认`.
- Prefer stable architecture roles over decorative categories: `entrypoint`, `interface`, `module`, `service`, `model`, `data`, `storage`, `process`, `external`, `risk`, `unknown`.
- Use status tags when they help review state: `implemented`, `external`, `planned`, `unknown`, `risk`. Put visible labels such as `拟介入` or `待确认` in node text when the exported map needs to show them.
- Keep the diagram easy to scan: 5-15 primary nodes first, short labels, large text, and explicit arrows that do not cover text.
- Default visual contract: white canvas, black primary text, 20px or larger primary labels, restrained pastel layers, stable node dimensions, and short relation labels.
- Default editing contract: preserve supported character-level rich text, allow informative embedded PNG/JPEG/WebP images with useful alt text, and keep pure image nodes connectable on all four sides.
- Default routing contract: architecture/dependency edges use automatic orthogonal obstacle avoidance; MindMap edges use automatic smooth curves. Do not hand-write waypoint collections unless the user has explicitly confirmed and locked a route.
- Use the MindMap app artifact by default: diagram JSON plus Electron desktop preview, three shared-data views, in-place text editing, XMind-style `Tab`/`Enter` topic creation, floating multi-node typography/color controls, marquee/lasso selection, relation creation, searchable nodes/edges, auto-layout, and SVG/PNG/PDF/JSON/HTML/Mermaid export.
- Never require a local notes directory for normal MindMap work.

## Required References

Load only the references needed for the current task:

- [architecture-method.md](references/architecture-method.md): evidence collection, architecture slicing, node/edge naming, uncertainty handling.
- [diagram-schema.md](references/diagram-schema.md): `mindmap-app/v1` schema, evidence/status fields, validator rules, and render contract.
- [quality-ratchet.md](references/quality-ratchet.md): quality gate, preview checks, and anti-patterns.

## Workflow

Follow this order for every new or updated map.

### 1. Scope And Evidence

Clarify the target in one pass:

- subject: model, system, repo/codebase, service, architecture proposal, or code path
- output path: target `.diagram.json` and optional export directory
- operation: create a new diagram or update an existing diagram JSON
- evidence sources: files, directories, docs, logs, URLs, user notes, or current diagram
- language: use the user's language unless the project strongly indicates otherwise

If sources are missing, proceed with explicit `Unknown` nodes rather than guessing.

### 2. Global Architecture

Read [architecture-method.md](references/architecture-method.md). Build a coarse architecture first:

- identify 5-15 primary components before adding internals
- group by runtime boundary, responsibility, layer, or repository area
- separate control flow, data flow, dependency, ownership, and uncertainty
- keep names short enough to scan in the app
- attach evidence to each confident claim
- put long evidence, risks, and links in metadata so the app can export them without crowding the map

Do not start from file-by-file noise. Promote details only when they explain how the architecture works.

### 3. Diagram JSON

Read [diagram-schema.md](references/diagram-schema.md). Write a `mindmap-app/v1` diagram JSON:

```json
{
  "schemaVersion": "mindmap-app/v1",
  "title": "Architecture Map",
  "subtitle": "Evidence-backed structure diagram",
  "canvas": { "width": 2400, "height": 1480, "background": "#ffffff" },
  "layers": [],
  "nodes": [],
  "edges": []
}
```

Use stable node coordinates and let the App calculate routes. Keep labels short; put details in `summary`, `evidence`, `risks`, and `links` as metadata, while visible content is edited directly on canvas nodes. Use `richText` only when character-level emphasis adds meaning, and always keep `title` / `subtitle` synchronized. Put images in top-level `assets` and reference them from `node.image`; never emit SVG uploads or unsafe data URLs.

For evidence-backed diagrams, add compact metadata that the runtime validator can check:

- `node.status`: `implemented`, `external`, `planned`, `unknown`, or `risk`
- `node.evidence` / `edge.evidence`: array of source strings
- `edge.relation`: known relation such as `calls`, `routes`, `guards`, `evaluates`, or `writes`

### 4. Preview And Export

Use the app scripts from the repository root:

```bash
npm run app:open
npm run app:render -- examples/<name>.diagram.json
npm run app:build
```

Open the Electron desktop window for interactive review. It uses the `mindmap://` local protocol rather than a `127.0.0.1` server. For a new deliverable, create a blank project with the project menu or `Ctrl/Cmd+N`; the desktop app owns its project file under the repository-root `projects/` directory, and `Ctrl/Cmd+S` saves it there. Do not create an Obsidian canvas or place active project files in an arbitrary vault. Double-click a node or press `F2` to edit title and description directly. The reference-style floating toolbar preserves character selection and supports lists, alignment, bold, strike, italic, underline, links, inline code, fonts, size, text/highlight colors, node colors, image insertion, and notes. Paste, upload, or drop informative images into a selected node or empty canvas; use the inspector for placement, fit, opacity, alt text, replacement, and removal. In MindMap view, `Tab` creates a child and `Enter` creates a sibling. Also use the project library/import control, the three-view switcher, search, navigator, minimap, marquee/lasso multi-select, group dragging, port relation tool, pointer-centered zoom, copy/paste/undo, and automatic layout. Canvas `Ctrl/Cmd+C/V/Z` act on nodes; while text editing they retain native character-level behavior. Export the current view as SVG, PNG, PDF, JSON, standalone HTML, or Mermaid when a portable artifact is needed.

### 5. Validate

Run the project checks after every finished map or app change:

```bash
npm run check
npm test
npm run app:smoke
npm run app:visual
npm run app:build
```

Run `npm run app:render -- examples/<name>.diagram.json` for the target diagram when you need an export-specific validator/render check.

If validation fails, fix the diagram or report the exact blocker.

### 6. Report

Finish with a compact report:

- diagram file
- preview URL or app path
- export files when generated
- validation result
- evidence coverage: strong / partial / weak
- explicit unknowns and conflicts
- next recommended source to confirm uncertain claims

## Quality Gate

Before finalizing, read [quality-ratchet.md](references/quality-ratchet.md) and confirm:

- the artifact is a MindMap app diagram, not another diagram workflow
- the map starts from global architecture and then drills down
- confident claims have evidence, and unknowns are marked
- the JSON follows `mindmap-app/v1`
- arrows are readable and do not cover node text
- orthogonal routes avoid nodes/images and labels do not collide
- rich text and embedded images survive every supported export
- automatic routes remain automatic unless a user-confirmed route is locked
- local preview or render checks were run or the blocker is reported

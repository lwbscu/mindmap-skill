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
- Default editing contract: preserve supported character-level rich text, allow informative embedded PNG/JPEG/WebP images with useful alt text, and keep pure image nodes connectable on all four sides. When editing text, a partial selection changes only those characters; a collapsed caret changes subsequent input only. Keep node fill, border, and radius controls in the inspector instead of mixing them with character formatting.
- Default routing contract: architecture/dependency edges use automatic orthogonal obstacle avoidance; MindMap edges use automatic smooth curves. Do not hand-write waypoint collections unless the user has explicitly confirmed and locked a route.
- Use the MindMap app artifact by default: diagram JSON plus the shared Electron/Web editor, three shared-data views, in-place text editing, XMind-style `Tab`/`Enter` topic creation, floating multi-node typography/color controls, marquee/lasso selection, relation creation, searchable nodes/edges, auto-layout, and SVG/PNG/PDF/JSON/read-only HTML/editable HTML/Mermaid export.
- Never require a local notes directory for normal MindMap work.

## Required References

Load only the references needed for the current task:

- [architecture-method.md](references/architecture-method.md): evidence collection, architecture slicing, node/edge naming, uncertainty handling.
- [diagram-schema.md](references/diagram-schema.md): `mindmap-app/v1` schema, evidence/status fields, validator rules, and render contract.
- [quality-ratchet.md](references/quality-ratchet.md): quality gate, preview checks, and anti-patterns.

## Non-Negotiable Visual Contract

Every generated or updated diagram must follow this contract unless the user explicitly requests a different visual language. A diagram that violates a hard requirement is unfinished and must be relaid out, split into views, or reported as blocked; do not waive the gate because the JSON validates.

- **Canvas:** use `#ffffff` as the diagram background. Editing grids may be faint guides only and must not dominate the canvas or appear in exports. Do not use textured, noisy, dark, gradient, blurred, or decorative backgrounds.
- **Information density:** start with 5-15 primary nodes and keep a normal overview at 25 visible nodes or fewer. If the overview needs more, create focused saved views, collapse branches, or split the subject instead of shrinking everything.
- **Typography:** use 20-28px primary node titles, 14-18px node subtitles, 13-16px edge labels, and no more than two font families in one view. The global diagram title/subtitle are display text and do not count toward the node typography scale. Primary text must meet 4.5:1 contrast. Keep node titles to one or two lines and subtitles to two short lines; move detail to metadata.
- **Overview readability:** on a 1440x900 review viewport, fit-all should normally remain at 40% zoom or above. At 50%, every primary node title and main relation must be readable. At 30%, text must remain rendered and primary node titles must remain distinguishable. If this is impossible, reduce density or split the view; never hide text to make the screenshot look clean.
- **Geometry:** place content on the 8px grid. Keep at least 32px between sibling node boxes, 56px between architectural layers, 32px inner padding inside layer bands, and 80px outer canvas margin. Same-role nodes in a row or column should align within 8px and use consistent dimensions. Keep ordinary card corner radii at 8px or less.
- **Color:** use white nodes with black/deep-gray text and 3-6 restrained pastel semantic accents. A color must communicate layer, role, status, risk, or selection. Do not create rainbow text, one-color saturation, decorative gradients, or large dark color fields.
- **Edges:** architecture and dependency edges are orthogonal; MindMap branches are smooth curves. No edge may cross a non-terminal node, image, node text, layer label, or relation label. Parallel edges need separate channels, labels need an opaque light background and clear whitespace, and arrowheads must be proportional to the stroke.
- **Rich text:** character formatting is for semantic emphasis, not decoration. Keep at most three visible node text-size levels per view and use bold, color, highlight, links, and code sparingly. Partial selections affect only selected characters; node fill, border, and radius remain inspector-level styles.
- **Images:** include only sharp, informative PNG/JPEG/WebP images with useful `alt` text. Use a stable thumbnail or top-image geometry, preserve aspect ratio, and never let an image displace titles, ports, or routes. Decorative, blurred, stretched, or unlabeled images fail the gate.
- **Interaction and export:** the Electron and Web editors must keep editable text, selection, copy/paste/undo, images, routes, and view state usable. SVG, PNG, PDF, JSON, and read-only HTML preserve the current rendered structure; editable HTML additionally embeds the complete editor runtime, shared graph, all views, rich text, assets, evidence, and route state in one offline file. It must reopen from `file://`, remain editable, and support re-export/import without external dependencies. Mermaid may use an explicit readable fallback.

Apply the view-specific composition rules in [quality-ratchet.md](references/quality-ratchet.md): one clear root and balanced fan-out for MindMap, one dominant flow direction for dependency graphs, and explicit aligned layers for architecture diagrams.

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
- choose the target view grammar before placing nodes: balanced tree for MindMap, single-direction graph for dependencies, or aligned layer bands for architecture
- preserve the spacing, alignment, density, and typography budgets from the Non-Negotiable Visual Contract

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

Open the Electron desktop window for interactive review. It uses the `mindmap://` local protocol rather than a `127.0.0.1` server. Use `npm run app:serve` when the user requests direct browser editing; the hosted `/app/` build is the same editor, and browser save downloads JSON. For a new deliverable, create a blank project with the project menu or `Ctrl/Cmd+N`; the desktop app owns its project file under the repository-root `projects/` directory, and `Ctrl/Cmd+S` saves it there. Do not create an Obsidian canvas or place active project files in an arbitrary vault. Double-click a node or press `F2` to edit title and description directly. The Word-style floating toolbar preserves the current text selection and provides font, 8-96px size, grow/shrink, bold, italic, underline, strike, text color, highlight, clear formatting, safe links, inline code, lists, and alignment. A mixed selection must display a mixed state; do not expand a partial selection into whole-field formatting. Paste, upload, or drop informative images into a selected node or empty canvas; use the inspector for placement, fit, opacity, alt text, replacement, and removal. In MindMap view, `Tab` creates a child and `Enter` creates a sibling. Also use the project library/import control, the three-view switcher, search, navigator, minimap, marquee/lasso multi-select, group dragging, port relation tool, pointer-centered zoom, copy/paste/undo, and automatic layout. Canvas `Ctrl/Cmd+C/X/V/Z/Y` act on nodes; while text editing they act on characters and Tiptap history. Use **独立 HTML（只读）** for a lightweight presentation and **可编辑 HTML（完整 App）** when the recipient must continue editing offline. Editable HTML must preserve complete `mindmap-app/v1` data and must be importable back into the App; never replace it with a static SVG wrapper.

### 5. Validate

Run the project checks after every finished map or app change:

```bash
npm run check
npm test
npm run app:test-editable
npm run app:smoke
npm run app:visual
npm run app:build
```

Run `npm run app:render -- examples/<name>.diagram.json` for the target diagram when you need an export-specific validator/render check.

Validation is not complete until the rendered result is visually inspected at 100%, 50%, fit-all, and the required responsive viewports. Passing scripts cannot override a visual collision, tiny text, noisy background, disordered alignment, or inconsistent export.

If validation fails, fix the diagram or report the exact blocker.

### 6. Report

Finish with a compact report:

- diagram file
- preview URL or app path
- export files when generated
- validation result
- evidence coverage: strong / partial / weak
- visual quality gate: pass / blocked, including the inspected zoom levels and viewports
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
- editable HTML opens without a server, remains editable, re-exports, and round-trips through the App without losing views, assets, rich text, evidence, or routes
- automatic routes remain automatic unless a user-confirmed route is locked
- local preview or render checks were run or the blocker is reported
- the strict visual contract and all view-specific pass/fail criteria were checked
- the whole diagram passes the three-second test: theme, entry, core flow, output/data, and risk/unknown areas are immediately identifiable

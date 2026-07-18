---
name: mindmap-skill
description: Build evidence-based interactive architecture maps for models, systems, repositories, services, dependencies, and code paths using the MindMap web app.
---

# MindMap

## Purpose

Create or safely update high-quality interactive architecture maps from evidence. The output is a compact `mindmap-app/v1` diagram JSON rendered by the MindMap web app, with clear layers, readable nodes, explicit relations, and uncertain facts marked as `Unknown` or `待确认`.

Use this skill for architecture diagrams of models, systems, repositories, services, components, data flows, dependency structures, or code paths. Do not switch to other diagram workflows unless the user explicitly asks.

## Operating Rules

- Work map-first: establish the whole architecture before filling details.
- Preserve evidence: every important node and edge should trace to a file, doc, quote, command output, or user statement when available.
- Do not invent facts. Mark missing ownership, runtime behavior, protocols, data contracts, or model internals as `Unknown` / `待确认`.
- Prefer stable architecture roles over decorative categories: `entrypoint`, `interface`, `module`, `service`, `model`, `data`, `storage`, `process`, `external`, `risk`, `unknown`.
- Keep the diagram easy to scan: 5-15 primary nodes first, short labels, large text, and explicit arrows that do not cover text.
- Use the MindMap app artifact by default: diagram JSON plus browser preview, SVG export, and standalone HTML export.
- Never require a local notes directory for normal MindMap work.

## Required References

Load only the references needed for the current task:

- [architecture-method.md](references/architecture-method.md): evidence collection, architecture slicing, node/edge naming, uncertainty handling.
- [diagram-schema.md](references/diagram-schema.md): `mindmap-app/v1` schema and render contract.
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

Use explicit node coordinates and edge waypoints when needed to keep arrows from crossing labels. Keep labels short; put details in subtitles only when they stay readable.

### 4. Preview And Export

Use the app scripts from the repository root:

```bash
npm run app:serve
npm run app:render -- examples/<name>.diagram.json
npm run app:build
```

Open the local `/app/` URL for interactive review. Use SVG or standalone HTML export when a portable artifact is needed.

### 5. Validate

Run the project checks after every finished map or app change:

```bash
npm run check
npm test
npm run app:build
```

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
- local preview or render checks were run or the blocker is reported

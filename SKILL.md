---
name: mindmap-skill
description: Build and safely update evidence-based Obsidian .canvas architecture maps for models, systems, and codebases. Use when the user asks for an architecture mind map, system map, model map, repo/codebase map, dependency map, or Obsidian Canvas visualization; do not use for Mermaid, draw.io, HTML pages, slides, or traditional radial mind maps.
---

# MindMap

## Purpose

Create or safely update high-quality Obsidian Canvas architecture maps from evidence. The output is an Obsidian `.canvas` file built from a compact JSON blueprint, with clear nodes, explicit relations, and uncertain facts marked as `Unknown` or `待确认`.

Use this skill only for architecture diagrams of models, systems, repositories, services, components, data flows, dependency structures, or code paths. Decline or reroute requests for Mermaid, draw.io, HTML visualizations, slides, whiteboards, generic concept maps, or traditional radial mind maps.

## Operating Rules

- Work map-first: establish the whole architecture before filling details.
- Preserve evidence: every important node and edge should trace to a file, doc, quote, command output, or user statement when available.
- Do not invent facts. Mark missing ownership, runtime behavior, protocols, data contracts, or model internals as `Unknown` / `待确认`.
- Do not pre-classify advanced model families or proprietary internals unless sources support the classification.
- Prefer stable architecture roles over decorative categories: `entrypoint`, `module`, `service`, `model`, `data`, `storage`, `interface`, `process`, `external`, `risk`, `unknown`.
- Keep Canvas as the only visual artifact. Do not emit Mermaid, draw.io XML, HTML, SVG-only diagrams, or courseware.
- Treat `metadata` and `styleAttributes` as optional Canvas enhancements. Preserve them during merge, but do not require them in the blueprint.
- Never create README, LICENSE, or extra documentation as part of normal use.

## Required References

Load only the references needed for the current task:

- [architecture-method.md](references/architecture-method.md): evidence collection, architecture slicing, node/edge naming, uncertainty handling.
- [obsidian-canvas-contract.md](references/obsidian-canvas-contract.md): blueprint schema, script commands, create/merge contract, Canvas compatibility.
- [quality-ratchet.md](references/quality-ratchet.md): quality gate, dry-run prompts, report format, anti-patterns.

## Workflow

Follow this order for every new or updated map.

### 1. Scope And Evidence

Clarify the target in one pass:

- subject: model, system, repo/codebase, service, architecture proposal, or code path
- output path: target `.canvas` file and, when relevant, Obsidian vault path
- operation: `create` for a new canvas, `merge` for an existing canvas
- evidence sources: files, directories, docs, logs, URLs, user notes, or current Canvas
- language: use the user's language unless the target vault or source material strongly indicates otherwise

If sources are missing, proceed with explicit `Unknown` nodes rather than guessing. If the user asks for unsupported output, state that MindMap v1 only creates Obsidian `.canvas` architecture maps.

### 2. Global Architecture

Read [architecture-method.md](references/architecture-method.md). Build a coarse architecture first:

- identify 5-15 primary components before adding internals
- group by runtime boundary, responsibility, layer, or repository area
- separate control flow, data flow, dependency, ownership, and uncertainty
- keep names short enough to scan on a canvas
- attach evidence to each confident claim

Do not start from file-by-file noise. Promote details only when they explain how the architecture works.

### 3. Blueprint

Read [obsidian-canvas-contract.md](references/obsidian-canvas-contract.md). Write a blueprint JSON with this frozen top-level shape:

```json
{
  "schemaVersion": "1.0",
  "title": "Architecture Map",
  "language": "en",
  "nodes": [],
  "edges": []
}
```

Require `schemaVersion`, `nodes`, and `edges`. Treat `title` and `language` as optional strings.

Node fields:

- required: `key`, `label`, `role`
- optional: `details`, `group`, `rank`, `lane`, `evidence`, `uncertain`
- use a non-negative integer for `rank`
- use a non-negative integer for `lane`; it is the vertical lane index

Edge fields:

- required: `from`, `to`, `relation`
- optional: `label`, `evidence`, `feedback`
- use a boolean for `feedback`; put feedback-loop wording in `label`

Use stable `key` values so future `merge` operations can match objects. Mark uncertain nodes with `uncertain: true` and explanatory `details`. For an unconfirmed relationship, use `relation: "unknown"`, attach available `evidence`, and put the confirmation or feedback explanation in `label`; set `feedback: true` only when the edge forms a feedback loop.

### 4. Plugin Completion

If the user gave an Obsidian vault path, ensure Advanced Canvas support before building when advanced styling is requested or helpful:

```bash
node scripts/ensure-advanced-canvas.mjs --vault <vault> --version 6.5.0
```

Use `--advanced auto` by default. Use `on` only when the vault supports Advanced Canvas and enhanced styling is desired. Use `off` when portability matters or the user asks for plain Obsidian Canvas.

### 5. Build Or Merge

Create a new Canvas:

```bash
node scripts/build-canvas.mjs --input <blueprint.json> --output <file.canvas> --mode create --advanced auto
```

Merge into an existing Canvas:

```bash
node scripts/build-canvas.mjs --input <blueprint.json> --output <file.canvas> --mode merge --advanced auto
```

Merge is conservative:

- preserve existing Canvas objects, layout, unknown fields, `metadata`, and `styleAttributes`
- add new blueprint objects when keys do not conflict
- update matched objects only when the meaning is compatible
- reject conflicts instead of overwriting ambiguous existing content
- do not delete anything unless the user gives an explicit deletion instruction

### 6. Validate

Run validation after every build:

```bash
node scripts/validate-canvas.mjs <file.canvas> --strict
```

If strict validation fails, fix the blueprint or report the exact blocker. For quick inspection during exploration, non-strict validation is allowed:

```bash
node scripts/validate-canvas.mjs <file.canvas>
```

### 7. Preview

Provide an Obsidian URI when the vault and file path are known:

```text
obsidian://open?vault=<vault-name>&file=<relative/path/to/file.canvas>
```

If the vault name or relative path is unknown, report the generated `.canvas` path and say which value is needed to form the URI.

### 8. Report

Finish with a compact report:

- output file
- mode: `create` or `merge`
- validation result
- preview URI or missing preview fields
- evidence coverage: strong / partial / weak
- explicit unknowns and conflicts
- next recommended source to confirm uncertain claims

## Quality Gate

Before finalizing, read [quality-ratchet.md](references/quality-ratchet.md) and run the checklist. At minimum confirm:

- the artifact is an Obsidian `.canvas`, not another diagram format
- the map starts from global architecture and then drills down
- confident claims have evidence, and unknowns are marked
- the blueprint follows the frozen schema
- create/merge mode matches the user's intent
- merge did not overwrite unrelated existing objects or unknown Canvas fields
- validation was run or the reason it could not run is reported

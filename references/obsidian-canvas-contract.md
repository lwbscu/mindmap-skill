# Obsidian Canvas Contract

Use this reference for the frozen MindMap v1 data contract and command interface. This file owns schema, commands, and create/merge behavior only.

## Output Format

MindMap v1 outputs Obsidian `.canvas` files only. Do not generate Mermaid, draw.io, HTML, SVG diagrams, slides, or traditional radial mind maps.

The working artifact is a blueprint JSON that is converted into `.canvas` by the provided scripts.

## Blueprint Schema

Top-level fields:

```json
{
  "schemaVersion": "1.0",
  "title": "Architecture Map",
  "language": "en",
  "nodes": [],
  "edges": []
}
```

`schemaVersion`, `nodes`, and `edges` are required. `schemaVersion` must be a string; `nodes` and `edges` must be arrays. `title` and `language` are optional strings. When present, use a language tag such as `en`, `zh-CN`, or the user's requested tag for `language`.

Node object:

```json
{
  "key": "api-server",
  "label": "API Server",
  "role": "service",
  "details": "Handles external HTTP requests.",
  "group": "Runtime",
  "rank": 20,
  "lane": 1,
  "evidence": ["src/server.ts:1", "package.json"],
  "uncertain": false
}
```

Required node fields:

- `key`: stable unique identifier; use lowercase kebab-case where possible
- `label`: short visible Canvas label
- `role`: architecture role

Optional node fields:

- `details`: concise explanation, uncertainty note, or confirmation question
- `group`: conceptual cluster
- `rank`: non-negative integer layout order hint
- `lane`: non-negative integer used as the vertical lane index
- `evidence`: array of evidence strings
- `uncertain`: boolean

Edge object:

```json
{
  "from": "api-server",
  "to": "database",
  "relation": "writes",
  "label": "retry result affects API response",
  "evidence": ["src/repository.ts:33"],
  "feedback": true
}
```

Required edge fields:

- `from`: source node key
- `to`: target node key
- `relation`: stable relation keyword

Optional edge fields:

- `label`: readable edge label
- `evidence`: array of evidence strings
- `feedback`: boolean; set `true` when the edge forms a feedback loop and put the explanation in `label`

Do not add required fields beyond this contract. Tooling may preserve or emit additional Canvas fields, but the blueprint standard remains compact.

## Canvas Enhancements

Obsidian Canvas supports base fields such as `nodes`, `edges`, positions, dimensions, colors, and text/file/link nodes. Advanced Canvas may add fields such as `metadata` or `styleAttributes`.

MindMap v1 treats `metadata` and `styleAttributes` as optional enhancements:

- preserve them during merge
- allow scripts to add them when `--advanced on` or `--advanced auto` supports it
- do not require them in blueprints
- do not reject existing Canvas files merely because they contain unknown enhancement fields

## Commands

Build a Canvas:

```bash
node scripts/build-canvas.mjs --input <blueprint.json> --output <file.canvas> --mode create|merge --advanced auto|on|off
```

Validate a Canvas:

```bash
node scripts/validate-canvas.mjs <file.canvas> [--strict]
```

Ensure Advanced Canvas plugin support in a vault:

```bash
node scripts/ensure-advanced-canvas.mjs --vault <vault> [--version 6.5.0]
```

Use exact paths in commands. Quote paths that contain spaces.

## Create Mode

Use `--mode create` when creating a new architecture map or intentionally replacing an output path after user confirmation.

Create mode should:

- generate a complete `.canvas` from the blueprint
- compute stable layout from `group`, `lane`, and `rank`
- include all blueprint nodes and edges
- include optional advanced styling only according to `--advanced`
- fail if the output path exists and replacement was not clearly intended by the user or script contract

## Merge Mode

Use `--mode merge` by default when the target `.canvas` already exists.

Merge mode must be conservative:

- preserve existing objects not mentioned by the blueprint
- preserve existing layout unless a new object needs placement
- preserve unknown fields on existing Canvas objects
- preserve `metadata` and `styleAttributes`
- match blueprint nodes by stable `key`
- match blueprint edges by `from`, `to`, and `relation`
- add new objects when there is no conflict
- refuse ambiguous conflicts instead of overwriting
- avoid deletion unless the user explicitly asks for specific removal

Conflict examples:

- same `key` but incompatible label or role
- same edge identity but contradictory relation meaning
- blueprint tries to replace a hand-positioned object with a different architectural unit
- deletion implied by omission from the blueprint

When a conflict is found, stop and report the conflict with the affected keys. Ask for direction or adjust the blueprint to avoid the conflict.

## Validation Expectations

Strict validation should confirm:

- valid JSON Canvas output
- required top-level Canvas arrays exist
- node and edge IDs are unique and connected correctly
- every edge references existing nodes
- blueprint-derived labels are non-empty
- no unsupported diagram format was emitted
- optional advanced fields do not break base Canvas compatibility

Non-strict validation is acceptable for early inspection, but final delivery should use `--strict` unless the script is unavailable. If validation cannot run, report the reason.

## Obsidian Preview URI

When vault name and relative file path are known, report:

```text
obsidian://open?vault=<vault-name>&file=<relative/path/to/file.canvas>
```

Use URL encoding when spaces or non-ASCII path characters are present. If only the absolute file path is known, report the path and ask for the vault name only if the user needs the URI.

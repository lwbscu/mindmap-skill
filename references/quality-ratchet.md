# Quality Ratchet

Use this compact gate before finalizing a MindMap blueprint or `.canvas` artifact. The goal is to keep the map useful, evidence-based, and compatible with Obsidian Canvas.

## Checklist

Run these checks in order:

1. Scope
   - The output is an Obsidian `.canvas` architecture map.
   - The subject is a model, system, repository/codebase, service, architecture proposal, or code path.
   - Unsupported formats such as Mermaid, draw.io, HTML, slides, and radial mind maps are not produced.

2. Map-first structure
   - The map starts with the global architecture before internals.
   - Primary nodes fit the system boundary and are not just a file tree.
   - Groups, lanes, and ranks reflect real architecture boundaries.

3. Evidence and uncertainty
   - Important nodes and edges include evidence when available.
   - Unknown facts are marked as `Unknown` / `待确认`; `uncertain: true` is used only on nodes.
   - Unconfirmed relationships use `relation: "unknown"` and available `evidence`; feedback loops use boolean `feedback`, with explanations in `label`.
   - No unsupported model family, protocol, owner, data flow, or runtime behavior is invented.

4. Blueprint contract
   - Top-level blueprint requires `schemaVersion`, `nodes`, and `edges`; optional `title` and `language` values are strings.
   - Nodes use required `key`, `label`, and `role`.
   - Optional node `rank` and `lane` values are non-negative integers; `lane` is the vertical lane index.
   - Edges use required `from`, `to`, and `relation`.
   - Optional edge `feedback` is boolean; feedback explanations are stored in `label`.
   - Optional fields stay within node fields `details`, `group`, `rank`, `lane`, `evidence`, `uncertain` and edge fields `label`, `evidence`, `feedback`.

5. Build behavior
   - `create` is used only for a new complete Canvas or an explicitly intended replacement.
   - `merge` preserves existing objects, layout, unknown fields, `metadata`, and `styleAttributes`.
   - Merge conflicts are rejected and reported, not overwritten.
   - No deletion is implied by an omitted blueprint object.

6. Validation and preview
   - `node scripts/validate-canvas.mjs <file.canvas> --strict` was run when scripts are available.
   - The report includes the validation result or the exact reason validation could not run.
   - An `obsidian://` preview URI is provided when vault name and relative path are known.

7. Final report
   - Output file path is clear.
   - Evidence coverage is summarized as strong, partial, or weak.
   - Unknowns and conflicts are listed.
   - The next confirmation source is specific.

## Dry-Run Prompts

Use these prompts mentally or with a reviewer when changing the skill itself.

```text
Use mindmap-skill to map this repo into an Obsidian Canvas architecture diagram.
```

Expected: collect repo path, output `.canvas` path, and operation mode; inspect architecture sources; produce a blueprint; build with `build-canvas.mjs`; validate; report evidence and unknowns.

```text
把这个现有 vault 里的 system.canvas 合并更新，不要动我手工排版。
```

Expected: use merge mode; preserve existing layout and unknown fields; reject conflicts; do not delete omitted objects; validate after merge.

```text
Generate a Mermaid graph of this service.
```

Expected: state that MindMap v1 only supports Obsidian `.canvas` architecture maps and offer to create that instead.

```text
给 GPT-Next 画一个完整内部架构图，训练数据和推理链路都补全。
```

Expected: avoid inventing proprietary internals; create only evidence-backed public architecture if sources exist; mark missing training data, routing, model internals, and feedback loops as `Unknown` / `待确认`.

```text
Create a codebase map but I only know the entrypoint, not the database or queue.
```

Expected: include the known entrypoint, mark storage and queue facts as unknown, and suggest the next source to inspect.

## Anti-Patterns

- Turning the map into a decorative brainstorming diagram.
- Emitting Mermaid, draw.io, HTML, SVG-only, or slides.
- Copying every file or class into the Canvas.
- Hiding uncertainty behind vague labels.
- Inferring advanced model classifications without sources.
- Overwriting an existing Canvas during merge.
- Dropping existing `metadata`, `styleAttributes`, or unknown fields.
- Treating optional styling as a required schema field.
- Reporting success without validation or an explicit validation blocker.

## Keep-Or-Revise Rule

Keep the artifact when it improves architectural understanding, preserves evidence, and remains easy to scan in Obsidian.

Revise when it adds unsupported claims, buries the global structure, creates format drift, weakens merge safety, or makes the next confirmation step unclear.

# Quality Ratchet

Use this gate before finalizing a MindMap diagram or app change.

## Checklist

1. Scope
   - The artifact is a MindMap interactive architecture map.
   - The subject is a model, system, repository/codebase, service, architecture proposal, or code path.
   - The work does not default to another diagram workflow.

2. Map-first structure
   - The map starts with global architecture before internals.
   - Primary nodes fit the system boundary and are not just a file tree.
   - Layers reflect real architecture boundaries.

3. Evidence and uncertainty
   - Important nodes and edges include evidence in the working notes when available.
   - Unknown facts are marked `Unknown` / `待确认`.
   - Unsupported model internals, protocols, owners, or runtime behavior are not invented.

4. Diagram contract
   - `schemaVersion` is `mindmap-app/v1`.
   - `layers`, `nodes`, and `edges` are arrays.
   - Node IDs are unique.
   - Every edge references existing nodes.
   - Runtime validator accepts every committed example.
   - Node `status` and edge `relation` values use known tags.
   - Text is large enough for whole-diagram review.
   - Arrows do not cover node titles, subtitles, or edge labels.
   - Architecture/dependency routes do not pass through non-terminal nodes or images.
   - MindMap branches use readable curved fan-out; parallel edges use separate channels.
   - Rich text compatibility fields remain synchronized and unsafe links are rejected.
   - Every image has information value, safe embedded bytes, and useful `alt` text.

5. Preview and export
   - `npm run check` passes.
   - `npm test` passes.
   - `npm run app:build` passes.
   - `npm run app:smoke` passes real Electron input checks.
   - `npm run app:visual` passes desktop, tablet, narrow, and mobile screenshot checks.
   - `npm run app:render -- examples/<name>.diagram.json` passes for the target diagram.
   - Local app preview or rendered SVG/HTML was inspected, or the blocker is reported.
   - Images and character styles appear in SVG/PNG/PDF/HTML exports; Mermaid has a readable text fallback.

6. Public release
   - No local machine paths, temporary files, generated `dist/`, or private workspace artifacts are committed.
   - GitHub Pages paths use relative URLs and work below a repository subpath.
   - README and SKILL describe the current app workflow.

## Anti-Patterns

- Turning the map into a decorative brainstorm with no evidence.
- Copying every file or class into the diagram.
- Hiding uncertainty behind vague labels.
- Using tiny text that only works when zoomed in.
- Letting arrows cross important text.
- Hand-writing many waypoints for routes the app should calculate.
- Adding blurred decorative images or images without alt text.
- Using unsafe HTML, SVG uploads, or `javascript:` links in diagram content.
- Publishing generated artifacts as source.
- Leaving obsolete workflow instructions in docs.
- Adding evidence/status metadata that is not validated by tests.

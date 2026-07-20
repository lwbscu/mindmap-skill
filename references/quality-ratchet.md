# Quality Ratchet

Use this pass/fail gate before finalizing a MindMap diagram or app change. Script success is necessary but not sufficient. Any hard failure below means the artifact is unfinished and must be relaid out, split into focused views, or reported with an explicit blocker.

## Visual Uniformity Gate

### All Views

- **Clean canvas:** the diagram background is `#ffffff`. A faint editing grid is allowed, but it must remain visually subordinate and must not appear in exports. There are no textures, decorative noise, gradients, blurred imagery, or large dark background fields.
- **Readable hierarchy:** primary node titles are 20-28px, node subtitles are 14-18px, and relation labels are 13-16px. Use at most two font families and three visible node text-size levels per view. The global diagram title/subtitle are display text and are excluded from the node scale. Primary text contrast is at least 4.5:1; route and large non-text graphics are at least 3:1.
- **Short visible copy:** titles use one line when possible and never exceed two lines. Subtitles use at most two short lines. Long evidence, implementation notes, risks, and links belong in metadata or the inspector.
- **Controlled density:** a first-pass overview has 5-15 primary nodes and normally no more than 25 visible nodes. Above that budget, add saved views, filters, collapsed branches, or a drill-down diagram instead of reducing font size.
- **Stable geometry:** use the 8px grid. Keep at least 32px between sibling node boxes, 32px inner padding inside layer bands, 56px between layer bands, and 80px between content and the canvas boundary. Same-role nodes in one row or column align within 8px and use matching heights unless content requires a documented exception.
- **Compact cards:** ordinary architecture cards are normally 300-420px wide and 88-132px high. MindMap topics are normally 180-320px wide and 56-96px high. Internal padding is 16-24px and ordinary corner radius is 8px or less. Selection, hover, badges, or loading state must not change the node's outer size.
- **Semantic color:** use white node surfaces, black/deep-gray primary text, and 3-6 restrained pastel accents for layers, roles, statuses, or risks. Do not assign colors arbitrarily, create rainbow typography, or use color as the only carrier of meaning.
- **Overview readability:** on a 1440x900 review viewport, fit-all should normally be 40% or greater. At 50%, all primary node titles and main relation labels are readable. At 30%, all text remains rendered and primary node titles remain distinguishable. If the view cannot meet this, reduce density or split it.
- **Three-second test:** within three seconds, a reviewer can identify the subject, entry, core processing path, output/data area, and risk or unknown area. Failure indicates weak hierarchy even when individual elements are valid.

Numerical values are defaults for normal architecture work. A genuine domain exception is allowed only when it is stated in the final report, does not create any collision or unreadable text, and is confirmed by screenshot review. There are no silent exceptions.

### MindMap View

- Use one visually dominant root. First-level branches fan out evenly and use the same directional grammar throughout the view.
- Prefer 3-7 first-level branches, a visible depth of four levels or fewer, and no more than nine direct children per parent. Collapse or split larger branches.
- Keep sibling spacing at 24px or greater and same-depth alignment within 12px. Branch curves must separate before reaching labels and must not cross sibling text.
- Balance a two-sided layout so one side does not carry more than roughly 30% extra visible nodes without a structural reason. A one-sided layout must use a clear top-to-bottom or left-to-right reading direction.
- A reader must be able to follow any root-to-leaf path without guessing direction or switching conceptual granularity mid-branch.

### Dependency View

- Choose one dominant direction, `LR` or `TB`, and keep it consistent. Reverse dependencies and cycles must be visibly distinguished from the primary flow.
- Group dependencies by package, runtime boundary, ownership, or deployment unit. External dependencies stay at the perimeter or in an explicit external group.
- For up to 20 visible edges, target no more than two edge crossings; for 21-60 edges, target no more than eight. If routing still forms a dense bundle, filter, group, or split the view.
- Nodes with more than six visible incoming or outgoing relations should use a hub/group treatment or a focused saved view. Cycles must be marked as a risk or otherwise made explicit.
- Parallel and reverse edges use separate channels. The overview must reveal the main dependency direction before the reader inspects labels.

### Architecture View

- Show at least three meaningful architectural regions when they exist: entry/interface, core process/service/model, and data/storage/observability/risk.
- Use 3-7 aligned layer bands for a normal overview and 2-5 primary nodes per row. Each node must be fully inside its assigned layer with at least 32px inner clearance.
- Align nodes within a layer to a shared row or column within 8px. Layer labels remain small tabs or quiet headings and never compete with the diagram title.
- Keep one dominant system flow, normally top-to-bottom or left-to-right. Cross-layer routes use layer gaps and consistent ports instead of diagonal shortcuts.
- Place external systems at the boundary or in an explicit external layer. `Unknown` and `risk` nodes remain visible and must not be disguised as confirmed modules.
- A reviewer must be able to trace at least one complete path from entry through core execution to output, storage, or success criterion.

## Routing And Label Gate

- Architecture and dependency routes use automatic orthogonal obstacle avoidance; MindMap uses automatic smooth curves.
- There are zero edge intersections with non-terminal nodes, images, titles, subtitles, badges, layer tabs, or relation-label boxes.
- Keep at least 12px visual clearance between a route and unrelated content, and at least 16px between parallel channels when the geometry allows it.
- Put relation labels on the longest clear segment with an opaque white or near-white background and 6px or more padding. Labels do not overlap other labels.
- Arrowheads are visible, consistent, and proportional: normal strokes are typically 1.5-2.5px with 8-12px arrowheads; emphasized risk or primary-flow edges may be 3-4px.
- Do not emit manual waypoints by default. A manual route is acceptable only after user confirmation and must be stored as a locked route.

## Rich Text And Media Gate

- Rich text communicates meaning. Do not mix more than two font families, use more than three text-size levels, or apply multiple accent colors to ordinary prose.
- A partial character selection changes only that selection. A collapsed caret changes subsequent input. `title`, `subtitle`, and `richText` remain synchronized.
- Node fill, border, radius, and image layout stay in the inspector; they are not character-format controls.
- Every image is informative, sharp at its rendered size, aspect-ratio preserving, safely embedded, and has useful `alt` text. Key screenshot imagery should have enough source resolution for a 2x export.
- Images do not cover titles, subtitles, status badges, ports, routes, or relation labels. Decorative, blurred, stretched, repeated, or unlabeled images fail the gate.

## Required Screenshot Review

Inspect the real app, not just JSON or DOM structure:

1. `1440x900`: inspect 100%, 50%, fit-all, node editing, and a selected route.
2. `1024x768`: inspect toolbar, both side panels, minimap, and fit-all readability.
3. `760x720`: inspect responsive drawers/panels and confirm they do not cover the active edit area.
4. `390x760`: inspect horizontal toolbar behavior, floating rich-text controls, dialogs, and canvas access.

At every size, fail on clipped text, overlapping controls, blank canvas, hidden primary nodes, edge-through-text, layer-title collisions, unexpected scrollbars, or a noisy background. `npm run app:visual` passing does not replace human inspection of these criteria.

## Export Consistency Gate

| Format | Required result |
| --- | --- |
| SVG | Exact structure, readable text, rich-text spans, labels, routes, and embedded images. |
| PNG | Same framing and hierarchy as SVG, sharp at the selected scale, with no transparent or dark background surprise. |
| PDF | No clipping, page-size overflow, visibly broken or unreadable font fallback, missing images, or shifted labels. |
| JSON | Complete `mindmap-app/v1` semantics, assets, view state, evidence, and locked-route state. |
| Read-only HTML | Opens without a server and preserves the current rendered view, images, rich text, routes, and labels. It does not claim editing interactions. |
| Editable HTML | Opens from `file://` as the complete editor, has no external dependency, preserves the whole diagram and every view/asset/rich-text/evidence/route field, accepts edits, re-exports, and imports back into MindMap. |
| Mermaid | Readable title/alt fallback for unsupported rich text or images; topology and direction remain understandable. |

Any structural difference between preview and SVG/PNG/PDF/HTML is a failure. Mermaid may degrade presentation, but it may not silently lose topology.

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
   - Text, density, spacing, alignment, color, and geometry pass the Visual Uniformity Gate.
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
   - Local app preview and the required zoom/viewports were inspected, or the exact blocker is reported.
   - Images and character styles appear in SVG/PNG/PDF/HTML exports; Mermaid has a readable text fallback.
   - `npm run app:test-editable` proves HTTP Web editing and `file://` editable-HTML edit/save/re-export round trips without any pending or skipped result.
   - Every supported output passes the Export Consistency Gate.

6. Public release
   - No local machine paths, temporary files, generated `dist/`, or private workspace artifacts are committed.
   - GitHub Pages paths use relative URLs and work below a repository subpath.
   - README and SKILL describe the current app workflow.

## Anti-Patterns

- Turning the map into a decorative brainstorm with no evidence.
- Using a dense dot grid, texture, gradient, dark field, or decorative image as the diagram background.
- Copying every file or class into the diagram.
- Hiding uncertainty behind vague labels.
- Using tiny text that only works when zoomed in.
- Shrinking the entire graph below readable overview scale instead of splitting it into focused views.
- Mixing unrelated card sizes, alignments, fonts, colors, or corner radii in one semantic layer.
- Letting arrows cross important text.
- Allowing edge bundles, label collisions, diagonal layer shortcuts, or arrows that enter the wrong side of a node.
- Hand-writing many waypoints for routes the app should calculate.
- Using rich text as decoration through rainbow colors, excessive highlighting, or font mixing.
- Adding blurred decorative images or images without alt text.
- Using unsafe HTML, SVG uploads, or `javascript:` links in diagram content.
- Publishing generated artifacts as source.
- Leaving obsolete workflow instructions in docs.
- Adding evidence/status metadata that is not validated by tests.

## Immediate Rework Conditions

Do not finalize when any of these is present:

- unreadable, hidden, clipped, or overflowing primary text at the required review zoom
- a noisy/non-white background or visually dominant editing grid
- node overlap, inconsistent layer alignment, collapsed layer padding, or uncontrolled density
- an edge through unrelated content, an ambiguous arrow direction, or a relation-label collision
- a blurred, stretched, decorative, unsafe, or missing-alt image
- rich text or media missing from SVG/PNG/PDF/HTML
- a view-specific grammar violation that makes hierarchy or direction ambiguous
- an unmarked unsupported fact or a confident relation without available evidence
- skipped validation or screenshot inspection without an explicit reported blocker

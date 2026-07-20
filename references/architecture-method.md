# Architecture Method

Use this reference to turn source material into a map-first MindMap diagram. This file owns the thinking method only; schema and render details live in `diagram-schema.md`.

## Source Triage

Start by naming the subject and evidence set:

- model: papers, model cards, eval notes, deployment notes
- system: architecture docs, configs, services, queues, databases, dashboards
- codebase: repo tree, manifests, entrypoints, package boundaries, tests, CI
- code path: caller, callee, data shape, side effects, error handling, dependencies

Separate facts from interpretation:

- Fact: directly visible in a source.
- Inference: likely from multiple sources; include evidence and cautious wording.
- Unknown: not supported; write `Unknown` or `待确认`.

Do not infer proprietary model internals, safety layers, training data, routing, owners, or protocols unless evidence says so.

## Map-First Pass

Create the first pass before deep details:

1. State the system boundary in one sentence.
2. Pick 5-15 primary nodes that explain the architecture.
3. Put user-facing or external entrypoints near the top.
4. Put core execution, model, or service nodes in the middle.
5. Put storage, observability, artifacts, and success criteria near the bottom.
6. Add only edges that explain real structure or flow.
7. Mark missing but important pieces as `Unknown` / `待确认`.

Prefer a readable incomplete map over a dense inventory.

## Composition By View

Choose one composition grammar before positioning nodes and keep it stable within the view.

### MindMap

- Establish one root and 3-7 first-level branches before adding leaves.
- Keep sibling concepts at comparable semantic depth; do not mix a subsystem, a file, and a sentence-length note at the same level.
- Prefer four visible levels or fewer. Collapse or split branches when a parent would exceed nine direct children.
- Use balanced two-sided, one-sided, or radial composition consistently. Reserve enough whitespace for curved fan-out before placing labels.

### Dependency Graph

- Select one dominant flow direction (`LR` or `TB`) from the dependency semantics.
- Place providers/upstream units before consumers/downstream units and isolate external dependencies at the perimeter.
- Group by package, runtime, ownership, or deployment boundary. Use focused views for hubs, cycles, and dense transitive relations.
- Keep reverse dependencies and cycles explicit rather than bending them into the primary direction.

### Architecture Diagram

- Build 3-7 meaningful horizontal or vertical layer bands when the evidence supports them.
- Put 2-5 primary nodes in a row, align same-role nodes, and keep node sizes consistent inside each layer.
- Place entry/interface first, core execution next, and data/storage/observability/success criteria last. Put external systems at the boundary.
- Route the main flow through layer gaps and consistent ports. Avoid diagonal shortcuts and cross-layer edge bundles.

For every view, use the numerical spacing, typography, density, routing, and screenshot criteria in `quality-ratchet.md`. When the whole system cannot fit those limits, create saved views or drill-down diagrams instead of compressing the architecture.

## Node Selection

Use one node when a concept is a stable architectural unit. Split nodes only when parts have different responsibilities, evidence, owners, data contracts, or failure modes.

Recommended roles:

- `entrypoint`: CLI, API route, UI action, webhook, scheduled job
- `interface`: API, contract, adapter, SDK, protocol boundary
- `module`: package, library, subsystem, internal component
- `service`: deployable or separately operated service
- `model`: model, agent, evaluator, scoring component
- `data`: dataset, message, event, payload, schema, feature
- `storage`: database, cache, object store, vector index, file store
- `process`: build, training, inference, sync, ingestion, deployment workflow
- `external`: third-party dependency or system outside the boundary
- `risk`: bottleneck, failure mode, security boundary, compliance concern
- `unknown`: important missing fact

Keep visible labels short. Put longer explanations in subtitles only when the text remains readable.

Recommended status tags:

- `implemented`: confirmed source-backed behavior in the current system
- `external`: separately operated dependency, runtime, model, simulator, or service
- `planned`: user-approved next-stage work or intended future integration
- `unknown`: important fact that still needs evidence
- `risk`: known constraint, failure mode, or success criterion that can regress

The renderer draws status badges and keeps metadata in the diagram JSON/export.
If a status matters to the reader, put the human label (`已实现`, `外部依赖`, `拟介入`,
`待确认`, `风险`) in the node title or subtitle as well.

## Edge Selection

Use edge relations consistently in notes and labels:

- `calls`: one component invokes another
- `reads` / `writes`: storage or data access
- `publishes` / `subscribes`: event flow
- `depends_on`: build/runtime/config dependency
- `routes`: directs traffic, decisions, or work
- `transforms`: changes data or representation
- `evaluates`: eval, scoring, review, feedback
- `guards`: validation, policy, permission, rate limit
- `observes`: logs, metrics, traces, monitoring
- `unknown`: relation exists but is not yet confirmed

Let the App reroute an arrow when it might cross a node, image, label, or layer title. Add explicit waypoints only after the user manually confirms the route, then preserve it as a locked route.

## Evidence Rules

Evidence can be compact strings:

- file path and line: `src/server.ts:42`
- command output: `rg "createServer" src`
- document section: `ADR-004 Deployment`
- user statement: `user: current service is single-tenant`
- source URL when applicable

Every important node and edge should be traceable. If evidence is partial, write cautious wording. If a fact lacks evidence, mark it `Unknown` / `待确认`.

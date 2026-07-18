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

Use explicit waypoints when an arrow might cross a node, label, or layer title.

## Evidence Rules

Evidence can be compact strings:

- file path and line: `src/server.ts:42`
- command output: `rg "createServer" src`
- document section: `ADR-004 Deployment`
- user statement: `user: current service is single-tenant`
- source URL when applicable

Every important node and edge should be traceable. If evidence is partial, write cautious wording. If a fact lacks evidence, mark it `Unknown` / `待确认`.

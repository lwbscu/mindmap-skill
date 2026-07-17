# Architecture Method

Use this reference to turn source material into a map-first Obsidian Canvas architecture blueprint. This file owns the thinking method only; schema and commands live in `obsidian-canvas-contract.md`.

## Source Triage

Start by naming the subject and evidence set:

- model: papers, model cards, system prompts, eval notes, API docs, deployment notes
- system: architecture docs, config, services, queues, databases, runbooks, dashboards
- codebase: repo tree, manifests, entrypoints, package boundaries, tests, CI, runtime config
- code path: caller, callee, data shape, side effects, error handling, external dependencies

Separate facts from interpretation:

- Fact: directly visible in a source.
- Inference: likely from multiple sources; include evidence and cautious wording.
- Unknown: not supported; write `Unknown` or `待确认`.

Do not infer proprietary model internals, advanced model classes, safety layers, training data, ranking systems, or orchestration details unless evidence says so.

## Map-First Pass

Create the first pass before deep details:

1. State the system boundary in one sentence.
2. Pick 5-15 primary nodes that explain the architecture.
3. Put user-facing or external entrypoints on the left/top.
4. Put core execution, model, or service nodes in the middle.
5. Put storage, observability, deployment, and external systems on the right/bottom.
6. Add only edges that explain real structure or flow.
7. Mark missing but important pieces as `Unknown` / `待确认`.

Prefer a readable incomplete map over a dense inventory.

## Node Selection

Use one node when a concept is a stable architectural unit. Split nodes only when the parts have different responsibilities, evidence, owners, data contracts, or failure modes.

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

Keep labels short. Put long explanations in `details`.

## Edge Selection

Use edge relations consistently:

- `calls`: one component invokes another
- `reads`: reads from storage or data
- `writes`: writes to storage or data
- `publishes`: emits events or messages
- `subscribes`: consumes events or messages
- `depends_on`: build/runtime/config dependency
- `contains`: parent-child or group relationship
- `transforms`: changes data or representation
- `routes`: directs traffic, decisions, or work
- `trains`: model/data training relationship
- `evaluates`: eval, scoring, review, feedback
- `guards`: policy, validation, safety, permission, rate limit
- `observes`: logging, metrics, tracing, monitoring
- `unknown`: relation exists but is not yet confirmed

Use `label` for human wording only when `relation` is not enough. Set `feedback: true` for loops where output changes later behavior, such as eval feedback, user correction, retraining, or retry decisions; put the feedback explanation in `label`.

## Grouping And Layout Hints

Use `group`, `lane`, and `rank` to help the builder lay out the map:

- `group`: stable conceptual cluster such as `Frontend`, `Runtime`, `Data Plane`, `Control Plane`, `Training`, `Evaluation`
- `lane`: non-negative integer used as the vertical lane index
- `rank`: non-negative integer order within a lane; lower values appear earlier

Choose layout hints from the architecture. Do not create decorative groups.

## Evidence Rules

Evidence can be compact strings:

- file path and line: `src/server.ts:42`
- command output: `rg "createServer" src`
- document section: `ADR-004 Deployment`
- user statement: `user: current service is single-tenant`
- source URL when applicable

Add evidence to important nodes and edges. If node evidence is partial, write a cautious `details` sentence. If a node lacks evidence, use `uncertain: true`.

## Uncertainty Rules

Use uncertainty deliberately:

- Create an `unknown` node for missing pieces that affect architecture understanding.
- Use `relation: "unknown"` for an unconfirmed relationship instead of inventing a protocol or call type.
- Attach available edge `evidence`; put the confirmation question in `label`.
- Set `feedback: true` only when the relationship forms a feedback loop, and put the feedback explanation in `label`.
- Put a node confirmation question in `details`, for example `Unknown: message broker type needs confirmation`.

Never hide uncertainty by using vague labels such as "magic", "AI layer", or "misc".

## Detail Ratchet

After the global map is coherent, add detail only if it improves one of these:

- explains a critical path
- clarifies a data boundary
- exposes a deployment or ownership boundary
- captures a real feedback loop
- names a meaningful risk or unknown
- helps the user decide what to inspect next

Stop before the map becomes a file tree.

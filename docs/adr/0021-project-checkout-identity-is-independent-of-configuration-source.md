# ADR 0021: Project checkout identity is independent of configuration source

## Status

Accepted. Implementation and acceptance verification remain pending.

## Decision

Ordinary local **Cross-Project Work** uses a shared **Aggregated Runtime** by default, with explicitly selected alternative **Runtime Scopes** retained. A **Project Checkout** remains the source target even when it borrows defaults from another **Project Configuration Source**. A linked worktree without local project configuration automatically falls back to its main checkout's configuration within the same Git repository; a local configuration takes precedence.

Automatic project configuration lookup stops at the repository boundary. A local worktree configuration replaces the inherited file as a whole; missing fields do not inherit from the main checkout. Parent-folder defaults require explicit selection rather than implicit cross-repository discovery.

Cross-project support covers one agent session working across several repositories, including frontend and backend portions of one feature. The caller explicitly declares a **Project Set** of labeled checkout paths for that session, with optional saved definitions for repeated work. The supported design accommodates explicit targets on individual calls, delegated agents, and native tool operations involving multiple checkouts. An agent coordinates separate calls for upstream tools that support only one project.

A checkout-specific operation requires an explicit **Project Selection** when the agent session contains multiple checkout targets. A session with one checkout retains its default, and project-independent tools may operate without selecting a checkout. A native combined operation is available only when its tool is available under every selected checkout's effective preset and filter settings. Selecting several targets does not broaden their individual configured tool visibility.

## Delegated agents and startup hooks

Worker startup hooks are part of this scope. CLI setup delivers bootstrap at both `SessionStart` and `SubagentStart` for clients with a verified compatible lifecycle contract. Each delegated agent receives the current 1MCP inspect-before-run playbook independently of full-history inheritance and an explicit **Worker Project Assignment** for its intended checkout or project set.

Hook delivery and project assignment have separate responsibilities. Codex's documented `SubagentStart` fields identify the child agent but do not include an assigned checkout, and its common `session_id` refers to the parent session. A hook must not infer a worker's source target solely from that session identity or working directory. If the assignment is available through an explicit supported handoff, bootstrap may render the corresponding project instructions. Otherwise it supplies the general playbook and marks project selection unresolved; project-specific instructions and calls are prepared after the worker explicitly selects its assigned target.

Setup preserves unrelated hooks and remains stable on repeated execution. Global and repository hook composition, inherited context, differing worker assignments, and client trust behavior require verification. Identical bootstrap delivery may be deduplicated, but a different worker target must retain its own current instructions. Startup hooks deliver bounded context and report runtime or target-resolution gaps accurately.

The implementation must demonstrate concurrent workers assigned to distinct frontend/backend repositories and distinct linked worktrees, including self-contained workers. Each worker's config provenance, effective filters, instructions, tool results, and backend/session binding must correspond to its assignment. The local template-context trust boundary remains as defined in ADR 0013.

Reference: [Official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks#subagentstart).

## Rationale

Using a configuration location as project identity can point tools at the wrong source tree. Giving every checkout its own runtime duplicates shared backend infrastructure. Keeping checkout identity independent allows shared runtime infrastructure and configuration defaults while preserving the intended source target. Explicitly selected separate Runtime Scopes remain available for workflows that need them.

## Consequences

- Config inheritance must preserve the linked worktree as the target.
- A local file replaces inherited configuration rather than merging fields.
- Repository boundaries end automatic ancestor lookup, changing the previous unbounded ancestor behavior.
- Different repositories in one feature remain distinct Project Checkouts.
- Project Set selection belongs to the calling agent session; simultaneous sessions may select different sets against the same runtime.
- Native multi-project tools receive the explicitly selected set, while the agent coordinates single-project tool calls.
- Checkout-specific calls in a multi-project session have an explicit Project Selection.
- Independent worker bootstrap is delivered through supported SubagentStart hooks, with source targeting established by explicit Worker Project Assignment.
- Combined tool availability is the intersection of the selected checkouts' effective tool visibility. Filtering remains distinct from authentication and authorization.
- A shared runtime does not by itself establish that a backend's mutable project state is safe to share.
- This decision does not change the template context trust boundary established by ADR 0013.

# Agent Brief: worktree and cross-project support

Status: accepted design; implementation and acceptance verification remain pending.

Use this brief when implementing worktree configuration inheritance, project selection, or delegated worker bootstrap. The design decision is recorded in [ADR 0021](https://github.com/1mcp-app/agent/blob/main/docs/adr/0021-project-checkout-identity-is-independent-of-configuration-source.md); domain terms are defined in [the glossary](https://github.com/1mcp-app/agent/blob/main/CONTEXT.md).

**Category:** enhancement

**Summary:** Support one agent session completing a feature across multiple repositories and linked worktrees through explicit checkout selection, inherited project defaults, correct backend/session binding, and independently delivered bootstrap instructions.

## Current behavior

The runtime already recognizes linked worktree roots, carries a single project in Request Context, hashes rendered template configurations for instance identity, and partitions CLI session caching by project context. Project configuration discovery searches all ancestors before Git-root discovery; a missing ignored worktree config loses the main checkout's defaults, while an outer config can change the detected root. There is no first-class Project Set or CLI selector independent of invocation directory. Existing MCP sessions retain prepared template bindings when a later request supplies a different context. Setup delivers rendered instructions at SessionStart but does not install SubagentStart.

## Desired behavior

- One shared local Aggregated Runtime serves ordinary Cross-Project Work; callers may explicitly select other Runtime Scopes.
- Every Project Checkout remains the source target independently of its Project Configuration Source.
- Automatic project config discovery stops at repository boundaries. A linked worktree without its own file automatically borrows the main checkout's file within the same repository. A local file replaces the inherited config as a whole.
- An agent session explicitly selects a Project Set of labeled checkout paths. Definitions can optionally be saved for later reuse. Concurrent agent sessions select their own sets.
- Individual calls and delegated agents select the intended checkout. A native multi-project tool can receive the selected set. The agent coordinates separate calls for a single-project upstream tool.
- Checkout-specific calls require an explicit Project Selection when the agent session contains multiple targets. Single-checkout sessions retain their default, and project-independent tools need no checkout target.
- Native combined calls require the tool to be available under every selected checkout's effective preset/filter settings. Filter policy remains separate from authentication and authorization.
- Changing a call's target selects the correct prepared session/backend binding. It must not reuse a binding for another checkout merely because the agent session is the same.
- Mutable upstream active-project state remains isolated where independent target addressing is unavailable. Project-independent backends may continue to share infrastructure.
- Worker startup hooks are in scope: CLI setup manages SessionStart and SubagentStart for clients with verified lifecycle support. Every subagent receives the current inspect-before-run contract independently of full-history inheritance.
- A Worker Project Assignment names each delegated agent's intended checkout or project set. The assignment is carried through the supported dispatch/bootstrap handoff, and the worker selects it before project-specific instructions or tool calls.
- A hook with no resolvable worker assignment supplies the general playbook and reports that selection is unresolved. It does not select a parent checkout from parent session identity or cwd. Existing ambiguity rules apply until an explicit selection is made.
- Bootstrap delivery respects supported client hook semantics, preserves unrelated hooks, and handles duplicate registrations, differing inherited/worker contexts, bounded output, trust, and runtime unavailability accurately.
- Index availability is reported for the selected checkout. An index for another checkout does not establish correctness for this target.

## Key interfaces

- `ResolvedProjectContext`: keep checkout root, config provenance, and effective defaults distinct.
- `ProjectConfigSchema`: preserve existing config validation and whole-file local precedence.
- `ContextData` and context validation: preserve existing single-project callers while introducing explicit project-set selection where needed.
- `ClientSurfaceAttachment` and session cache identity: target-aware attachment and stable binding for checkout or native project-set operations.
- Template Server Identity and routing: correct rendered or session-bound backend identity for the selected target; keep the existing template-context trust boundary.
- Instructions Distribution, CLI setup, and the supported worker dispatch handoff: independent worker bootstrap, explicit Worker Project Assignment, and idempotent hook composition for supported clients. Clients without an automatic assignment channel receive the general hook playbook plus an explicit worker assignment in their dispatch context.

## Acceptance criteria

- [ ] A real linked worktree without local config inherits the main checkout's settings while tools observe the linked checkout's source root.
- [ ] A local config containing only one field does not inherit missing fields from the main checkout.
- [ ] A config above a repository is not implicitly selected; nested directories inside the repository still resolve its own root/config correctly.
- [ ] Main-worktree discovery handles Git metadata layouts without assuming that the common Git directory's parent is the source checkout. An unavailable main config leaves the correct checkout target intact.
- [ ] One agent session can perform frontend and backend calls against distinct checkout roots, including linked worktrees, and each call returns evidence from the intended source tree.
- [ ] Concurrent calls and delegated workers do not change another target's prepared template binding or mutable active-project state.
- [ ] Existing single-checkout calls can still omit an explicit target, and existing nested local config behavior remains compatible within the accepted repository boundary.
- [ ] Saved project-set definitions can be selected by independent sessions without a runtime-global current-project switch.
- [ ] A native multi-project fixture receives the explicitly selected members; a single-project fixture is invoked through agent-coordinated separate calls.
- [ ] A checkout-specific call with multiple selected targets and no explicit Project Selection fails clearly with the available target labels.
- [ ] Project-independent tools remain callable without a checkout selection.
- [ ] A native combined call is rejected when its tool is excluded by any selected checkout's effective preset/filter settings, and succeeds when available for every member.
- [ ] Setup installs the managed SessionStart and SubagentStart bootstrap handlers for supported clients, preserves unrelated handlers, and is byte-stable on repeated execution. Client-specific hook input/output contracts are verified.
- [ ] Full-history and self-contained workers receive the current inspect-before-run contract; identical repeated hook delivery is handled without suppressing instructions for a different assigned target.
- [ ] A frontend worker and backend worker run concurrently in one agent session; each receives the correct config provenance, filters, instructions, and checkout-specific tool results.
- [ ] Two workers assigned to different linked worktrees of the same repository inherit the appropriate defaults while retaining distinct checkout identities and correct session/backend bindings.
- [ ] A worker assigned several projects follows explicit per-call target selection and combined-operation visibility rules.
- [ ] When hook identity/cwd belongs to the parent but the assigned checkout differs, the worker targets the assignment. When no assignment is available, bootstrap reports unresolved selection and project-specific calls require an explicit target.
- [ ] Tests cover user-global plus repository hook composition and existing unrelated SubagentStart handlers.
- [ ] Disabled/untrusted hooks and an unavailable runtime are reported as bootstrap coverage gaps; hook delivery is not claimed from a generated configuration file alone.
- [ ] A missing checkout index or unavailable runtime produces an accurate coverage-gap report rather than silently using another checkout.
- [ ] Existing runtime selection, context proof verification, authentication, and authorization retain their effective boundaries.
- [ ] Required repository verification gates pass, including documentation checks for changed user-facing contracts.

## Out of scope

- Runtime-global project switching.
- Generic runtime fan-out for single-project upstream tools.
- Automatically discovering every neighboring repository.
- Remote trust issuance or changes to the template-context trust model.
- Automatic codegraph indexing or treating another checkout's index as current source evidence.

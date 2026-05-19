# Architecture Deepening Opportunities

This note records the architecture review from 2026-05-08. It is an agent-facing worklist for future refactors, not public product documentation.

## Milestone Plan

This plan sequences the deepening work so each milestone leaves the codebase in a better state, even if later milestones are delayed. Each milestone should land with focused unit tests around the new Module Interface plus caller tests for migrated Adapters.

### Milestone 1: Runtime Identity And Context Foundations

**Goal**: remove duplicated runtime-key and request-preparation rules before changing broader capability or command paths.

**Scope**:

- Complete No.1 **Template Server Identity Module**.
- Complete No.2 **Request Context Preparation Module** for targeted inspect and REST tool listing/invocation.
- Add any missing `CONTEXT.md` terms discovered while implementing these Modules.

**Done when**:

- Template identity construction, serialization, parsing, lookup candidate order, and rendered-hash creation live behind `src/core/server/templateIdentity.ts`.
- Targeted inspect and REST tool routes use one **Request Context Preparation** path for session precedence, template registration, pending instance creation, and lazy capability refresh.
- Bare `/api/inspect` remains non-instantiating.
- Tests cover static, rendered, session-bound, routing-only, and malformed identity/context cases.

### Milestone 2: Capability And Filter Visibility

**Goal**: make visibility and routing one query surface instead of a caller responsibility.

**Scope**:

- Complete No.8 **Filter Selection Module**.
- Complete the first slice of No.5 **Capability Snapshot And Catalog Module**.
- Migrate `MetaToolProvider`, `/api/tools`, and `/api/tool-invocations` to the **Capability Catalog**.

**Done when**:

- CLI and HTTP filter inputs produce the same validated filtering intent for `preset`, `tag-filter`, `filter`, and `tags`.
- **Capability Catalog** owns **Capability Visibility**, **Capability Refresh** intent, and internal **Capability Routes** for the first migrated callers.
- Disabled-tool checks, tag/preset filtering, and schema/invoke access checks follow the same visibility path for migrated callers.
- Tests cover visible listing, schema lookup, invocation rejection, template routes, static routes, and filter selector precedence.

### Milestone 3: Config Change And Installation

**Goal**: centralize persisted configuration mutation before migrating install workflows.

**Scope**:

- Complete No.4 **Config Mutation And Reload Module** first.
- Then complete No.3 **Server Installation Workflow Module** on top of the public **Config Change** Interface.

**Done when**:

- Destructive or forced config mutations can create **Config Backups**, validate before writing, serialize writers, preserve unknown fields, and report reload outcomes.
- `mcp uninstall` and the internal remove/uninstall path use **Config Change** as the first vertical slice.
- `mcp install` and `mcp_install` use **Server Installation Workflow** for registry/direct preview and apply modes.
- Tests cover backup defaults, retention, lock timeout, reload outcomes, install conflict policy, dry-run preview, endpoint priority, and structured workflow statuses.

### Milestone 4: Streamable Transport Lifecycle

**Goal**: move Streamable HTTP continuity out of Express route control flow.

**Scope**:

- Complete No.6 **HTTP Streamable Transport Session Lifecycle Module**.
- Preserve existing HTTP behavior while exposing structured lifecycle results internally.
- Reconcile the long-lived Streamable HTTP/proxy path with **Request Context Preparation** decisions from Milestone 1.

**Done when**:

- POST, GET, and DELETE routes delegate creation, active lookup, restoration, initialize recovery, bookkeeping, disconnect cleanup, and explicit delete cleanup to `streamableSessionLifecycle`.
- `SessionService` is removed or reduced to a temporary compatibility wrapper.
- Tests cover active lookup, restore success/failure, initialize recovery, missing sessions, persistence warnings, abnormal disconnect, explicit delete, and **Template Server Instance** membership cleanup through `ServerManager.disconnectTransport()`.

### Milestone 5: Attach-Only Client Surfaces

**Goal**: make `run`, `inspect`, `instructions`, and `proxy` use one attachment model for an existing **Aggregated Runtime**.

**Scope**:

- Complete No.7 **Client Surface Attachment Module**.
- Migrate `run` and `inspect` first, then `instructions`, then `proxy` where the Interface fits.
- Keep `proxy`, `inspect`, and `run` attach-only; do not reopen the **Background Aggregated Runtime** ADR.

**Done when**:

- Runtime discovery, auth-profile lookup, **Request Context** building, context hash, session cache, REST support cache, and stale-session retry decisions live behind one Module Interface.
- `run` and `inspect` command bodies mostly format input/output and map structured attachment outcomes.
- Tests cover auth-required errors, REST endpoint support probing, MCP fallback, stale cached session retry, and filter/query propagation.

### Milestone 6: OAuth And Instructions Distribution

**Goal**: deepen the two remaining user-facing seams whose behavior spans runtime, HTTP routes, and agent setup.

**Scope**:

- Complete No.9 **OAuth Authorization Flow Module**.
- Complete No.10 **Instructions Distribution Module**.

**Done when**:

- OAuth routes no longer mutate `oauthProvider.oauthStorage` directly for consent or CLI-token flows.
- Consent, denial, token creation, backend OAuth start/restart, and dashboard facts are structured operations behind the OAuth Module Interface.
- `instructions` and `cli-setup` use one **Instructions Distribution** policy for eager inspection, disconnected server instructions, and managed startup-doc content.
- Tests cover invalid consent, selected scopes, localhost CLI token creation, backend OAuth restart, unavailable **Template Server** instructions, disconnected cached instructions, and managed startup-doc updates.

### Cross-Milestone Rules

- Do not skip the Interface tests for a deepened Module; the Interface is the test surface.
- Do not migrate every caller in the first slice unless the milestone explicitly says so.
- Preserve public command and HTTP behavior unless a milestone explicitly records a behavior change.
- Update `CONTEXT.md` when a milestone needs a new domain term.
- Add an ADR only when a milestone resolves a decision future architecture reviews should not re-litigate.

## 1. Template Server Identity Module

**Files**: `src/core/server/templateServerManager.ts`, `src/core/server/connectionResolver.ts`, `src/core/server/adapters/TemplateServerAdapter.ts`, `src/core/capabilities/lazyLoadingOrchestrator.ts`

**Problem**: template identity leaks across the runtime as `name`, `name:sessionId`, `name:renderedHash`, clean names, and outbound keys. The Seam is Shallow because callers must know key formats.

**Solution**: deepen one Module that owns template identity, lookup order, and routing.

**Accepted boundaries**:

- Treat **Template Server Identity** as the canonical owner for all template identity forms, including clean template names, rendered identities, session identities, outbound routing identities, pool identities, and cleanup/tracker identities.
- Preserve the current lookup priority as intentional behavior: session identity first, rendered identity second, and clean static name last.
- Model identity mode explicitly. Both `perClient: true` and `shareable: false` produce a session-bound identity; default shareable templates produce a shareable rendered identity.
- Start the module in `src/core/server/templateIdentity.ts` because template identity is runtime core plumbing, not a CLI or user-facing domain module.
- Use typed identity objects internally and convert to strings only at map, adapter, and transport storage boundaries.
- Let the identity module own rendered-hash creation from an already-rendered template config, but leave template rendering itself in the existing pool/preparation lifecycle.
- Keep `ClientTemplateTracker` internals on their current `templateName` plus `instanceId` relationship model in the first slice; use **Template Server Identity** only at the boundaries where tracker data becomes routing, pooling, or cleanup keys.
- Keep `ConnectionResolver` as the lookup facade for `OutboundConnections`; it should consume **Template Server Identity** candidate order instead of rebuilding key strings itself.
- Make `TemplateServerAdapter` delegate connection lookup to `ConnectionResolver` instead of building its own candidate connection keys.
- Reject `:` inside serialized identity components for runtime map keys. Treat no-colon keys as clean/static identities, exactly-one-colon keys as template routing identities, and more-than-one-colon routing keys as invalid. Pool identity serialization should be explicit rather than relying on ad hoc `split(':')` parsing.
- Fail fast when constructing or serializing identities with invalid components, but parse existing runtime map keys defensively so malformed keys can be logged and skipped during filtering.

**Implementation plan**:

1. Add `src/core/server/templateIdentity.ts` with typed identity objects, rendered-hash creation from already-rendered configs, key serialization, identity-mode resolution, and canonical lookup candidate order.
2. Add focused tests for shareable rendered identity, session-bound identity from `perClient: true`, session-bound identity from `shareable: false`, pool identity serialization, static clean identity, session-first lookup candidates, invalid component rejection, and defensive parsing of malformed runtime keys.
3. Refactor `ClientInstancePool` to use identity-owned rendered hashes and pool keys while leaving template rendering in the existing lifecycle.
4. Refactor `TemplateServerManager` to use identity mode for outbound keys and cleanup-boundary conversions.
5. Refactor `ConnectionResolver` to use canonical identity candidates while preserving it as the `OutboundConnections` lookup facade.
6. Refactor `TemplateServerAdapter` to delegate lookup and connection-key reporting through `ConnectionResolver`.
7. Keep `ClientTemplateTracker` internals unchanged for the first slice.
8. Verify resolver, adapter, pool, manager, and route direct-invocation coverage.

**Benefits**: better Locality for template bugs and more Leverage for server, lazy loading, and tool routing tests. Tests can cover shareable, per-client, and missing-session cases once.

## 2. Request Context Preparation Module

**Files**: `src/transport/http/routes/inspectRoutes.ts`, `src/transport/http/routes/toolRoutes.ts`, `src/core/server/serverManager.ts`

**Problem**: inspect and tool routes duplicate "extract context, derive session, load templates, register templates, create pending instances, refresh capabilities," with a subtle header-only session difference.

**Solution**: deepen a Module whose Interface is "prepare this request/session for template-aware routing."

**Accepted boundaries**:

- Treat **Request Context Preparation** as runtime core behavior, not an Express route helper. HTTP routes should keep transport-specific extraction and response-header writing, while the preparation module accepts normalized request context/session inputs and returns the resolved **Request Session**.
- Preserve header-only `mcp-session-id` as a routing-only **Request Session**. Tool list and invocation routes may use it to route to already-prepared template instances, but it must not render or register new **Template Server Instances** without an actual **Request Context**.
- Preserve the existing **Request Session** precedence: transport-provided session identity first, `Request Context.sessionId` second, and derived context identity last.
- Let **Request Context Preparation** own the lazy capability refresh trigger after it creates new **Template Server Instances**. Keep the actual capability rebuild behind the existing lazy-loading dependency, and skip refresh for routing-only sessions or requests that only touch already-prepared template instances.
- Return a structured preparation result rather than only `sessionId | undefined`, so callers and tests can distinguish no context, routing-only session, already-prepared context, and newly-created template instances without inferring behavior from a nullable string.
- When a real **Request Context** is present, register missing **Template Server** adapters for the rendered template set even if every **Template Server Instance** for the resolved **Request Session** already exists. Registration is part of template-aware routing and inspection; instance creation remains limited to pending templates.
- Keep bare `/api/inspect` listings non-instantiating. They should not run **Request Context Preparation** even when request context data is present; they may list declared **Template Servers** without creating **Template Server Instances**.
- Let targeted `/api/inspect?target=...` use a header-only `mcp-session-id` as a routing-only **Request Session**, matching `/api/tools`. This may resolve already-prepared session-specific template connections, but still must not create **Template Server Instances** without a real **Request Context**.
- Include the stdio proxy path in the design: proxy is a **Client Surface** that carries **Request Context** in MCP `_meta` over Streamable HTTP, and Streamable HTTP session creation currently prepares contextual templates through `ServerManager.connectTransport`.
- Migrate both REST template-aware surfaces in the first implementation slice: targeted inspect and tool list/invocation should call the same **Request Context Preparation** module, while bare inspect listings keep their non-instantiating path. Treat Streamable HTTP/proxy integration as a second slice unless the first slice exposes a clear compatibility wrapper for `ServerManager.connectTransport`.
- Give the module a narrow runtime dependency object rather than the full `ServerManager`. The route layer may adapt from `ServerManager` initially, but the preparation module should depend only on rendered-template loading, template manager operations, template adapter registration, outbound client/transport access, and lazy capability refresh.
- Keep unexpected preparation failures as thrown errors in the first slice, preserving current route-level 500 handling. The structured preparation result should describe successful preparation/routing states, not replace route input validation or introduce a new error transport contract.

**Implementation plan**:

1. Add `src/core/server/requestContextPreparation.ts` with normalized inputs, structured successful result states, session precedence resolution, template adapter registration, pending-template creation, ephemeral-session touch, and lazy capability refresh ownership.
2. Add focused module tests for no context, routing-only header session, derived session, header-over-context precedence, pending template creation, already-prepared template touch, adapter registration without duplicate instance creation, and refresh-only-after-new-instances.
3. Migrate targeted inspect plus `/api/tools` list/invocation to the shared module, preserving bare `/api/inspect` as non-instantiating and adding route tests for targeted inspect header-only routing.
4. Audit `ServerManager.connectTransport` and Streamable HTTP session creation for the proxy path. Either adapt it to the shared preparation module in a second slice or document why long-lived MCP transport initialization keeps a separate preparation path.

**Benefits**: the ordering facts move behind one Seam. Tests become focused on context present or absent, header-only session, pending templates, lazy refresh, targeted inspect routing, REST/proxy consistency, and long-lived Streamable HTTP session compatibility.

## 3. Server Installation Workflow Module

**Files**: `src/commands/mcp/install.ts`, `src/core/tools/internal/installationHandlers.ts`, `src/core/tools/internal/adapters/installationAdapter.ts`, `src/domains/server-management/serverInstallationService.ts`

**Problem**: CLI and internal MCP tools repeat install, persist, reload, validation, and result-shaping behavior. The Adapter is Shallow by the deletion test.

**Solution**: deepen one **Server Installation Workflow** Module; CLI and internal tools become formatting Adapters.

**Accepted boundaries**:

- Treat **Server Installation Workflow** as the canonical owner for resolving registry or direct-install input into an installable **Configured Server Target** plus structured installation facts. It owns validation, registry/package resolution, local-name derivation, conflict policy, and result shaping, but delegates persisted config writes, backups, and reload observation to **Config Change**.
- Keep this opportunity install-only. Registry install, direct package/config install, force/conflict policy, dry-run preview, structured install result, and handoff to **Config Change** are in scope; update, uninstall, and list workflows remain separate concerns.
- Expose one normalized workflow input with explicit source variants. Use a `registry` source for registry-id/version/local-name inputs and a `direct` source for package, command, URL, transport, environment, and argument inputs. Do not let `name` ambiguously mean both local configured-server name and registry server id.
- Return registry prerequisite metadata as first-class non-blocking workflow output. Registry lookup and endpoint selection failures fail the workflow, but prerequisite extraction failures should become warnings when a valid **Configured Server Target** can still be produced.
- Resolve install conflicts against **Configured Server Target** names, not only static `mcpServers` names. Installs create or replace static `mcpServers` entries in the first slice. If the requested local name collides with a **Template Server** in `mcpTemplates`, return a clear conflict even when `force` is set; the caller should choose another local name or use a future template-edit workflow. If the local name collides only with a static `mcpServers` entry, `force` may replace that static target through **Config Change**.
- Make dry-run a real workflow preview, not a CLI-only string formatter. Dry-run should perform validation, registry lookup, endpoint selection, local-name derivation, conflict detection, and **Configured Server Target** generation, then return a structured preview without invoking **Config Change**.
- Expose one workflow entrypoint with `mode: 'preview' | 'apply'` rather than separate planning and execution APIs. Both modes share validation, resolution, target generation, and conflict handling; only apply mode invokes **Config Change** and includes its result.
- Land the workflow in `src/domains/installation/serverInstallationWorkflow.ts`, alongside the existing install-specific validators, metadata extraction, defaults, and configurators. Keep `src/domains/server-management/serverInstallationService.ts` as a compatibility facade for old update, uninstall, list, and migrated install callers during the transition.
- Give the workflow narrow dependency ports instead of letting it create singletons internally. The core workflow should receive ports for registry lookup/search, configured-target conflict lookup, **Config Change** apply, and optional progress events; CLI and internal-tool factory helpers may wire those ports from `ConfigContext`, `createRegistryClient()`, and progress tracking.
- Wait for the real **Config Change** module before migrating install persistence. Do not introduce a temporary install-only adapter over existing config helpers; apply mode should use the public **Config Change** API once No.4 exists.
- Treat No.3 implementation as blocked on No.4. Do not implement a preview-only workflow before **Config Change** exists, because preview conflict lookup and apply persistence should share the same configured-target resolution model.
- Return expected install outcomes as structured statuses rather than thrown exceptions. Use statuses such as `preview`, `applied`, `exists`, `template_conflict`, `invalid_input`, `not_found`, and `registry_unavailable`; reserve thrown exceptions for programmer errors and unexpected port failures. CLI adapters may turn non-success statuses into exit-code failures, while internal MCP tools should format the same statuses as JSON results.
- Extend the `mcp_install` output schema to expose the workflow status vocabulary directly when No.3 is implemented. Do not collapse statuses such as `template_conflict`, `invalid_input`, or `registry_unavailable` into a generic `failed` result.
- Validate `direct` sources strictly by transport shape. A direct static `stdio` target requires `command` and may include args, env, cwd, and restart fields; direct `http` and `sse` targets require `url` and may include headers. Treat `package` as metadata or an explicit convenience for building an `npx` command, not as the discriminator for whether an install is direct. Invalid combinations should return `invalid_input` with field-level messages.
- Preserve the current registry endpoint priority as the default: packages before remotes, `npm` package before other packages, `streamable-http` remote before other remotes, then first available endpoint. Workflow inputs may express a preferred endpoint or installation method, but only among endpoints present in registry metadata. Unsatisfied required preferences should return `invalid_input`; optional preferences may warn and fall back to the default priority.
- Return installation metadata in the workflow result for CLI and internal-tool formatting, but defer persisted metadata shape. Do not write `_metadata`, `_registry`, or a new metadata field into generated **Configured Server Targets** in the first slice; reconcile the persisted metadata contract separately before storing it in config.

**Implementation plan**:

1. Land No.4 first so the public **Config Change** API owns configured-target mutation, backup, validation, and reload observation.
2. Add `src/domains/installation/serverInstallationWorkflow.ts` with normalized source inputs, preview/apply modes, narrow ports, endpoint selection, prerequisite extraction, direct-config generation, static-only conflict policy, transport-shaped direct validation, result-only installation metadata, and structured statuses.
3. Add focused workflow tests for registry success, endpoint priority and preference handling, direct stdio/http/sse success, invalid direct source combinations, result-only metadata, real dry-run preview, static conflict without force, static replacement with force, template collision refusal, registry not found, registry unavailable, prerequisite extraction warning, and unexpected port failure.
4. Migrate `mcp install` direct and interactive execution paths to the workflow result while keeping terminal progress and display formatting in the CLI layer. Do not redesign wizard search, selection, or configuration prompts in this slice; the wizard should hand its final selection to the shared workflow.
5. Migrate `mcp_install` and `ServerInstallationAdapter.installServer` to the workflow while leaving update, uninstall, and list methods on the existing compatibility adapter. Extend `McpInstallOutputSchema` to expose workflow statuses directly.
6. Keep `src/domains/server-management/serverInstallationService.ts` as a compatibility facade during the first slice; remove or shrink its install-specific logic only after both CLI and internal install callers use the workflow.

**Benefits**: stronger Locality for install semantics and better Leverage across human CLI and MCP tool callers. Tests can target force, dry-run, registry failure, direct package, and reload once.

## 4. Config Mutation And Reload Module

**Files**: `src/commands/shared/baseConfigUtils.ts`, `src/core/tools/internal/adapters/management/managementAdapter.ts`, `src/core/tools/internal/adapters/installation/directInstallation.ts`, `src/commands/mcp/uninstall.ts`

**Problem**: config read, write, backup, and reload are scattered through globals and file helpers. Reload has weak Locality because callers cannot observe what actually happened.

**Solution**: deepen a Module around add, update, remove, backup, and reload results.

**Accepted boundaries**:

- Treat a config change as the persisted mutation plus the observable reload outcome for the affected runtime scope.
- Target both static servers and template server definitions; resolve existing duplicate names with template-first precedence.
- Make backups caller-controlled, defaulting to backups for destructive operations and forced overwrites.
- After a backup is created, apply backup retention opportunistically: keep the latest 10 matching backups per config file and also support a configurable maximum age, defaulting to 30 days, from `config.toml`.
- When both backup retention rules are active, delete a backup if either rule expires it: outside the latest 10 for that config file, or older than the configured maximum age.
- Do not automatically roll back a persisted config change when reload fails. Report persistence and reload as separate outcomes; restore remains an explicit backup-driven action.
- Validate the requested configured-server target before mutation, then validate the full resulting config document before writing. Reload failures are reported after a successful write, not treated as write failures.
- Preserve unknown top-level and server-level config fields when writing. A config change is not a config migration unless explicitly requested.
- Expose explicit high-level methods for add, update, remove, backup, and reload-facing operations, backed by a shared internal pipeline. Avoid a generic public config-operation DSL.
- Land the module under a domain area such as `src/domains/config-change/`. Keep `src/commands/shared/baseConfigUtils.ts` as a compatibility wrapper during migration rather than the long-term owner.
- Observe runtime reload through a port boundary. Internal MCP tools can use in-process reload; CLI commands should discover the aggregated runtime for the same runtime scope and request reload when available. Report outcomes such as observed, runtime not running, reload disabled, and reload failed.
- Serialize writers with a per-config-file lock around read, backup, mutate, validate, write, and backup-retention cleanup. Release the lock before reload observation, and fail with a clear timeout result rather than waiting indefinitely.
- Treat backup creation failure as a hard failure when backup is required or requested. Treat backup-retention cleanup failure as a non-blocking warning on an otherwise successful config change.
- Migrate callers incrementally. Use `mcp uninstall` and the internal remove/uninstall path as the first vertical slice before expanding to install, update, enable, disable, and tool-specific config edits.
- Return stable structured results from high-level methods, with fields for status, operation, config path, target, changed state, backup, retention cleanup, reload outcome, and warnings. CLI and internal tools should format from this result instead of inferring facts independently.

**Implementation plan**:

1. Add `src/domains/config-change/` with the public result types, explicit high-level operations, shared mutation pipeline, per-config-file lock, backup creation, backup-retention cleanup, validation hooks, and reload-observation port.
2. Implement backup retention as an opportunistic post-backup cleanup using latest-10-per-config-file plus configurable max-age rules from `config.toml`.
3. Migrate `mcp uninstall` and the internal remove/uninstall path as the first vertical slice, leaving existing shared config helpers as compatibility wrappers during migration.
4. Add focused tests for destructive backup defaults, forced-overwrite backup behavior, retention OR semantics, lock timeout behavior, validation-before-write, preservation of unknown fields, reload outcomes, and non-blocking retention cleanup warnings.
5. Expand the module to install, update, enable, disable, and tool-specific config edits once the uninstall/remove slice is stable.

**Benefits**: one Seam for config mutation, structured reload facts, less singleton mocking, and cleaner filesystem tests.

## 5. Capability Snapshot And Catalog Module

**Files**: `src/core/capabilities/capabilityAggregator.ts`, `src/core/capabilities/asyncLoadingOrchestrator.ts`, `src/core/capabilities/metaToolProvider.ts`, `src/core/capabilities/toolRegistry.ts`

**Problem**: callers must know to refresh capabilities, rebuild registries, apply session filters, and suppress notifications in the right order.

**Solution**: deepen snapshot and catalog behavior around "refresh and return visible capabilities plus routing facts."

**Accepted boundaries**:

- Treat **Capability Snapshot** as the raw point-in-time aggregate of tools, resources, prompts, and ready servers from backend servers before request-specific visibility rules are applied.
- Treat **Capability Catalog** as the visibility-aware query surface for tools, resources, prompts, server lists, and routing facts that are visible to a **Client Surface** for a **Request Session** and filter context.
- Let callers ask the **Capability Catalog** for visible results instead of separately refreshing capabilities, rebuilding the tool registry, applying tag/preset/session filters, applying disabled-tool filtering, normalizing template server names, and deciding whether list-changed notifications should be suppressed.
- Let **Capability Catalog** own **Capability Refresh** policy through explicit per-call intent such as `never`, `ifStale`, or `force`. Callers should not manually sequence refresh followed by a separate registry/catalog query.
- Return refresh/change facts alongside visible query results so request-context preparation, async server readiness, config changes, and REST/MCP callers can tell whether the underlying **Capability Snapshot** changed and whether list-changed notifications are appropriate for the current **Client Surface**.
- Return internal **Capability Routes** with visible capability entries so REST routes, meta-tools, and MCP handlers do not separately rediscover clean-name, rendered-hash, session-key, and static-server resolution rules.
- Keep public capability output on clean names. **Capability Routes** are runtime facts for invocation and schema lookup, not client-visible server identifiers.
- Treat disabled-tool rules, tag/preset filters, and session/template availability as inputs into **Capability Visibility**. The **Capability Catalog** should both omit invisible tools from listings and reject schema lookup or invocation through the same visibility path.
- Remove caller-specific splits between `filterDisabledTools()` for list paths and `getDisabledToolError()` for invocation paths as callers migrate to the **Capability Catalog**.
- Start with a narrow vertical slice. Add `src/core/capabilities/capabilityCatalog.ts`, keep `CapabilityAggregator`, `ToolRegistry`, and `MetaToolProvider` as internal collaborators, and migrate `MetaToolProvider`, `/api/tools`, and `/api/tool-invocations` before broadening to MCP protocol handlers or notification flows.
- Leave direct MCP protocol list/call handlers, async server-loaded notifications, and config-change notification migration for a second slice once the **Capability Catalog** contract has proven its visible-query, routing, refresh, and access-check shape.
- Expose explicit workflow methods instead of a generic catalog query DSL. First-slice methods should be shaped around real caller needs such as listing visible tools, describing a visible tool, invoking a visible tool, returning MCP-style visible capabilities, and refreshing/querying with change facts where needed.
- Keep meta-tool output schemas on public clean server/tool fields in the first slice. Internal **Capability Routes** should not leak into `tool_list`, `tool_schema`, or `tool_invoke` responses.

**Implementation plan**:

1. Add `src/core/capabilities/capabilityCatalog.ts` with public result types for visible capability entries, internal **Capability Routes**, **Capability Refresh** intent, refresh/change facts, and visibility/access errors.
2. Add focused catalog tests before caller migration: visible tool listing, server/tag/session filtering, disabled-tool omission, disabled schema/invoke rejection, static-server route handles, template rendered-hash route handles, per-client session route handles, refresh `never`/`force` behavior, and public clean-name output.
3. Implement the first catalog slice around existing collaborators. Reuse `CapabilityAggregator` for **Capability Snapshot** rebuilds, `ToolRegistry` for lightweight metadata where it still helps, `ConnectionResolver` for route lookup during the transition, and `SchemaCache`/schema loading for describe flows.
4. Migrate `MetaToolProvider` to call the **Capability Catalog** for `tool_list`, `tool_schema`, and `tool_invoke` while preserving the current meta-tool input/output schemas and structured error shape.
5. Migrate REST `/api/tools` and `/api/tool-invocations` to the **Capability Catalog**, removing route-local disabled-tool checks, direct `ToolRegistry.fromToolsMap(...)` fallback behavior where catalog output can cover it, and duplicate clean-name/template-key resolution.
6. Keep direct MCP protocol handlers, `AsyncLoadingOrchestrator` notification handling, `ConfigChangeHandler` notifications, and broad `LazyLoadingOrchestrator` cleanup for a second slice. Add adapter shims in the first slice only when needed to keep existing behavior stable.
7. Verify with targeted tests for `capabilityCatalog`, `metaToolProvider`, `lazyLoadingOrchestrator`, and `apiRoutes`, plus template-server clean-name coverage that exercises list, describe, and invoke paths through the catalog.

**Benefits**: higher Leverage for lazy loading and async loading tests; better Locality for clean-name/hash-key and filtering bugs.

## 6. HTTP Streamable Transport Session Lifecycle Module

**Files**: `src/transport/http/routes/streamableHttpRoutes.ts`, `src/transport/http/utils/sessionService.ts`, `src/transport/http/restorableStreamableTransport.ts`

**Problem**: route code owns **Streamable Transport Session** creation, initialize-only recovery, persistence warnings, restoration, response storage, and error rules. The route Module is Shallow.

**Solution**: deepen **Streamable Transport Session** lifecycle resolution so routes mostly delegate.

**Accepted boundaries**:

- Treat **Streamable Transport Session Lifecycle** as the owner of the incoming-request decision tree for Streamable HTTP transport continuity. It resolves whether a request should create a new **Streamable Transport Session**, use an active transport, restore a persisted session, recover an unknown session through an initialize request, return a missing-session result, or fail.
- Keep Express route handlers as HTTP adapters. Routes should extract HTTP method, `mcp-session-id`, request body, validated tag/filter inputs, custom template, and `_meta` **Request Context**, then map structured lifecycle results to HTTP responses and SDK `handleRequest` calls.
- Return structured lifecycle outcomes such as `created`, `found`, `restored`, `initialize_recovered`, `missing`, `invalid_request`, and `failed` instead of making routes infer lifecycle state from nullable transports or thrown errors.
- Land the first slice in `src/transport/http/streamableSessionLifecycle.ts` because **Streamable Transport Session** is a transport concept, not a general runtime domain module.
- Give the module narrow dependency ports rather than the full route environment. It should receive ports for active transport lookup/connect/disconnect, session repository access, optional async notification initialization, transport construction, and lifecycle diagnostics.
- Keep the current SDK-internal restoration mechanism in the first slice, but isolate it behind a narrow compatibility helper or port. The first slice should not redesign the MCP SDK restoration handshake; it should make success, missing initialize-response data, connection failure, and SDK-internal access failure directly testable.
- Keep `transport.handleRequest(req, res, body)` in the route adapter because Express response streaming belongs at the HTTP boundary. Move post-handle initialize bookkeeping into **Streamable Transport Session Lifecycle** through an explicit method such as `recordHandledRequest`, so initialize-response persistence stays with the restoration prerequisites.
- Own cleanup entrypoints while preserving the current semantic split. Abnormal stream disconnect and transport `onclose` should disconnect only the active transport and preserve persisted **Streamable Transport Session** state for reconnect; explicit DELETE should delete persisted lifecycle state after the SDK DELETE request is handled.
- Preserve the relationship between **Streamable Transport Session** cleanup and pooled **Template Server Instances**. Disconnecting or deleting a **Streamable Transport Session** must remove that session from any associated **Template Server Instances**; instances with no remaining sessions become idle and are released later by the existing template instance idle-cleanup path.
- Back the lifecycle active-transport cleanup port with `ServerManager.disconnectTransport()` in the first slice. Do not make **Streamable Transport Session Lifecycle** depend directly on `TemplateServerManager` or `ClientInstancePool`; the template-pool release invariant should stay centralized behind the existing server-manager cleanup path.
- Preserve first-slice HTTP error mapping while exposing richer internal lifecycle results. Missing sessions and restore-unavailable states should keep the current route-level 404 behavior for GET/DELETE, unknown non-initialize POST should keep the initialize-first 404, missing `mcp-session-id` on GET/DELETE should remain 400, and unexpected port/programmer failures should remain 500. Internal results should still distinguish reasons such as `not_found`, `missing_initialize_response`, `connection_failed`, and `sdk_restore_failed` for unit tests and diagnostics.
- Absorb the current `SessionService` responsibilities into **Streamable Transport Session Lifecycle** instead of keeping two overlapping lifecycle abstractions. Delete `src/transport/http/utils/sessionService.ts` in the first slice if migration stays small; keep only a temporary compatibility wrapper if route/test wiring needs an intermediate step.

**Benefits**: direct tests for unknown session, initialize recovery, restoration, and persistence without Express-heavy setup.

**Implementation plan**:

1. Add `src/transport/http/streamableSessionLifecycle.ts` with structured lifecycle results, narrow dependency ports, normal/restorable transport construction, active lookup, creation, restoration, initialize recovery, post-handle initialize bookkeeping, and cleanup/delete entrypoints.
2. Add focused lifecycle unit tests for generated-session POST creation, provided-session initialize recovery, unknown non-initialize POST, active transport lookup, persisted restoration success, missing initialize-response data, connection failure, SDK-internal restore failure, GET/DELETE missing session ID, persistence warnings, record-handled initialize storage, abnormal disconnect preserving persisted state, explicit delete removing persisted state, and active cleanup calling the `ServerManager.disconnectTransport()` port.
3. Migrate POST, GET, and DELETE in `streamableHttpRoutes.ts` together so routes become HTTP adapters that extract inputs, map lifecycle results to existing HTTP responses, call `transport.handleRequest`, wire disconnect listeners, and call `recordHandledRequest` or delete cleanup at the right time.
4. Delete `src/transport/http/utils/sessionService.ts` and migrate its tests to `streamableSessionLifecycle.test.ts` if the route migration remains small; otherwise keep a temporary compatibility wrapper for one slice only.
5. Preserve existing public HTTP behavior and verify with `streamableHttpRoutes`, `streamableSessionLifecycle`, `streamableSessionRepository`, `restorableStreamableTransport`, and targeted session-restoration e2e coverage.

## 7. Client Surface Attachment Module

**Files**: `src/commands/run/run.ts`, `src/commands/inspect/inspect.ts`, `src/commands/proxy/proxy.ts`, `src/commands/shared/serveTargetResolver.ts`, `src/commands/shared/apiClient.ts`, `src/commands/shared/serveClient.ts`

**Problem**: `run` and `inspect` each own a large part of **Client Surface** attachment behavior: runtime discovery, project-context resolution, **Request Context** construction, auth-profile loading, REST-vs-MCP selection, cached **Streamable Transport Session** reuse, stale-session recovery, and session-cache updates. `proxy` uses some of the same discovery and **Request Context** setup, but has its own filtering and session identity path. The current command Modules are Shallow because callers must know protocol fallback, cache, auth, and context-ordering details.

**Solution**: deepen a **Client Surface Attachment** Module whose Interface prepares a command to communicate with an **Aggregated Runtime** and returns structured attachment facts. Commands should declare their **Client Surface**, desired protocol behavior, filtering inputs, and whether they need a fresh or reusable **Streamable Transport Session**; the module should own discovery, auth profile lookup, context hashing, cache read/write/delete, REST support facts, and stale-session retry decisions.

**Benefits**: better Locality for attach-only command bugs and more Leverage across `run`, `inspect`, `instructions`, and `proxy`. Tests can cover runtime discovery, auth, **Request Context** hashing, REST support cache, MCP fallback, and stale-session recovery once instead of repeating command-heavy mocks.

## 8. Filter Selection Module

**Files**: `src/commands/serve/serve.ts`, `src/transport/http/middlewares/tagsExtractor.ts`, `src/transport/http/middlewares/scopeAuthMiddleware.ts`, `src/core/filtering/filteringService.ts`, `src/core/filtering/templateFilteringService.ts`, `src/domains/preset/manager/presetManager.ts`, `src/commands/mcp/tokens.ts`

**Problem**: `preset`, `tag-filter`, `filter`, and `tags` are parsed, normalized, prioritized, and validated in several places. HTTP middleware writes partial facts into `res.locals`, scope validation re-extracts tags from expressions, `serve` handles preset environment variables separately, and token/listing paths evaluate filters again. The Interface leaks filtering priority, legacy compatibility rules, validated tags, preset JSON queries, and advanced-expression conversion.

**Solution**: deepen one **Filter Selection** Module whose Interface is "turn command or HTTP query inputs into a validated filtering intent." The module should own selector precedence, preset resolution, tag sanitization, legacy `filter` compatibility, requested-tag extraction for scope checks, and conversion into the `InboundConnectionConfig` fields consumed by runtime filtering. HTTP middleware and CLI commands become Adapters that map inputs and errors.

**Benefits**: stronger Locality for tag and preset behavior, plus more Leverage for **Capability Visibility**, **Request Context Preparation**, and **Streamable Transport Session** persistence tests. It also reduces the chance that `serve`, REST, SSE, token tooling, and template filtering disagree about the same selector.

## 9. OAuth Authorization Flow Module

**Files**: `src/auth/sdkOAuthServerProvider.ts`, `src/auth/storage/oauthStorageService.ts`, `src/transport/http/routes/oauthRoutes.ts`, `src/transport/http/routes/cliTokenRoute.ts`, `src/transport/http/middlewares/scopeAuthMiddleware.ts`

**Problem**: `SDKOAuthServerProvider` owns SDK OAuth hooks, authorization-code exchange, token verification, token revocation, consent rendering, and storage construction, but HTTP routes still reach into `oauthProvider.oauthStorage` for consent approval/denial and CLI-token creation. The route layer also owns parts of OAuth dashboard status, server reconnect initiation, and HTML rendering. The seam is real, but under-deepened: callers still know repository keys, token creation details, and consent-processing order.

**Solution**: deepen the existing OAuth Module so routes ask it for structured authorization-flow operations: submit consent, deny consent, create localhost CLI tokens, summarize backend OAuth status, start or restart backend OAuth, and render or return consent/dashboard view models. Keep Express routes as HTTP Adapters and keep SDK-specific provider methods behind the OAuth Module's public Interface.

**Benefits**: better Locality for security-sensitive token and consent behavior, with more Leverage for tests around invalid consent requests, selected scopes, localhost CLI token generation, token TTL, audit events, backend OAuth restart, and route error mapping. It narrows the Interface that can mutate OAuth storage directly.

## 10. Instructions Distribution Module

**Files**: `src/commands/instructions/instructions.ts`, `src/commands/cliSetup/setupFiles.ts`, `src/core/instructions/instructionAggregator.ts`, `src/commands/inspect/inspect.ts`

**Problem**: instruction behavior is split between runtime aggregation, `instructions` command formatting, `inspect` fallback behavior, and startup-doc/hook setup. The tricky behavior is distribution, not only template rendering: which **Client Surface** should receive which instructions, when to eager-inspect unavailable **Template Servers**, how disconnected server instructions are carried from server listings, and how managed startup references stay current.

**Solution**: deepen an **Instructions Distribution** Module that owns instruction collection policy and managed startup-doc content for agent clients. Runtime inspection should provide server facts; the module should decide which server details require eager inspection, how unavailable or disconnected server instructions are represented, and what managed bootstrap content gets written for each supported client. `instructions` and `cli-setup` remain formatting/file-writing Adapters.

**Benefits**: better Locality for agent bootstrap regressions and more Leverage for tests covering unavailable template instructions, disconnected server cached instructions, global vs repo-scoped startup docs, managed block updates, and **Client Surface**-specific playbooks.

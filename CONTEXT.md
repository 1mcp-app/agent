# 1MCP Runtime Context

This context names the domain concepts used inside the 1MCP runtime. It exists so architecture work can talk about runtime behavior without falling back to file names or generic transport language.

## Language

**Aggregated Runtime**:
The long-lived `1mcp serve` process that owns server lifecycle, client routing, filtering, instructions, and backend MCP server access.
_Avoid_: proxy server, HTTP wrapper

**Background Aggregated Runtime**:
An **Aggregated Runtime** started by `1mcp serve --background` that keeps running after the invoking terminal command returns.
_Avoid_: auto-started proxy, implicit inspect server

**Runtime Scope**:
The configuration directory that defines which **Aggregated Runtime** instance a command should discover, start, or manage.
_Avoid_: global lock, machine singleton

**Client Surface**:
A way callers interact with the **Aggregated Runtime**, such as CLI mode, direct HTTP MCP, REST inspection routes, or stdio proxy.
_Avoid_: frontend, API layer

**Client Surface Attachment**:
The process that prepares a **Client Surface** to communicate with an **Aggregated Runtime** using the appropriate **Request Context**, authentication, filters, and transport-session behavior.
_Avoid_: command setup, connection helper, proxy setup

**Request Context**:
Project, user, environment, and optional transport data supplied by a caller so the **Aggregated Runtime** can resolve contextual behavior.
_Avoid_: metadata, payload extras

**Request Session**:
The runtime identity used to associate a request or client connection with template rendering or routing.
_Avoid_: HTTP session, connection id

**Streamable Transport Session**:
The MCP Streamable HTTP session identified by `mcp-session-id` for transport continuity, request handling, restoration, and explicit deletion.
_Avoid_: HTTP session, Request Session, connection id

**Streamable Transport Session Lifecycle**:
The transport-level process that resolves creation, active use, restoration, initialize recovery, and deletion for a **Streamable Transport Session**.
_Avoid_: route session handling, HTTP route logic

**Template Server**:
An MCP server definition that is rendered from a **Request Context** instead of being fully fixed at startup.
_Avoid_: dynamic server, generated server

**Template Server Instance**:
A connected backend server created from a rendered **Template Server** for one or more **Request Sessions**.
_Avoid_: spawned template, dynamic connection

**Template Server Identity**:
The canonical runtime identity of a **Template Server** or **Template Server Instance** across lookup, routing, pooling, and cleanup.
_Avoid_: server key, connection key, instance key

**Configured Server Target**:
A static server definition or **Template Server** definition addressed by a **Config Change** before runtime rendering.
_Avoid_: server config, target config, raw server

**Request Context Preparation**:
The runtime step that resolves a **Request Context** and **Request Session**, renders matching **Template Servers**, registers them for routing, and refreshes lazy capabilities when needed.
_Avoid_: request setup, context init

**Capability Snapshot**:
A point-in-time view of tools, resources, and prompts available from ready backend servers before request-specific visibility rules are applied.
_Avoid_: current capabilities, aggregate cache

**Capability Catalog**:
The queryable runtime view that returns capabilities visible to a **Client Surface** for a **Request Session** and filter context.
_Avoid_: tool registry, registry cache, meta-tool list

**Capability Refresh**:
The runtime act of rebuilding the **Capability Snapshot** after backend server availability, configuration, or template-instance changes.
_Avoid_: registry rebuild, manual refresh, recache

**Capability Route**:
The internal routing fact that connects a visible capability to the backend server or **Template Server Identity** that should handle it for a **Request Session**.
_Avoid_: connection key, hash key, registry entry

**Capability Visibility**:
The runtime rule that determines whether a capability is visible and callable for a **Client Surface**, **Request Session**, and filter context.
_Avoid_: disabled-tool filter, allowed servers, tool allowlist

**Filter Selection**:
The process that resolves filtering inputs from a **Client Surface** into one validated filtering intent for runtime visibility and routing.
_Avoid_: tag parsing, query parsing, selector precedence

**Server Candidate Set**:
The static servers and session-available **Template Server Instances** that can be filtered for one **Request Session**.
_Avoid_: static server list, template server list, filtered server type

**OAuth Authorization Flow**:
The security-sensitive process that turns authorization requests, consent decisions, and localhost CLI token requests into OAuth redirects, authorization codes, and access tokens.
_Avoid_: OAuth route logic, storage mutation, token helper

**Instructions Distribution**:
The policy that decides how server instructions and managed agent bootstrap content are collected and delivered to a **Client Surface**.
_Avoid_: instruction formatting, template rendering, setup file writing

**Config Change**:
A persisted change to a **Runtime Scope** configuration together with the observable reload outcome for the affected **Aggregated Runtime**.
_Avoid_: config edit, JSON write, reload hint

**Config Backup**:
A restorable snapshot of a **Runtime Scope** configuration created before a risky **Config Change**.
_Avoid_: temp copy, old config file

**Server Installation Workflow**:
The domain workflow that turns registry or direct-install input into an installable **Configured Server Target** and structured installation facts.
_Avoid_: install command, installation adapter, registry install

## Relationships

- An **Aggregated Runtime** exposes one or more **Client Surfaces**.
- A **Background Aggregated Runtime** is an **Aggregated Runtime**.
- A **Runtime Scope** allows at most one active **Aggregated Runtime**.
- `1mcp serve` owns **Aggregated Runtime** lifecycle operations for a **Runtime Scope**.
- A **Config Change** belongs to exactly one **Runtime Scope**.
- A **Config Change** can add, update, or remove one **Configured Server Target**.
- A **Configured Server Target** is either a static server definition or a **Template Server** definition.
- A **Config Change** may create one **Config Backup** before persisting the change.
- A **Config Backup** belongs to exactly one **Runtime Scope**.
- A **Config Change** may affect the **Aggregated Runtime** for that **Runtime Scope**.
- A **Server Installation Workflow** produces or updates one **Configured Server Target** through a **Config Change**.
- A **Client Surface** can provide a **Request Context**.
- A **Client Surface Attachment** belongs to one **Client Surface**.
- A **Client Surface Attachment** can reuse an existing **Streamable Transport Session** or create a fresh one depending on the **Client Surface**.
- A **Client Surface** can provide filtering inputs resolved by **Filter Selection**.
- The stdio proxy is a **Client Surface** that carries **Request Context** through MCP `_meta` over Streamable HTTP.
- Direct HTTP MCP uses a **Streamable Transport Session** for transport continuity.
- Direct HTTP MCP uses **Streamable Transport Session Lifecycle** before SDK request handling.
- A **Request Context** resolves to a **Request Session**.
- A **Request Session** can be routing-only when a **Client Surface** supplies session identity without a **Request Context**.
- When a **Client Surface** supplies both transport session identity and contextual session data, the transport session identity names the **Request Session**.
- A **Streamable Transport Session** can also name a **Request Session** when contextual template routing uses its `mcp-session-id`.
- A **Template Server** can produce one or more **Template Server Instances**.
- A **Template Server Identity** can identify a **Template Server** or a **Template Server Instance** depending on runtime phase.
- A **Template Server Instance** belongs to one or more **Request Sessions** when it is shareable, and exactly one **Request Session** when it is per-client.
- A **Streamable Transport Session** can hold one or more **Template Server Instance** memberships through its associated **Request Session**.
- **Request Context Preparation** happens before template-aware REST inspection or tool invocation.
- An **Aggregated Runtime** maintains a **Capability Snapshot**.
- A **Capability Catalog** reads from a **Capability Snapshot**.
- A **Capability Catalog** returns **Client Surface**-specific capabilities for a **Request Session**.
- A **Capability Catalog** owns **Capability Refresh** policy.
- A **Capability Catalog** returns internal **Capability Routes** with visible capabilities.
- A **Capability Catalog** enforces **Capability Visibility** for listing, schema lookup, and invocation.
- **Filter Selection** provides filtering intent consumed by **Capability Visibility**.
- Filtering applies to a **Server Candidate Set** for one **Request Session**.
- A **Server Candidate Set** can include static servers and session-available **Template Server Instances**.
- An **OAuth Authorization Flow** can create authorization codes or access tokens.
- **Instructions Distribution** delivers instruction content to a **Client Surface**.
- A **Capability Route** can resolve to a static server or a **Template Server Identity**.
- **Request Context Preparation** can cause the **Capability Snapshot** to change when new **Template Server Instances** become available.

## Example dialogue

> **Dev:** "When `/api/tools` receives a context, should it create template servers itself?"
> **Domain expert:** "No. `/api/tools` is just a **Client Surface**. It should ask **Request Context Preparation** to resolve the **Request Session** and prepare any **Template Server Instances**."
> **Dev:** "After that, should `/api/tools` read the registry directly?"
> **Domain expert:** "No. It should query the **Capability Catalog** for that **Request Session** so visibility rules are applied consistently."
> **Dev:** "Should the response expose template hash keys?"
> **Domain expert:** "No. The client sees clean capability names; the **Capability Catalog** keeps the **Capability Route** internally."

## Flagged ambiguities

- "session" can mean the standard MCP streamable HTTP session or the contextual identity used by REST inspection routes. Use **Streamable Transport Session** for the MCP transport lifecycle and **Request Session** when the identity is used for contextual template rendering and routing.
- "attach-only" does not always mean "reuse an existing session"; short-lived **Client Surfaces** may reuse a cached **Streamable Transport Session**, while long-lived proxy-style surfaces may create a fresh one.
- A header-only `mcp-session-id` is a routing-only **Request Session** when no **Request Context** is supplied; it does not by itself mean the caller supplied contextual data for rendering **Template Servers**.
- If both transport session identity and contextual session data are supplied, they must not create competing **Request Sessions**; the transport session identity is authoritative.
- "context initialization" and "request setup" both referred to the same behavior in route code. Use **Request Context Preparation** for the full prepare-and-register step.
- "global runtime" means the default **Runtime Scope**, not a machine-wide singleton; an alternate configuration directory creates a separate **Runtime Scope**.
- "proxy" is a **Client Surface**, not a separate runtime path; when it talks to the **Aggregated Runtime**, it uses MCP over Streamable HTTP and carries **Request Context** in `_meta`.
- "config mutation" and "reload" were discussed separately in implementation code, but architecture discussions should use **Config Change** when the caller needs both persisted mutation facts and reload outcome facts.
- "reload recommended" is weaker than **Config Change** language; a **Config Change** should distinguish observed reload, unavailable runtime, and disabled reload.
- "server config" was used for both static servers and template definitions. Use **Configured Server Target** when a **Config Change** may address either, with template-first resolution for existing duplicate names.
- "backup cleanup" should mean retention applied to **Config Backups** after a new backup is created, not a continuously running scheduler unless explicitly stated.
- "key" was used for clean names, outbound connection keys, pool instance keys, and tracker cleanup keys. Use **Template Server Identity** when discussing the canonical identity language rather than one storage map's string key.
- "per-client" and "not shareable" both mean the **Template Server Instance** identity is bound to one **Request Session**; discuss this as a session-bound **Template Server Identity** when the difference is not user-visible.
- "registry", "catalog", and "snapshot" were used interchangeably. Use **Capability Snapshot** for raw point-in-time capabilities, and **Capability Catalog** for visibility-aware capability queries.
- "routing facts" means **Capability Routes** inside the runtime, not public server names or transport storage keys.
- "disabled tool" describes one input into **Capability Visibility**, not a separate caller-specific access path.
- "disconnect" for a **Streamable Transport Session** releases active transport membership but does not necessarily delete persisted lifecycle state.
- "filter" can mean the legacy selector named `filter` or the resolved filtering intent. Use **Filter Selection** for the resolution process and name the selected intent explicitly.
- Filtering should not branch on whether a server candidate came from static configuration or a **Template Server Instance**; build the session's **Server Candidate Set** first, then apply the selected filter intent.
- OAuth route handlers should be HTTP adapters for **OAuth Authorization Flow**, not direct callers of OAuth storage repositories.
- **Instructions Distribution** is not the same as runtime instruction aggregation or CLI output formatting.

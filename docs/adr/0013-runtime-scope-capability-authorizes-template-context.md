# ADR 0013: Runtime Scope capability authorizes template context

## Status

Accepted.

## Decision

The **Aggregated Runtime** treats caller-supplied **Request Context** as data to decode and audit, not as authority to render a **Template Server**. In the default `verified` mode, template rendering requires a detached HMAC proof created with a random capability stored owner-only (`0600`) in the selected **Runtime Scope**. The proof binds the readable context hash, `runtimeScopeId`, and canonical **Request Session**. The capability is never stored in PID metadata, transmitted to the runtime, or logged.

First-party local Client Surfaces (`run`, `inspect`, `wait`, and `proxy`) may sign context only when the selected URL exactly matches a live PID record in that Runtime Scope. GET REST requests keep the existing base64url `context` query representation for wire compatibility; POST and MCP requests carry readable JSON context. All ingress paths carry the proof separately.

The server owns three trust modes:

- `verified` (default): verified local context may render templates; unsigned clients remain connected with static servers only.
- `disabled`: no caller context may render templates.
- `legacy`: unsigned context may render templates, restoring the historical behavior and its command, args, cwd, and env injection risk.

`legacy` on a non-loopback HTTP host requires the explicit `--confirm-untrusted-template-context` acknowledgement. The mode is configured by `--template-context-trust` or `[templateContext].trust` in `config.toml`, with CLI precedence.

Persisted streamable sessions store the detached proof. Restoration reverifies it; an older context-bearing session without a proof fails restoration and must initialize again. Session persistence TTL remains the proof's effective lifetime.

## Consequences

Local-first template workflows remain zero-configuration after upgrade. Remote and third-party clients remain wire-compatible and can use static servers, but cannot influence template execution in `verified` mode. Operators can select `legacy` temporarily for remote context-dependent clients, with an explicit warning and stronger confirmation for network-exposed listeners.

Request logs replace raw base64 context and proof signatures with placeholders. A dedicated structured audit event records the source, project name and path, canonical session, context hash, Runtime Scope identity, verification result, and rejection reason. Debug audit details preserve context keys and safe identity fields while redacting environment values, custom values, user home/email/shell, and proof signatures.

Remote trusted context issuance is intentionally separate and tracked in GitHub issue #436. A future provider must bind a server-owned context profile to an authenticated principal, Runtime Scope, and Request Session without distributing the local capability.

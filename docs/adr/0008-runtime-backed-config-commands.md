---
status: accepted
---

# Config-Mutating CLI Commands Prefer the Runtime Path

Config-mutating CLI commands should become **Runtime-Backed Commands** when an **Aggregated Runtime** is available for the selected target. The command should call the runtime instead of editing local files directly, so CLI and Admin Console mutations share **Admin Operation**, **Config Change**, backup, validation, audit, and reload-observation semantics.

## Consequences

Runtime-backed mutations use **Admin Session** authority and the versioned **CLI Admin Adapter**, sharing domain operations with the browser without coupling shipped CLIs to the SPA API. Mutation admission, serialization, idempotency, and audit belong to the admin domain; queue admission is not a successful Config Change.

Target contexts are stored outside Runtime Scope configuration. Named targets bind credentials to an observed runtime identity and fail closed on mismatch; accepting a replacement clears saved credentials. An ephemeral `--url` remains credentialless. `--config-dir` and lifecycle commands remain local, while client-scoped commands retain their OAuth authority.

---
status: accepted
---

# Project checkout identity is independent of configuration source

Ordinary local **Cross-Project Work** shares an **Aggregated Runtime**, while **Project Checkout** identity remains independent of the **Project Configuration Source** supplying its defaults. Linked worktrees may inherit configuration within their repository, and callers explicitly select checkouts or **Project Sets** without broadening tool visibility. This avoids targeting the wrong source tree or duplicating runtime infrastructure; explicitly selected alternative **Runtime Scopes** remain available.

## Consequences

A linked worktree may inherit its main checkout's configuration, but remains the source target. A local file replaces the inherited file as a whole; automatic lookup stops at repository boundaries.

Project Sets belong to individual calling sessions. Checkout-specific calls select a checkout when several are available; native multi-project operations require visibility under every selected checkout's filters. Single-project tools receive separate calls. Shared runtime infrastructure does not establish that backend mutable state is safe to share.

Each delegated worker receives independent bootstrap instructions and an explicit **Worker Project Assignment**. Parent session identity or cwd cannot supply that assignment. Missing assignment yields general instructions and an unresolved target, not guessed project authority. Supported hooks preserve unrelated configuration and report delivery gaps. The template-context trust boundary in [ADR 0013](0013-runtime-scope-capability-authorizes-template-context.md) remains unchanged.

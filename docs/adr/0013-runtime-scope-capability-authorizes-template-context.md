---
status: accepted
---

# Runtime Scope capability authorizes template context

Caller-supplied **Request Context** is data, not authority to render a **Template Server**. In the default `verified` mode, the **Aggregated Runtime** requires a detached HMAC proof bound to the context hash, **Runtime Scope**, and canonical **Request Session**. This preserves local template workflows without allowing unsigned callers to inject commands, arguments, working directories, or environment values.

## Consequences

The owner-only capability stays local; first-party surfaces sign context only for a URL matching the selected scope's live PID record. Context travels as readable data with a separate proof, and persisted sessions must reverify that proof on restoration. Proofless legacy sessions must initialize again.

The server controls trust: `verified` allows unsigned callers static servers only, `disabled` prevents contextual rendering, and `legacy` restores unsigned rendering with its injection risk. Network-exposed legacy mode requires explicit acknowledgement. Remote trusted context issuance remains a separate design; local proofs confer no general session or OAuth authority. Diagnostics redact context secrets and proof signatures.

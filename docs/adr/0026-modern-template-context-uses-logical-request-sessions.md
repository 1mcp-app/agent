---
status: accepted
---

# Modern template context uses logical Request Sessions

Modern local proxy clients bind contextual template capabilities to a logical **Request Session**, independent of temporary request bridges. This preserves backend reuse between listing and invocation without sharing per-client state across proxies. Existing template-context trust, metadata sanitization, and idle-cleanup rules remain authoritative.

## Consequences

Logical sessions own template memberships across listing and invocation. Separate proxies retain independent per-client state even with shared OAuth credentials; shareable templates keep existing pooling rules. Closing a temporary bridge does not release memberships; existing idle-expiry and subscription policies govern lifetime.

Effective context stays fixed within a session. Changed project or template inputs require a new session and invalidate continuations; timestamps or proof re-signing alone do not. Cursors, routes, subscriptions, and continuations remain bound to the applicable session, context, and authority.

Discovery prepares authorized capabilities before template instructions, and every applicable ingress checks trust. Client information restores contextual compatibility without becoming OAuth authority; raw context and proof are not forwarded as backend authority. This decision covers fixed-context local proxies; remote trusted issuance and dynamic project switching remain separate.

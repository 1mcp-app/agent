# HANDOFF — 1MCP + Cloudflare Access + MCP Events

**Project:** Agent delegation  
**Prepared for:** Codex implementation worker  
**Supervisor:** current ChatGPT conversation (Marcus)  
**Date:** 2026-10-04  
**Status:** Ready for implementation planning/coding. Production changes are **not** pre-authorized.

---

## Starter prompt

Use this when starting Codex:

> Read `HANDOFF.md` in full before making any changes. Treat it as the authoritative project context and decision record. Work only on the scoped 1MCP + Cloudflare Access + MCP Events integration described there. Do not redesign the architecture, introduce another public MCP endpoint, or replace 1MCP. Preserve the existing Cloudflare Access → Cloudflare Tunnel → 1MCP architecture. Extend the existing modern 1MCP gateway narrowly so OpenAI MCP Events can route to `agent-offload` / `pi-delegate-mcp`. Produce a focused PR with tests and migration/deployment instructions; do not deploy production unless explicitly authorized. When the bounded coding/review unit is complete and durable GitHub state exists, notify the supervisor conversation using the existing visible ChatGPT callback/orchestration mechanism so the supervisor can independently verify and continue with merge/CI/deploy/smoke.

---

# 1. Goal

Finish the final integration layer for delegated-agent completion events.

The desired end state is:

```text
ChatGPT
   │
   │ OAuth 2.x + PKCE
   ▼
Cloudflare Access Managed OAuth
   │
   ▼
Cloudflare Tunnel
   │
   ▼
1MCP
   │   MCP 2026-07-28
   │   + MCP Events
   │
   ├── existing MCP servers
   └── agent-offload
          │
          ▼
   pi-delegate-mcp
          │
          └── delegation.completed
                   │
                   ▼
                ChatGPT
```

The system must keep **1MCP as the single public MCP aggregation/gateway endpoint**.  
Cloudflare Access remains the **single public OAuth boundary**.  
Cloudflare Tunnel remains private transport.  
`pi-delegate-mcp` remains downstream/private.

---

# 2. Settled architecture decision

## Keep

- **Cloudflare Access Managed OAuth**
- **Cloudflare Tunnel**
- **1MCP**
- existing public hostname:
  - `https://1mcp-mcp.lekthai.co.uk/mcp`
- downstream `agent-offload` / `pi-delegate-mcp`
- existing 1MCP lazy-loading/tool aggregation behavior
- existing visible ChatGPT supervisor/worker orchestration
- existing callback fallback in `pi-delegate-mcp`

## Do not introduce

- OpenAI Secure MCP Tunnel
- a second public `pi-delegate-mcp` hostname
- a second public MCP gateway
- Cloudflare MCP Portal in the ChatGPT → 1MCP path
- duplicate OAuth stacks
- anonymous public MCP exposure

## Why

1MCP already solves MCP aggregation. Cloudflare Access already solves public OAuth. Cloudflare Tunnel already solves private network exposure. Adding another MCP portal/gateway/tunnel would duplicate responsibilities and add another protocol-aware layer that could block or alter draft OpenAI MCP Events behavior.

---

# 3. Current production topology

Observed live on the integration host:

```text
1mcp-mcp.lekthai.co.uk
   ↓
Cloudflare Access
   ↓
Cloudflare Tunnel
   ↓
http://127.0.0.1:3050
   ↓
1MCP
```

Cloudflared config includes:

```yaml
ingress:
  - hostname: 1mcp-mcp.lekthai.co.uk
    service: http://127.0.0.1:3050
```

The live 1MCP process is:

```text
node /usr/local/bin/1mcp serve
  --config /opt/business-mcp/config/mcp.json
  --transport http
  --host 127.0.0.1
  --port 3050
  --trust-proxy loopback
  --external-url https://1mcp-mcp.lekthai.co.uk
  --log-level debug
  --log-file /opt/business-mcp/logs/1mcp.log
  --enable-internal-tools
  --internal-tools=enable,disable
  --enable-lazy-loading
  --lazy-mode=hybrid
  ...
```

The public endpoint is protected by Cloudflare Access Managed OAuth.

---

# 4. Cloudflare Access — live verification

The live protected MCP endpoint advertises OAuth protected-resource metadata.

## Protected resource metadata

Live endpoint:

```text
https://1mcp-mcp.lekthai.co.uk/.well-known/oauth-protected-resource/mcp
```

Returned:

```json
{
  "resource": "https://1mcp-mcp.lekthai.co.uk/mcp",
  "authorization_servers": [
    "https://lekthailtd.cloudflareaccess.com"
  ]
}
```

Cloudflare-specific protected resource metadata also advertises:

```json
{
  "resource": "https://1mcp-mcp.lekthai.co.uk/mcp",
  "protected": true,
  "team_domain": "lekthailtd.cloudflareaccess.com",
  "authorization_servers": [
    "https://lekthailtd.cloudflareaccess.com"
  ]
}
```

## Authorization server metadata

Live endpoint:

```text
https://1mcp-mcp.lekthai.co.uk/.well-known/oauth-authorization-server
```

Advertises:

- authorization endpoint
- token endpoint
- revocation endpoint
- dynamic registration endpoint
- authorization code
- refresh token
- PKCE
- `S256`

This matches the desired ChatGPT MCP OAuth shape.

## Important auth decision

Cloudflare Access is the public OAuth authority.

Do **not** force an already Access-authenticated MCP request through another independent 1MCP OAuth challenge.

Desired model:

```text
ChatGPT
  → Cloudflare Access OAuth
      → Cloudflare adds trusted Access identity/JWT
          → 1MCP validates/trusts that identity
              → MCP request
```

Cloudflare's `Cf-Access-Jwt-Assertion` should be validated in 1MCP as defense-in-depth if the current fork does not already do this appropriately.

At minimum validate:

- signature
- issuer
- audience
- expiry

Do not invent a new custom token format.

---

# 5. Cloudflare MCP Portal decision

Cloudflare MCP Portal was originally considered because it supplied OAuth.

That is no longer necessary.

Current Cloudflare MCP Portal documentation supports modern MCP `2026-07-28`, tools, prompts, resources, and portal aggregation. However, no usable/documented OpenAI-style MCP Events subscription support was established for:

- `events/list`
- `events/subscribe`
- `events/unsubscribe`

Therefore the portal is intentionally excluded from this architecture for now.

Use:

```text
Cloudflare Access + Tunnel + 1MCP
```

not:

```text
Cloudflare Access + MCP Portal + 1MCP
```

---

# 6. 1MCP repository and deployment state

## Fork

Repository:

```text
lekthailtd-bit/agent
```

Upstream:

```text
1mcp-app/agent
```

Integration-host working copy:

```text
/opt/1mcp/src/agent
```

Observed working-copy state:

```text
branch: feat/lazy-instructions-metatool
HEAD: f03d8aa239608696d3ada5747bf538a799d388ce
source/package version: 0.37.0
```

There is also:

```text
/opt/1mcp/src/upstream
HEAD: 50af86018c6582f04de97212dec5072e54df6b46
```

Upstream issue for MCP 2026 work:

```text
1mcp-app/agent#459
[Feature]: Support MCP specification 2026-07-28 (stateless core, SDK v2)
```

Upstream compatibility foundations were observed integrated at:

```text
50af86018c6582f04de97212dec5072e54df6b46
```

## Critical deployment mismatch

**Production is not running the 0.37.0 fork working copy.**

Installed binary:

```text
/usr/local/bin/1mcp
→ /usr/local/lib/node_modules/@1mcp/agent/build/index.js
```

Installed version:

```text
0.32.2
```

So:

```text
live production runtime = 0.32.2
working source fork      = 0.37.0-era code
```

Do not assume the working copy is deployed.

---

# 7. Live 1MCP protocol verification

A properly initialized live production MCP session against:

```text
http://127.0.0.1:3050/mcp
```

reported:

```text
protocolVersion: 2025-06-18
serverInfo:
  name: 1mcp
  version: 0.32.2
```

Capabilities included:

- completions
- resources
- tools
- prompts
- logging

Live calls:

```text
events/list
```

returned:

```text
-32601 Method not found
```

and:

```text
server/discover
```

returned:

```text
-32601 Method not found
```

Therefore current production 1MCP blocks modern MCP Events.

---

# 8. Newer 1MCP fork capabilities

The newer fork is substantially closer to the required architecture.

Observed package state included:

```text
@modelcontextprotocol/sdk     1.30.0
@modelcontextprotocol/server  2.x
@modelcontextprotocol/client  2.x
```

The fork already contains modern MCP infrastructure, including:

- `createMcpHandler()`
- modern inbound HTTP route
- `server/discover`
- 2026-era protocol handling
- `ModernInboundEraAdapter`
- `GatewayDispatcher`
- `GatewaySession`
- modern ↔ legacy bridge
- `modernInboundLegacyBridge`
- independent modern/legacy gateway model

This means the task is **not** "add MCP 2026 to 1MCP from scratch".

---

# 9. Exact 1MCP gap for Events

The modern HTTP handler currently advertises capabilities roughly equivalent to:

```text
tools
prompts
resources
completions
```

It does **not** advertise:

```text
events
```

The gateway operation allowlist currently includes:

```text
tools/list
tools/call
prompts/list
prompts/get
resources/list
resources/templates/list
resources/read
completion/complete
```

It does **not** include:

```text
events/list
events/subscribe
events/unsubscribe
```

That is the primary functional gap.

---

# 10. Event routing decision

Do **not** initially build generalized cross-server Events aggregation.

For the first production implementation:

```text
Events provider = agent-offload
```

All Events methods should route only to the configured downstream server:

```text
agent-offload
```

which currently points to:

```text
/opt/business-mcp/pi-delegate-mcp/dist/index.js
```

Why:

- only one producer currently needs Events
- avoids namespace collisions
- avoids cross-server subscription semantics
- keeps the 1MCP change bounded
- easiest to test and roll back

The implementation may be structured so generalized Events aggregation can be added later, but do not make that a completion requirement.

---

# 11. Desired request path

## Discovery

```text
ChatGPT
  → Cloudflare Access
  → 1MCP server/discover
```

1MCP should advertise:

```json
{
  "supportedVersions": ["2026-07-28"],
  "capabilities": {
    "tools": {},
    "events": {}
  }
}
```

alongside whatever other modern capabilities it legitimately supports.

## Events list

```text
ChatGPT
  → events/list
  → 1MCP
  → agent-offload
  → delegation.completed
```

## Subscribe

```text
ChatGPT
  → events/subscribe
  → 1MCP
  → agent-offload
  → pi-delegate-mcp stores subscription
```

## Completion

Once the subscription exists:

```text
worker completes
  → pi-delegate-mcp
  → POST signed webhook directly to ChatGPT callback URL
```

1MCP does **not** need to proxy every completion webhook if the downstream `pi-delegate-mcp` already owns the subscription and can deliver directly.

## Unsubscribe

```text
ChatGPT
  → events/unsubscribe
  → 1MCP
  → agent-offload
```

---

# 12. `pi-delegate-mcp` state

Repository:

```text
lekthailtd-bit/pi-delegate-mcp
```

## Previous gates

Before Turn 3:

- GitHub housekeeping: PASS
- merged-main CI: PASS
- production deploy: PASS
- independent live production smoke: PASS

The baseline production lifecycle was proven working.

## PR #6

Open PR:

```text
#6 — Turn 3: serve MCP Events over MCP 2.0 HTTP
```

Branch:

```text
feature/mcp-events-turn3
```

Head:

```text
52435a252268593397783600f07a08ec006d4c50
```

Base at PR creation:

```text
3c6e1efd444e5c896287ffde15e6aa05fd1df666
```

PR #6 is **open, mergeable, not deployed**.

CI run:

```text
37190899216
```

Result:

```text
SUCCESS
```

Node 22 + Node 24 both passed:

- `npm ci`
- typecheck
- build
- stdio launch/list-tools
- callback tests
- Events service tests
- completion-event tests
- worker lifecycle tests
- modern HTTP test

The modern HTTP test proves:

- missing bearer rejected
- MCP v2 negotiates modern era
- raw `server/discover` advertises:
  - `2026-07-28`
  - `resultType:"complete"`
  - `events:{}`
- existing 12 tools remain available
- `events/list` returns `delegation.completed`

## Important deployment state

PR #6 has **not** been merged or deployed.

Do not merge/deploy it as part of unrelated 1MCP coding unless explicitly authorized after review.

---

# 13. Existing pi-delegate Events design

Turn 1 and Turn 2 are already complete.

## Turn 1 — Event plumbing

Implemented:

- event catalog
- subscription persistence
- deterministic subscription identity
- signed webhook delivery
- retry/backoff
- verification
- secret rotation overlap
- SSRF/public-address protections
- bounded payload/timeouts

First event:

```text
delegation.completed
```

## Turn 2 — Completion integration

Settled behavior:

```text
Pi worker completes successfully
        ↓
build full completion payload
        ↓
deterministic result hash / delivery identity
        ↓
delegation.completed
        ↓
event subscribers
        │
        ├─ accepted → suppress legacy callback
        └─ none/failure → existing callback fallback
```

Error/aborted states currently use callback fallback rather than pretending they are completed events.

Notification failure must never retroactively turn successful worker completion into failed work.

---

# 14. Important lifecycle hardening already proven

The deployed pi delegate baseline includes later lifecycle fixes that were reconciled into PR #6:

- bound a turn if provider never settles
- make manual abort terminal promptly
- expose streamed `lastText` while worker is still running
- treat Pi `agent_settled` as authoritative terminal event
- ensure completion publication is idempotent
- avoid duplicate completion if later idle resolution fires

Independent production smoke proved:

```text
state: running
lastText: <expected text>
```

then naturally:

```text
state: done
```

and a follow-up turn reused the same session and completed cleanly with a new deterministic completion identity.

Do not regress these behaviors.

---

# 15. Authentication design for 1MCP

The public MCP hostname is already behind Cloudflare Access Managed OAuth.

Desired behavior:

1. ChatGPT authenticates with Cloudflare Access.
2. Cloudflare validates OAuth/token/session at the edge.
3. Cloudflare forwards to the Tunnel.
4. 1MCP receives the request on loopback.
5. 1MCP validates/trusts Cloudflare Access identity, preferably via `Cf-Access-Jwt-Assertion`.
6. 1MCP handles MCP without triggering a second user-facing OAuth flow.

## Security requirements

Do not weaken:

- Host validation
- Origin validation
- loopback binding
- Cloudflare Access enforcement
- existing scope/permission checks
- lazy loading / tool visibility
- admin separation

Do not expose `127.0.0.1:3050` publicly.

Do not make 1MCP accept arbitrary identity headers without verifying they came from a trusted Cloudflare Access JWT context.

---

# 16. Scope for Codex

## Primary implementation scope

In `lekthailtd-bit/agent`:

1. Start from the correct current fork/upstream state.
2. Reconcile the current feature branch with the newer upstream MCP-2026 foundations as needed.
3. Preserve all existing Lek Thai-specific fork behavior.
4. Extend modern discovery to advertise Events only when the configured Events provider is available.
5. Add support for:
   - `events/list`
   - `events/subscribe`
   - `events/unsubscribe`
6. Route those methods only to `agent-offload` for v1.
7. Preserve request authority/security semantics through the gateway.
8. Preserve legacy clients.
9. Preserve modern clients.
10. Add focused tests.
11. Add Cloudflare Access JWT validation/trust mode if the current server does not already securely validate the assertion in the desired direct-Access architecture.
12. Produce migration/deployment documentation.
13. Open a focused PR.
14. Do **not** deploy production without explicit authorization.

---

# 17. Tests / acceptance criteria for the 1MCP PR

At minimum prove:

## Protocol

- legacy 2025 client still works
- modern `2026-07-28` client works
- `server/discover` advertises `events:{}` when Events provider is healthy
- `events/list` reaches `agent-offload`
- `events/subscribe` reaches `agent-offload`
- `events/unsubscribe` reaches `agent-offload`
- unrelated arbitrary methods do not become silently proxyable

## Security

- unauthenticated public request remains rejected by Access
- 1MCP does not blindly trust forged Access headers
- JWT validation rejects:
  - bad signature
  - wrong issuer
  - wrong audience
  - expired assertion
- no accidental second OAuth challenge for valid Access-authenticated MCP traffic
- Host/Origin protections remain intact
- no public loopback bypass

## Existing behavior

- lazy loading unchanged
- direct exposed tools unchanged
- tool list / tool invoke unchanged
- internal enable/disable tools unchanged
- existing downstream MCP servers remain reachable
- existing Cloudflare OAuth path remains usable
- existing admin path remains protected/functional

## Events behavior

For the bounded test configuration:

```text
Events provider = agent-offload
```

Prove:

```text
server/discover
→ events advertised

events/list
→ delegation.completed visible

events/subscribe
→ downstream subscription created

events/unsubscribe
→ downstream subscription removed
```

Do not claim real ChatGPT delivery until the full end-to-end test has actually run.

---

# 18. Final end-to-end acceptance after merge/deploy

This is a separate supervisor-controlled gate.

After PR review, merge, CI, and exact deployment:

```text
ChatGPT
  → Cloudflare Access OAuth
  → 1MCP modern discovery
  → events/list
  → events/subscribe(delegation.completed)
  → spawn real delegated worker
  → worker completes
  → exactly one delegation.completed event reaches ChatGPT
  → supervisor fetches authoritative result
```

Then test:

- duplicate prevention
- same event ID on retry
- follow-up turn creates new completion identity
- no double event + callback
- webhook delivery failure falls back correctly
- restart behavior
- expired subscription
- unsubscribe
- no subscriber → callback fallback
- subscriber accepted → callback suppressed
- no leaked browser/task tabs if visible callback fallback is exercised

Only after these pass is the Events migration production-accepted.

---

# 19. Production change policy

Production changes are **not** pre-authorized by this handoff.

The intended sequence is:

```text
Codex coding
  ↓
focused PR
  ↓
CI
  ↓
notify supervisor conversation
  ↓
independent review
  ↓
merge authorization
  ↓
merged-main CI
  ↓
exact deploy authorization
  ↓
production smoke
  ↓
real ChatGPT Events acceptance
```

Do not compress these gates.

---

# 20. Visible worker / supervisor callback contract

This project uses visible ChatGPT worker orchestration.

Core lifecycle:

```text
operator
  → supervisor conversation
    → visible worker/Codex
      → bounded task
        → durable GitHub state first
          → callback/notification second
            → supervisor independently verifies
```

Rules:

- GitHub first, callback second.
- One bounded worker scope.
- No recursive worker spawning unless explicitly allowed.
- Completion is not acceptance.
- Supervisor independently verifies durable state.
- Production/destructive work is separate.
- Exact SHAs matter.
- Do not report success based only on chat text.
- Preserve PR/commit/run IDs.
- Do not navigate the worker away unnecessarily.
- Notify the existing supervisor conversation when the bounded coding/PR unit is complete.

The callback should include:

- task name
- success / partial / blocked
- PR number
- exact head SHA
- CI run ID/status
- important tests
- unresolved risks
- explicit next supervisor action

Example:

```text
[worker-completion]
1MCP MCP Events gateway work complete.
PR: #<n>
Head: <full SHA>
CI: <run id> PASS
Implemented: modern events capability + events/list|subscribe|unsubscribe routed to agent-offload; Cloudflare Access JWT validation; legacy/modern regression coverage.
Production unchanged.
Next action: supervisor independently review PR/diff/CI, then decide merge gate.
```

---

# 21. Things Codex must not “helpfully” redesign

Do not:

- replace 1MCP
- introduce another public MCP gateway
- move OAuth from Cloudflare Access into a new custom service
- add OpenAI Secure MCP Tunnel
- insert Cloudflare MCP Portal back into the path
- expose pi-delegate directly to the Internet
- generalize Events across every downstream server unless required for correctness
- rewrite lazy-loading architecture
- upgrade the Pi agent dependency just because npm audit suggests a semver-major fix
- deploy production as part of implementation without explicit approval
- merge `pi-delegate-mcp` PR #6 without supervisor review
- touch unrelated Lek Thai infrastructure/repos

---

# 22. Relevant repos / identifiers

## 1MCP

```text
fork:     lekthailtd-bit/agent
upstream: 1mcp-app/agent
working:  /opt/1mcp/src/agent
fork branch observed: feat/lazy-instructions-metatool
fork HEAD observed: f03d8aa239608696d3ada5747bf538a799d388ce
upstream working HEAD observed: 50af86018c6582f04de97212dec5072e54df6b46
live installed version: 0.32.2
live port: 127.0.0.1:3050
public URL: https://1mcp-mcp.lekthai.co.uk/mcp
```

## pi-delegate

```text
repo: lekthailtd-bit/pi-delegate-mcp
PR: #6
title: Turn 3: serve MCP Events over MCP 2.0 HTTP
branch: feature/mcp-events-turn3
head: 52435a252268593397783600f07a08ec006d4c50
CI run: 37190899216
CI status: PASS
production status: PR #6 NOT merged/deployed
```

## General ops / previous fallback work

```text
repo: lekthailtd-bit/lekthai-restaurant-general-ops
Issue #141
```

Issue #141 fixed the Gemini/agent-offload fallback path and provided separate evidence that delegated-agent execution is functioning.

---

# 23. Recommended first Codex actions

1. Read this handoff fully.
2. Read current default-branch `AGENTS.md` and repo-local contributor instructions.
3. Fetch latest `lekthailtd-bit/agent` and `1mcp-app/agent`.
4. Verify current fork/upstream divergence rather than trusting the observed SHAs above blindly.
5. Read upstream issue #459 and the current MCP-2026 follow-up PR/issues referenced there.
6. Identify the smallest extension points for:
   - capability advertisement
   - gateway operation schema
   - routing to a specific downstream connection
   - Access JWT trust/validation
7. Write a short implementation plan in durable GitHub state if repository conventions require it.
8. Implement on a new focused branch.
9. Add tests before production changes.
10. Open PR.
11. Wait for CI.
12. Write authoritative PR comment with exact evidence.
13. Notify the existing supervisor conversation.
14. Stop. Do not merge/deploy.

---

# 24. Compact implementation thesis

The task is **not** to create an Events platform.

It is:

```text
teach the existing modern 1MCP gateway three new request methods
+
advertise one new capability
+
route them to one known downstream provider
+
trust Cloudflare Access correctly
+
prove nothing else regresses
```

That is the intended scope.

---

# 25. Final starter prompt (copy/paste)

> Read `HANDOFF.md` completely and treat it as the authoritative context/decision ledger for this task. Work only in `lekthailtd-bit/agent` unless the handoff explicitly requires read-only cross-repo verification. Preserve the settled architecture: ChatGPT → Cloudflare Access Managed OAuth → Cloudflare Tunnel → 1MCP → `agent-offload`/`pi-delegate-mcp`. Do not introduce Secure MCP Tunnel, Cloudflare MCP Portal, a second public MCP endpoint, or a replacement for 1MCP. Extend the existing modern 1MCP gateway narrowly so `server/discover` advertises Events and `events/list`, `events/subscribe`, and `events/unsubscribe` route only to `agent-offload` initially. Preserve legacy clients, modern clients, lazy loading, existing tools, security boundaries, and Cloudflare Access auth. Add focused regression/security tests, open a PR, wait for CI, write durable evidence, and do not merge or deploy production. When the bounded PR/CI unit is complete, notify the existing supervisor ChatGPT conversation through the project’s visible callback mechanism with PR number, exact head SHA, CI evidence, unresolved risks, and the next supervisor action.

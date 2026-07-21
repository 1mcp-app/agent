---
status: accepted
---

# Aggregated Runtime Owns Backend Stdio Supervision

The **Aggregated Runtime** owns crash recovery for static and template stdio backends because the child process and its stdin/stdout MCP transport form one lifecycle boundary. External process managers may supervise the whole 1MCP runtime or independently hosted servers, but they cannot replace an owned stdio child while preserving 1MCP routing, protocol initialization, request failure, capability refresh, and template-instance membership semantics.

Supervision is opt-in at the **Runtime Scope** through shared server defaults, with a configured server or template allowed to override that policy. Static servers have one supervision lifecycle. Template servers have one lifecycle per canonical **Template Server Identity**: shareable rendered instances recover once for all member sessions, while session-bound instances recover independently. Recovery reuses the rendered configuration and memberships of the logical instance; cleanup, loss of all memberships, configuration replacement, or runtime shutdown cancels pending recovery.

Consecutive failures use exponential backoff from the configured initial delay, default to five attempts, and reset after five stable minutes. `maxRestarts: 0` explicitly means unlimited attempts. A crash moves the backend to `restarting`, fails interrupted requests without replay, and removes its capabilities from routing. Successful MCP initialization returns it to `connected`; exhausting the budget moves it to `crash-loop` without terminating other backends or the Aggregated Runtime.

Operators recover backends through `1mcp mcp restart <name>`, with template targeting for one instance or all instances. Each logical template instance receives a random 64-character hexadecimal **Template Instance ID**; normal output shows its first 12 characters and commands accept any unambiguous prefix. The ID survives child-process replacement but is retired with the logical instance. Existing status, health, internal-tool, logging, and capability-notification surfaces expose supervision state and retry facts.

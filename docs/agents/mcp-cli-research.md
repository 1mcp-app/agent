# Lessons From Philipp Schmid's `mcp-cli`

Research date: 2026-08-31

Source snapshots:

- [Article: "Introducing MCP CLI: A way to call MCP Servers Efficiently"](https://www.philschmid.de/mcp-cli), updated for v0.3.0 in January 2026.
- [`philschmid/mcp-cli` at `d77672a1`](https://github.com/philschmid/mcp-cli/tree/d77672a1ce800ec3fec1f43829909badb2ffbd32), the live `main` HEAD inspected for this note.
- [`1mcp-app/agent` at `a9360041`](https://github.com/1mcp-app/agent/tree/a9360041523510ccf6e058e203bdb5fec5cc82e7), the 1MCP baseline used for comparison.
- MCP protocol references use the stable [2025-11-25 specification](https://modelcontextprotocol.io/specification/2025-11-25).

## Executive Finding

The article's central idea is sound: do not inject every tool schema into an agent's starting context. Give the agent a small inventory, let it narrow to one server and one tool, and fetch the full schema only immediately before invocation. MCP supports this interaction model because clients discover tools with `tools/list` and invoke them with `tools/call`; the protocol explicitly leaves the user-interface pattern to implementations ([MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#user-interaction-model), [listing and calling tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#protocol-messages)).

1MCP has already adopted the main thesis, and in a more complete form. Its CLI guide defines `instructions -> inspect <server> -> inspect <server>/<tool> -> run`, while the resident **Aggregated Runtime** keeps MCP lifecycle, routing, auth, filtering, templates, and capability refresh behind that narrow agent-facing surface ([1MCP CLI-mode guide](https://github.com/1mcp-app/agent/blob/a9360041523510ccf6e058e203bdb5fec5cc82e7/docs/en/guide/integrations/cli-mode.md#how-1mcp-cli-mode-works), [`instructions` playbook implementation](https://github.com/1mcp-app/agent/blob/a9360041523510ccf6e058e203bdb5fec5cc82e7/src/commands/instructions/instructionsUtils.ts#L65-L115)). The article is therefore validation of 1MCP's direction, not a reason to replace its architecture.

The highest-value incremental idea is to make the startup bootstrap summary-only and defer server details until `inspect <server>`. Cross-server tool-name search over the existing **Capability Catalog**, with compact output and descriptions opt-in, is the next useful step. The clearest things not to copy are per-server daemon ownership and automatic replay of `tools/call` after transient failures.

### Current 1MCP bootstrap measurement

The live `1mcp instructions` hook used for this research described 10 servers and 87 tools without embedding the 87 tool schemas. Its 13,171 characters encoded to 3,149 tokens with `tiktoken`'s `gpt-4o` encoding. The playbook plus `SERVER SUMMARY` accounted for 654 tokens; the repeated `SERVER DETAILS` section accounted for 2,495 tokens. In this snapshot, deferring server details would reduce the initial payload by about 79% while preserving each server's name, status, availability, tool count, and `hasInstructions` signal.

This is a time-bounded local measurement, not a general benchmark. It nevertheless identifies a concrete duplication: the startup hook eagerly includes server instructions and detailed metadata that `inspect <server>` can already retrieve on demand. A summary mode should keep the current full form available for diagnostics, while `cli-setup` hooks use the compact form by default.

## Article Thesis And Evidence

The article calls the pattern "dynamic context discovery": first discover servers, then inspect one tool schema, then execute it. Its concrete sequence is `mcp-cli`, `mcp-cli info <server> <tool>`, and `mcp-cli call <server> <tool> <json>` ([article, Dynamic Context Discovery](https://www.philschmid.de/mcp-cli#dynamic-context-discovery)). This is progressive disclosure applied to tool schemas.

The article reports about 47,000 tokens for 60 tools across six servers and about 400 after dynamic discovery, described as a 99% reduction ([article, The Context Problem](https://www.philschmid.de/mcp-cli#the-context-problem)). Treat this as a motivating anecdote, not a benchmark: the article does not publish the tool schemas, tokenizer/model, prompt wrapper, measurement script, or repeated-run results needed to reproduce the comparison. The defensible claim is that omitting unused schemas reduces starting context; the exact percentage is workload-dependent.

The protocol evidence supports the shape of the solution. A tool definition contains a name, description, input JSON Schema, and optional output schema, so large catalogs can carry substantial descriptive payload ([MCP Tool data type](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool)). `tools/list` is explicitly a discovery operation and is paginated, while `tools/call` sends only the selected name and arguments ([MCP listing tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#listing-tools), [MCP calling tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#calling-tools)). A server may also return optional initialization instructions as a hint for the model, which explains why both CLIs surface server instructions without requiring every schema to be present ([MCP `InitializeResult`](https://modelcontextprotocol.io/specification/2025-11-25/schema#initializeresult)).

## Verified `mcp-cli` Mechanics

### Progressive discovery and targeted connections

`info <server>` and `info <server>/<tool>` connect only to the named server. `call` also connects only to the named server. Bare listing and `grep` fan out across configured servers, with `grep` applying a concurrency limit and matching a glob against tool names; descriptions are opt-in ([repository architecture table](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/README.md#connection-model-direct), [`grep.ts`](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/src/commands/grep.ts#L112-L212)). This creates a useful middle step between "which servers exist?" and "show one exact schema."

### Shell-oriented input, output, and errors

`call` accepts inline JSON or reads JSON from non-TTY stdin, prints successful text content to stdout, sends errors to stderr, assigns separate client/network/server exit categories, and attempts to include available tools in a not-found error ([`call.ts`](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/src/commands/call.ts#L45-L192), [error examples](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/README.md#error-messages)). These are good agent ergonomics because results remain pipeable and failures include a recovery direction.

1MCP already goes further here. `run` accepts JSON or stdin, can map raw stdin to the first required string argument after schema inspection, supports `compact`, `text`, `toon`, and `json`, and separates stdout from stderr ([1MCP `run` reference](https://github.com/1mcp-app/agent/blob/a9360041523510ccf6e058e203bdb5fec5cc82e7/docs/en/commands/run.md#input-options), [`runUtils.ts`](https://github.com/1mcp-app/agent/blob/a9360041523510ccf6e058e203bdb5fec5cc82e7/src/commands/run/runUtils.ts#L118-L193)). Its shared command runner also emits a versioned JSON failure envelope with error code, retryability, recovery command, and details when JSON output is selected ([`commandRunner.ts`](https://github.com/1mcp-app/agent/blob/a9360041523510ccf6e058e203bdb5fec5cc82e7/src/commands/shared/commandRunner.ts#L3-L98)). The lesson is to keep tightening consistency, not to add another output contract.

### Lazy connection pooling

`mcp-cli` lazily starts one detached daemon per server, communicates through a Unix socket, records a PID and configuration hash for stale detection, and self-terminates after a default 60-second idle timeout. If daemon startup fails, the client falls back to a direct connection ([README daemon design](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/README.md#connection-pooling-daemon), [`daemon.ts`](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/src/daemon.ts), [`daemon-client.ts`](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/src/daemon-client.ts)). This is a pragmatic latency optimization for a standalone CLI that otherwise owns no long-lived runtime.

1MCP should not adopt that ownership model. Its accepted architecture assigns backend subprocess supervision, protocol initialization, routing membership, capability refresh, and recovery to the single **Aggregated Runtime**. Interrupted requests fail without replay while the backend recovers ([ADR 0010](https://github.com/1mcp-app/agent/blob/a9360041523510ccf6e058e203bdb5fec5cc82e7/docs/adr/0010-aggregated-runtime-owns-backend-stdio-supervision.md)). A second per-server daemon layer would duplicate ownership and weaken those lifecycle guarantees.

### Tool filtering

`allowedTools` and `disabledTools` accept name globs; deny rules take precedence, and the same checks are applied to listing and invocation ([`config.ts`](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/src/config.ts#L13-L143)). Enforcing visibility and invocation through the same policy is the important lesson.

1MCP already centrally hides and rejects configured `disabledTools`, including qualified and logical name variants ([`disabledTools.ts`](https://github.com/1mcp-app/agent/blob/a9360041523510ccf6e058e203bdb5fec5cc82e7/src/core/server/disabledTools.ts#L37-L150)). An allowlist could be useful for tightly scoped presets or agents, but simple name globs are not an authorization boundary. Any future allowlist should live in **Capability Visibility**, compose with auth scopes, server/tag filters, templates, and description overrides, and be enforced again at invocation.

## Limitations And Tradeoffs

### Automatic call retry can duplicate side effects

The repository wraps connection, `tools/list`, and `tools/call` in the same transient-error retry helper. The helper retries network errors, timeouts, 429, and selected 5xx responses with exponential backoff and jitter ([`client.ts` retry helper](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/src/client.ts#L80-L205), [`callTool`](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/src/client.ts#L358-L370)).

That is safe enough for discovery, but not generally safe for invocation. A connection may fail after a server performed a write but before the client received the response. MCP tools are arbitrary model-controlled actions and the protocol does not declare general idempotency ([MCP tools overview and safety guidance](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#user-interaction-model)). 1MCP should retain its current no-replay behavior for interrupted calls unless a future tool-level contract explicitly proves idempotency or carries a server-supported idempotency key.

### Discovery stops at the first tool page

`mcp-cli`'s `listTools` calls the SDK's `client.listTools()` once and returns only `result.tools`; it does not follow `nextCursor` ([`client.ts`](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/src/client.ts#L333-L345)). The MCP operation is paginated ([MCP listing tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#listing-tools)), so `info`, `grep`, tool-not-found suggestions, and filtering can be incomplete for paginated servers.

1MCP already exposes `--limit`, `--cursor`, and `--all` for server inspection ([1MCP `inspect` reference](https://github.com/1mcp-app/agent/blob/a9360041523510ccf6e058e203bdb5fec5cc82e7/docs/en/commands/inspect.md)). Any cross-server search must preserve cursor-aware completeness or report a **Partial Capability Walk** with actionable continuation facts; it must not silently search only the first page.

### The CLI covers tools, not the full MCP surface

The public command surface is `info`, `grep`, and `call`, and the source connection abstraction exposes tool listing/calling plus initialization instructions ([README usage](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/README.md#usage), [`client.ts`](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/src/client.ts#L390-L465)). MCP servers may also expose prompts and resources ([MCP server features overview](https://modelcontextprotocol.io/specification/2025-11-25/server)). The tool-only scope is reasonable for a small agent CLI, but it is not a substitute for 1MCP's full MCP aggregation and transport responsibilities.

### Compression and safety are separate concerns

Hiding schemas reduces context, but it does not make a tool safe. The MCP specification recommends that clients expose which tools are available, show inputs, and retain a human ability to deny sensitive calls ([MCP user interaction model](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#user-interaction-model), [security considerations](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#security-considerations)). 1MCP should keep auth, filtering, confirmation/host approval, logging, and output validation as independent controls rather than treating progressive discovery as a security feature.

### Fast-moving documentation needs contract tests

The current repository's `call.ts` implementation describes and emits raw text by default, while parts of the README still describe JSON as the default call output ([`call.ts`](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/src/commands/call.ts#L1-L12), [README call example](https://github.com/philschmid/mcp-cli/blob/d77672a1ce800ec3fec1f43829909badb2ffbd32/README.md#call-a-tool)). This does not invalidate the design, but it shows how quickly an agent-facing CLI contract can drift. 1MCP should keep command help, bootstrap instructions, docs, output envelopes, and end-to-end tests derived from one explicit contract.

## Candidate Lessons For 1MCP

| Priority | Candidate                              | Recommendation                                                                                                                                                                                               | Reason                                                                                                                                                                                              |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Summary-only bootstrap                 | Add an explicit summary/full detail contract for `instructions`, and make generated startup hooks request the summary form by default. Keep per-server instructions discoverable through `inspect <server>`. | The measured live payload drops from 3,149 to 654 GPT-4o tokens when server details are deferred, about a 79% reduction without losing the discovery path.                                          |
| P1       | Cross-server tool search               | Prototype a compact `inspect --match <glob>` or dedicated search command over the **Capability Catalog**. Default to qualified names and arity; make descriptions opt-in.                                    | It fills the largest gap between server inventory and exact-server inspection without reintroducing full schema context. Use resident catalog state rather than connecting every backend per query. |
| P1       | Pagination and partial-result contract | Require cross-server search and inspection to walk pages deliberately or return explicit partial/continuation facts.                                                                                         | The reference CLI's single-page listing is an easy correctness regression, and MCP explicitly paginates `tools/list`.                                                                               |
| P1       | Invocation retry policy                | Preserve no automatic replay for `tools/call`; limit transparent retries to demonstrably safe discovery, attachment, and pre-execution operations.                                                           | Ambiguous failures can otherwise duplicate writes or external actions.                                                                                                                              |
| P2       | Token benchmark harness                | Measure `instructions`, server inspection, exact-tool inspection, and direct-MCP baselines with fixed catalogs, tokenizer/model, prompt wrappers, and checked-in fixtures.                                   | The article's 99% number is directional but not reproducible. 1MCP should publish evidence tied to its own richer surface.                                                                          |
| P2       | Compact server inspection              | Measure whether descriptions in `inspect <server>` dominate real agent context. If so, make names plus required/optional counts the default and descriptions opt-in, while retaining exact-tool detail.      | `mcp-cli -d` shows a useful second compression step, but 1MCP already has pagination and compact/TOON formats, so evidence should precede another flag.                                             |
| P2       | Central allowlist policy               | Explore optional tool allowlists only through **Capability Visibility**, with exact invocation enforcement and composition tests for auth, filters, disabled tools, templates, and aliases.                  | Positive selection can reduce accidental exposure, but glob names alone are not security policy.                                                                                                    |
| Keep     | Resident **Aggregated Runtime**        | Do not add `mcp-cli`-style per-server daemons.                                                                                                                                                               | 1MCP already owns a stronger and explicit lifecycle boundary.                                                                                                                                       |
| Keep     | Structured outputs and recovery errors | Keep the existing versioned JSON failure envelope, stdout/stderr separation, stdin mapping, formats, and recovery commands; audit consistency across `instructions`, `inspect`, `wait`, and `run`.           | Most shell/agent ergonomics from the article are already implemented more completely.                                                                                                               |

## Suggested Next Slices

The first slice should make progressive disclosure true at bootstrap time:

1. Add a stable summary/full detail option to `instructions`; preserve the existing full output for explicit diagnostics.
2. Render only the playbook and server summary in the summary form, including `hasInstructions` so the agent knows when exact server inspection has extra guidance.
3. Update generated startup hooks to request the summary form.
4. Add a fixed-catalog token fixture and a budget assertion for both forms.
5. Verify that `inspect <server>` still supplies the deferred instructions and complete tool summary.

The next slice is read-only cross-server search:

1. Query only currently visible tools from the existing **Capability Catalog**, after runtime context, auth, preset/tag filtering, template routing, and disabled-tool policy have been resolved.
2. Match qualified tool names first; optionally match effective descriptions only when explicitly requested.
3. Return deterministic qualified names, server state, required/optional argument counts, and completion facts. Do not return full schemas.
4. Support JSON/TOON/text output through the existing CLI contract and structured recovery errors through the shared command runner.
5. Add pagination/partial-result tests and a token fixture comparing `instructions -> search -> exact inspect` against `instructions -> inspect several servers -> exact inspect`.

This keeps the article's best ergonomics while preserving the deeper 1MCP architecture.

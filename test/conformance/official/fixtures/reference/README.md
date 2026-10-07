This is the unbundled official conformance example server from publication commit
`c321dd32035556e6769d3724a8ee97d87c3faaac` of
[`modelcontextprotocol/conformance`](https://github.com/modelcontextprotocol/conformance/blob/c321dd32035556e6769d3724a8ee97d87c3faaac/examples/servers/typescript/everything-server.ts).
The pinned npm package does not publish its examples. `provenance.json` records
the original source hash, generated file hash, and transformation recipe. The
upstream license is retained in `LICENSE`.

To reproduce, read that exact source as UTF-8 and call esbuild 0.28.2 `transform`
with `{ loader: 'ts', format: 'esm', target: 'node22', legalComments: 'inline' }`.
Remove the generated hashbang, prepend the two provenance comment lines shown
in the original side of `fixture.patch`, then apply `fixture.patch`. Verify both
hashes against `provenance.json`; do not bundle or upgrade its SDK dependencies.
It resolves the repository's frozen installed dependencies. From the repository
root with frozen dependencies installed, the exact regeneration commands are:

```bash
git clone https://github.com/modelcontextprotocol/conformance.git .tmp/official-reference-source
git -C .tmp/official-reference-source checkout c321dd32035556e6769d3724a8ee97d87c3faaac
node --input-type=module <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const source = await readFile('.tmp/official-reference-source/examples/servers/typescript/everything-server.ts', 'utf8');
const result = await transform(source, { loader: 'ts', format: 'esm', target: 'node22', legalComments: 'inline' });
const header = '// Mechanically transpiled from modelcontextprotocol/conformance at c321dd32035556e6769d3724a8ee97d87c3faaac.\n// See provenance.json and LICENSE. No behavioral edits.\n';
await writeFile('test/conformance/official/fixtures/reference/everything-server.mjs', header + result.code.replace('#!/usr/bin/env node\n', ''));
NODE
cd test/conformance/official/fixtures/reference
patch -p0 < fixture.patch
shasum -a 256 everything-server.mjs
```

Compare the final SHA256 to `generatedSha256` in `provenance.json` and the original
source SHA256 to `sourceSha256`. Retain the upstream `LICENSE` verbatim.

The patch corrects reference-example defects: draft SSE tool results need
the same `resultType: "complete"` discriminant as JSON tool results, and malformed
elicitation `inputResponses` must be rejected before returning complete results.
Modern subscription acknowledgements and subsequent catalog notifications use
`text/event-stream` and SSE framing, as required by the pinned 2026-07-28 HTTP
transport contract. The upstream example sent newline-delimited JSON with
`application/json` and kept the response open; the selected SDK waited for EOF
and timed out before legacy gateway initialization could complete. A real SDK
HTTP subscription regression checks acknowledgement and catalog notification
delivery without changing the suite, dependency pins or production transport.
The four inherited sampling and elicitation tools share their actual callback request
and response-rendering definitions between legacy callbacks and native modern MRTR.
Modern continuations carry a signed binding to the exact tool and arguments; the
fixture validates the returned callback response before deriving its result, without
executing the original tool again. Sampling uses the sampling result schema instead
of incorrectly requiring a request method in the response. The defaults and enum
schemas retain their upstream values. Real legacy and modern SDK clients exercise
these callbacks; forged states, changed arguments, malformed responses, decline and
cancel responses are covered too.

The simple elicitation tool requests the pinned scenario's required `username`
and `email` string fields on both callback paths. The additional owned
`test_custom_header` tool exposes one required string argument annotated
`x-mcp-header: "Value"` and echoes the supplied value. Its modern calls pass
the original headers and parsed request through `@modelcontextprotocol/server`
`createMcpHandler`, adapted by `@modelcontextprotocol/node` `toNodeHandler`.
The public SDK's registered schema performs custom-header decoding and validation
before tool execution. Real HTTP tests cover matching literals and encoded Unicode,
Base64 decoding, literal incomplete markers, malformed Base64, missing headers,
and header/body mismatch. The fixture does not synthesize passing header results.

The modern resource listener honors only requested `test://watched-resource`
watches, emits URI updates with its own subscription id every three seconds, and
releases its update timer on close. Discovery advertises this implemented subscribe
capability. Streaming progress and logging diagnostic tools also use SSE with valid
notification fields and complete-result discriminants; no-log-without-logLevel is
checked through the real SDK transport. These fixture corrections leave the pinned
suite and its validators unchanged.

It also binds the fixture listener explicitly to `127.0.0.1` so local controls
do not expose their synthetic server on other interfaces.
It does not activate tasks. The owned custom-header tool supplies the callable
fixture needed by the pinned server custom-header validation scenario; the pinned
scenario selection and requirement classifications remain unchanged.

Run controls on Node 24, matching CI. Node 26.4.0 triggers an unhandled rejection
inside the pinned suite's legacy multiple-SSE-stream scenario; that missing
report is infrastructure failure, not a passing control.

`serverControl.ts` runs every pinned scenario directly and retains SHA256-verified suite
artifacts in `official-controls/server.<revision>/`. All required scenarios must
have nonempty successful checks to qualify this fixture. Excluded statuses remain
in the artifacts. The foundation runs the gateway independently afterward and
records required-scenario comparisons; a direct success never supplies a gateway
success. The wire tap preserves Host values so DNS rebinding checks reach the peer.

The gateway server target uses `canonicalGatewayTarget.ts` to adapt only pinned
scenario input identities. Before scored scenarios, it reads the verified
reference fixture's catalogs as an allowlist and matches each identity to the
gateway's advertised `_meta['app.1mcp/route']` tuple of kind, server
`official_conformance`, and upstream identity. Missing or ambiguous tuples never
receive guessed routes. Exact tool/prompt names, resource URIs and owned template
instances are replaced with actual advertised identities; matching `Mcp-Name`
headers follow the same replacement. Missing or mismatching headers remain
unchanged, as do raw arguments, metadata and continuation fields.

Responses retain their status, headers and body bytes, including incremental SSE.
The pinned suite, requirements, result validation and output identities remain
unchanged: invalid public names and resource URIs remain failures. Actual
gateway-bound frames and JSON/SSE response payloads receive the same negotiated
envelope schema validation used by the official runner. Sanitized payload digests,
schema outcomes, exact mapping identities and qualification faults are retained
in digest-protected `official-targets/server.<revision>.json` artifacts; raw private payloads
are not retained. These artifacts describe target adaptation, not product success.
Catalog discovery preloads shared catalogs and closes its discovery sessions
before scored exchanges, so these runs do not prove cold-cache behavior.

The modern official gateway leg runs with production authentication and scope
validation enabled. Its owned loopback CLI route issues a genuine grant, checked
through native REST admission before the canonical target starts. The target
adds that same in-memory bearer only to its fixed gateway destination, including
gateway catalog discovery, after the credential-stripping wire tap. Reference
discovery remains anonymous. All other headers and request fields retain their
existing treatment; conflicting Authorization headers fail closed. Qualification
evidence records the authentication mode and credential presence, never the
credential or its digest. Legacy, matrix and official client legs keep their
existing authentication configuration. This exercises authenticated protocol
behavior; it does not supply authorization-server conformance evidence or replace
the separate anonymous rejection checks.

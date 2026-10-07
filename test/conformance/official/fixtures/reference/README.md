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

The patch corrects two reference-example defects: draft SSE tool results need
the same `resultType: "complete"` discriminant as JSON tool results, and malformed
elicitation `inputResponses` must be rejected before returning complete results.
It also binds the fixture listener explicitly to `127.0.0.1` so local controls
do not expose their synthetic server on other interfaces.
It does not activate tasks or implement the excluded draft header scenarios.

Run controls on Node 24, matching CI. Node 26.4.0 triggers an unhandled rejection
inside the pinned suite's legacy multiple-SSE-stream scenario; that missing
report is infrastructure failure, not a passing control.

`serverControl.ts` runs every pinned scenario directly and retains SHA256-verified suite
artifacts in `official-controls/server.<revision>/`. All required scenarios must
have nonempty successful checks to qualify this fixture. Excluded statuses remain
in the artifacts. The foundation runs the gateway independently afterward and
records required-scenario comparisons; a direct success never supplies a gateway
success. The wire tap preserves Host values so DNS rebinding checks reach the peer.

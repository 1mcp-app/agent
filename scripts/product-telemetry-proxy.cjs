const { buildSync } = require('esbuild');
const { isBuiltin } = require('node:module');

/** A self-contained ESM asset that an eval worker can import without a filesystem. */
function buildProductProxyModule(rootDir = process.cwd()) {
  const result = buildSync({
    stdin: {
      contents: "export { getProxyForUrl } from 'proxy-from-env'; export { HttpsProxyAgent } from 'https-proxy-agent';",
      resolveDir: rootDir,
      loader: 'js',
    },
    // Telemetry never enables integrated proxy authentication or loads native Kerberos modules.
    alias: {
      'proxy-agent-negotiate':
        'data:text/javascript,' +
        encodeURIComponent(
          "export function createNegotiateAuth() { throw new Error('Integrated proxy authentication is not enabled for telemetry'); }",
        ),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
    banner: {
      js: "import { createRequire as createTelemetryRequire } from 'node:module'; const require = createTelemetryRequire(process.execPath);",
    },
  });
  for (const output of Object.values(result.metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && !isBuiltin(dependency.path)) {
        throw new Error('Telemetry proxy bundle contains an external package');
      }
    }
  }
  return 'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64');
}

module.exports = { buildProductProxyModule };

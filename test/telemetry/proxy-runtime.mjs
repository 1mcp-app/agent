// Reuse the real proxy transport fixture pattern; this host starts real providers.
// CLI attachment/config behavior is verified separately by the runtime lane.
import { parseTelemetryConfig } from '../../build/config/telemetryConfig.js';
import { startTelemetry, stopTelemetry } from '../../build/observability/telemetry.js';
import { bootstrapTracing } from '../../build/observability/tracing/bootstrap.js';

bootstrapTracing();
await startTelemetry(parseTelemetryConfig(process.env), { role: 'proxy', serviceVersion: '0.39.2' });
const { StdioProxyTransport } = await import('../../build/sdk/legacy/transport/stdioProxyTransport.js');
const proxy = new StdioProxyTransport({ serverUrl: process.argv[2] });
let stopping;
async function stop() {
  stopping ??= (async () => {
    await proxy.close();
    await stopTelemetry({ deadlineMs: Date.now() + 5000 });
  })();
  await stopping;
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    void stop().then(() => process.exit(0));
  });
await proxy.start();

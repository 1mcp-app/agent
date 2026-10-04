import { bootstrapTracing } from '../../../build/observability/tracing/bootstrap.js';

bootstrapTracing();
const { StdioProxyTransport } = await import('../../../build/sdk/legacy/transport/stdioProxyTransport.js');
const proxy = new StdioProxyTransport({ serverUrl: process.argv[2] });
await proxy.start();
process.on('SIGTERM', () => {
  void proxy.close().then(() => process.exit(0));
});

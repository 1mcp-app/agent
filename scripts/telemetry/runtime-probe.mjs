// Test-only preload: measure the actual runtime, identically in every mode.
import { appendFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const output = process.env.ONE_MCP_ACCEPTANCE_PROBE;
if (output) {
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  const timer = setInterval(() => {
    appendFileSync(
      output,
      JSON.stringify({
        pid: process.pid,
        rss: process.memoryUsage().rss,
        eventLoopP99Ms: histogram.percentile(99) / 1e6,
      }) + '\n',
    );
    histogram.reset();
  }, 250);
  timer.unref();
}

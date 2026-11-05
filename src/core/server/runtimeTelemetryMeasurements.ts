import { recordTelemetryMeasurement } from '@src/observability/telemetry.js';

// Process totals across owners. Owner identities never become measurement dimensions.
const depths = { admission: 0, upstream: 0, interaction: 0, subscription: 0 };
export function changeTelemetryQueueDepth(queue: keyof typeof depths, delta: number): void {
  depths[queue] += delta;
  recordTelemetryMeasurement('gateway.queue.depth', depths[queue], { queue });
}

let connections = 0;
export function trackTelemetryConnection(): () => void {
  connections++;
  recordTelemetryMeasurement('gateway.upstream.connections', connections, { connection_state: 'connected' });
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    connections--;
    recordTelemetryMeasurement('gateway.upstream.connections', connections, { connection_state: 'connected' });
  };
}

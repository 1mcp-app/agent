/** SDK-free tracing facade. Correlation never grants authority or selects a route. */
export {
  captureTraceContext,
  getActiveTraceCorrelation,
  injectTraceContext,
  stripBaggage,
  withMcpTraceContext,
} from './otelAdapter.js';
export type { TraceCorrelation } from './otelAdapter.js';

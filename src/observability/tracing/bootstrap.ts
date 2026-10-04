import { installTracingContext } from './otelAdapter.js';

/** Propagation is independent of signal SDK activation, including OTEL_SDK_DISABLED. */
export function bootstrapTracing(): void {
  installTracingContext();
}

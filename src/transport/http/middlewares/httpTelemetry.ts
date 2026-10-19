import { getTelemetryStatus, startTelemetryOperation } from '@src/observability/telemetry.js';
import { withMcpTraceContext } from '@src/observability/tracing/context.js';

import type { NextFunction, Request, Response } from 'express';

/** Reviewed HTTP correlation only; local diagnostic fields never enter the signal API. */
export function httpTelemetry(req: Request, res: Response, next: NextFunction): void {
  if (getTelemetryStatus().state === 'disabled') {
    next();
    return;
  }
  const phase =
    req.path === '/mcp'
      ? 'http-mcp'
      : req.path === '/sse'
        ? 'http-sse'
        : req.path.startsWith('/oauth/')
          ? 'http-oauth'
          : req.path.startsWith('/health')
            ? 'http-health'
            : 'http-other';
  void withMcpTraceContext(
    { _meta: { traceparent: req.headers.traceparent, tracestate: req.headers.tracestate } },
    async () => {
      const operation = startTelemetryOperation({
        kind: 'http',
        phase,
        transport: phase === 'http-sse' ? 'sse' : 'streamable-http',
      });
      await operation.run(
        () =>
          new Promise<void>((resolve) => {
            let completed = false;
            const finish = () => {
              if (completed) return;
              completed = true;
              res.off('finish', finish);
              res.off('close', finish);
              operation.end(
                res.writableFinished ? (res.statusCode >= 500 ? 'internal-error' : 'success') : 'cancelled',
              );
              resolve();
            };
            res.once('finish', finish);
            res.once('close', finish);
            next();
          }),
      );
    },
  );
}

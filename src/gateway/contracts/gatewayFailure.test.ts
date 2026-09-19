import { describe, expect, it } from 'vitest';

import {
  createGatewayFailure,
  gatewayFailureExitCode,
  gatewayFailureFromMcpError,
  gatewayFailureFromUnknown,
  gatewayFailureToMcp,
  gatewayFailureToProblem,
  gatewayFailureToToolResult,
} from './gatewayFailure.js';

describe('gateway failure public projections', () => {
  it('drops hostile messages, data, accessors and arbitrary codes across destinations', () => {
    const raw = new Error('Bearer secret https://private/ argument=value');
    Object.assign(raw, { code: 'secret-code', data: { secret: 'sensitive' } });
    const failure = gatewayFailureFromUnknown(raw, 'transport');
    for (const projection of [
      gatewayFailureToMcp(failure, 'legacy'),
      gatewayFailureToMcp(failure, 'modern'),
      gatewayFailureToProblem(failure),
      gatewayFailureToToolResult(failure),
    ]) {
      expect(JSON.stringify(projection)).not.toMatch(/secret|sensitive|private/);
    }
    expect(gatewayFailureToProblem(failure).status).toBe(502);
    expect(gatewayFailureToToolResult(failure).isError).toBe(true);
    expect(gatewayFailureExitCode(failure)).toBe(5);
  });
  it.each([
    ['invalid-request', 400, 2],
    ['authorization', 403, 3],
    ['deadline-exceeded', 408, 6],
    ['internal', 500, 1],
  ] as const)('projects %s consistently', (kind, status, exit) => {
    const failure = createGatewayFailure({ kind, code: `gateway_${kind}`, message: 'Safe public message' });
    expect(gatewayFailureToProblem(failure).status).toBe(status);
    expect(gatewayFailureExitCode(failure)).toBe(exit);
  });
  it.each([
    ['transport', 'gateway_overloaded', 6],
    ['authorization', 'gateway_authorization_error', 3],
    ['cancelled', 'gateway_cancelled_error', 6],
    ['transport', 'gateway_target_unavailable', 4],
  ] as const)('preserves %s/%s through a serialized MCP projection', (kind, code, exit) => {
    const failure = createGatewayFailure({ kind, code, message: 'Safe message' });
    const wire = JSON.parse(JSON.stringify(gatewayFailureToMcp(failure)));
    expect(gatewayFailureExitCode(gatewayFailureFromMcpError(wire))).toBe(exit);
    expect(gatewayFailureFromUnknown(wire, 'protocol').kind).toBe('protocol');
  });

  it('rejects inconsistent wire classifications and drops untrusted diagnostics', () => {
    const projection = {
      code: -32602,
      message: 'Bearer secret',
      data: { 'app.1mcp/failure': { kind: 'authorization', code: 'secret' } },
    };
    expect(gatewayFailureFromMcpError(projection)).toMatchObject({ kind: 'protocol', code: '-32602' });
    projection.code = -32000;
    const failure = gatewayFailureFromMcpError(projection);
    expect(failure.kind).toBe('authorization');
    expect(JSON.stringify(failure)).not.toContain('secret');
  });

  it('translates the actual numeric legacy resource-not-found code', () => {
    const failure = gatewayFailureFromUnknown({ code: -32002, message: 'private uri' }, 'transport');
    expect(gatewayFailureToMcp(failure, 'legacy').code).toBe(-32002);
    expect(gatewayFailureToMcp(failure, 'modern').code).toBe(-32602);
  });
});

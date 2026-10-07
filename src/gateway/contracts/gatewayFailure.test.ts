import { InvalidJsonValueError, JSON_VALUE_LIMITS } from '@src/sdk/contracts/jsonValue.js';

import { describe, expect, it } from 'vitest';

import {
  createGatewayFailure,
  detachGatewayFailure,
  gatewayFailureExitCode,
  gatewayFailureFromMcpError,
  gatewayFailureFromUnknown,
  gatewayFailureToMcp,
  gatewayFailureToProblem,
  gatewayFailureToToolResult,
  MISSING_CLIENT_CAPABILITY,
  missingClientCapabilityFailure,
  missingClientCapabilityFromBridge,
  resourceNotFoundFailure,
  resourceNotFoundFromBridge,
  ResourceRouteNotFoundError,
} from './gatewayFailure.js';

describe('gateway failure public projections', () => {
  it('preserves only locally owned requested resource URI facts through normalization and detachment', () => {
    const uri = 'test://unknown%2f?q=a%20b#part';
    const owned = resourceNotFoundFailure(uri);
    const error = new ResourceRouteNotFoundError(uri);
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.data)).toBe(true);
    for (const value of [owned, error, detachGatewayFailure(owned), gatewayFailureFromUnknown(owned)]) {
      const failure = gatewayFailureFromUnknown(value);
      const modern = gatewayFailureToMcp(failure, 'modern');
      expect(modern).toEqual({
        code: -32602,
        message: 'Unknown resource',
        data: { 'app.1mcp/failure': { kind: 'protocol', code: 'resource_not_found' }, uri },
      });
      expect(Object.isFrozen(modern.data)).toBe(true);
      expect(gatewayFailureToMcp(failure, 'legacy').code).toBe(-32002);
    }
    for (const foreign of [
      { ...owned },
      Object.create(owned),
      { code: -32002, message: 'SECRET', data: { uri } },
      Object.create(ResourceRouteNotFoundError.prototype),
      Object.assign(Object.create(ResourceRouteNotFoundError.prototype), { code: -32002, data: { uri } }),
      createGatewayFailure({ kind: 'protocol', code: 'resource_not_found', message: 'generic', data: { uri } }),
    ]) {
      const projected = gatewayFailureToMcp(gatewayFailureFromUnknown(foreign), 'modern');
      expect(projected.data).not.toHaveProperty('uri');
      expect(projected.message).not.toContain(uri);
      expect(projected.message).not.toContain('SECRET');
    }
  });

  it('inherits the shared scalar budget without recharging an owned error wrapper', () => {
    const uri = `test://${'x'.repeat(JSON_VALUE_LIMITS.maxTotalStringLength - 7)}`;
    const owned = resourceNotFoundFailure(uri);
    const error = new ResourceRouteNotFoundError(uri);
    for (const value of [owned, error, detachGatewayFailure(owned), gatewayFailureFromUnknown(owned)]) {
      const modern = gatewayFailureToMcp(gatewayFailureFromUnknown(value), 'modern');
      expect(modern.code).toBe(-32602);
      expect(modern.data).toHaveProperty('uri', uri);
    }
    expect(() => resourceNotFoundFailure(`${uri}x`)).toThrow(InvalidJsonValueError);
  });

  it('restores bridge resource facts only for native errors and the exact expected URI', () => {
    const uri = 'test://expected';
    const wire = gatewayFailureToMcp(resourceNotFoundFailure(uri), 'legacy');
    const error = Object.assign(new Error('foreign diagnostics'), wire);
    expect(resourceNotFoundFromBridge(error, uri)).toEqual(resourceNotFoundFailure(uri));
    expect(resourceNotFoundFromBridge(error, 'test://other')).toBeUndefined();
    expect(resourceNotFoundFromBridge(wire, uri)).toBeUndefined();
    expect(resourceNotFoundFromBridge(Object.create(error), uri)).toBeUndefined();
    expect(resourceNotFoundFromBridge(Object.assign(new Error('SECRET'), wire, { code: -32602 }), uri)).toBeUndefined();
    expect(
      resourceNotFoundFromBridge(Object.assign(new Error('SECRET'), wire, { data: { uri } }), uri),
    ).toBeUndefined();
  });
  it('retains only bounded capability facts in an owned missing-capability projection', () => {
    const source = { sampling: {}, elicitation: { form: {} }, 'custom.capability': { supported: true } };
    const failure = missingClientCapabilityFailure(source)!;
    source.sampling = { secret: 'later' };
    expect(gatewayFailureToMcp(failure, 'modern')).toEqual({
      code: -32021,
      message: 'Interaction capability required',
      data: {
        requiredCapabilities: { sampling: {}, elicitation: { form: {} }, 'custom.capability': { supported: true } },
        'app.1mcp/failure': { kind: 'protocol', code: MISSING_CLIENT_CAPABILITY },
      },
    });
    const wire = JSON.parse(JSON.stringify(gatewayFailureToMcp(failure, 'modern')));
    expect(missingClientCapabilityFromBridge(wire)).toEqual(failure);
    // The general foreign-error path cannot acquire this trust.
    expect(gatewayFailureToMcp(gatewayFailureFromUnknown(wire, 'transport')).code).toBe(-32000);
    expect(missingClientCapabilityFromBridge({ ...wire, code: -32603 })).toBeUndefined();
    expect(
      missingClientCapabilityFromBridge({ ...wire, data: { requiredCapabilities: { sampling: {} } } }),
    ).toBeUndefined();
  });

  it('rejects malformed, unbounded and accessor capability payloads', () => {
    const getter = Object.defineProperty({}, 'sampling', {
      enumerable: true,
      get: () => {
        throw new Error('must not access');
      },
    });
    for (const value of [
      null,
      [],
      {},
      { sampling: [] },
      { sampling: true },
      { sampling: { value: 'x'.repeat(4097) } },
      getter,
    ])
      expect(missingClientCapabilityFailure(value)).toBeUndefined();
    const foreign = {
      kind: 'protocol' as const,
      code: MISSING_CLIENT_CAPABILITY,
      message: 'secret',
      data: { requiredCapabilities: { sampling: {} } },
    };
    expect(gatewayFailureToMcp(foreign).code).toBe(-32000);
  });
  it.each([
    ['schema_evaluation_timeout', 6],
    ['schema_evaluation_unavailable', 6],
    ['schema_budget_exceeded', 2],
  ] as const)('retains %s in CLI classification without forwarding diagnostic payloads', (code, exit) => {
    const error = {
      code: code === 'schema_budget_exceeded' ? -32602 : -32000,
      message: 'SECRET',
      data: {
        'app.1mcp/failure': {
          kind: code === 'schema_budget_exceeded' ? 'invalid-request' : 'protocol',
          code,
          extra: 'SECRET',
        },
      },
    };
    const failure = gatewayFailureFromMcpError(error);
    expect(gatewayFailureExitCode(failure)).toBe(exit);
    expect(JSON.stringify(failure)).not.toContain('SECRET');
    expect(gatewayFailureExitCode(gatewayFailureFromMcpError({ ...error, code: 500 }))).toBe(1);
  });
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

import { describe, expect, it, vi } from 'vitest';

import { productClientFamily, productOperationName, productOperationOutcome } from './operation.js';

describe('closed operation labels', () => {
  it.each([
    ['claude-ai', 'claude'],
    ['claude-code', 'claude'],
    ['codex-mcp-client', 'codex'],
    ['cursor', 'cursor'],
    ['vscode', 'vscode'],
    ['Visual Studio Code', 'vscode'],
  ])('recognizes the finite client alias %s', (name, expected) => {
    expect(productClientFamily({ name })).toBe(expected);
  });
  it('uses only safe terminal error flags and does not read workload content', () => {
    const getter = vi.fn(() => true);
    expect(productOperationOutcome({ result: { isError: true, content: 'private' } })).toBe('failure');
    expect(productOperationOutcome({ error: { message: 'private-error' } })).toBe('failure');
    expect(productOperationOutcome({ result: { resultType: 'input_required', requestState: 'private-state' } })).toBe(
      'success',
    );
    expect(productOperationOutcome({ result: Object.defineProperty({}, 'isError', { get: getter }) })).toBe('success');
    expect(getter).not.toHaveBeenCalled();
  });

  it('recognizes exact client names without reading accessors, proxies, title or version', () => {
    expect(productClientFamily({ name: 'codex', title: 'private', version: 'secret' })).toBe('codex');
    expect(productClientFamily({ name: 'arbitrary-private-name' })).toBe('other');
    const getter = vi.fn(() => 'codex');
    expect(productClientFamily(Object.defineProperty({}, 'name', { get: getter }))).toBe('other');
    expect(
      productClientFamily(
        new Proxy(
          { name: 'codex' },
          {
            getOwnPropertyDescriptor: () => {
              getter();
              return undefined;
            },
          },
        ),
      ),
    ).toBe('other');
    expect(getter).not.toHaveBeenCalled();
    expect(productClientFamily(undefined)).toBe('other');
    expect(productOperationName('tools/call')).toBe('tools_call');
    expect(productOperationName('private/method')).toBe('other');
  });
});

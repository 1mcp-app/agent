import { describe, expect, it } from 'vitest';

import { getDisabledSourceToolError, isSourceToolDisabled } from './disabledTools.js';
import { applySourceToolDescription } from './toolDescriptionOverrides.js';

describe('catalog source tool identity configuration', () => {
  it('does not reinterpret a source name that resembles a public identity', () => {
    const config = { command: 'test', disabledTools: ['read'], toolDescriptionOverrides: { read: 'override' } };
    expect(isSourceToolDisabled({ server: config }, 'server', 'server_1mcp_read')).toBe(false);
    expect(getDisabledSourceToolError({ server: config }, 'server', 'server_1mcp_read')).toBeUndefined();
    expect(applySourceToolDescription({ name: 'server_1mcp_read', description: 'original' }, config, 'server')).toEqual(
      { name: 'server_1mcp_read', description: 'original' },
    );
  });

  it('accepts the exact source name and its configured canonical identity', () => {
    const config = {
      command: 'test',
      disabledTools: ['server_1mcp_read'],
      toolDescriptionOverrides: { server_1mcp_read: 'override' },
    };
    expect(isSourceToolDisabled({ server: config }, 'server', 'read')).toBe(true);
    expect(applySourceToolDescription({ name: 'read', description: '' }, config, 'server').description).toBe(
      'override',
    );
  });
});

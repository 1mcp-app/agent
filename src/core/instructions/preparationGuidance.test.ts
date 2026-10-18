import { formatInstructionsOutput } from '@src/commands/instructions/instructionsUtils.js';

import { describe, expect, it } from 'vitest';

import { renderManagedDocContent } from './instructionsDistribution.js';
import { DEFAULT_CLI_INSTRUCTION_TEMPLATE } from './templateTypes.js';

describe('preparation guidance delivery', () => {
  it.each([
    ['managed bootstrap', renderManagedDocContent()],
    ['runtime template', DEFAULT_CLI_INSTRUCTION_TEMPLATE],
    ['standalone formatter', formatInstructionsOutput({ servers: [], details: [] })],
  ])('teaches authorized recovery through %s', (_surface, content) => {
    for (const action of ['inspect', 'start', 'status', 'wait', 'cancel', 'retry']) {
      expect(content).toContain(`1mcp prepare ${action} <backend>`);
    }
    expect(content).toContain('same runtime (--url/--context)');
    expect(content).toContain('assigned --project/--project-set');
    expect(content).toContain('preserve --operation');
    expect(content).toContain('existing user authorization and runtime permissions');
    expect(content).toContain('never executes or replays the original tool call');
    expect(content).toContain('refresh server discovery and inspect the tool schema');
    expect(content).toContain('never an automatic retry loop');
  });
});

import { formatInstructionsOutput } from '@src/commands/instructions/instructionsUtils.js';

import { describe, expect, it } from 'vitest';

import { INSPECTION_GUIDANCE } from './inspectionGuidance.js';
import { renderManagedDocContent } from './instructionsDistribution.js';
import { DEFAULT_CLI_INSTRUCTION_TEMPLATE } from './templateTypes.js';

describe('session inspection reuse', () => {
  it('keeps managed, runtime, and legacy instructions consistent', () => {
    for (const content of [
      renderManagedDocContent(),
      DEFAULT_CLI_INSTRUCTION_TEMPLATE,
      formatInstructionsOutput({ servers: [], details: [] }),
    ]) {
      expect(content).toContain(INSPECTION_GUIDANCE);
      expect(content).toContain('including across projects');
      expect(content).toContain('project-specific instructions, readiness, authorization, and target selection');
      expect(content).toContain('capabilities change, preparation completes, or relevant failures occur');
      expect(content).toContain('Never automatically replay failed tool calls');
      expect(content).not.toContain('only after inspecting the tool');
    }
  });
});

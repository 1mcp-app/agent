import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

function readUpdateVersionWorkflow(): string {
  return fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'update-version.yml'), 'utf8');
}

describe('update-version workflow', () => {
  it('generates the changelog with the release version before the tag exists', () => {
    const workflow = readUpdateVersionWorkflow();

    expect(workflow).toContain('args: --verbose --tag v${{ inputs.version }}');
  });
});

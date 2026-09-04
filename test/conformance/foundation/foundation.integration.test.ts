import { join } from 'node:path';

import { conformanceExitCode } from '../baseline/baseline.js';
import { runFoundationConformance } from './foundationRun.js';

const runIntegration = process.env.ONE_MCP_RUN_CONFORMANCE_INTEGRATION === 'true';

describe.runIf(runIntegration)('exact-source conformance foundation', () => {
  it(
    'executes official requirements and every gateway matrix assignment before finalizing evidence',
    async () => {
      const root = process.cwd();
      const mode = process.env.ONE_MCP_CONFORMANCE_MODE === 'gate' ? 'gate' : 'baseline';
      const outputDirectory = process.env.ONE_MCP_CONFORMANCE_OUTPUT_DIR ?? join(root, '.tmp', 'conformance');
      const baseline = await runFoundationConformance({ root, mode, outputDirectory });

      expect(baseline.attempt).toBe(1);
      expect(baseline.officialRuns).toHaveLength(4);
      expect(baseline.matrixRuns).toHaveLength(12);
      expect(baseline.sdkBoundaryProof).toMatchObject({ classification: 'product', productVerdict: 'pass' });
      expect(conformanceExitCode(mode, baseline)).toBe(0);
    },
    20 * 60_000,
  );
});

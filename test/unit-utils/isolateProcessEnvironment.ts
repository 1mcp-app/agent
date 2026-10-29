import { afterAll } from 'vitest';

import { isolatedTestEnvironment } from '../../scripts/test-process-environment.mjs';

const isolated = isolatedTestEnvironment();
for (const key of Object.keys(process.env)) {
  if (key.startsWith('ONE_MCP_')) delete process.env[key];
}
Object.assign(process.env, isolated.env);
afterAll(() => isolated.cleanup());

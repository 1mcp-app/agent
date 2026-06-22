import { afterEach, describe, expect, it } from 'vitest';

import { CommandTestEnvironment } from './CommandTestEnvironment.js';

describe('CommandTestEnvironment', () => {
  let environment: CommandTestEnvironment | undefined;

  afterEach(async () => {
    await environment?.cleanup();
    environment = undefined;
  });

  it('does not leak mock registry URL into generic subprocess environment', async () => {
    environment = new CommandTestEnvironment({
      name: 'mock-registry-env-test',
      mockRegistry: true,
    });
    await environment.setup();

    expect(environment.getRegistryUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(environment.getEnvironmentVariables()).not.toHaveProperty('ONE_MCP_REGISTRY_URL');
  });
});

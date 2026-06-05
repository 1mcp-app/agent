import { describe, expect, it } from 'vitest';

import {
  createRegistryInstallSource,
  installationWorkflowFailureMessage,
  validateRegistryServerId,
} from './installSource.js';

describe('installSource', () => {
  it('trims registry ids when creating registry install sources', () => {
    expect(
      createRegistryInstallSource({
        registryServerId: '  io.github.owner/server  ',
        serverName: 'server',
      }),
    ).toMatchObject({
      type: 'registry',
      registryId: 'io.github.owner/server',
      localName: 'server',
    });
  });

  it('rejects invalid registry ids after trimming', () => {
    expect(() => validateRegistryServerId(' /bad ')).toThrow('Registry server ID has invalid format');
    expect(() =>
      createRegistryInstallSource({
        registryServerId: '  ',
        serverName: 'server',
      }),
    ).toThrow('Registry server ID cannot be empty');
  });

  it('falls back to workflow status when field errors are empty', () => {
    expect(
      installationWorkflowFailureMessage({
        status: 'invalid_input',
        mode: 'apply',
        sourceType: 'registry',
        fieldErrors: {},
        warnings: [],
      }),
    ).toBe('Installation workflow returned invalid_input');
  });
});

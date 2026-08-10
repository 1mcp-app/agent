import { configuredServerCreateContract } from './configuredServerCreate.fixtures';
import {
  configuredServerCreateDraft,
  createConfiguredServerCreateState,
  reduceConfiguredServerCreateState,
} from './configuredServerCreateState';

describe('configured server create state', () => {
  it('serializes only fields for the selected transport and keeps secrets replace-only', () => {
    let state = reduceConfiguredServerCreateState(createConfiguredServerCreateState(), {
      type: 'contractLoaded',
      contract: configuredServerCreateContract(),
    });
    state = reduceConfiguredServerCreateState(state, { type: 'fieldChanged', fieldPath: ['name'], value: 'custom' });
    state = reduceConfiguredServerCreateState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'command'],
      value: 'node',
    });
    state = reduceConfiguredServerCreateState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'url'],
      value: 'https://ignored.example/mcp',
    });
    state = reduceConfiguredServerCreateState(state, {
      type: 'secretAdded',
      secret: {
        id: 'secret-1',
        container: 'env',
        key: 'API_TOKEN',
        replacementKind: 'environmentReference',
        replacementValue: 'CUSTOM_TOKEN',
      },
    });

    expect(configuredServerCreateDraft(state)).toEqual({
      name: 'custom',
      enabled: true,
      tags: [],
      transport: { type: 'stdio', command: 'node', args: [], env: {} },
      secrets: [
        {
          fieldPath: ['env', 'API_TOKEN'],
          action: 'replace',
          replacement: { kind: 'environmentReference', value: 'CUSTOM_TOKEN' },
        },
      ],
    });

    state = reduceConfiguredServerCreateState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'type'],
      value: 'sse',
    });
    expect(configuredServerCreateDraft(state)).toEqual({
      name: 'custom',
      enabled: true,
      tags: [],
      transport: { type: 'sse', url: 'https://ignored.example/mcp', headers: {} },
    });
  });

  it('clears in-memory inline secrets when creation closes', () => {
    let state = reduceConfiguredServerCreateState(createConfiguredServerCreateState(), {
      type: 'contractLoaded',
      contract: configuredServerCreateContract(),
    });
    state = reduceConfiguredServerCreateState(state, {
      type: 'secretAdded',
      secret: {
        id: 'secret-1',
        container: 'env',
        key: 'API_TOKEN',
        replacementKind: 'inlineSecret',
        replacementValue: 'raw-secret',
      },
    });

    expect(state).toMatchObject({ status: 'editing', secrets: [{ replacementValue: 'raw-secret' }] });
    expect(reduceConfiguredServerCreateState(state, { type: 'closed' })).toEqual({ status: 'idle' });
  });
});

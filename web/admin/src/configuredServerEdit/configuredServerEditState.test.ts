import { configuredServerDetailState } from '../components/AdminConsoleApp.fixtures';
import {
  configuredServerEditDraft,
  createConfiguredServerEditState,
  reduceConfiguredServerEditState,
} from './configuredServerEditState';

function detail() {
  const state = configuredServerDetailState();
  if (state.status !== 'loaded') throw new Error('Expected loaded fixture');
  return state.detail;
}

describe('configured server edit state', () => {
  it('initializes a loaded contract without a dirty draft', () => {
    const state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: detail(),
    });

    expect(state.status).toBe('loaded');
    if (state.status !== 'loaded') return;
    expect(state.dirty).toBe(false);
    expect(state.fieldDraft['transport\0url']).toBe('https://example.com/mcp?token=REDACTED');
    expect(state.secretDraft['url\0query\0token']).toMatchObject({ action: 'preserve' });
    expect(configuredServerEditDraft(state)).toEqual({});
  });

  it('owns normalized field and secret draft construction', () => {
    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: detail(),
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'url'],
      value: 'https://example.com/v2/mcp',
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'secretChanged',
      fieldPath: ['url', 'query', 'token'],
      value: {
        fieldPath: ['url', 'query', 'token'],
        action: 'replace',
        replacementKind: 'environmentReference',
        replacementValue: 'GITHUB_TOKEN',
      },
    });

    expect(state.status).toBe('loaded');
    if (state.status !== 'loaded') return;
    expect(state.dirty).toBe(true);
    expect(configuredServerEditDraft(state)).toEqual({
      transport: { url: 'https://example.com/v2/mcp' },
      secrets: [
        {
          fieldPath: ['url', 'query', 'token'],
          action: 'replace',
          replacement: { kind: 'environmentReference', value: 'GITHUB_TOKEN' },
        },
      ],
    });
  });

  it('invalidates an existing preview when the draft changes', () => {
    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: detail(),
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'previewSucceeded',
      preview: {
        targetName: 'github',
        proposedTargetName: 'github',
        previewFingerprint: 'preview-old',
        validation: { status: 'valid', errors: [] },
        diff: [],
        configChange: {
          status: 'preview',
          operation: 'update',
          target: { name: 'github', source: 'mcpServers' },
          changed: false,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'not_attempted' },
        },
        connectivityCheck: { status: 'skipped', reason: 'connection_critical_fields_unchanged' },
      },
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'url'],
      value: 'https://example.com/changed',
    });

    expect(state.status).toBe('loaded');
    if (state.status !== 'loaded') return;
    expect(state.preview).toBeUndefined();
    expect(state.previewError).toBeUndefined();
  });

  it('serializes only fields applicable to the selected transport while retaining hidden draft values', () => {
    const conversionDetail = detail();
    conversionDetail.editContract.schemaVersion = 2;
    conversionDetail.editContract.fieldGroups[0].fields.push(
      {
        fieldPath: ['transport', 'type'],
        label: 'Transport Type',
        control: 'select',
        value: 'http',
        options: ['stdio', 'http', 'sse', 'streamableHttp'],
        editable: true,
      },
      {
        fieldPath: ['transport', 'command'],
        label: 'Command',
        control: 'text',
        value: '',
        editable: true,
        applicableTransportTypes: ['stdio'],
      },
      {
        fieldPath: ['transport', 'args'],
        label: 'Args',
        control: 'string-list',
        value: [],
        editable: true,
        applicableTransportTypes: ['stdio'],
      },
    );
    const urlField = conversionDetail.editContract.fieldGroups[0].fields.find(
      (field) => field.fieldPath.join('.') === 'transport.url',
    );
    if (!urlField) throw new Error('Expected URL field');
    urlField.applicableTransportTypes = ['http', 'sse', 'streamableHttp'];

    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: conversionDetail,
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'url'],
      value: 'https://draft.example.com/mcp',
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'type'],
      value: 'stdio',
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'command'],
      value: 'node',
    });

    expect(state.status).toBe('loaded');
    if (state.status !== 'loaded') return;
    expect(state.fieldDraft['transport\0url']).toBe('https://draft.example.com/mcp');
    expect(configuredServerEditDraft(state)).toEqual({ transport: { type: 'stdio', command: 'node' } });

    state = reduceConfiguredServerEditState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'type'],
      value: 'http',
    });
    expect(state.status).toBe('loaded');
    if (state.status !== 'loaded') return;
    expect(configuredServerEditDraft(state)).toEqual({
      transport: { url: 'https://draft.example.com/mcp' },
    });
  });
});

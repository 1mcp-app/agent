import { configuredServerDetailState } from '../components/AdminConsoleApp.fixtures';
import {
  configuredServerEditDraft,
  createConfiguredServerEditState,
  reduceConfiguredServerEditState,
} from './configuredServerEditState';
import { configuredServerApplyEligibility } from './useConfiguredServerEdit';

function detail() {
  const state = configuredServerDetailState();
  if (state.status !== 'loaded') throw new Error('Expected loaded fixture');
  return state.detail;
}

function toolInventoryRow(name: string) {
  return {
    name,
    effectiveDescription: `${name} upstream`,
    descriptionOverridden: false,
    enabled: true,
    observed: true,
    unresolved: false,
    observedInstanceCount: 1,
    activeInstanceCount: 1,
    observedInSomeInstances: false,
    approximateTokens: 10,
  };
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

  it('serializes complete configured-tool selection and description overrides', () => {
    const toolDetail = detail();
    toolDetail.toolInventory = {
      targetName: 'github',
      source: 'mcpServers',
      targetEnabled: true,
      freshness: 'live',
      model: 'gpt-4o',
      generation: 'generation-1',
      activeInstanceCount: 1,
      rows: [
        {
          name: 'read',
          effectiveDescription: 'Read upstream',
          descriptionOverridden: false,
          enabled: true,
          observed: true,
          unresolved: false,
          observedInstanceCount: 1,
          activeInstanceCount: 1,
          observedInSomeInstances: false,
          approximateTokens: 10,
        },
        {
          name: 'write',
          effectiveDescription: 'Write safely',
          descriptionOverride: 'Write safely',
          descriptionOverridden: true,
          enabled: false,
          observed: true,
          unresolved: false,
          observedInstanceCount: 1,
          activeInstanceCount: 1,
          observedInSomeInstances: false,
          approximateTokens: 12,
        },
      ],
      counts: { observed: 2, enabled: 1, disabled: 1, unresolved: 0 },
      approximateTokens: { enabled: 10, allObserved: 22, savings: 12 },
    };
    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: toolDetail,
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'toolChanged',
      name: 'read',
      enabled: false,
      descriptionOverride: 'Read safely',
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'toolChanged',
      name: 'write',
      enabled: true,
      descriptionOverride: '',
    });

    expect(configuredServerEditDraft(state)).toEqual({
      disabledTools: ['read'],
      toolDescriptionOverrides: { read: 'Read safely' },
    });
  });

  it('preserves unsaved tool edits and adds newly observed rows after recalculation', () => {
    const toolDetail = detail();
    toolDetail.toolInventory = {
      targetName: 'github',
      source: 'mcpServers',
      targetEnabled: true,
      freshness: 'live',
      model: 'gpt-4o',
      generation: 'generation-1',
      activeInstanceCount: 1,
      rows: [toolInventoryRow('search')],
      counts: { observed: 1, enabled: 1, disabled: 0, unresolved: 0 },
      approximateTokens: { enabled: 10, allObserved: 10, savings: 0 },
    };
    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: toolDetail,
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'toolChanged',
      name: 'search',
      descriptionOverride: 'Search safely',
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'toolInventoryRecalculated',
      inventory: {
        ...toolDetail.toolInventory,
        model: 'gpt-4o-mini',
        generation: 'generation-2',
        rows: [toolInventoryRow('search'), toolInventoryRow('issues')],
        counts: { observed: 2, enabled: 2, disabled: 0, unresolved: 0 },
        approximateTokens: { enabled: 20, allObserved: 20, savings: 0 },
      },
    });
    state = reduceConfiguredServerEditState(state, { type: 'toolChanged', name: 'issues', enabled: false });

    expect(configuredServerEditDraft(state)).toEqual({
      disabledTools: ['issues'],
      toolDescriptionOverrides: { search: 'Search safely' },
    });
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

  it('allows an explicit override when an enabled remote connection-critical check fails', () => {
    const proposedEnableDetail = detail();
    proposedEnableDetail.server.enabled = false;
    proposedEnableDetail.editContract.capabilities.apply.supported = true;
    proposedEnableDetail.editContract.fieldGroups.unshift({
      id: 'identity',
      label: 'Identity',
      fields: [{ fieldPath: ['enabled'], label: 'Enabled', control: 'switch', value: false, editable: true }],
    });
    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: proposedEnableDetail,
    });
    state = reduceConfiguredServerEditState(state, { type: 'fieldChanged', fieldPath: ['enabled'], value: true });
    state = reduceConfiguredServerEditState(state, {
      type: 'previewSucceeded',
      preview: previewWithConnectionFailure(),
    });

    expect(configuredServerApplyEligibility(state)).toEqual({ eligible: true });
  });

  it('tracks clearing and restoring a server transport override in the normalized draft', () => {
    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: detail(),
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'transportOverrideChanged',
      key: 'requestTimeout',
      clear: true,
    });
    expect(configuredServerEditDraft(state)).toEqual({ clearTransportOverrides: ['requestTimeout'] });
    expect(state).toMatchObject({ dirty: true });

    state = reduceConfiguredServerEditState(state, {
      type: 'transportOverrideChanged',
      key: 'requestTimeout',
      clear: false,
    });
    expect(configuredServerEditDraft(state)).toEqual({});
    expect(state).toMatchObject({ dirty: false });
  });

  it('owns instruction outcomes in the dirty preview state machine', () => {
    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: detail(),
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'instructionOverrideChanged',
      mode: 'replace',
      value: 'Operator guidance',
    });
    expect(configuredServerEditDraft(state)).toEqual({
      instructionOverride: { action: 'set', value: 'Operator guidance' },
    });
    expect(state).toMatchObject({ status: 'loaded', dirty: true });

    state = reduceConfiguredServerEditState(state, { type: 'instructionOverrideChanged', mode: 'suppress' });
    expect(configuredServerEditDraft(state)).toEqual({ instructionOverride: { action: 'set', value: '' } });

    state = reduceConfiguredServerEditState(state, { type: 'instructionOverrideChanged', mode: 'replace' });
    expect(configuredServerEditDraft(state)).toEqual({
      instructionOverride: { action: 'set', value: 'Operator guidance' },
    });

    state = reduceConfiguredServerEditState(state, { type: 'instructionOverrideChanged', mode: 'upstream' });
    expect(configuredServerEditDraft(state)).toEqual({});
    expect(state).toMatchObject({ status: 'loaded', dirty: false });
  });

  it('rejects non-override draft changes for template-backed targets', () => {
    const templateDetail = detail();
    templateDetail.server.source = 'mcpTemplates';
    templateDetail.server.target.source = 'mcpTemplates';
    templateDetail.editContract.target.source = 'mcpTemplates';
    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: templateDetail,
    });

    state = reduceConfiguredServerEditState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'url'],
      value: 'https://unsupported.example/mcp',
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'transportOverrideChanged',
      key: 'requestTimeout',
      clear: true,
    });

    expect(configuredServerEditDraft(state)).toEqual({});
    expect(state).toMatchObject({ status: 'loaded', dirty: false });
  });

  it('invalidates stale previews and keeps committed writes non-retryable when detail refresh fails', () => {
    const applyDetail = detail();
    applyDetail.editContract.capabilities.apply.supported = true;
    let state = reduceConfiguredServerEditState(createConfiguredServerEditState(), {
      type: 'detailLoaded',
      serverId: 'github',
      detail: applyDetail,
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'fieldChanged',
      fieldPath: ['transport', 'url'],
      value: 'https://new.example/mcp',
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'previewSucceeded',
      preview: previewWithConnectionFailure(),
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'applyFailed',
      message: 'Apply failed: Preview is stale.',
      clearPreview: true,
    });
    expect(state).toMatchObject({ status: 'loaded', dirty: true, preview: undefined });

    state = reduceConfiguredServerEditState(state, {
      type: 'previewSucceeded',
      preview: previewWithConnectionFailure(),
    });
    state = reduceConfiguredServerEditState(state, { type: 'applyStarted' });
    state = reduceConfiguredServerEditState(state, {
      type: 'applyCommitted',
      serverId: 'github-renamed',
      result: {
        originalTargetName: 'github',
        targetName: 'github-renamed',
        previewFingerprint: 'preview-critical',
        configChange: previewWithConnectionFailure().configChange,
      },
    });
    state = reduceConfiguredServerEditState(state, {
      type: 'applyRefreshFailed',
      message: 'Changes were applied, but server detail could not be refreshed.',
    });
    expect(state).toMatchObject({
      status: 'committedRefreshFailed',
      serverId: 'github-renamed',
      success: 'Changes applied to github-renamed.',
      message: 'Changes were applied, but server detail could not be refreshed.',
    });
    expect(state).not.toHaveProperty('dirty');
    expect(state).not.toHaveProperty('fieldDraft');
  });

  it('keeps a committed reload failure as a warning on freshly loaded disk detail', () => {
    const refreshedDetail = detail();
    refreshedDetail.server.transport.url = 'https://new.example/mcp';
    const failedReload = previewWithConnectionFailure().configChange;
    failedReload.reload = { status: 'failed', error: 'reload timed out' };
    const state = reduceConfiguredServerEditState(
      { status: 'committed', serverId: 'github', success: 'Applied.' },
      {
        type: 'applySucceeded',
        serverId: 'github',
        detail: refreshedDetail,
        result: {
          originalTargetName: 'github',
          targetName: 'github',
          previewFingerprint: 'preview-critical',
          configChange: failedReload,
        },
      },
    );

    expect(state).toMatchObject({
      status: 'loaded',
      dirty: false,
      detail: { server: { transport: { url: 'https://new.example/mcp' } } },
      applySuccess: 'Changes applied to github.',
      applyWarning: 'Configuration was written, but runtime reload failed: reload timed out',
    });
    expect(state).not.toHaveProperty('applyError');
  });
});

function previewWithConnectionFailure() {
  return {
    targetName: 'github',
    proposedTargetName: 'github',
    previewFingerprint: 'preview-critical',
    validation: { status: 'valid' as const, errors: [] },
    diff: [
      {
        fieldPath: ['transport', 'url'],
        oldValue: 'https://old.example/mcp',
        newValue: 'https://new.example/mcp',
        riskFlags: ['connection_critical' as const],
      },
    ],
    configChange: {
      status: 'preview',
      operation: 'update',
      target: { name: 'github', source: 'mcpServers' },
      changed: true,
      backup: { created: false },
      retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
      reload: { status: 'not_attempted' },
    },
    connectivityCheck: { status: 'failed' as const, mode: 'bounded_dry_run' as const, message: 'refused' },
  };
}

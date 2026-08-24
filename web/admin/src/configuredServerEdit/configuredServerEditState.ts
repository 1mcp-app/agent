import type {
  ConfiguredServerApplyResponse,
  ConfiguredServerDetailResponse,
  ConfiguredServerEditDraft,
  ConfiguredServerPreviewResponse,
} from '../api/adminApi';
import {
  buildPreviewEdit,
  type FieldDraftState,
  fieldKey,
  initialDraftValue,
  type SecretDraftState,
  selectedTransportType,
} from './configuredServerEditDraft';

interface LoadedConfiguredServerEditState {
  status: 'loaded';
  serverId: string;
  detail: ConfiguredServerDetailResponse;
  fieldDraft: FieldDraftState;
  initialFieldDraft: FieldDraftState;
  secretDraft: SecretDraftState;
  clearedTransportOverrides: string[];
  instructionOverride: { mode: 'upstream' | 'replace' | 'suppress'; value: string };
  initialInstructionOverride: { mode: 'upstream' | 'replace' | 'suppress'; value: string };
  toolDraft: Record<string, { enabled: boolean; descriptionOverride: string }>;
  initialToolDraft: Record<string, { enabled: boolean; descriptionOverride: string }>;
  toolModel: string;
  toolInventoryBusy: boolean;
  toolInventoryError?: string;
  dirty: boolean;
  preview?: ConfiguredServerPreviewResponse['preview'];
  previewBusy: boolean;
  previewError?: string;
  applyBusy: boolean;
  applyError?: string;
  applyWarning?: string;
  applySuccess?: string;
}

export type ConfiguredServerEditState =
  | { status: 'list' }
  | { status: 'loading'; serverId: string }
  | { status: 'committed'; serverId: string; success: string; warning?: string }
  | { status: 'committedRefreshFailed'; serverId: string; success: string; warning?: string; message: string }
  | LoadedConfiguredServerEditState
  | { status: 'missing'; serverId: string }
  | { status: 'failed'; serverId: string; message: string };

export type ConfiguredServerEditAction =
  | { type: 'closed' }
  | { type: 'detailLoadStarted'; serverId: string }
  | { type: 'detailLoaded'; serverId: string; detail: ConfiguredServerDetailResponse }
  | { type: 'detailMissing'; serverId: string }
  | { type: 'detailFailed'; serverId: string; message: string }
  | { type: 'fieldChanged'; fieldPath: string[]; value: unknown }
  | { type: 'secretChanged'; fieldPath: string[]; value: SecretDraftState[string] }
  | { type: 'transportOverrideChanged'; key: string; clear: boolean }
  | { type: 'instructionOverrideChanged'; mode: 'upstream' | 'replace' | 'suppress'; value?: string }
  | { type: 'toolChanged'; name: string; enabled?: boolean; descriptionOverride?: string }
  | { type: 'toolsBulkChanged'; names: string[]; enabled: boolean }
  | { type: 'toolInventoryRequestStarted'; clearPreview: boolean }
  | {
      type: 'toolInventoryReceived';
      inventory: NonNullable<ConfiguredServerDetailResponse['toolInventory']>;
      clearPreview: 'always' | 'generationChanged';
    }
  | { type: 'toolInventoryRequestFailed'; message: string }
  | { type: 'previewStarted' }
  | { type: 'previewSucceeded'; preview: ConfiguredServerPreviewResponse['preview'] }
  | { type: 'previewFailed'; message: string }
  | { type: 'applyStarted' }
  | { type: 'applyCommitted'; serverId: string; result: ConfiguredServerApplyResponse['result'] }
  | {
      type: 'applySucceeded';
      serverId: string;
      detail: ConfiguredServerDetailResponse;
      result: ConfiguredServerApplyResponse['result'];
    }
  | { type: 'applyFailed'; message: string; clearPreview?: boolean }
  | { type: 'applyRefreshFailed'; message: string };

export function createConfiguredServerEditState(): ConfiguredServerEditState {
  return { status: 'list' };
}

export function configuredServerEditDraft(state: ConfiguredServerEditState): ConfiguredServerEditDraft {
  if (state.status !== 'loaded') return {};
  const transportType = selectedTransportType(state.fieldDraft, state.detail.server.transport.type);
  const edit = buildPreviewEdit(
    state.detail.editContract.fieldGroups,
    state.fieldDraft,
    state.initialFieldDraft,
    state.secretDraft,
    transportType,
    state.clearedTransportOverrides,
  );
  const current = state.instructionOverride;
  const initial = state.initialInstructionOverride;
  if (current.mode !== initial.mode || (current.mode === 'replace' && current.value !== initial.value)) {
    edit.instructionOverride =
      current.mode === 'upstream'
        ? { action: 'remove' }
        : { action: 'set', value: current.mode === 'suppress' ? '' : current.value };
  }

  if (JSON.stringify(state.toolDraft) !== JSON.stringify(state.initialToolDraft)) {
    edit.disabledTools = Object.entries(state.toolDraft)
      .filter(([, draft]) => !draft.enabled)
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right));
    edit.toolDescriptionOverrides = Object.fromEntries(
      Object.entries(state.toolDraft)
        .map(([name, draft]) => [name, draft.descriptionOverride.trim()] as const)
        .filter(([, description]) => description.length > 0)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
  }
  return edit;
}

export function reduceConfiguredServerEditState(
  state: ConfiguredServerEditState,
  action: ConfiguredServerEditAction,
): ConfiguredServerEditState {
  switch (action.type) {
    case 'closed':
      return createConfiguredServerEditState();
    case 'detailLoadStarted':
      return { status: 'loading', serverId: action.serverId };
    case 'detailLoaded':
      return loadedState(action.serverId, action.detail);
    case 'detailMissing':
      return { status: 'missing', serverId: action.serverId };
    case 'detailFailed':
      return { status: 'failed', serverId: action.serverId, message: action.message };
    case 'fieldChanged':
      if (state.status !== 'loaded') return state;
      if (state.applyBusy) return state;
      return withDraftChange(state, {
        fieldDraft: { ...state.fieldDraft, [fieldKey(action.fieldPath)]: action.value },
        clearedTransportOverrides:
          action.fieldPath[0] === 'transport' && action.fieldPath[1]
            ? state.clearedTransportOverrides.filter((key) => key !== action.fieldPath[1])
            : state.clearedTransportOverrides,
      });
    case 'secretChanged':
      if (state.status !== 'loaded') return state;
      if (state.applyBusy) return state;
      return withDraftChange(state, {
        secretDraft: { ...state.secretDraft, [fieldKey(action.fieldPath)]: action.value },
      });
    case 'transportOverrideChanged':
      if (state.status !== 'loaded' || state.applyBusy) return state;
      return withDraftChange(state, {
        clearedTransportOverrides: action.clear
          ? Array.from(new Set([...state.clearedTransportOverrides, action.key]))
          : state.clearedTransportOverrides.filter((key) => key !== action.key),
      });
    case 'instructionOverrideChanged':
      if (state.status !== 'loaded' || state.applyBusy) return state;
      return withDraftChange(state, {
        instructionOverride: {
          mode: action.mode,
          value:
            action.mode === 'replace'
              ? (action.value ?? state.instructionOverride.value)
              : state.instructionOverride.value,
        },
      });
    case 'toolChanged': {
      if (state.status !== 'loaded' || state.applyBusy) return state;
      const current = state.toolDraft[action.name];
      if (!current) return state;
      return withDraftChange(state, {
        toolDraft: {
          ...state.toolDraft,
          [action.name]: {
            enabled: action.enabled ?? current.enabled,
            descriptionOverride: action.descriptionOverride ?? current.descriptionOverride,
          },
        },
      });
    }
    case 'toolsBulkChanged':
      if (state.status !== 'loaded' || state.applyBusy) return state;
      return withDraftChange(state, {
        toolDraft: Object.fromEntries(
          Object.entries(state.toolDraft).map(([name, draft]) => [
            name,
            action.names.includes(name) ? { ...draft, enabled: action.enabled } : draft,
          ]),
        ),
      });
    case 'toolInventoryRequestStarted':
      if (state.status !== 'loaded' || state.applyBusy || state.toolInventoryBusy) return state;
      return {
        ...state,
        toolInventoryBusy: true,
        toolInventoryError: undefined,
        ...(action.clearPreview
          ? { preview: undefined, previewBusy: false, previewError: undefined, applyError: undefined }
          : {}),
      };
    case 'toolInventoryReceived': {
      if (state.status !== 'loaded') return state;
      const toolDraft = { ...state.toolDraft };
      const initialToolDraft = { ...state.initialToolDraft };
      for (const row of action.inventory.rows) {
        toolDraft[row.name] ??= {
          enabled: row.enabled,
          descriptionOverride: row.descriptionOverride ?? '',
        };
        initialToolDraft[row.name] ??= {
          enabled: row.enabled,
          descriptionOverride: row.descriptionOverride ?? '',
        };
      }
      const generationChanged = state.detail.toolInventory?.generation !== action.inventory.generation;
      const next: LoadedConfiguredServerEditState = {
        ...state,
        detail: { ...state.detail, toolInventory: action.inventory },
        toolDraft,
        initialToolDraft,
        toolModel: action.inventory.model,
        toolInventoryBusy: false,
        toolInventoryError: undefined,
        ...(action.clearPreview === 'always' || generationChanged
          ? { preview: undefined, previewBusy: false, previewError: undefined, applyError: undefined }
          : {}),
      };
      return { ...next, dirty: Object.keys(configuredServerEditDraft(next)).length > 0 };
    }
    case 'toolInventoryRequestFailed':
      if (state.status !== 'loaded') return state;
      return { ...state, toolInventoryBusy: false, toolInventoryError: action.message };
    case 'previewStarted':
      if (state.status !== 'loaded') return state;
      return { ...state, previewBusy: true, previewError: undefined };
    case 'previewSucceeded':
      if (state.status !== 'loaded') return state;
      return { ...state, preview: action.preview, previewBusy: false, previewError: undefined };
    case 'previewFailed':
      if (state.status !== 'loaded') return state;
      return { ...state, previewBusy: false, previewError: action.message };
    case 'applyStarted':
      if (state.status !== 'loaded') return state;
      return {
        ...state,
        applyBusy: true,
        applyError: undefined,
        applySuccess: undefined,
      };
    case 'applyCommitted':
      if (state.status !== 'loaded') return state;
      return {
        status: 'committed',
        serverId: action.serverId,
        success: `Changes applied to ${action.result.targetName}.`,
        warning: configuredServerReloadWarning(action.result),
      };
    case 'applySucceeded': {
      const next = loadedState(action.serverId, action.detail);
      return {
        ...next,
        applySuccess: `Changes applied to ${action.result.targetName}.`,
        applyWarning: configuredServerReloadWarning(action.result),
      };
    }
    case 'applyFailed':
      if (state.status !== 'loaded') return state;
      return {
        ...state,
        preview: action.clearPreview ? undefined : state.preview,
        applyBusy: false,
        applyError: action.message,
      };
    case 'applyRefreshFailed':
      if (state.status !== 'committed') return state;
      return { ...state, status: 'committedRefreshFailed', message: action.message };
  }
}

function loadedState(serverId: string, detail: ConfiguredServerDetailResponse): LoadedConfiguredServerEditState {
  const fieldDraft: FieldDraftState = {};
  const secretDraft: SecretDraftState = {};
  for (const group of detail.editContract.fieldGroups) {
    for (const field of group.fields) {
      const key = fieldKey(field.fieldPath);
      if (field.control === 'secret') {
        secretDraft[key] = {
          fieldPath: field.fieldPath,
          action: field.secret?.defaultAction ?? 'preserve',
          replacementKind:
            field.secret?.environmentReference.supported === false ? 'inlineSecret' : 'environmentReference',
          replacementValue: '',
        };
      } else {
        fieldDraft[key] = initialDraftValue(field);
      }
    }
  }
  const toolDraft = Object.fromEntries(
    (detail.toolInventory?.rows ?? []).map((row) => [
      row.name,
      { enabled: row.enabled, descriptionOverride: row.descriptionOverride ?? '' },
    ]),
  );
  return {
    status: 'loaded',
    serverId,
    detail,
    fieldDraft,
    initialFieldDraft: fieldDraft,
    secretDraft,
    clearedTransportOverrides: [],
    instructionOverride: instructionOverrideDraft(detail.server.instructionOverride),
    initialInstructionOverride: instructionOverrideDraft(detail.server.instructionOverride),
    toolDraft,
    initialToolDraft: toolDraft,
    toolModel: detail.toolInventory?.model ?? 'gpt-4o',
    toolInventoryBusy: false,
    dirty: false,
    previewBusy: false,
    applyBusy: false,
  };
}

function withDraftChange(
  state: LoadedConfiguredServerEditState,
  change: Partial<
    Pick<
      LoadedConfiguredServerEditState,
      'fieldDraft' | 'secretDraft' | 'clearedTransportOverrides' | 'instructionOverride' | 'toolDraft'
    >
  >,
): LoadedConfiguredServerEditState {
  const next = {
    ...state,
    ...change,
    preview: undefined,
    previewBusy: false,
    previewError: undefined,
    applyError: undefined,
    applyWarning: undefined,
    applySuccess: undefined,
  };
  return { ...next, dirty: Object.keys(configuredServerEditDraft(next)).length > 0 };
}

function instructionOverrideDraft(
  override: ConfiguredServerDetailResponse['server']['instructionOverride'],
): LoadedConfiguredServerEditState['instructionOverride'] {
  if (override?.state === 'replace') return { mode: 'replace', value: override.value };
  if (override?.state === 'suppress') return { mode: 'suppress', value: '' };
  return { mode: 'upstream', value: '' };
}

function configuredServerReloadWarning(result: ConfiguredServerApplyResponse['result']): string | undefined {
  if (result.configChange.reload.status !== 'failed') return undefined;
  return result.configChange.reload.error
    ? `Configuration was written, but runtime reload failed: ${result.configChange.reload.error}`
    : 'Configuration was written, but runtime reload failed. Inspect runtime health before continuing.';
}

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
  return buildPreviewEdit(
    state.detail.editContract.fieldGroups,
    state.fieldDraft,
    state.initialFieldDraft,
    state.secretDraft,
    transportType,
    state.clearedTransportOverrides,
  );
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
  return {
    status: 'loaded',
    serverId,
    detail,
    fieldDraft,
    initialFieldDraft: fieldDraft,
    secretDraft,
    clearedTransportOverrides: [],
    dirty: false,
    previewBusy: false,
    applyBusy: false,
  };
}

function withDraftChange(
  state: LoadedConfiguredServerEditState,
  change: Partial<Pick<LoadedConfiguredServerEditState, 'fieldDraft' | 'secretDraft' | 'clearedTransportOverrides'>>,
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

function configuredServerReloadWarning(result: ConfiguredServerApplyResponse['result']): string | undefined {
  if (result.configChange.reload.status !== 'failed') return undefined;
  return result.configChange.reload.error
    ? `Configuration was written, but runtime reload failed: ${result.configChange.reload.error}`
    : 'Configuration was written, but runtime reload failed. Inspect runtime health before continuing.';
}

import type {
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
} from './configuredServerEditDraft';

interface LoadedConfiguredServerEditState {
  status: 'loaded';
  serverId: string;
  detail: ConfiguredServerDetailResponse;
  fieldDraft: FieldDraftState;
  initialFieldDraft: FieldDraftState;
  secretDraft: SecretDraftState;
  dirty: boolean;
  preview?: ConfiguredServerPreviewResponse['preview'];
  previewBusy: boolean;
  previewError?: string;
}

export type ConfiguredServerEditState =
  | { status: 'list' }
  | { status: 'loading'; serverId: string }
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
  | { type: 'previewStarted' }
  | { type: 'previewSucceeded'; preview: ConfiguredServerPreviewResponse['preview'] }
  | { type: 'previewFailed'; message: string };

export function createConfiguredServerEditState(): ConfiguredServerEditState {
  return { status: 'list' };
}

export function configuredServerEditDraft(state: ConfiguredServerEditState): ConfiguredServerEditDraft {
  if (state.status !== 'loaded') return {};
  return buildPreviewEdit(
    state.detail.editContract.fieldGroups,
    state.fieldDraft,
    state.initialFieldDraft,
    state.secretDraft,
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
      return withDraftChange(state, {
        fieldDraft: { ...state.fieldDraft, [fieldKey(action.fieldPath)]: action.value },
      });
    case 'secretChanged':
      if (state.status !== 'loaded') return state;
      return withDraftChange(state, {
        secretDraft: { ...state.secretDraft, [fieldKey(action.fieldPath)]: action.value },
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
    dirty: false,
    previewBusy: false,
  };
}

function withDraftChange(
  state: LoadedConfiguredServerEditState,
  change: Partial<Pick<LoadedConfiguredServerEditState, 'fieldDraft' | 'secretDraft'>>,
): LoadedConfiguredServerEditState {
  const next = {
    ...state,
    ...change,
    preview: undefined,
    previewBusy: false,
    previewError: undefined,
  };
  return { ...next, dirty: Object.keys(configuredServerEditDraft(next)).length > 0 };
}

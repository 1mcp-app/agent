import type { ConfiguredServerDeletePreview, ConfiguredServerDeleteResponse } from '../api/adminApi';

export interface ConfiguredServerDeleteState {
  preview: ConfiguredServerDeletePreview | null;
  confirmation: string;
  previewBusy: boolean;
  applyBusy: boolean;
  error: string | null;
  result: ConfiguredServerDeleteResponse['result'] | null;
}

export type ConfiguredServerDeleteAction =
  | { type: 'reset' }
  | { type: 'previewStarted' }
  | { type: 'previewSucceeded'; preview: ConfiguredServerDeletePreview }
  | { type: 'previewFailed'; message: string }
  | { type: 'confirmationChanged'; value: string }
  | { type: 'applyStarted' }
  | { type: 'applySucceeded'; result: ConfiguredServerDeleteResponse['result'] }
  | { type: 'applyFailed'; message: string; clearPreview: boolean };

export function createConfiguredServerDeleteState(): ConfiguredServerDeleteState {
  return { preview: null, confirmation: '', previewBusy: false, applyBusy: false, error: null, result: null };
}

export function reduceConfiguredServerDeleteState(
  state: ConfiguredServerDeleteState,
  action: ConfiguredServerDeleteAction,
): ConfiguredServerDeleteState {
  switch (action.type) {
    case 'reset':
      return createConfiguredServerDeleteState();
    case 'previewStarted':
      return { ...state, previewBusy: true, error: null, result: null };
    case 'previewSucceeded':
      return { ...state, preview: action.preview, confirmation: '', previewBusy: false, error: null };
    case 'previewFailed':
      return { ...state, previewBusy: false, error: action.message };
    case 'confirmationChanged':
      return { ...state, confirmation: action.value, error: null };
    case 'applyStarted':
      return { ...state, applyBusy: true, error: null };
    case 'applySucceeded':
      return { ...state, preview: null, confirmation: '', applyBusy: false, error: null, result: action.result };
    case 'applyFailed':
      return {
        ...state,
        preview: action.clearPreview ? null : state.preview,
        confirmation: action.clearPreview ? '' : state.confirmation,
        applyBusy: false,
        error: action.message,
      };
  }
}

export function configuredServerDeleteRecoveryRequired(result: ConfiguredServerDeleteResponse['result']): boolean {
  return result.configChange.reload.status !== 'observed' || result.runtimeImpact?.retirementObserved === false;
}

export function configuredServerDeleteEligible(state: ConfiguredServerDeleteState): boolean {
  return Boolean(
    state.preview && !state.previewBusy && !state.applyBusy && state.confirmation === state.preview.qualifiedId,
  );
}

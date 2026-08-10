import type {
  ConfiguredServerCreateContractResponse,
  ConfiguredServerCreateDraft,
  ConfiguredServerCreatePreviewResponse,
  ConfiguredServerCreateResponse,
} from '../api/adminApi';
import {
  fieldAppliesToTransport,
  fieldKey,
  initialDraftValue,
  objectRecord,
  stringArray,
} from '../configuredServerEdit/configuredServerEditDraft';

export interface ConfiguredServerCreateSecretDraft {
  id: string;
  container: 'env' | 'headers';
  key: string;
  replacementKind: 'environmentReference' | 'inlineSecret';
  replacementValue: string;
}

interface EditingConfiguredServerCreateState {
  status: 'editing';
  contract: ConfiguredServerCreateContractResponse;
  fieldDraft: Record<string, unknown>;
  secrets: ConfiguredServerCreateSecretDraft[];
  dirty: boolean;
  preview?: ConfiguredServerCreatePreviewResponse['preview'];
  previewBusy: boolean;
  previewError?: string;
  applyBusy: boolean;
  applyError?: string;
}

export type ConfiguredServerCreateState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | EditingConfiguredServerCreateState
  | { status: 'committed'; serverId: string; result: ConfiguredServerCreateResponse['result']; warning?: string };

export type ConfiguredServerCreateAction =
  | { type: 'closed' }
  | { type: 'contractLoadStarted' }
  | { type: 'contractLoaded'; contract: ConfiguredServerCreateContractResponse }
  | { type: 'contractFailed'; message: string }
  | { type: 'fieldChanged'; fieldPath: string[]; value: unknown }
  | { type: 'secretAdded'; secret: ConfiguredServerCreateSecretDraft }
  | { type: 'secretChanged'; secret: ConfiguredServerCreateSecretDraft }
  | { type: 'secretRemoved'; id: string }
  | { type: 'previewStarted' }
  | { type: 'previewSucceeded'; preview: ConfiguredServerCreatePreviewResponse['preview'] }
  | { type: 'previewFailed'; message: string }
  | { type: 'applyStarted' }
  | { type: 'applyFailed'; message: string; clearPreview?: boolean }
  | { type: 'applySucceeded'; response: ConfiguredServerCreateResponse };

export function createConfiguredServerCreateState(): ConfiguredServerCreateState {
  return { status: 'idle' };
}

export function reduceConfiguredServerCreateState(
  state: ConfiguredServerCreateState,
  action: ConfiguredServerCreateAction,
): ConfiguredServerCreateState {
  switch (action.type) {
    case 'closed':
      return { status: 'idle' };
    case 'contractLoadStarted':
      return { status: 'loading' };
    case 'contractLoaded': {
      const fieldDraft: Record<string, unknown> = {};
      for (const field of action.contract.createContract.fieldGroups.flatMap((group) => group.fields)) {
        fieldDraft[fieldKey(field.fieldPath)] = initialDraftValue(field);
      }
      const transportTypeKey = fieldKey(['transport', 'type']);
      if (!['stdio', 'http', 'sse'].includes(String(fieldDraft[transportTypeKey] ?? ''))) {
        fieldDraft[transportTypeKey] = 'stdio';
      }
      return {
        status: 'editing',
        contract: action.contract,
        fieldDraft,
        secrets: [],
        dirty: false,
        previewBusy: false,
        applyBusy: false,
      };
    }
    case 'contractFailed':
      return { status: 'failed', message: action.message };
    case 'fieldChanged':
      if (state.status !== 'editing' || state.applyBusy) return state;
      return changed(state, { fieldDraft: { ...state.fieldDraft, [fieldKey(action.fieldPath)]: action.value } });
    case 'secretAdded':
      if (state.status !== 'editing' || state.applyBusy) return state;
      return changed(state, { secrets: [...state.secrets, action.secret] });
    case 'secretChanged':
      if (state.status !== 'editing' || state.applyBusy) return state;
      return changed(state, {
        secrets: state.secrets.map((secret) => (secret.id === action.secret.id ? action.secret : secret)),
      });
    case 'secretRemoved':
      if (state.status !== 'editing' || state.applyBusy) return state;
      return changed(state, { secrets: state.secrets.filter((secret) => secret.id !== action.id) });
    case 'previewStarted':
      return state.status === 'editing' ? { ...state, previewBusy: true, previewError: undefined } : state;
    case 'previewSucceeded':
      return state.status === 'editing'
        ? { ...state, preview: action.preview, previewBusy: false, previewError: undefined }
        : state;
    case 'previewFailed':
      return state.status === 'editing' ? { ...state, previewBusy: false, previewError: action.message } : state;
    case 'applyStarted':
      return state.status === 'editing' ? { ...state, applyBusy: true, applyError: undefined } : state;
    case 'applyFailed':
      return state.status === 'editing'
        ? {
            ...state,
            applyBusy: false,
            applyError: action.message,
            preview: action.clearPreview ? undefined : state.preview,
          }
        : state;
    case 'applySucceeded':
      return {
        status: 'committed',
        serverId: action.response.result.targetName,
        result: action.response.result,
        warning:
          action.response.result.configChange.reload.status === 'failed'
            ? (action.response.result.configChange.reload.error ??
              'Runtime reload failed after configuration was written.')
            : undefined,
      };
  }
}

export function configuredServerCreateDraft(state: ConfiguredServerCreateState): ConfiguredServerCreateDraft | null {
  if (state.status !== 'editing') return null;
  const transportType = state.fieldDraft[fieldKey(['transport', 'type'])];
  if (transportType !== 'stdio' && transportType !== 'http' && transportType !== 'sse') return null;
  const transport: Record<string, unknown> & { type: typeof transportType } = { type: transportType };
  for (const field of state.contract.createContract.fieldGroups.flatMap((group) => group.fields)) {
    if (field.fieldPath[0] !== 'transport' || field.fieldPath.length !== 2) continue;
    if (!fieldAppliesToTransport(field, transportType)) continue;
    const key = field.fieldPath[1];
    if (key === 'type') continue;
    const value = state.fieldDraft[fieldKey(field.fieldPath)];
    if (field.control === 'string-list') transport[key] = stringArray(value);
    else if (field.control === 'record') transport[key] = objectRecord(value);
    else if (value !== '' && value !== undefined) transport[key] = value;
  }
  const applicableContainer = transportType === 'stdio' ? 'env' : 'headers';
  const secrets = state.secrets
    .filter((secret) => secret.container === applicableContainer && secret.key.trim() && secret.replacementValue.trim())
    .map((secret) => ({
      fieldPath: [secret.container, secret.key.trim()],
      action: 'replace' as const,
      replacement: { kind: secret.replacementKind, value: secret.replacementValue },
    }));
  return {
    name: String(state.fieldDraft[fieldKey(['name'])] ?? ''),
    enabled: Boolean(state.fieldDraft[fieldKey(['enabled'])]),
    tags: stringArray(state.fieldDraft[fieldKey(['tags'])]),
    transport,
    ...(secrets.length > 0 ? { secrets } : {}),
  };
}

function changed(
  state: EditingConfiguredServerCreateState,
  change: Partial<Pick<EditingConfiguredServerCreateState, 'fieldDraft' | 'secrets'>>,
): EditingConfiguredServerCreateState {
  return {
    ...state,
    ...change,
    dirty: true,
    preview: undefined,
    previewBusy: false,
    previewError: undefined,
    applyError: undefined,
  };
}

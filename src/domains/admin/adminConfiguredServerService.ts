import { createHash } from 'node:crypto';

import { type MCPServerParams, transportConfigSchema } from '@src/core/types/index.js';
import type { ConfigChangeResult, ConfigChangeService } from '@src/domains/config-change/configChange.js';

import { z } from 'zod';

import type {
  AdminAuditFact,
  AdminConfirmationRequirement,
  AdminOperationContext,
  AdminOperationResult,
  AdminOperationService,
} from './adminOperationService.js';

type ConfiguredServerSecretAction = 'preserve' | 'replace' | 'clear';
type ConfiguredServerSecretReplacementKind = 'environmentReference' | 'inlineSecret';
const ENV_PLACEHOLDER_PATTERN = /\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*/u;
const previewTransportConfigSchema = transportConfigSchema.extend({
  url: z
    .string()
    .refine((value) => ENV_PLACEHOLDER_PATTERN.test(value) || z.string().url().safeParse(value).success, {
      message: 'URL must be a valid URL or environment substitution reference.',
    })
    .optional(),
});

interface AdminConfiguredServerServiceOptions {
  operationService: AdminOperationService;
  configChangeService: ConfigChangeService;
  readConfigDocument: () => ConfiguredServerConfigDocument | null;
  checkConnectivity?: ConfiguredServerConnectivityChecker;
}

interface ConfiguredServerMutationInput {
  context: AdminOperationContext;
  targetName: string;
  dryRun?: boolean;
  confirmationRequirements?: AdminConfirmationRequirement[];
}

interface ConfiguredServerDetailInput {
  context: AdminOperationContext;
  targetName: string;
}

interface ConfiguredServerPreviewInput {
  context: AdminOperationContext;
  targetName: string;
  edit: unknown;
  connectivityCheck?: 'auto' | 'manual';
}

export interface ConfiguredServerSecretReplacement {
  kind: ConfiguredServerSecretReplacementKind;
  value: string;
}

export interface ConfiguredServerSecretEditDraft {
  fieldPath: string[];
  action: ConfiguredServerSecretAction;
  replacement?: ConfiguredServerSecretReplacement;
}

export interface ConfiguredServerEditDraft {
  id?: string;
  enabled?: boolean;
  tags?: string[];
  transport?: Record<string, unknown>;
  secrets?: ConfiguredServerSecretEditDraft[];
}

export interface ConfiguredServerSecretInput {
  fieldPath: string[];
  label: string;
  state: 'present' | 'empty';
  allowedActions: ConfiguredServerSecretAction[];
}

export interface RedactedConfiguredServerValue {
  present: boolean;
  value: '[REDACTED]';
  secret: true;
}

export interface ConfiguredServerTargetIdentity {
  type: 'configured_server';
  id: string;
  source: 'mcpServers';
}

export interface ConfiguredServerTransportSummary {
  kind: string;
  label: string;
}

export interface ConfiguredServerMutationAvailability {
  available: boolean;
  operations: Array<'enable' | 'disable'>;
}

export interface ConfiguredServerActionAvailability {
  available: boolean;
  label: string;
  disabledReason?: 'already_enabled' | 'already_disabled';
}

export interface ConfiguredServerActionState {
  enable: ConfiguredServerActionAvailability;
  disable: ConfiguredServerActionAvailability;
}

export interface ConfiguredServerReadModel {
  id: string;
  source: 'mcpServers';
  target: ConfiguredServerTargetIdentity;
  enabled: boolean;
  tags: string[];
  transportSummary: ConfiguredServerTransportSummary;
  mutationAvailability: ConfiguredServerMutationAvailability;
  actionState: ConfiguredServerActionState;
  transport: Record<string, unknown>;
  secretInputs: ConfiguredServerSecretInput[];
}

export interface ConfiguredServerMutationResult {
  mode?: 'dry_run';
  targetName: string;
  enabled: boolean;
  outcome: 'enabled' | 'disabled' | 'already_enabled' | 'already_disabled';
  configChange: ConfigChangeResult;
}

export interface ConfiguredServerPreviewDiffEntry {
  fieldPath: string[];
  oldValue: unknown;
  newValue: unknown;
  secretAction?: ConfiguredServerSecretAction;
  riskFlags: Array<'rename' | 'connection_critical' | 'secret' | 'template_risk'>;
}

export interface ConfiguredServerPreviewValidationError {
  fieldPath: string[];
  code: string;
  message: string;
}

export interface ConfiguredServerPreviewValidation {
  status: 'valid' | 'invalid';
  errors: ConfiguredServerPreviewValidationError[];
}

export interface ConfiguredServerConnectivityCheckPassed {
  status: 'passed';
  mode: 'bounded_dry_run';
  checkedAt?: string;
}

export interface ConfiguredServerConnectivityCheckFailed {
  status: 'failed';
  mode: 'bounded_dry_run';
  message: string;
}

export interface ConfiguredServerConnectivityCheckSkipped {
  status: 'skipped';
  reason:
    | 'connection_critical_fields_unchanged'
    | 'target_disabled'
    | 'validation_failed'
    | 'local_stdio_transport'
    | 'checker_unavailable'
    | 'endpoint_changed_with_preserved_secrets';
}

export type ConfiguredServerConnectivityCheckResult =
  | ConfiguredServerConnectivityCheckPassed
  | ConfiguredServerConnectivityCheckFailed
  | ConfiguredServerConnectivityCheckSkipped;

export type ConfiguredServerConnectivityChecker = (input: {
  targetName: string;
  serverConfig: MCPServerParams;
}) => Promise<ConfiguredServerConnectivityCheckPassed | ConfiguredServerConnectivityCheckFailed>;

export interface ConfiguredServerPreviewResult {
  targetName: string;
  proposedTargetName: string;
  previewFingerprint: string;
  validation: ConfiguredServerPreviewValidation;
  diff: ConfiguredServerPreviewDiffEntry[];
  configChange: ConfigChangeResult;
  connectivityCheck: ConfiguredServerConnectivityCheckResult;
}

export type ConfiguredServerEditFieldControl =
  'text' | 'number' | 'switch' | 'tag-list' | 'select' | 'string-list' | 'secret' | 'record' | 'readonly';

export type ConfiguredServerTransportType = 'stdio' | 'http' | 'sse' | 'streamableHttp';

export interface ConfiguredServerSecretEditMetadata {
  state: 'present' | 'empty';
  defaultAction: ConfiguredServerSecretAction;
  allowedActions: ConfiguredServerSecretAction[];
  environmentReference: {
    supported: boolean;
    recommended: boolean;
    valueFormat: 'env_var_name_or_substitution';
    storesSecretMaterial: false;
    guidance: string;
  };
  inlineReplacement: {
    supported: boolean;
    emphasis: 'secondary';
    guidance: string;
  };
}

export interface ConfiguredServerEditField {
  fieldPath: string[];
  label: string;
  control: ConfiguredServerEditFieldControl;
  value?: unknown;
  options?: string[];
  editable: boolean;
  applicableTransportTypes?: ConfiguredServerTransportType[];
  secret?: ConfiguredServerSecretEditMetadata;
}

export interface ConfiguredServerEditFieldGroup {
  id: string;
  label: string;
  fields: ConfiguredServerEditField[];
}

export interface ConfiguredServerEditContract {
  schemaVersion: 2;
  target: ConfiguredServerTargetIdentity;
  capabilities: {
    singleTargetEdit: true;
    rename: { supported: true };
    create: { supported: false };
    delete: { supported: false };
    bulkEdit: { supported: false };
    rawJson: { supported: false };
    preview: { supported: true };
    apply: { supported: false };
  };
  fieldGroups: ConfiguredServerEditFieldGroup[];
}

export interface ConfiguredServerDetailResult {
  server: ConfiguredServerReadModel;
  editContract: ConfiguredServerEditContract;
}

export interface ConfiguredServerConfigDocument {
  mcpServers?: Record<string, MCPServerParams>;
}

export interface AdminConfiguredServerOperations {
  listConfiguredServers(input: {
    context: AdminOperationContext;
  }): Promise<AdminOperationResult<{ servers: ConfiguredServerReadModel[] }>>;
  getConfiguredServerDetail(
    input: ConfiguredServerDetailInput,
  ): Promise<AdminOperationResult<ConfiguredServerDetailResult>>;
  previewConfiguredServerEdit(
    input: ConfiguredServerPreviewInput,
  ): Promise<AdminOperationResult<ConfiguredServerPreviewResult>>;
  enableConfiguredServer(
    input: ConfiguredServerMutationInput,
  ): Promise<AdminOperationResult<ConfiguredServerMutationResult>>;
  disableConfiguredServer(
    input: ConfiguredServerMutationInput,
  ): Promise<AdminOperationResult<ConfiguredServerMutationResult>>;
  getRecentAuditFacts(options?: { limit?: number }): AdminAuditFact[];
}

export class AdminConfiguredServerNotFoundError extends Error {
  readonly code = 'configured_server_not_found';

  constructor(readonly targetName: string) {
    super(`Configured server target '${targetName}' was not found`);
    this.name = 'AdminConfiguredServerNotFoundError';
  }
}

export class AdminConfiguredServerService implements AdminConfiguredServerOperations {
  constructor(private readonly options: AdminConfiguredServerServiceOptions) {}

  async listConfiguredServers(input: {
    context: AdminOperationContext;
  }): Promise<AdminOperationResult<{ servers: ConfiguredServerReadModel[] }>> {
    return this.options.operationService.executeReadOnly({
      context: input.context,
      operationName: 'listConfiguredServers',
      run: async () => ({ servers: this.readConfiguredServers() }),
    });
  }

  async getConfiguredServerDetail(
    input: ConfiguredServerDetailInput,
  ): Promise<AdminOperationResult<ConfiguredServerDetailResult>> {
    const context = {
      ...input.context,
      target: { type: 'configured_server', id: input.targetName },
    };
    return this.options.operationService.executeReadOnly({
      context,
      operationName: 'getConfiguredServerDetail',
      run: async () => {
        const server = this.readConfiguredServers().find(
          (configuredServer) => configuredServer.id === input.targetName,
        );
        if (!server) {
          throw new AdminConfiguredServerNotFoundError(input.targetName);
        }
        return {
          server,
          editContract: createConfiguredServerEditContract(server),
        };
      },
    });
  }

  async previewConfiguredServerEdit(
    input: ConfiguredServerPreviewInput,
  ): Promise<AdminOperationResult<ConfiguredServerPreviewResult>> {
    const context = {
      ...input.context,
      target: { type: 'configured_server', id: input.targetName },
    };
    const currentConfig = this.readConfiguredServerConfig(input.targetName);
    return this.options.operationService.executeDryRun({
      context,
      operationName: 'previewConfiguredServerEdit',
      run: async () => this.previewConfiguredServerEditResult(input, currentConfig),
    });
  }

  async enableConfiguredServer(
    input: ConfiguredServerMutationInput,
  ): Promise<AdminOperationResult<ConfiguredServerMutationResult>> {
    return this.setConfiguredServerEnabledState(input, true);
  }

  async disableConfiguredServer(
    input: ConfiguredServerMutationInput,
  ): Promise<AdminOperationResult<ConfiguredServerMutationResult>> {
    return this.setConfiguredServerEnabledState(input, false);
  }

  getRecentAuditFacts(options: { limit?: number } = {}): AdminAuditFact[] {
    return this.options.operationService.getRecentAuditFacts(options);
  }

  private async setConfiguredServerEnabledState(
    input: ConfiguredServerMutationInput,
    enabled: boolean,
  ): Promise<AdminOperationResult<ConfiguredServerMutationResult>> {
    const operationName = enabled ? 'enableConfiguredServer' : 'disableConfiguredServer';
    const context = {
      ...input.context,
      target: { type: 'configured_server', id: input.targetName },
    };

    if (input.dryRun) {
      return this.options.operationService.executeDryRun({
        context,
        operationName,
        run: async () => {
          const configChange = await this.options.configChangeService.previewConfiguredServerTargetEnabledState({
            targetName: input.targetName,
            enabled,
            backup: 'skip',
          });
          assertSuccessfulConfigChange(configChange);
          return {
            mode: 'dry_run',
            targetName: input.targetName,
            enabled,
            outcome: mutationOutcome(enabled, configChange.changed),
            configChange,
          };
        },
      });
    }

    return this.options.operationService.executeMutation({
      context,
      operationName,
      confirmationRequirements: input.confirmationRequirements,
      run: async () => {
        const configChange = await this.options.configChangeService.setConfiguredServerTargetEnabledState({
          targetName: input.targetName,
          enabled,
          backup: 'required',
        });
        assertSuccessfulConfigChange(configChange);
        return {
          targetName: input.targetName,
          enabled,
          outcome: mutationOutcome(enabled, configChange.changed),
          configChange,
        };
      },
    });
  }

  private readConfiguredServers(): ConfiguredServerReadModel[] {
    const parsed = this.options.readConfigDocument();
    if (!parsed) {
      return [];
    }

    return Object.entries(parsed.mcpServers ?? {}).map(([name, serverConfig]) =>
      createConfiguredServerReadModel(name, serverConfig),
    );
  }

  private readConfiguredServerConfig(targetName: string): MCPServerParams {
    const parsed = this.options.readConfigDocument();
    const currentConfig = parsed?.mcpServers?.[targetName];
    if (!currentConfig) {
      throw new AdminConfiguredServerNotFoundError(targetName);
    }
    return currentConfig;
  }

  private async previewConfiguredServerEditResult(
    input: ConfiguredServerPreviewInput,
    currentConfig: MCPServerParams,
  ): Promise<ConfiguredServerPreviewResult> {
    const normalizedEdit = normalizeEditDraft(input.edit);
    const currentReadModel = createConfiguredServerReadModel(input.targetName, currentConfig);
    const secretValidation = validateSecretEditCapabilities(normalizedEdit.edit, currentReadModel.secretInputs);
    const transportApplicabilityValidation = validateTransportFieldApplicability(currentConfig, normalizedEdit.edit);
    const applicableEdit = filterApplicableSecretEdits(normalizedEdit.edit, currentReadModel.secretInputs);
    const proposedTargetName = applicableEdit.id?.trim() || input.targetName;
    const proposedConfig = applyEditDraft(currentConfig, applicableEdit);
    const proposedReadModel = createConfiguredServerReadModel(proposedTargetName, proposedConfig);
    const proposedTransportType = configuredTransportType(proposedConfig);
    const serverValidation = validatePreviewServerConfig(proposedConfig);
    const validation = mergeValidation(
      mergeValidation(mergeValidation(normalizedEdit.validation, secretValidation), transportApplicabilityValidation),
      serverValidation,
    );
    const diff = createPreviewDiff(currentReadModel, proposedReadModel, applicableEdit);
    const changed = validation.status === 'valid' && diff.length > 0;
    const endpointChangedWithPreservedSecrets =
      endpointAuthorityChanged(currentConfig, proposedConfig) &&
      hasPreservedSecretInputs(
        currentReadModel.secretInputs.filter(
          (input) => !proposedTransportType || transportFieldAppliesToType(input.fieldPath[0], proposedTransportType),
        ),
        applicableEdit,
      );

    return {
      targetName: input.targetName,
      proposedTargetName,
      previewFingerprint: previewFingerprint({
        targetName: input.targetName,
        edit: normalizedEdit.edit,
        current: currentReadModel,
        proposed: proposedReadModel,
        diff,
        validation,
      }),
      validation,
      diff,
      configChange: previewConfigChange(input.targetName, changed),
      connectivityCheck: await this.previewConnectivityCheck({
        targetName: proposedTargetName,
        serverConfig: proposedConfig,
        enabled: proposedReadModel.enabled,
        validationStatus: validation.status,
        connectionCriticalChanged: diff.some((entry) => entry.riskFlags.includes('connection_critical')),
        force: input.connectivityCheck === 'manual',
        endpointChangedWithPreservedSecrets,
      }),
    };
  }

  private async previewConnectivityCheck(input: {
    targetName: string;
    serverConfig: MCPServerParams;
    enabled: boolean;
    validationStatus: ConfiguredServerPreviewValidation['status'];
    connectionCriticalChanged: boolean;
    force: boolean;
    endpointChangedWithPreservedSecrets: boolean;
  }): Promise<ConfiguredServerConnectivityCheckResult> {
    if (!input.enabled) {
      return { status: 'skipped', reason: 'target_disabled' };
    }

    if (input.validationStatus === 'invalid') {
      return { status: 'skipped', reason: 'validation_failed' };
    }

    if (!input.connectionCriticalChanged && !input.force) {
      return { status: 'skipped', reason: 'connection_critical_fields_unchanged' };
    }

    if (input.endpointChangedWithPreservedSecrets && !input.force) {
      return { status: 'skipped', reason: 'endpoint_changed_with_preserved_secrets' };
    }

    if (wouldUseLocalStdioTransport(input.serverConfig)) {
      return { status: 'skipped', reason: 'local_stdio_transport' };
    }

    if (!this.options.checkConnectivity) {
      return { status: 'skipped', reason: 'checker_unavailable' };
    }

    return this.options.checkConnectivity({
      targetName: input.targetName,
      serverConfig: input.serverConfig,
    });
  }
}

function assertSuccessfulConfigChange(configChange: ConfigChangeResult): void {
  if (configChange.reload.status === 'failed') {
    throw new Error(`Config reload observation failed: ${configChange.reload.error ?? 'unknown reload failure'}`);
  }

  if (configChange.status === 'failed') {
    throw new Error(configChange.error ?? 'Config change failed');
  }

  if (configChange.status === 'not_found') {
    throw new Error(`Configured server target '${configChange.target.name}' was not found`);
  }

  if (configChange.status === 'template_conflict') {
    throw new Error(configChange.error ?? `Configured server target '${configChange.target.name}' is unsupported`);
  }
}

function mutationOutcome(enabled: boolean, changed: boolean): ConfiguredServerMutationResult['outcome'] {
  if (changed) {
    return enabled ? 'enabled' : 'disabled';
  }
  return enabled ? 'already_enabled' : 'already_disabled';
}

function normalizeEditDraft(value: unknown): {
  edit: ConfiguredServerEditDraft;
  validation: ConfiguredServerPreviewValidation;
} {
  const errors: ConfiguredServerPreviewValidationError[] = [];
  const edit: ConfiguredServerEditDraft = {};
  const supportedKeys = new Set(['id', 'enabled', 'tags', 'transport', 'secrets']);

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      edit,
      validation: {
        status: 'invalid',
        errors: [
          {
            fieldPath: [],
            code: 'invalid_edit',
            message: 'Edit must be an object.',
          },
        ],
      },
    };
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!supportedKeys.has(key)) {
      errors.push({
        fieldPath: [key],
        code: 'unsupported_edit_field',
        message: 'Edit field is not supported by the normalized configured-server edit contract.',
      });
    }
  }

  if (record.id !== undefined) {
    if (typeof record.id === 'string') {
      edit.id = record.id;
    } else {
      errors.push({
        fieldPath: ['id'],
        code: 'invalid_target_id',
        message: 'Target ID must be a string.',
      });
    }
  }

  if (record.enabled !== undefined) {
    if (typeof record.enabled === 'boolean') {
      edit.enabled = record.enabled;
    } else {
      errors.push({
        fieldPath: ['enabled'],
        code: 'invalid_enabled',
        message: 'Enabled must be true or false.',
      });
    }
  }

  if (record.tags !== undefined) {
    if (Array.isArray(record.tags) && record.tags.every((tag) => typeof tag === 'string')) {
      edit.tags = record.tags;
    } else {
      errors.push({
        fieldPath: ['tags'],
        code: 'invalid_tags',
        message: 'Tags must be a list of strings.',
      });
    }
  }

  if (record.transport !== undefined) {
    if (record.transport && typeof record.transport === 'object' && !Array.isArray(record.transport)) {
      edit.transport = normalizeTransportEditDraft(record.transport as Record<string, unknown>, errors);
    } else {
      errors.push({
        fieldPath: ['transport'],
        code: 'invalid_transport',
        message: 'Transport edits must be an object.',
      });
    }
  }

  if (record.secrets !== undefined) {
    if (Array.isArray(record.secrets)) {
      edit.secrets = record.secrets.flatMap((entry, index) => normalizeSecretEditDraft(entry, index, errors));
    } else {
      errors.push({
        fieldPath: ['secrets'],
        code: 'invalid_secret_actions',
        message: 'Secret actions must be a list.',
      });
    }
  }

  return {
    edit,
    validation: { status: errors.length === 0 ? 'valid' : 'invalid', errors },
  };
}

function normalizeTransportEditDraft(
  record: Record<string, unknown>,
  errors: ConfiguredServerPreviewValidationError[],
): Record<string, unknown> {
  const transport: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!isSafeFieldPathSegment(key)) {
      errors.push({
        fieldPath: ['transport', key],
        code: 'invalid_transport_field_path',
        message: 'Transport field path contains a reserved segment.',
      });
      continue;
    }

    if (isSecretCapableRawTransportEdit(key, value)) {
      errors.push({
        fieldPath: ['transport', key],
        code: 'secret_transport_edit_requires_secret_action',
        message: 'Secret-capable transport fields must use explicit secret actions.',
      });
      continue;
    }

    transport[key] = value;
  }

  return transport;
}

function isSecretCapableRawTransportEdit(key: string, value: unknown): boolean {
  if (key === 'url') {
    return isSecretCapableUrlEdit(value);
  }

  if (key === 'headers' || key === 'env') {
    return true;
  }

  if (key === 'oauth' && value && typeof value === 'object' && !Array.isArray(value)) {
    return containsStringOrSecretLikeField(value);
  }

  if (key === 'args' && Array.isArray(value)) {
    return argsContainSecretMaterial(value);
  }

  if (isSecretLikeKey(key) || containsSecretLikeField(value)) {
    return true;
  }

  return false;
}

function argsContainSecretMaterial(value: unknown[]): boolean {
  return value.some((entry, index) => {
    if (typeof entry !== 'string') {
      return containsSecretLikeField(entry);
    }

    const previous = value[index - 1];
    return Boolean(
      secretAssignmentArg(entry) ||
      secretFlagArg(entry) ||
      containsSecretLikeString(entry) ||
      (typeof previous === 'string' && secretCarrierArg(previous) && containsSecretLikeString(entry)),
    );
  });
}

function secretCarrierArg(value: string): boolean {
  return /^-{1,2}(header|h|env|e)$/iu.test(value);
}

function containsSecretLikeString(value: string): boolean {
  return (
    /\b(Bearer|Basic)\s+[^\s"',;]+/iu.test(value) ||
    /\b(?:token|secret|password|auth|api[_-]?key|credential)\b\s*[:=]/iu.test(value)
  );
}

function containsSecretLikeField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsSecretLikeField);
  }

  if (typeof value === 'string') {
    return containsSecretLikeString(value);
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([nestedKey, nestedValue]) => isSecretLikeKey(nestedKey) || containsSecretLikeField(nestedValue),
  );
}

function containsStringOrSecretLikeField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsStringOrSecretLikeField);
  }

  if (typeof value === 'string') {
    return true;
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([nestedKey, nestedValue]) => isSecretLikeKey(nestedKey) || containsStringOrSecretLikeField(nestedValue),
  );
}

function isSecretCapableUrlEdit(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const url = new URL(value);
    if (url.username || url.password) {
      return true;
    }

    for (const [key, paramValue] of url.searchParams.entries()) {
      if (isSecretLikeKey(key) || containsSecretLikeString(paramValue)) {
        return true;
      }
    }
    return false;
  } catch {
    if (/^[a-z][a-z0-9+.-]*:\/\/[^@/?#]+@/iu.test(value)) {
      return true;
    }
    return /[?&][^=]*(?:token|secret|password|auth|key|credential)[^=]*=[^&]+/iu.test(value);
  }
}

function normalizeSecretEditDraft(
  value: unknown,
  index: number,
  errors: ConfiguredServerPreviewValidationError[],
): ConfiguredServerSecretEditDraft[] {
  const basePath = ['secrets', String(index)];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push({
      fieldPath: basePath,
      code: 'invalid_secret_action',
      message: 'Secret action must be an object.',
    });
    return [];
  }

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.fieldPath) || !record.fieldPath.every((segment) => typeof segment === 'string')) {
    errors.push({
      fieldPath: [...basePath, 'fieldPath'],
      code: 'invalid_secret_field_path',
      message: 'Secret field path must be a list of strings.',
    });
    return [];
  }
  if (!isValidFieldPath(record.fieldPath)) {
    errors.push({
      fieldPath: [...basePath, 'fieldPath'],
      code: 'invalid_secret_field_path',
      message: 'Secret field path contains a reserved segment.',
    });
    return [];
  }

  if (record.action !== 'preserve' && record.action !== 'replace' && record.action !== 'clear') {
    errors.push({
      fieldPath: [...basePath, 'action'],
      code: 'invalid_secret_action',
      message: 'Secret action must be preserve, replace, or clear.',
    });
    return [];
  }

  const hasReplacement = record.replacement !== undefined;
  const replacement = normalizeSecretReplacement(record.replacement, basePath, errors);
  if (record.action === 'replace' && !hasReplacement) {
    errors.push({
      fieldPath: [...basePath, 'replacement'],
      code: 'missing_secret_replacement',
      message: 'Replace actions require an explicit replacement.',
    });
  }
  if (record.action !== 'replace' && hasReplacement) {
    errors.push({
      fieldPath: [...basePath, 'replacement'],
      code: 'unexpected_secret_replacement',
      message: 'Only replace actions may include a replacement.',
    });
  }

  return [
    {
      fieldPath: record.fieldPath,
      action: record.action,
      ...(record.action === 'replace' && replacement ? { replacement } : {}),
    },
  ];
}

function normalizeSecretReplacement(
  value: unknown,
  basePath: string[],
  errors: ConfiguredServerPreviewValidationError[],
): ConfiguredServerSecretReplacement | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push({
      fieldPath: [...basePath, 'replacement'],
      code: 'invalid_secret_replacement',
      message: 'Secret replacement must be an object.',
    });
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.kind !== 'environmentReference' && record.kind !== 'inlineSecret') {
    errors.push({
      fieldPath: [...basePath, 'replacement', 'kind'],
      code: 'invalid_secret_replacement_kind',
      message: 'Secret replacement kind must be environmentReference or inlineSecret.',
    });
    return undefined;
  }

  if (typeof record.value !== 'string') {
    errors.push({
      fieldPath: [...basePath, 'replacement', 'value'],
      code: 'invalid_secret_replacement_value',
      message: 'Secret replacement value must be a string.',
    });
    return undefined;
  }

  if (record.kind === 'environmentReference' && !isEnvironmentReferenceInput(record.value)) {
    errors.push({
      fieldPath: [...basePath, 'replacement', 'value'],
      code: 'invalid_environment_reference',
      message: 'Environment reference must be an environment variable name or substitution expression.',
    });
    return undefined;
  }

  if (record.kind === 'inlineSecret' && record.value.length === 0) {
    errors.push({
      fieldPath: [...basePath, 'replacement', 'value'],
      code: 'empty_inline_secret',
      message: 'Inline secret replacement cannot be empty; use clear to remove a secret.',
    });
    return undefined;
  }

  return {
    kind: record.kind,
    value: record.value,
  };
}

function validateSecretEditCapabilities(
  edit: ConfiguredServerEditDraft,
  secretInputs: ConfiguredServerSecretInput[],
): ConfiguredServerPreviewValidation {
  const inputs = secretInputMap(secretInputs);
  const errors: ConfiguredServerPreviewValidationError[] = [];

  for (const [index, secret] of (edit.secrets ?? []).entries()) {
    const basePath = ['secrets', String(index)];
    const input = resolveSecretInput(secret.fieldPath, inputs);
    if (!input) {
      errors.push({
        fieldPath: [...basePath, 'fieldPath'],
        code: 'unsupported_secret_field',
        message: 'Secret action must target a secret-capable field.',
      });
      continue;
    }

    if (!input.allowedActions.includes(secret.action)) {
      errors.push({
        fieldPath: [...basePath, 'action'],
        code: 'unsupported_secret_action',
        message: 'Secret action is not supported for this field.',
      });
    }
  }

  return {
    status: errors.length === 0 ? 'valid' : 'invalid',
    errors,
  };
}

function filterApplicableSecretEdits(
  edit: ConfiguredServerEditDraft,
  secretInputs: ConfiguredServerSecretInput[],
): ConfiguredServerEditDraft {
  if (!edit.secrets) {
    return edit;
  }

  const inputs = secretInputMap(secretInputs);
  return {
    ...edit,
    secrets: edit.secrets.filter((secret) => {
      const input = resolveSecretInput(secret.fieldPath, inputs);
      return Boolean(
        input &&
        input.allowedActions.includes(secret.action) &&
        (secret.action === 'replace' ? secret.replacement : !secret.replacement),
      );
    }),
  };
}

function secretInputMap(secretInputs: ConfiguredServerSecretInput[]): Map<string, ConfiguredServerSecretInput> {
  return new Map(secretInputs.map((input) => [fieldKey(input.fieldPath), input]));
}

function hasPreservedSecretInputs(
  secretInputs: ConfiguredServerSecretInput[],
  edit: ConfiguredServerEditDraft,
): boolean {
  if (secretInputs.length === 0) {
    return false;
  }

  const explicitActions = new Map((edit.secrets ?? []).map((secret) => [fieldKey(secret.fieldPath), secret.action]));
  return secretInputs.some((input) => {
    const action = explicitActions.get(fieldKey(input.fieldPath));
    return action !== 'replace' && action !== 'clear';
  });
}

function endpointAuthorityChanged(currentConfig: MCPServerParams, proposedConfig: MCPServerParams): boolean {
  const currentAuthority = endpointAuthority(currentConfig);
  const proposedAuthority = endpointAuthority(proposedConfig);

  if (currentAuthority || proposedAuthority) {
    return currentAuthority !== proposedAuthority;
  }

  const currentUrl = typeof currentConfig.url === 'string' ? currentConfig.url : undefined;
  const proposedUrl = typeof proposedConfig.url === 'string' ? proposedConfig.url : undefined;
  return currentUrl !== proposedUrl && Boolean(currentUrl || proposedUrl);
}

function endpointAuthority(serverConfig: MCPServerParams): string | undefined {
  if (typeof serverConfig.url !== 'string') {
    return undefined;
  }

  try {
    const url = new URL(serverConfig.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function resolveSecretInput(
  fieldPath: string[],
  inputs: Map<string, ConfiguredServerSecretInput>,
): ConfiguredServerSecretInput | undefined {
  return inputs.get(fieldKey(fieldPath)) ?? potentialSecretInput(fieldPath);
}

function potentialSecretInput(fieldPath: string[]): ConfiguredServerSecretInput | undefined {
  if (!isValidFieldPath(fieldPath)) {
    return undefined;
  }

  if (fieldPath[0] === 'headers' && fieldPath.length === 2) {
    return secretInput(fieldPath, fieldPath[1]);
  }

  if (fieldPath[0] === 'env' && fieldPath.length === 2) {
    return secretInput(fieldPath, fieldPath[1]);
  }

  if (fieldPath[0] === 'oauth' && fieldPath.length === 2) {
    return secretInput(fieldPath, fieldPath[1]);
  }

  if (fieldPath[0] === 'url') {
    if ((fieldPath[1] === 'username' || fieldPath[1] === 'password') && fieldPath.length === 2) {
      return secretInput(fieldPath, `url.${fieldPath[1]}`);
    }
    if (fieldPath[1] === 'query' && fieldPath.length === 3 && isSecretLikeKey(fieldPath[2])) {
      return secretInput(fieldPath, `url.query.${fieldPath[2]}`);
    }
  }

  return undefined;
}

function applyEditDraft(currentConfig: MCPServerParams, edit: ConfiguredServerEditDraft): MCPServerParams {
  const nextConfig = cloneServerConfig(currentConfig);

  if (typeof edit.enabled === 'boolean') {
    if (edit.enabled) {
      delete nextConfig.disabled;
    } else {
      nextConfig.disabled = true;
    }
  }

  if (Array.isArray(edit.tags)) {
    nextConfig.tags = edit.tags.filter((tag): tag is string => typeof tag === 'string');
  }

  if (edit.transport && typeof edit.transport === 'object') {
    const currentType = configuredTransportType(currentConfig);
    const proposedType = configuredTransportType({ ...currentConfig, ...edit.transport });
    if (currentType && proposedType && currentType !== proposedType) {
      for (const definition of TRANSPORT_FIELD_DEFINITIONS) {
        if (definition.applicableTransportTypes && !definition.applicableTransportTypes.includes(proposedType)) {
          delete (nextConfig as Record<string, unknown>)[definition.key];
        }
      }
    }

    for (const [key, value] of Object.entries(edit.transport)) {
      if (
        value === undefined ||
        !isSafeFieldPathSegment(key) ||
        (proposedType && !transportFieldAppliesToType(key, proposedType))
      ) {
        continue;
      }
      (nextConfig as Record<string, unknown>)[key] = cloneUnknown(value);
    }
  }

  for (const secret of edit.secrets ?? []) {
    applySecretEdit(nextConfig, secret);
  }

  return nextConfig;
}

function cloneServerConfig(serverConfig: MCPServerParams): MCPServerParams {
  return cloneUnknown(serverConfig) as MCPServerParams;
}

function validateTransportFieldApplicability(
  currentConfig: MCPServerParams,
  edit: ConfiguredServerEditDraft,
): ConfiguredServerPreviewValidation {
  const transport = edit.transport;
  if (!transport) return { status: 'valid', errors: [] };

  const proposedType = configuredTransportType({ ...currentConfig, ...transport });
  if (!proposedType) return { status: 'valid', errors: [] };

  const errors: ConfiguredServerPreviewValidationError[] = [];
  for (const key of Object.keys(transport)) {
    if (transportFieldAppliesToType(key, proposedType)) continue;
    errors.push({
      fieldPath: ['transport', key],
      code: 'transport_field_not_applicable',
      message: `${TRANSPORT_FIELD_DEFINITION_BY_KEY.get(key)?.label ?? labelFromPath([key])} does not apply to ${proposedType} transports.`,
    });
  }
  return { status: errors.length > 0 ? 'invalid' : 'valid', errors };
}

function configuredTransportType(config: Record<string, unknown>): ConfiguredServerTransportType | undefined {
  if (config.type === 'stdio' || config.type === 'http' || config.type === 'sse' || config.type === 'streamableHttp') {
    return config.type;
  }
  if (typeof config.command === 'string') return 'stdio';
  if (typeof config.url === 'string') return 'http';
  return undefined;
}

function transportFieldApplicability(key: string): ConfiguredServerTransportType[] | undefined {
  return TRANSPORT_FIELD_DEFINITION_BY_KEY.get(key)?.applicableTransportTypes;
}

function transportFieldAppliesToType(key: string, transportType: ConfiguredServerTransportType): boolean {
  const applicableTypes = transportFieldApplicability(key);
  return !applicableTypes || applicableTypes.includes(transportType);
}

function cloneUnknown<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function applySecretEdit(serverConfig: MCPServerParams, secret: ConfiguredServerSecretEditDraft): void {
  if (!isValidFieldPath(secret.fieldPath)) {
    return;
  }

  if (secret.action === 'preserve') {
    return;
  }

  if (applyVirtualSecretEdit(serverConfig, secret)) {
    return;
  }

  if (secret.action === 'clear') {
    deleteNestedValue(serverConfig as Record<string, unknown>, secret.fieldPath);
    return;
  }

  if (secret.action === 'replace' && secret.replacement) {
    setNestedValue(serverConfig as Record<string, unknown>, secret.fieldPath, replacementValue(secret.replacement));
  }
}

function applyVirtualSecretEdit(serverConfig: MCPServerParams, secret: ConfiguredServerSecretEditDraft): boolean {
  if (secret.fieldPath[0] === 'url') {
    return applyUrlSecretEdit(serverConfig, secret);
  }

  if (secret.fieldPath[0] === 'args') {
    return applyArgsSecretEdit(serverConfig, secret);
  }

  if (secret.fieldPath[0] === 'env') {
    return applyEnvSecretEdit(serverConfig, secret);
  }

  return false;
}

function applyUrlSecretEdit(serverConfig: MCPServerParams, secret: ConfiguredServerSecretEditDraft): boolean {
  if (typeof serverConfig.url !== 'string') {
    return true;
  }

  try {
    new URL(serverConfig.url);
  } catch {
    return true;
  }

  const value = secret.action === 'replace' && secret.replacement ? replacementValue(secret.replacement) : undefined;
  const [, scope, key] = secret.fieldPath;
  if (scope === 'username') {
    serverConfig.url = replaceRawUrlUserInfo(serverConfig.url, 'username', value);
    return true;
  }
  if (scope === 'password') {
    serverConfig.url = replaceRawUrlUserInfo(serverConfig.url, 'password', value);
    return true;
  }
  if (scope === 'query' && key) {
    serverConfig.url = replaceRawUrlQueryParam(serverConfig.url, key, value);
    return true;
  }

  return true;
}

function applyEnvSecretEdit(serverConfig: MCPServerParams, secret: ConfiguredServerSecretEditDraft): boolean {
  if (!Array.isArray(serverConfig.env) || secret.fieldPath.length !== 2) {
    return false;
  }

  const key = secret.fieldPath[1];
  const entryIndex = serverConfig.env.findIndex(
    (entry) => typeof entry === 'string' && envArrayEntryKey(entry) === key,
  );
  if (secret.action === 'clear') {
    if (entryIndex >= 0) {
      serverConfig.env.splice(entryIndex, 1);
    }
    return true;
  }

  if (secret.action === 'replace' && secret.replacement) {
    const value = replacementValue(secret.replacement);
    const nextEntry = `${key}=${value}`;
    if (entryIndex >= 0) {
      serverConfig.env[entryIndex] = nextEntry;
    } else {
      serverConfig.env.push(nextEntry);
    }
  }

  return true;
}

function envArrayEntryKey(entry: string): string {
  return entry.includes('=') ? entry.split('=', 1)[0] : entry;
}

function replaceRawUrlUserInfo(input: string, scope: 'username' | 'password', value: string | undefined): string {
  const match = input.match(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#@]*@)?(.*)$/u);
  if (!match) {
    return input;
  }

  const prefix = match[1];
  const rawUserInfo = match[2]?.slice(0, -1) ?? '';
  const rest = match[3];
  const [currentUsername = '', currentPassword = ''] = rawUserInfo.split(':');
  const username = scope === 'username' ? (value ?? '') : currentUsername;
  const password = scope === 'password' ? (value ?? '') : currentPassword;
  const userInfo = username || password ? `${username}${password ? `:${password}` : ''}@` : '';
  return `${prefix}${userInfo}${rest}`;
}

function replaceRawUrlQueryParam(input: string, key: string, value: string | undefined): string {
  const [withoutFragment, fragment = ''] = input.split('#', 2);
  const [base, query = ''] = withoutFragment.split('?', 2);
  const params = query ? query.split('&').filter((entry) => entry.length > 0) : [];
  const keyPrefix = `${key}=`;
  let replaced = false;
  const nextParams = params.flatMap((entry) => {
    const entryKey = entry.split('=', 1)[0];
    if (entryKey !== key) {
      return [entry];
    }
    replaced = true;
    return value === undefined ? [] : [`${keyPrefix}${value}`];
  });

  if (!replaced && value !== undefined) {
    nextParams.push(`${keyPrefix}${value}`);
  }

  const querySuffix = nextParams.length > 0 ? `?${nextParams.join('&')}` : '';
  const fragmentSuffix = fragment ? `#${fragment}` : '';
  return `${base}${querySuffix}${fragmentSuffix}`;
}

function applyArgsSecretEdit(serverConfig: MCPServerParams, secret: ConfiguredServerSecretEditDraft): boolean {
  if (!Array.isArray(serverConfig.args) || secret.fieldPath.length !== 2) {
    return true;
  }

  const index = Number(secret.fieldPath[1]);
  if (!Number.isInteger(index) || index < 0 || index >= serverConfig.args.length) {
    return true;
  }

  const current = serverConfig.args[index];
  if (typeof current !== 'string') {
    return true;
  }

  if (secret.action === 'clear') {
    serverConfig.args.splice(index, 1);
    return true;
  }

  if (secret.action === 'replace' && secret.replacement) {
    const value = replacementValue(secret.replacement);
    const assignment = secretAssignmentArg(current);
    serverConfig.args[index] = assignment ? `${assignment.prefix}${value}` : value;
  }

  return true;
}

function replacementValue(replacement: ConfiguredServerSecretReplacement): string {
  if (replacement.kind === 'environmentReference') {
    return normalizeEnvironmentReference(replacement.value);
  }

  return replacement.value;
}

function normalizeEnvironmentReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (/^\$\{[A-Z_][A-Z0-9_]*\}$/u.test(trimmed) || /^\$[A-Z_][A-Z0-9_]*$/u.test(trimmed)) {
    return trimmed;
  }
  return `\${${trimmed}}`;
}

function isEnvironmentReferenceInput(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^[A-Z_][A-Z0-9_]*$/u.test(trimmed) ||
    /^\$[A-Z_][A-Z0-9_]*$/u.test(trimmed) ||
    /^\$\{[A-Z_][A-Z0-9_]*\}$/u.test(trimmed)
  );
}

function isValidFieldPath(fieldPath: string[]): boolean {
  return fieldPath.length > 0 && fieldPath.every(isSafeFieldPathSegment);
}

function isSafeFieldPathSegment(segment: string): boolean {
  return segment.length > 0 && segment !== '__proto__' && segment !== 'prototype' && segment !== 'constructor';
}

function setNestedValue(target: Record<string, unknown>, fieldPath: string[], value: unknown): void {
  let cursor: Record<string, unknown> = target;
  for (const segment of fieldPath.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[fieldPath[fieldPath.length - 1]] = value;
}

function deleteNestedValue(target: Record<string, unknown>, fieldPath: string[]): void {
  let cursor: Record<string, unknown> = target;
  for (const segment of fieldPath.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      return;
    }
    cursor = existing as Record<string, unknown>;
  }
  delete cursor[fieldPath[fieldPath.length - 1]];
}

function validatePreviewServerConfig(serverConfig: MCPServerParams): ConfiguredServerPreviewValidation {
  const errors: ConfiguredServerPreviewValidationError[] = [];
  const type = typeof serverConfig.type === 'string' ? serverConfig.type : undefined;
  const url = typeof serverConfig.url === 'string' ? serverConfig.url : undefined;
  const command = typeof serverConfig.command === 'string' ? serverConfig.command : undefined;
  const schemaResult = previewTransportConfigSchema.safeParse(serverConfig);

  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      if (
        (issue.path[0] === 'type' && typeof serverConfig.type === 'string') ||
        (issue.path[0] === 'url' && typeof serverConfig.url === 'string') ||
        issue.path[0] === 'args'
      ) {
        continue;
      }
      errors.push({
        fieldPath: ['transport', ...issue.path.map(String)],
        code: 'invalid_transport_field',
        message: issue.message,
      });
    }
  }

  if (type === 'stdio' && !command) {
    errors.push({
      fieldPath: ['transport', 'command'],
      code: 'missing_stdio_command',
      message: 'Command is required for stdio servers.',
    });
  }

  if ((type === 'http' || type === 'sse' || type === 'streamableHttp') && !url) {
    errors.push({
      fieldPath: ['transport', 'url'],
      code: 'missing_transport_url',
      message: `URL is required for ${type} servers.`,
    });
  }

  if (type && !['stdio', 'http', 'sse', 'streamableHttp'].includes(type)) {
    errors.push({
      fieldPath: ['transport', 'type'],
      code: 'invalid_transport_type',
      message: 'Transport type must be stdio, http, sse, or streamableHttp.',
    });
  }

  if (url !== undefined && !isValidUrlOrEnvReference(url)) {
    errors.push({
      fieldPath: ['transport', 'url'],
      code: 'invalid_url',
      message: 'URL must be a valid URL or environment substitution reference.',
    });
  }

  if (
    serverConfig.args !== undefined &&
    (!Array.isArray(serverConfig.args) || !serverConfig.args.every((arg) => typeof arg === 'string'))
  ) {
    errors.push({
      fieldPath: ['transport', 'args'],
      code: 'invalid_string_list',
      message: 'Args must be a list of strings.',
    });
  }

  if (!url && !command) {
    errors.push({
      fieldPath: ['transport'],
      code: 'missing_transport',
      message: 'Configured server must define a command or URL.',
    });
  }

  return {
    status: errors.length === 0 ? 'valid' : 'invalid',
    errors,
  };
}

function mergeValidation(
  editValidation: ConfiguredServerPreviewValidation,
  serverValidation: ConfiguredServerPreviewValidation,
): ConfiguredServerPreviewValidation {
  const errors = [...editValidation.errors, ...serverValidation.errors];
  return {
    status: errors.length === 0 ? 'valid' : 'invalid',
    errors,
  };
}

function isValidUrlOrEnvReference(value: string): boolean {
  if (/\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*/u.test(value)) {
    return true;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function previewConfigChange(targetName: string, changed: boolean): ConfigChangeResult {
  return {
    status: changed ? 'changed' : 'unchanged',
    operation: 'set_static' as ConfigChangeResult['operation'],
    configPath: '[redacted]',
    target: { name: targetName, source: 'mcpServers' },
    changed,
    backup: { created: false },
    retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
    reload: { status: 'skipped' },
    warnings: [],
  };
}

function previewFingerprint(input: {
  targetName: string;
  edit: ConfiguredServerEditDraft;
  current: ConfiguredServerReadModel;
  proposed: ConfiguredServerReadModel;
  diff: ConfiguredServerPreviewDiffEntry[];
  validation: ConfiguredServerPreviewValidation;
}): string {
  return `preview_${createHash('sha256')
    .update(
      stableStringify({
        schemaVersion: 2,
        targetName: input.targetName,
        edit: redactEditDraftForFingerprint(input.edit),
        current: input.current,
        proposed: input.proposed,
        diff: input.diff,
        validation: input.validation,
      }),
    )
    .digest('hex')}`;
}

function redactEditDraftForFingerprint(edit: ConfiguredServerEditDraft): ConfiguredServerEditDraft {
  return {
    ...edit,
    secrets: edit.secrets?.map((secret) => ({
      fieldPath: secret.fieldPath,
      action: secret.action,
      replacement: secret.replacement ? fingerprintSecretReplacement(secret.replacement) : undefined,
    })),
  };
}

function fingerprintSecretReplacement(
  replacement: ConfiguredServerSecretReplacement,
): ConfiguredServerSecretReplacement {
  if (replacement.kind === 'environmentReference') {
    return {
      kind: replacement.kind,
      value: normalizeEnvironmentReference(replacement.value),
    };
  }

  return {
    kind: replacement.kind,
    value: `sha256:${createHash('sha256').update(replacement.value).digest('hex')}`,
  };
}

function createPreviewDiff(
  current: ConfiguredServerReadModel,
  proposed: ConfiguredServerReadModel,
  edit: ConfiguredServerEditDraft,
): ConfiguredServerPreviewDiffEntry[] {
  const diff: ConfiguredServerPreviewDiffEntry[] = [];

  pushDiff(diff, ['id'], current.id, proposed.id, proposed.id === current.id ? [] : ['rename']);
  pushDiff(diff, ['enabled'], current.enabled, proposed.enabled, ['connection_critical']);
  pushDiff(diff, ['tags'], current.tags, proposed.tags, []);

  const secretEditedTopLevelKeys = new Set((edit.secrets ?? []).map((secret) => secret.fieldPath[0]));
  const transportEditedKeys = new Set(Object.keys(edit.transport ?? {}));
  const transportKeys = new Set([...Object.keys(current.transport), ...Object.keys(proposed.transport)]);
  for (const key of transportKeys) {
    if (secretEditedTopLevelKeys.has(key) && !transportEditedKeys.has(key)) {
      continue;
    }
    const currentValue = current.transport[key];
    const proposedValue = proposed.transport[key];
    pushDiff(diff, ['transport', key], currentValue, proposedValue, previewRiskFlags([key]));
  }

  for (const secret of edit.secrets ?? []) {
    if (secret.action === 'preserve' || !isValidFieldPath(secret.fieldPath)) {
      continue;
    }

    diff.push({
      fieldPath: secret.fieldPath,
      secretAction: secret.action,
      oldValue: readRedactedField(current.transport, secret.fieldPath),
      newValue: redactedSecretPreviewValue(secret),
      riskFlags: [...previewRiskFlags(secret.fieldPath), 'secret'],
    });
  }

  return diff;
}

function pushDiff(
  diff: ConfiguredServerPreviewDiffEntry[],
  fieldPath: string[],
  oldValue: unknown,
  newValue: unknown,
  riskFlags: ConfiguredServerPreviewDiffEntry['riskFlags'],
): void {
  if (stableStringify(oldValue) === stableStringify(newValue)) {
    return;
  }

  diff.push({
    fieldPath,
    oldValue,
    newValue,
    riskFlags,
  });
}

function readRedactedField(source: Record<string, unknown>, fieldPath: string[]): unknown {
  if (fieldPath[0] === 'env' && Array.isArray(source.env)) {
    return redactedValue();
  }

  if (fieldPath[0] === 'url') {
    return readRedactedUrlField(source.url, fieldPath);
  }

  if (fieldPath[0] === 'args') {
    return readRedactedArgsField(source.args, fieldPath);
  }

  let cursor: unknown = source;
  for (const segment of fieldPath) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function readRedactedUrlField(value: unknown, fieldPath: string[]): unknown {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    const url = new URL(value);
    const [, scope, key] = fieldPath;
    if (scope === 'username') {
      return url.username ? redactedValue() : undefined;
    }
    if (scope === 'password') {
      return url.password ? redactedValue() : undefined;
    }
    if (scope === 'query' && key) {
      return url.searchParams.has(key) ? redactedValue() : undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readRedactedArgsField(value: unknown, fieldPath: string[]): unknown {
  if (!Array.isArray(value) || fieldPath.length !== 2) {
    return undefined;
  }

  const index = Number(fieldPath[1]);
  return Number.isInteger(index) && index >= 0 && index < value.length ? redactedValue() : undefined;
}

function redactedSecretPreviewValue(secret: ConfiguredServerSecretEditDraft): unknown {
  if (secret.action === 'clear') {
    return { present: false, value: '[REDACTED]', secret: true };
  }

  if (secret.replacement?.kind === 'environmentReference') {
    return {
      kind: 'environmentReference',
      value: normalizeEnvironmentReference(secret.replacement.value),
      storesSecretMaterial: false,
    };
  }

  return { present: true, value: '[REDACTED]', secret: true };
}

function isConnectionCriticalPath(fieldPath: string[]): boolean {
  const joined = fieldPath.join('.');
  return /^(type|command|url|args|cwd|env|headers|oauth|metadata|template)/u.test(joined);
}

function previewRiskFlags(fieldPath: string[]): ConfiguredServerPreviewDiffEntry['riskFlags'] {
  const flags: ConfiguredServerPreviewDiffEntry['riskFlags'] = [];
  if (isConnectionCriticalPath(fieldPath)) {
    flags.push('connection_critical');
  }
  if (fieldPath.includes('template')) {
    flags.push('template_risk');
  }
  return flags;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createConfiguredServerReadModel(name: string, serverConfig: MCPServerParams): ConfiguredServerReadModel {
  const secretInputs: ConfiguredServerSecretInput[] = [];
  const transport: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(serverConfig)) {
    if (key === 'disabled' || key === 'tags') {
      continue;
    }

    if (key === 'env') {
      transport.env = redactNamedSecretRecord(value, ['env'], secretInputs);
      continue;
    }

    if (key === 'headers') {
      transport.headers = redactNamedSecretRecord(value, ['headers'], secretInputs);
      continue;
    }

    if (key === 'args') {
      transport.args = sanitizeCommandArgs(value, secretInputs);
      continue;
    }

    if (key === 'oauth') {
      transport.oauth = redactOAuthConfig(value, secretInputs);
      continue;
    }

    if (key === 'url' && typeof value === 'string') {
      transport.url = redactUrlQuerySecrets(value, secretInputs);
      continue;
    }

    transport[key] = sanitizeUnknownValue(value, [key], secretInputs);
  }

  const enabled = serverConfig.disabled ? false : true;

  return {
    id: name,
    source: 'mcpServers',
    target: {
      type: 'configured_server',
      id: name,
      source: 'mcpServers',
    },
    enabled,
    tags: normalizeTags(serverConfig.tags),
    transportSummary: createTransportSummary(serverConfig, transport),
    mutationAvailability: {
      available: true,
      operations: ['enable', 'disable'],
    },
    actionState: createActionState(name, enabled),
    transport,
    secretInputs,
  };
}

const STDIO_TRANSPORT_TYPES: ConfiguredServerTransportType[] = ['stdio'];
const NETWORK_TRANSPORT_TYPES: ConfiguredServerTransportType[] = ['http', 'sse', 'streamableHttp'];

interface TransportFieldDefinition {
  key: string;
  label: string;
  control: ConfiguredServerEditFieldControl;
  defaultValue?: unknown;
  options?: string[];
  applicableTransportTypes?: ConfiguredServerTransportType[];
}

const TRANSPORT_FIELD_DEFINITIONS: TransportFieldDefinition[] = [
  {
    key: 'type',
    label: 'Transport Type',
    control: 'select',
    options: ['stdio', 'http', 'sse', 'streamableHttp'],
  },
  { key: 'timeout', label: 'Deprecated Timeout', control: 'number' },
  { key: 'connectionTimeout', label: 'Connection Timeout', control: 'number' },
  { key: 'requestTimeout', label: 'Request Timeout', control: 'number' },
  { key: 'disabledTools', label: 'Disabled Tools', control: 'string-list', defaultValue: [] },
  { key: 'template', label: 'Template', control: 'record', defaultValue: {} },
  {
    key: 'url',
    label: 'URL',
    control: 'text',
    defaultValue: '',
    applicableTransportTypes: NETWORK_TRANSPORT_TYPES,
  },
  {
    key: 'headers',
    label: 'Headers',
    control: 'record',
    defaultValue: {},
    applicableTransportTypes: NETWORK_TRANSPORT_TYPES,
  },
  {
    key: 'oauth',
    label: 'OAuth',
    control: 'record',
    defaultValue: {},
    applicableTransportTypes: NETWORK_TRANSPORT_TYPES,
  },
  {
    key: 'command',
    label: 'Command',
    control: 'text',
    defaultValue: '',
    applicableTransportTypes: STDIO_TRANSPORT_TYPES,
  },
  {
    key: 'args',
    label: 'Args',
    control: 'string-list',
    defaultValue: [],
    applicableTransportTypes: STDIO_TRANSPORT_TYPES,
  },
  {
    key: 'stderr',
    label: 'Stderr',
    control: 'text',
    defaultValue: '',
    applicableTransportTypes: STDIO_TRANSPORT_TYPES,
  },
  {
    key: 'cwd',
    label: 'Working Directory',
    control: 'text',
    defaultValue: '',
    applicableTransportTypes: STDIO_TRANSPORT_TYPES,
  },
  {
    key: 'env',
    label: 'Environment',
    control: 'record',
    defaultValue: {},
    applicableTransportTypes: STDIO_TRANSPORT_TYPES,
  },
  {
    key: 'inheritParentEnv',
    label: 'Inherit Parent Environment',
    control: 'switch',
    defaultValue: false,
    applicableTransportTypes: STDIO_TRANSPORT_TYPES,
  },
  {
    key: 'envFilter',
    label: 'Environment Filter',
    control: 'string-list',
    defaultValue: [],
    applicableTransportTypes: STDIO_TRANSPORT_TYPES,
  },
  {
    key: 'restartOnExit',
    label: 'Restart On Exit',
    control: 'switch',
    defaultValue: false,
    applicableTransportTypes: STDIO_TRANSPORT_TYPES,
  },
  {
    key: 'maxRestarts',
    label: 'Maximum Restarts',
    control: 'number',
    applicableTransportTypes: STDIO_TRANSPORT_TYPES,
  },
  {
    key: 'restartDelay',
    label: 'Restart Delay',
    control: 'number',
    applicableTransportTypes: STDIO_TRANSPORT_TYPES,
  },
];

const TRANSPORT_FIELD_DEFINITION_BY_KEY = new Map(
  TRANSPORT_FIELD_DEFINITIONS.map((definition) => [definition.key, definition]),
);

function createConfiguredServerEditContract(server: ConfiguredServerReadModel): ConfiguredServerEditContract {
  const secretFieldKeys = new Set(server.secretInputs.map((input) => fieldKey(input.fieldPath)));
  const transportFields = TRANSPORT_FIELD_DEFINITIONS.map((definition) => {
    const value = Object.prototype.hasOwnProperty.call(server.transport, definition.key)
      ? server.transport[definition.key]
      : definition.defaultValue;
    return transportEditField(definition.key, omitSecretValues(value, [definition.key], secretFieldKeys), definition);
  });
  const knownTransportFields = new Set(TRANSPORT_FIELD_DEFINITIONS.map((definition) => definition.key));
  for (const [key, value] of Object.entries(server.transport)) {
    if (knownTransportFields.has(key) || secretFieldKeys.has(key)) continue;
    transportFields.push(transportEditField(key, omitSecretValues(value, [key], secretFieldKeys)));
  }

  return {
    schemaVersion: 2,
    target: server.target,
    capabilities: {
      singleTargetEdit: true,
      rename: { supported: true },
      create: { supported: false },
      delete: { supported: false },
      bulkEdit: { supported: false },
      rawJson: { supported: false },
      preview: { supported: true },
      apply: { supported: false },
    },
    fieldGroups: [
      {
        id: 'identity',
        label: 'Target',
        fields: [
          {
            fieldPath: ['id'],
            label: 'Target ID',
            control: 'text',
            value: server.id,
            editable: true,
          },
          {
            fieldPath: ['enabled'],
            label: 'Enabled',
            control: 'switch',
            value: server.enabled,
            editable: true,
          },
          {
            fieldPath: ['tags'],
            label: 'Tags',
            control: 'tag-list',
            value: server.tags,
            editable: true,
          },
        ],
      },
      {
        id: 'transport',
        label: 'Transport',
        fields: transportFields,
      },
      {
        id: 'secrets',
        label: 'Secrets',
        fields: server.secretInputs.map(secretEditField),
      },
    ],
  };
}

function omitSecretValues(value: unknown, fieldPath: string[], secretFieldKeys: Set<string>): unknown {
  if (secretFieldKeys.has(fieldKey(fieldPath))) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry, index) => omitSecretValues(entry, [...fieldPath, String(index)], secretFieldKeys))
      .filter((entry) => entry !== undefined);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const nextValue = omitSecretValues(nestedValue, [...fieldPath, key], secretFieldKeys);
    if (nextValue !== undefined) {
      cleaned[key] = nextValue;
    }
  }
  return cleaned;
}

function transportEditField(
  key: string,
  value: unknown,
  definition = TRANSPORT_FIELD_DEFINITION_BY_KEY.get(key),
): ConfiguredServerEditField {
  if (definition) {
    return {
      fieldPath: ['transport', key],
      label: definition.label,
      control: definition.control,
      value,
      options: definition.options,
      editable: true,
      applicableTransportTypes: definition.applicableTransportTypes,
    };
  }

  if (Array.isArray(value)) {
    return {
      fieldPath: ['transport', key],
      label: labelFromPath([key]),
      control: 'string-list',
      value,
      editable: true,
    };
  }

  if (value && typeof value === 'object') {
    return {
      fieldPath: ['transport', key],
      label: labelFromPath([key]),
      control: 'record',
      value,
      editable: true,
    };
  }

  return {
    fieldPath: ['transport', key],
    label: labelFromPath([key]),
    control: typeof value === 'boolean' ? 'switch' : 'text',
    value,
    editable: true,
  };
}

function secretEditField(input: ConfiguredServerSecretInput): ConfiguredServerEditField {
  return {
    fieldPath: input.fieldPath,
    label: input.label,
    control: 'secret',
    editable: true,
    applicableTransportTypes: transportFieldApplicability(input.fieldPath[0]),
    secret: {
      state: input.state,
      defaultAction: 'preserve',
      allowedActions: input.allowedActions,
      environmentReference: {
        supported: true,
        recommended: true,
        valueFormat: 'env_var_name_or_substitution',
        storesSecretMaterial: false,
        guidance:
          'Store only the environment variable name or substitution expression; keep secret material outside 1MCP config.',
      },
      inlineReplacement: {
        supported: true,
        emphasis: 'secondary',
        guidance: 'Use inline replacement only as a secondary path when an environment reference is not suitable.',
      },
    },
  };
}

function fieldKey(fieldPath: string[]): string {
  return fieldPath.join('\0');
}

function labelFromPath(pathSegments: string[]): string {
  return pathSegments
    .join(' ')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .replace(/[-_.]+/gu, ' ')
    .replace(/\b\w/gu, (char) => char.toUpperCase());
}

function createActionState(name: string, enabled: boolean): ConfiguredServerActionState {
  return {
    enable: enabled
      ? {
          available: false,
          disabledReason: 'already_enabled',
          label: `Enable ${name}`,
        }
      : {
          available: true,
          label: `Enable ${name}`,
        },
    disable: enabled
      ? {
          available: true,
          label: `Disable ${name}`,
        }
      : {
          available: false,
          disabledReason: 'already_disabled',
          label: `Disable ${name}`,
        },
  };
}

function createTransportSummary(
  serverConfig: MCPServerParams,
  transport: Record<string, unknown>,
): ConfiguredServerTransportSummary {
  const kind = transportKind(serverConfig);
  const url = typeof transport.url === 'string' ? transport.url : undefined;
  const command = typeof serverConfig.command === 'string' ? serverConfig.command : undefined;
  const args = Array.isArray(transport.args)
    ? transport.args.filter((arg): arg is string => typeof arg === 'string')
    : [];

  if (url) {
    return { kind, label: url };
  }

  if (command) {
    return {
      kind,
      label: [command, ...args].join(' '),
    };
  }

  return { kind, label: kind };
}

function sanitizeCommandArgs(value: unknown, secretInputs: ConfiguredServerSecretInput[]): unknown {
  if (!Array.isArray(value)) {
    return sanitizeUnknownValue(value, ['args'], secretInputs);
  }

  let pendingSecretInput: { fieldPath: string[]; label: string } | undefined;
  return value.map((entry, index) => {
    const fieldPath = ['args', String(index)];
    if (typeof entry !== 'string') {
      pendingSecretInput = undefined;
      return sanitizeUnknownValue(entry, fieldPath, secretInputs);
    }

    if (pendingSecretInput) {
      secretInputs.push(secretInput(fieldPath, pendingSecretInput.label));
      pendingSecretInput = undefined;
      return 'REDACTED';
    }

    const assignment = secretAssignmentArg(entry);
    if (assignment) {
      secretInputs.push(secretInput(fieldPath, `args.${assignment.label}`));
      return `${assignment.prefix}REDACTED`;
    }

    if (containsSecretLikeString(entry)) {
      secretInputs.push(secretInput(fieldPath, `args.${fieldPath[1]}`));
      return redactSecretArg(entry);
    }

    const secretFlag = secretFlagArg(entry);
    if (secretFlag) {
      pendingSecretInput = { fieldPath, label: `args.${secretFlag}` };
      return entry;
    }

    if (secretCarrierArg(entry)) {
      pendingSecretInput = { fieldPath, label: `args.${entry}` };
      return entry;
    }

    return entry;
  });
}

function secretAssignmentArg(value: string): { prefix: string; label: string } | null {
  const match = value.match(/^((-{1,2}[^=\s]+)|([A-Za-z_][A-Za-z0-9_]*))=(.*)$/u);
  if (!match) {
    return null;
  }

  const key = match[1];
  return isSecretLikeKey(key) ? { prefix: `${key}=`, label: key } : null;
}

function redactSecretArg(value: string): string {
  if (value.includes('=')) {
    return `${value.split('=', 1)[0]}=REDACTED`;
  }
  return 'REDACTED';
}

function secretFlagArg(value: string): string | undefined {
  return /^-{1,2}[^=\s]+$/u.test(value) && isSecretLikeKey(value) ? value : undefined;
}

function transportKind(serverConfig: MCPServerParams): string {
  if (typeof serverConfig.type === 'string') {
    return serverConfig.type;
  }
  if (typeof serverConfig.url === 'string') {
    return 'http';
  }
  if (typeof serverConfig.command === 'string') {
    return 'stdio';
  }
  return 'unknown';
}

function wouldUseLocalStdioTransport(serverConfig: MCPServerParams): boolean {
  return serverConfig.type === 'stdio' || (!serverConfig.type && typeof serverConfig.command === 'string');
}

function normalizeTags(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
}

function redactNamedSecretRecord(
  value: unknown,
  basePath: string[],
  secretInputs: ConfiguredServerSecretInput[],
): Record<string, RedactedConfiguredServerValue> | RedactedConfiguredServerValue[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      const label = typeof entry === 'string' && entry.includes('=') ? entry.split('=')[0] : String(index);
      secretInputs.push(secretInput([...basePath, label], label));
      return redactedValue();
    });
  }

  if (!value || typeof value !== 'object') {
    return {};
  }

  const redacted: Record<string, RedactedConfiguredServerValue> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    redacted[key] = redactedValue();
    secretInputs.push(secretInput([...basePath, key], key));
  }
  return redacted;
}

function redactOAuthConfig(value: unknown, secretInputs: ConfiguredServerSecretInput[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof fieldValue === 'string') {
      redacted[key] = redactedValue();
      secretInputs.push(secretInput(['oauth', key], key));
    } else {
      redacted[key] = sanitizeUnknownValue(fieldValue, ['oauth', key], secretInputs);
    }
  }
  return redacted;
}

function redactUrlQuerySecrets(value: string, secretInputs: ConfiguredServerSecretInput[]): string {
  try {
    const url = new URL(value);
    if (url.username) {
      url.username = 'REDACTED';
      secretInputs.push(secretInput(['url', 'username'], 'url.username'));
    }
    if (url.password) {
      url.password = 'REDACTED';
      secretInputs.push(secretInput(['url', 'password'], 'url.password'));
    }
    for (const key of Array.from(url.searchParams.keys())) {
      const value = url.searchParams.get(key) ?? '';
      if (isSecretLikeKey(key) || containsSecretLikeString(value)) {
        url.searchParams.set(key, 'REDACTED');
        secretInputs.push(secretInput(['url', 'query', key], `url.query.${key}`));
      }
    }
    return url.toString();
  } catch {
    let redacted = value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/?#]+@/iu, (_match, prefix: string) => {
      secretInputs.push(secretInput(['url', 'userinfo'], 'url.userinfo', ['preserve']));
      return `${prefix}REDACTED@`;
    });
    redacted = redacted.replace(
      /([?&]([^=]*(?:token|secret|password|auth|key)[^=]*)=)[^&]*/giu,
      (_match: string, prefix: string, key: string) => {
        secretInputs.push(secretInput(['url', 'query', key], `url.query.${key}`));
        return `${prefix}REDACTED`;
      },
    );
    return redacted;
  }
}

function sanitizeUnknownValue(
  value: unknown,
  fieldPath: string[],
  secretInputs: ConfiguredServerSecretInput[],
): unknown {
  if (isSecretLikeKey(fieldPath[fieldPath.length - 1])) {
    secretInputs.push(secretInput(fieldPath, fieldPath.join('.')));
    return redactedValue();
  }

  if (typeof value === 'string' && containsSecretLikeString(value)) {
    secretInputs.push(secretInput(fieldPath, fieldPath.join('.')));
    return redactedValue();
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeUnknownValue(entry, [...fieldPath, String(index)], secretInputs));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = sanitizeUnknownValue(nestedValue, [...fieldPath, key], secretInputs);
  }
  return sanitized;
}

function isSecretLikeKey(key: string): boolean {
  return /api[_-]?key|access[_-]?token|token|password|secret|auth|credential|private[_-]?key/i.test(key);
}

function secretInput(
  fieldPath: string[],
  label = fieldPath[fieldPath.length - 1],
  allowedActions: ConfiguredServerSecretAction[] = ['preserve', 'replace', 'clear'],
): ConfiguredServerSecretInput {
  return {
    fieldPath,
    label,
    state: 'present',
    allowedActions,
  };
}

function redactedValue(): RedactedConfiguredServerValue {
  return {
    present: true,
    value: '[REDACTED]',
    secret: true,
  };
}

import type { MCPServerParams } from '@src/core/types/index.js';
import type { ConfigChangeResult, ConfigChangeService } from '@src/domains/config-change/configChange.js';

import type {
  AdminAuditFact,
  AdminConfirmationRequirement,
  AdminOperationContext,
  AdminOperationResult,
  AdminOperationService,
} from './adminOperationService.js';

type ConfiguredServerSecretAction = 'preserve' | 'replace' | 'clear';

interface AdminConfiguredServerServiceOptions {
  operationService: AdminOperationService;
  configChangeService: ConfigChangeService;
  readConfigDocument: () => ConfiguredServerConfigDocument | null;
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

export type ConfiguredServerEditFieldControl =
  'text' | 'switch' | 'tag-list' | 'select' | 'string-list' | 'secret' | 'record' | 'readonly';

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
  secret?: ConfiguredServerSecretEditMetadata;
}

export interface ConfiguredServerEditFieldGroup {
  id: string;
  label: string;
  fields: ConfiguredServerEditField[];
}

export interface ConfiguredServerEditContract {
  schemaVersion: 1;
  target: ConfiguredServerTargetIdentity;
  capabilities: {
    singleTargetEdit: true;
    rename: { supported: true };
    create: { supported: false };
    delete: { supported: false };
    bulkEdit: { supported: false };
    rawJson: { supported: false };
    preview: { supported: false };
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

function createConfiguredServerEditContract(server: ConfiguredServerReadModel): ConfiguredServerEditContract {
  const secretFieldKeys = new Set(server.secretInputs.map((input) => fieldKey(input.fieldPath)));
  const transportFields = Object.entries(server.transport)
    .filter(([key]) => !secretFieldKeys.has(key))
    .map(([key, value]) => transportEditField(key, omitSecretValues(value, [key], secretFieldKeys)));

  return {
    schemaVersion: 1,
    target: server.target,
    capabilities: {
      singleTargetEdit: true,
      rename: { supported: true },
      create: { supported: false },
      delete: { supported: false },
      bulkEdit: { supported: false },
      rawJson: { supported: false },
      preview: { supported: false },
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

function transportEditField(key: string, value: unknown): ConfiguredServerEditField {
  if (key === 'type') {
    return {
      fieldPath: ['transport', 'type'],
      label: 'Transport Type',
      control: 'select',
      value,
      options: ['stdio', 'http', 'sse'],
      editable: true,
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

  let pendingSecretFlag: string | undefined;
  return value.map((entry, index) => {
    const fieldPath = ['args', String(index)];
    if (typeof entry !== 'string') {
      pendingSecretFlag = undefined;
      return sanitizeUnknownValue(entry, fieldPath, secretInputs);
    }

    if (pendingSecretFlag) {
      secretInputs.push(secretInput(fieldPath, `args.${pendingSecretFlag}`));
      pendingSecretFlag = undefined;
      return 'REDACTED';
    }

    const assignment = secretAssignmentArg(entry);
    if (assignment) {
      secretInputs.push(secretInput(fieldPath, `args.${assignment.label}`));
      return `${assignment.prefix}REDACTED`;
    }

    pendingSecretFlag = secretFlagArg(entry);
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
      redacted[key] = fieldValue;
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
      if (isSecretLikeKey(key)) {
        url.searchParams.set(key, 'REDACTED');
        secretInputs.push(secretInput(['url', 'query', key], `url.query.${key}`));
      }
    }
    return url.toString();
  } catch {
    return value.replace(
      /([?&]([^=]*(?:token|secret|password|auth|key)[^=]*)=)[^&]*/giu,
      (_match: string, prefix: string, key: string) => {
        secretInputs.push(secretInput(['url', 'query', key], `url.query.${key}`));
        return `${prefix}REDACTED`;
      },
    );
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

function secretInput(fieldPath: string[], label = fieldPath[fieldPath.length - 1]): ConfiguredServerSecretInput {
  return {
    fieldPath,
    label,
    state: 'present',
    allowedActions: ['preserve', 'replace', 'clear'],
  };
}

function redactedValue(): RedactedConfiguredServerValue {
  return {
    present: true,
    value: '[REDACTED]',
    secret: true,
  };
}

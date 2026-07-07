import fs from 'node:fs';

import ConfigContext from '@src/config/configContext.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import type { ConfigChangeResult, ConfigChangeService } from '@src/domains/config-change/configChange.js';

import type {
  AdminAuditFact,
  AdminOperationContext,
  AdminOperationResult,
  AdminOperationService,
} from './adminOperationService.js';

type ConfiguredServerSecretAction = 'preserve' | 'replace' | 'clear';

interface AdminConfiguredServerServiceOptions {
  operationService: AdminOperationService;
  configChangeService: ConfigChangeService;
  getConfigPath?: () => string;
}

interface ConfiguredServerMutationInput {
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

export interface ConfiguredServerReadModel {
  id: string;
  source: 'mcpServers';
  enabled: boolean;
  transport: Record<string, unknown>;
  secretInputs: ConfiguredServerSecretInput[];
}

export interface ConfiguredServerMutationResult {
  targetName: string;
  enabled: boolean;
  outcome: 'enabled' | 'disabled' | 'already_enabled' | 'already_disabled';
  configChange: ConfigChangeResult;
}

export interface AdminConfiguredServerOperations {
  listConfiguredServers(input: {
    context: AdminOperationContext;
  }): Promise<AdminOperationResult<{ servers: ConfiguredServerReadModel[] }>>;
  enableConfiguredServer(
    input: ConfiguredServerMutationInput,
  ): Promise<AdminOperationResult<ConfiguredServerMutationResult>>;
  disableConfiguredServer(
    input: ConfiguredServerMutationInput,
  ): Promise<AdminOperationResult<ConfiguredServerMutationResult>>;
  getRecentAuditFacts(options?: { limit?: number }): AdminAuditFact[];
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
    return this.options.operationService.executeMutation({
      context: {
        ...input.context,
        target: { type: 'configured_server', id: input.targetName },
      },
      operationName,
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
    const configPath = this.options.getConfigPath?.() ?? ConfigContext.getInstance().getResolvedConfigPath();
    if (!fs.existsSync(configPath)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { mcpServers?: Record<string, MCPServerParams> };
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
    if (key === 'disabled') {
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

  return {
    id: name,
    source: 'mcpServers',
    enabled: serverConfig.disabled ? false : true,
    transport,
    secretInputs,
  };
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

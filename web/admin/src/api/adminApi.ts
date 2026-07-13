export interface AdminAccount {
  id: string;
  username: string;
  role: 'full-admin' | string;
}

export interface AdminSession {
  authenticated: true;
  account: AdminAccount;
  csrfToken: string;
  expiresAt: string;
}

export interface UnauthenticatedSession {
  authenticated: false;
  adminStatus?: 'setupRequired' | 'loginRequired';
}

export interface RuntimeIdentity {
  identityProtocolVersion: string;
  runtimeScopeId: string;
  externalUrl?: string;
  runtimeVersion: string;
  serverTime?: string;
}

export interface OAuthServiceStatus {
  name: string;
  status: string;
  requiresOAuth?: boolean;
  lastError?: string;
}

export interface AdminAuditFact {
  timestamp: string;
  operationId?: string;
  operationName: string;
  result: string;
  target?: { type?: string; id?: string };
  request?: { requestId?: string };
}

export interface AdminStatus {
  ok: true;
  runtime: RuntimeIdentity;
  session: {
    authenticated: true;
    account: AdminAccount;
    expiresAt: string;
  };
  oauth: {
    status: string;
    services: OAuthServiceStatus[];
  };
  audit: {
    facts: AdminAuditFact[];
  };
  about: AdminAboutMetadata;
}

export interface AdminAboutMetadata {
  productName: string;
  runtimeVersion: string;
  adminUiBuildVersion?: string;
  adminApiProtocolVersion: string;
  adminUiProtocolVersion?: string;
  protocolCompatible: boolean;
  runtime: { runtimeScopeId: string; externalUrl?: string };
  build: { commit?: string; timestamp?: string };
  project: { repository?: string; documentation?: string; issues?: string; license?: string };
}

export interface AdminPresetDraft {
  name: string;
  description?: string;
  strategy: 'or' | 'and' | 'advanced';
  tagQuery: Record<string, unknown>;
}

export interface AdminPresetListItem extends AdminPresetDraft {
  querySummary: string;
  matchCount: number;
}

export interface AdminPresetPreview {
  draft: AdminPresetDraft;
  revision: string;
  previewFingerprint: string;
  validation: {
    status: 'valid' | 'invalid';
    fieldErrors: Array<{ field: string; message: string }>;
    globalErrors: string[];
    warnings: string[];
  };
  matches: Array<{ name: string; tags: string[]; enabled: boolean; matched: boolean; reason: string }>;
  matchCount: number;
  structuredConversion: { lossless: boolean; strategy?: 'or' | 'and'; tags?: string[]; reason?: string };
}

export interface ConfiguredServerSecretInput {
  fieldPath: string[];
  label: string;
  state: 'present' | 'empty';
  allowedActions?: Array<'preserve' | 'replace' | 'clear'>;
}

export interface ConfiguredServerReadModel {
  id: string;
  source: 'mcpServers';
  target: {
    type: 'configured_server';
    id: string;
    source: 'mcpServers';
  };
  enabled: boolean;
  tags: string[];
  transportSummary: {
    kind: string;
    label: string;
  };
  mutationAvailability: {
    available: boolean;
    operations: Array<'enable' | 'disable'>;
  };
  actionState: {
    enable: {
      available: boolean;
      label: string;
      disabledReason?: 'already_enabled' | 'already_disabled';
    };
    disable: {
      available: boolean;
      label: string;
      disabledReason?: 'already_enabled' | 'already_disabled';
    };
  };
  transport: Record<string, unknown>;
  secretInputs: ConfiguredServerSecretInput[];
}

export interface ConfiguredServerSecretEditMetadata {
  state: 'present' | 'empty';
  defaultAction: 'preserve' | 'replace' | 'clear';
  allowedActions: Array<'preserve' | 'replace' | 'clear'>;
  environmentReference: {
    supported: boolean;
    recommended: boolean;
    valueFormat?: 'env_var_name_or_substitution';
    storesSecretMaterial?: false;
    guidance?: string;
  };
  inlineReplacement: {
    supported: boolean;
    emphasis: 'secondary';
    guidance?: string;
  };
}

export interface ConfiguredServerEditField {
  fieldPath: string[];
  label: string;
  control: 'text' | 'switch' | 'tag-list' | 'select' | 'string-list' | 'secret' | 'record' | 'readonly';
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
  target: ConfiguredServerReadModel['target'];
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

export interface ConfiguredServerDetailResponse {
  ok: true;
  operationId: string;
  server: ConfiguredServerReadModel;
  editContract: ConfiguredServerEditContract;
}

export interface ConfiguredServerSecretReplacement {
  kind: 'environmentReference' | 'inlineSecret';
  value: string;
}

export interface ConfiguredServerSecretEditDraft {
  fieldPath: string[];
  action: 'preserve' | 'replace' | 'clear';
  replacement?: ConfiguredServerSecretReplacement;
}

export interface ConfiguredServerEditDraft {
  id?: string;
  enabled?: boolean;
  tags?: string[];
  transport?: Record<string, unknown>;
  secrets?: ConfiguredServerSecretEditDraft[];
}

export type ConfiguredServerPreviewRiskFlag = 'rename' | 'connection_critical' | 'secret' | 'template_risk';

export type ConfiguredServerConnectivityCheck =
  | {
      status: 'passed';
      mode: 'bounded_dry_run';
      checkedAt?: string;
    }
  | {
      status: 'failed';
      mode: 'bounded_dry_run';
      message: string;
    }
  | {
      status: 'skipped';
      reason:
        | 'connection_critical_fields_unchanged'
        | 'target_disabled'
        | 'validation_failed'
        | 'local_stdio_transport'
        | 'checker_unavailable'
        | 'endpoint_changed_with_preserved_secrets';
    };

export interface ConfiguredServerPreviewConfigChange {
  status: string;
  operation: string;
  configPath?: string;
  target: {
    name: string;
    source: string;
  };
  changed: boolean;
  backup: {
    created: boolean;
    path?: string;
  };
  retentionCleanup: {
    attempted: boolean;
    deletedPaths: string[];
    warnings: string[];
  };
  reload: {
    status: string;
    error?: string;
    before?: unknown;
    after?: unknown;
  };
  warnings?: string[];
  error?: string;
}

export interface ConfiguredServerPreviewResponse {
  ok: true;
  operationId: string;
  preview: {
    targetName: string;
    proposedTargetName: string;
    previewFingerprint: string;
    validation: {
      status: 'valid' | 'invalid';
      errors: Array<{ fieldPath: string[]; code: string; message: string }>;
    };
    diff: Array<{
      fieldPath: string[];
      oldValue: unknown;
      newValue: unknown;
      secretAction?: 'preserve' | 'replace' | 'clear';
      riskFlags: ConfiguredServerPreviewRiskFlag[];
    }>;
    configChange: ConfiguredServerPreviewConfigChange;
    connectivityCheck: ConfiguredServerConnectivityCheck;
  };
}

export interface AdminApiOptions {
  fetch?: typeof fetch;
  idempotencyKey?: (input: { action: 'enable' | 'disable'; targetName: string }) => string;
}

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export function createAdminApi(options: AdminApiOptions = {}) {
  const request = createRequest(options.fetch ?? fetch);
  const idempotencyKey = options.idempotencyKey ?? defaultIdempotencyKey;

  return {
    login(input: { username: string; password: string }): Promise<AdminSession> {
      return request('/admin/api/session/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    getSession(): Promise<AdminSession> {
      return request('/admin/api/session');
    },

    logout(csrfToken: string): Promise<{ ok: true }> {
      return request('/admin/api/session/logout', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
      });
    },

    getStatus(): Promise<AdminStatus> {
      return request('/admin/api/status');
    },

    async listPresets(): Promise<{ revision: string; presets: AdminPresetListItem[] }> {
      const response = await request<{ result: { revision: string; presets: AdminPresetListItem[] } }>(
        '/admin/api/presets',
      );
      return response.result;
    },

    async getPreset(name: string): Promise<{
      revision: string;
      preset: AdminPresetDraft;
      structuredConversion: AdminPresetPreview['structuredConversion'];
    }> {
      const response = await request<{
        result: {
          revision: string;
          preset: AdminPresetDraft;
          structuredConversion: AdminPresetPreview['structuredConversion'];
        };
      }>(`/admin/api/presets/${encodeURIComponent(name)}`);
      return response.result;
    },

    async previewPreset(input: {
      draft: AdminPresetDraft;
      sourceName?: string;
      csrfToken: string;
    }): Promise<AdminPresetPreview> {
      const response = await request<{ result: AdminPresetPreview }>('/admin/api/presets/preview', {
        method: 'POST',
        headers: { 'X-CSRF-Token': input.csrfToken },
        body: JSON.stringify({ draft: input.draft, sourceName: input.sourceName }),
      });
      return response.result;
    },

    mutatePreset(input: {
      action: 'create' | 'update' | 'duplicate';
      sourceName?: string;
      draft: AdminPresetDraft;
      revision: string;
      previewFingerprint: string;
      confirmations: Record<string, unknown>;
      csrfToken: string;
    }): Promise<unknown> {
      const path =
        input.action === 'create'
          ? '/admin/api/presets'
          : `/admin/api/presets/${encodeURIComponent(input.sourceName ?? '')}/${input.action === 'duplicate' ? 'duplicate' : 'update'}`;
      return request(path, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': input.csrfToken,
          'Idempotency-Key': defaultPresetIdempotencyKey(input.action, input.draft.name),
        },
        body: JSON.stringify({
          draft: input.draft,
          revision: input.revision,
          previewFingerprint: input.previewFingerprint,
          confirmationFacts: input.confirmations,
        }),
      });
    },

    async previewPresetDelete(input: { name: string; revision: string; csrfToken: string }): Promise<{
      previewFingerprint: string;
      matches: AdminPresetPreview['matches'];
      matchCount: number;
      consequence: string;
    }> {
      const response = await request<{
        result: {
          previewFingerprint: string;
          matches: AdminPresetPreview['matches'];
          matchCount: number;
          consequence: string;
        };
      }>(`/admin/api/presets/${encodeURIComponent(input.name)}/delete-preview`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': input.csrfToken },
        body: JSON.stringify({ revision: input.revision }),
      });
      return response.result;
    },

    deletePreset(input: {
      name: string;
      revision: string;
      previewFingerprint: string;
      csrfToken: string;
    }): Promise<unknown> {
      return request(`/admin/api/presets/${encodeURIComponent(input.name)}`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': input.csrfToken,
          'Idempotency-Key': defaultPresetIdempotencyKey('delete', input.name),
        },
        body: JSON.stringify({
          revision: input.revision,
          previewFingerprint: input.previewFingerprint,
          confirmationFacts: { previewConfirmed: input.previewFingerprint, presetNameConfirmed: input.name },
        }),
      });
    },

    async listConfiguredServers(): Promise<ConfiguredServerReadModel[]> {
      const response = await request<{ servers: ConfiguredServerReadModel[] }>('/admin/api/configured-servers');
      return response.servers ?? [];
    },

    getConfiguredServerDetail(name: string): Promise<ConfiguredServerDetailResponse> {
      return request(`/admin/api/configured-servers/${encodeURIComponent(name)}`);
    },

    previewConfiguredServerEdit(input: {
      name: string;
      csrfToken: string;
      edit: ConfiguredServerEditDraft;
      connectivityCheck?: 'auto' | 'manual';
    }): Promise<ConfiguredServerPreviewResponse> {
      return request(`/admin/api/configured-servers/${encodeURIComponent(input.name)}/preview`, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': input.csrfToken,
        },
        body: JSON.stringify({
          edit: input.edit,
          ...(input.connectivityCheck ? { connectivityCheck: input.connectivityCheck } : {}),
        }),
      });
    },

    setConfiguredServerEnabled(input: { name: string; enabled: boolean; csrfToken: string }): Promise<unknown> {
      const action = input.enabled ? 'enable' : 'disable';
      return request(`/admin/api/configured-servers/${encodeURIComponent(input.name)}/${action}`, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': input.csrfToken,
          'Idempotency-Key': idempotencyKey({ action, targetName: input.name }),
        },
        body: '{}',
      });
    },
  };
}

function defaultPresetIdempotencyKey(action: string, name: string): string {
  return `admin-console-preset-${action}-${encodeIdempotencyKeyPart(name)}-${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
}

export type AdminApiClient = ReturnType<typeof createAdminApi>;

function createRequest(fetchImpl: typeof fetch) {
  return async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = {
      'Content-Type': 'application/json',
      'X-Admin-UI-Build-Version': import.meta.env.VITE_ADMIN_UI_BUILD_VERSION ?? 'unavailable',
      'X-Admin-UI-Protocol-Version': import.meta.env.VITE_ADMIN_UI_PROTOCOL_VERSION ?? 'unavailable',
      ...(init.headers ?? {}),
    };
    const response = await fetchImpl(path, {
      ...init,
      headers,
    });
    const body = await readJson(response);

    if (!response.ok) {
      throw new AdminApiError(response.status, body, errorMessage(body, response.statusText));
    }

    return body as T;
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.error === 'string') {
      return record.error;
    }
    if (typeof record.code === 'string') {
      return record.code;
    }
    const nestedError = record.error as Record<string, unknown> | undefined;
    if (nestedError && typeof nestedError.code === 'string') {
      return nestedError.code;
    }
  }
  return fallback || 'Admin API request failed';
}

function defaultIdempotencyKey(input: { action: 'enable' | 'disable'; targetName: string }): string {
  const random = crypto.getRandomValues(new Uint32Array(2)).join('-');
  return `admin-console-${input.action}-${encodeIdempotencyKeyPart(input.targetName)}-${Date.now()}-${random}`;
}

function encodeIdempotencyKeyPart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

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
    preview: { supported: false };
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

    async listConfiguredServers(): Promise<ConfiguredServerReadModel[]> {
      const response = await request<{ servers: ConfiguredServerReadModel[] }>('/admin/api/configured-servers');
      return response.servers ?? [];
    },

    getConfiguredServerDetail(name: string): Promise<ConfiguredServerDetailResponse> {
      return request(`/admin/api/configured-servers/${encodeURIComponent(name)}`);
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

export type AdminApiClient = ReturnType<typeof createAdminApi>;

function createRequest(fetchImpl: typeof fetch) {
  return async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = {
      'Content-Type': 'application/json',
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

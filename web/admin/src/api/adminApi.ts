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
  id: string;
  displayName: string;
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

export interface BackendLogSource {
  id: string;
  canonicalName: string;
  displayName: string;
  kind: 'static' | 'template';
  capture: 'managed' | 'not-captured';
  lifecycle: 'active' | 'ended';
}

export interface BackendLogEntry {
  sequence: number;
  timestamp: string;
  sourceId: string;
  canonicalName: string;
  displayName: string;
  sourceKind: 'static' | 'template';
  kind: 'line' | 'repeated' | 'suppressed';
  content: string;
  count?: number;
  truncated: boolean;
}

export interface BackendLogSnapshot {
  sequence: number;
  sources: BackendLogSource[];
  entries: BackendLogEntry[];
}

export interface BackendLogSourceUpdate {
  sourceId: string;
  source?: BackendLogSource;
  removed: boolean;
}

export interface AdminLogEventSource {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
  onerror: ((event: Event) => void) | null;
  onopen: ((event: Event) => void) | null;
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

export interface AdminPresetTarget {
  name: string;
  tags: string[];
  enabled: boolean;
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
  structuredConversion: {
    lossless: boolean;
    strategy?: 'or' | 'and';
    tags?: string[];
    states?: Record<string, 'neutral' | 'include' | 'exclude'>;
    reason?: string;
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
  control: 'text' | 'number' | 'switch' | 'tag-list' | 'select' | 'string-list' | 'secret' | 'record' | 'readonly';
  value?: unknown;
  options?: string[];
  editable: boolean;
  applicableTransportTypes?: Array<'stdio' | 'http' | 'sse' | 'streamableHttp'>;
  secret?: ConfiguredServerSecretEditMetadata;
  source?: 'server' | 'inherited' | 'default';
  overrideSupported?: boolean;
  clearOverrideSupported?: boolean;
}

export interface ConfiguredServerEditFieldGroup {
  id: string;
  label: string;
  fields: ConfiguredServerEditField[];
}

export interface ConfiguredServerEditContract {
  schemaVersion: 1 | 2 | 3;
  target: ConfiguredServerReadModel['target'];
  capabilities: {
    singleTargetEdit: true;
    rename: { supported: true };
    create: { supported: false };
    delete: { supported: false };
    bulkEdit: { supported: false };
    rawJson: { supported: false };
    preview: { supported: true };
    apply: { supported: boolean };
  };
  fieldGroups: ConfiguredServerEditFieldGroup[];
}

export type ConfiguredServerCreateTransport = 'stdio' | 'http' | 'sse';

export interface ConfiguredServerCreateDraft {
  name: string;
  enabled: boolean;
  tags: string[];
  transport: Record<string, unknown> & { type: ConfiguredServerCreateTransport };
  secrets?: Array<{
    fieldPath: string[];
    action: 'replace';
    replacement: ConfiguredServerSecretReplacement;
  }>;
}

export interface ConfiguredServerCreateContractResponse {
  ok: true;
  operationId: string;
  createContract: {
    schemaVersion: 1;
    capabilities: {
      create: { supported: true };
      forceReplacement: { supported: false };
      rawJson: { supported: false };
      preview: { supported: true };
      apply: { supported: boolean };
    };
    fieldGroups: ConfiguredServerEditFieldGroup[];
    secretPolicy: {
      allowedActions: ['replace'];
      environmentReference: { recommended: true; storesSecretMaterial: false; guidance: string };
      inlineReplacement: { emphasis: 'secondary'; guidance: string };
    };
  };
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
  clearTransportOverrides?: string[];
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

export interface ConfiguredServerApplyResponse {
  ok: true;
  operationId: string;
  result: {
    originalTargetName: string;
    targetName: string;
    previewFingerprint: string;
    configChange: ConfiguredServerPreviewConfigChange;
  };
}

export interface ConfiguredServerCreatePreviewResponse {
  ok: true;
  operationId: string;
  preview: Omit<ConfiguredServerPreviewResponse['preview'], 'proposedTargetName'> & {
    proposedTargetName?: string;
    expectedReload: {
      policy: 'observe_after_write';
      possibleStatuses: readonly ['observed', 'runtime_not_running', 'reload_disabled', 'failed'];
    };
  };
}

export interface ConfiguredServerCreateResponse {
  ok: true;
  operationId: string;
  result: {
    targetName: string;
    previewFingerprint: string;
    configChange: ConfiguredServerPreviewConfigChange;
  };
}

export interface AdminApiOptions {
  fetch?: typeof fetch;
  eventSource?: (url: string) => AdminLogEventSource;
  idempotencyKey?: (input: {
    action: 'enable' | 'disable' | 'oauth-authorize' | 'oauth-restart';
    targetName: string;
  }) => string;
}

export interface OAuthAuthorizationRedirectResult {
  serviceId: string;
  redirectUrl: string;
}

export class AdminApiError extends Error {
  public readonly failure: AdminApiFailure;

  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
    failure?: AdminApiFailure,
  ) {
    super(message);
    this.name = 'AdminApiError';
    this.failure = failure ?? classifyAdminApiError(this);
  }
}

export type AdminApiFailure =
  | {
      kind: 'unauthenticated';
      adminStatus: 'setupRequired' | 'loginRequired';
      code: string;
      message: string;
      requestId: string | null;
      status: 401;
    }
  | {
      kind: 'configuredServerNotFound';
      code: 'configured_server_not_found';
      message: string;
      requestId: string | null;
      status: 404;
    }
  | {
      kind: 'rejected';
      code: string;
      message: string;
      requestId: string | null;
      status: number;
    }
  | {
      kind: 'unavailable';
      message: string;
    };

function classifyAdminApiError(error: AdminApiError): AdminApiFailure {
  const code = readErrorCode(error);
  const requestId = readRequestId(error.body);
  const message = requestId
    ? `${friendlyAdminError(error, code)} Request ID: ${requestId}`
    : friendlyAdminError(error, code);
  if (error.status === 401) {
    return {
      kind: 'unauthenticated',
      adminStatus: readAdminStatus(error.body),
      code,
      message,
      requestId,
      status: 401,
    };
  }
  if (error.status === 404 && code === 'configured_server_not_found') {
    return { kind: 'configuredServerNotFound', code, message, requestId, status: 404 };
  }
  return { kind: 'rejected', code, message, requestId, status: error.status };
}

export function createAdminApi(options: AdminApiOptions = {}) {
  const request = createRequest(options.fetch ?? fetch);
  const idempotencyKey = options.idempotencyKey ?? defaultIdempotencyKey;
  const createEventSource = options.eventSource ?? ((url: string) => new EventSource(url) as AdminLogEventSource);

  return {
    login(input: { username: string; password: string }): Promise<AdminSession> {
      return request('/admin/api/session/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    getSession(): Promise<AdminSession | UnauthenticatedSession> {
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

    getBackendLogSnapshot(sourceId?: string): Promise<BackendLogSnapshot> {
      const query = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : '';
      return request(`/admin/api/logs/snapshot${query}`);
    },

    openBackendLogStream(handlers: {
      onSnapshot(snapshot: BackendLogSnapshot): void;
      onGap(snapshot: BackendLogSnapshot): void;
      onEntry(entry: BackendLogEntry): void;
      onSources(sources: BackendLogSource[]): void;
      onSourceUpdate(update: BackendLogSourceUpdate): void;
      onOpen(): void;
      onError(): void;
    }): () => void {
      const parseEvent = <T>(event: MessageEvent<string>): T | undefined => {
        try {
          return JSON.parse(event.data) as T;
        } catch {
          handlers.onError();
          return undefined;
        }
      };
      const source = createEventSource('/admin/api/logs/stream');
      source.addEventListener('snapshot', (event) => {
        const snapshot = parseEvent<BackendLogSnapshot>(event);
        if (snapshot) handlers.onSnapshot(snapshot);
      });
      source.addEventListener('gap', (event) => {
        const snapshot = parseEvent<BackendLogSnapshot>(event);
        if (snapshot) handlers.onGap(snapshot);
      });
      source.addEventListener('entry', (event) => {
        const entry = parseEvent<BackendLogEntry>(event);
        if (entry) handlers.onEntry(entry);
      });
      source.addEventListener('sources', (event) => {
        const sources = parseEvent<BackendLogSource[]>(event);
        if (sources) handlers.onSources(sources);
      });
      source.addEventListener('source', (event) => {
        const update = parseEvent<BackendLogSourceUpdate>(event);
        if (update) handlers.onSourceUpdate(update);
      });
      source.onopen = () => handlers.onOpen();
      source.onerror = () => handlers.onError();
      return () => source.close();
    },

    async authorizeOAuthService(input: {
      serviceId: string;
      csrfToken: string;
    }): Promise<OAuthAuthorizationRedirectResult> {
      const response = await request<{ result: OAuthAuthorizationRedirectResult }>(
        `/admin/api/oauth/${encodeURIComponent(input.serviceId)}/authorize`,
        {
          method: 'POST',
          headers: {
            'X-CSRF-Token': input.csrfToken,
            'Idempotency-Key': idempotencyKey({ action: 'oauth-authorize', targetName: input.serviceId }),
          },
          body: '{}',
        },
      );
      return response.result;
    },

    async restartOAuthService(input: {
      serviceId: string;
      csrfToken: string;
    }): Promise<OAuthAuthorizationRedirectResult> {
      const response = await request<{ result: OAuthAuthorizationRedirectResult }>(
        `/admin/api/oauth/${encodeURIComponent(input.serviceId)}/restart`,
        {
          method: 'POST',
          headers: {
            'X-CSRF-Token': input.csrfToken,
            'Idempotency-Key': idempotencyKey({ action: 'oauth-restart', targetName: input.serviceId }),
          },
          body: '{}',
        },
      );
      return response.result;
    },

    async listPresets(): Promise<{ revision: string; presets: AdminPresetListItem[]; targets: AdminPresetTarget[] }> {
      const response = await request<{
        result: { revision: string; presets: AdminPresetListItem[]; targets: AdminPresetTarget[] };
      }>('/admin/api/presets');
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

    getConfiguredServerCreateContract(): Promise<ConfiguredServerCreateContractResponse> {
      return request('/admin/api/configured-servers/create-contract');
    },

    previewConfiguredServerCreate(input: {
      draft: ConfiguredServerCreateDraft;
      csrfToken: string;
      connectivityCheck?: 'auto' | 'manual';
    }): Promise<ConfiguredServerCreatePreviewResponse> {
      return request('/admin/api/configured-servers/create-preview', {
        method: 'POST',
        headers: { 'X-CSRF-Token': input.csrfToken },
        body: JSON.stringify({
          draft: input.draft,
          ...(input.connectivityCheck ? { connectivityCheck: input.connectivityCheck } : {}),
        }),
      });
    },

    createConfiguredServer(input: {
      draft: ConfiguredServerCreateDraft;
      csrfToken: string;
      idempotencyKey: string;
      previewFingerprint: string;
      confirmationFacts: Record<string, unknown>;
    }): Promise<ConfiguredServerCreateResponse> {
      return request('/admin/api/configured-servers', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': input.csrfToken,
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          draft: input.draft,
          previewFingerprint: input.previewFingerprint,
          confirmationFacts: input.confirmationFacts,
        }),
      });
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

    applyConfiguredServerEdit(input: {
      name: string;
      csrfToken: string;
      idempotencyKey: string;
      edit: ConfiguredServerEditDraft;
      previewFingerprint: string;
      confirmationFacts: Record<string, unknown>;
    }): Promise<ConfiguredServerApplyResponse> {
      return request(`/admin/api/configured-servers/${encodeURIComponent(input.name)}/apply`, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': input.csrfToken,
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          edit: input.edit,
          previewFingerprint: input.previewFingerprint,
          confirmationFacts: input.confirmationFacts,
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

export function createConfiguredServerApplyIdempotencyKey(name: string): string {
  return `admin-console-server-apply-${encodeIdempotencyKeyPart(name)}-${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
}

export function createConfiguredServerCreateIdempotencyKey(name: string): string {
  return `admin-console-server-create-${encodeIdempotencyKeyPart(name)}-${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
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
    let response: Response;
    try {
      response = await fetchImpl(path, {
        ...init,
        headers,
      });
    } catch {
      const message =
        'The Admin Console could not reach the runtime. Check that the runtime is still available, then refresh.';
      throw new AdminApiError(0, {}, message, { kind: 'unavailable', message });
    }
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

function readAdminStatus(body: unknown): 'setupRequired' | 'loginRequired' {
  if (body && typeof body === 'object') {
    return (body as { adminStatus?: string }).adminStatus === 'setupRequired' ? 'setupRequired' : 'loginRequired';
  }
  return 'loginRequired';
}

function readErrorCode(error: AdminApiError): string {
  if (error.body && typeof error.body === 'object') {
    const record = error.body as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.code === 'string') return record.code;
    if (record.error && typeof record.error === 'object') {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.code === 'string') return nested.code;
    }
  }
  return error.message;
}

function readRequestId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.requestId === 'string') return record.requestId;
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.requestId === 'string') return nested.requestId;
  }
  return null;
}

function friendlyAdminError(error: AdminApiError, code: string): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Check the admin username and password, then try again.';
    case 'csrf_required':
      return 'Refresh the page to renew the admin session, then retry the action.';
    case 'admin_login_rate_limited':
      return 'Too many failed login attempts. Wait before trying again.';
    case 'idempotency_conflict':
      return 'This action was already retried with different inputs. Refresh the console and try again.';
    case 'idempotency_key_required':
      return 'Refresh the console and retry the action with a new request.';
    case 'admin_configured_servers_unavailable':
      return 'Configured-server operations are not available on this runtime.';
    case 'backend_oauth_service_not_found':
      return 'The OAuth service is no longer available. Refresh the OAuth status and try again.';
    case 'backend_oauth_runtime_unavailable':
      return 'Backend OAuth operations are not available on this runtime.';
    case 'backend_oauth_authorization_start_failed':
      return 'The runtime could not start backend OAuth authorization. Refresh the OAuth status and try again.';
    case 'mutation_failed':
      return 'The runtime could not apply the server change. Refresh the console and inspect the current state.';
    case 'configured_server_stale_preview':
      return 'The server changed after this preview. Preview the edit again before applying.';
    case 'configured_server_destination_conflict':
      return 'The requested server name is already in use. Choose another target name and preview again.';
    case 'configured_server_connectivity_blocked':
      return 'Connectivity validation did not pass. Fix the connection settings and rerun connectivity before applying.';
    case 'configured_server_edit_invalid':
      return 'The server edit is invalid. Review the field errors and preview again.';
    case 'configured_server_edit_unchanged':
      return 'The preview no longer contains a change. Refresh the server detail before editing again.';
    case 'configured_server_not_found':
      return 'The configured server no longer exists. Return to the inventory and refresh it.';
    case 'configured_server_reload_failed':
      return 'The configuration was written, but the runtime reload failed. Inspect runtime health before continuing.';
    case 'configured_server_apply_failed':
      return 'The server edit could not be written. Refresh the detail and inspect runtime health before retrying.';
    case 'operation_in_progress':
      return 'Another admin operation is still running. Wait for it to finish, then refresh the console.';
    case 'operation_state_unknown':
      return 'The runtime could not confirm the operation result. Refresh the console and inspect the current state before retrying.';
    case 'admin_operation_journal_unavailable':
      return 'The runtime cannot record admin operations right now. Check runtime health before retrying.';
    case 'runtime_scope_mismatch':
      return 'The runtime identity changed. Stop using this session and verify the selected runtime before retrying.';
    case 'mutation_confirmation_required':
      return 'This operation needs an explicit confirmation flow that is not available in the console yet.';
    default:
      if (error.status === 401) return 'The admin session is no longer valid. Log in again.';
      if (error.status === 403) return 'The admin session cannot perform this action. Refresh the page and try again.';
      if (error.status === 429) return 'The runtime is rate limiting this request. Wait before trying again.';
      if (code.startsWith('configured_server_')) {
        const bodyMessage = readBodyMessage(error.body);
        if (bodyMessage) return bodyMessage;
      }
      return 'The Admin Console request failed. Refresh the console and try again.';
  }
}

function readBodyMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const message = (body as Record<string, unknown>).message;
  return typeof message === 'string' && message.trim().length > 0 ? message.trim() : null;
}

function defaultIdempotencyKey(input: {
  action: 'enable' | 'disable' | 'oauth-authorize' | 'oauth-restart';
  targetName: string;
}): string {
  const random = crypto.getRandomValues(new Uint32Array(2)).join('-');
  return `admin-console-${input.action}-${encodeIdempotencyKeyPart(input.targetName)}-${Date.now()}-${random}`;
}

function encodeIdempotencyKeyPart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

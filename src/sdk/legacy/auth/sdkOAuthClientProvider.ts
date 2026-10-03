import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';

import {
  authoritySlot,
  type BoundClientSession,
  matchesAuthorityContext,
  OAUTH_ATTEMPT_TTL_MS,
  type OAuthAuthority,
  type OAuthAuthorityContext,
  oauthAuthorityError,
  OAuthAuthorizationDeniedError,
  oauthDigest,
  sameAuthority,
} from '@src/auth/oauthAuthority.js';
import { createOAuthEndpointFetch, validateOAuthEndpoint } from '@src/auth/oauthEndpointFetch.js';
import { ClientSessionRepository } from '@src/auth/storage/clientSessionRepository.js';
import { FileStorageService } from '@src/auth/storage/fileStorageService.js';
import { AUTH_CONFIG } from '@src/constants.js';
import type { OAuthClientProvider, OAuthDiscoveryState } from '@src/sdk/legacy/client/auth.js';
import {
  type OAuthClientInformationFull,
  OAuthClientInformationFullSchema,
  type OAuthClientMetadata,
  type OAuthTokens,
  OAuthTokensSchema,
} from '@src/sdk/legacy/shared/auth.js';

export interface OAuthClientConfig {
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  redirectUrl: string;
  issuer?: string;
  clientMetadataUrl?: string;
  autoRegister?: boolean;
  credentialAuthority?: string;
  authority?: OAuthAuthorityContext;
  legacy?: boolean;
}

interface OAuthResponseTicket {
  generation: string;
  revision: number;
  requestVersion: number;
  ambiguous?: boolean;
}

/** Shared by the released modern and legacy SDK adapters. SDK cache objects are never authority. */
export class SDKOAuthClientProvider implements OAuthClientProvider {
  private readonly sessionRepository: ClientSessionRepository;
  private readonly fileStorage: FileStorageService;
  private readonly context?: OAuthAuthorityContext;
  private readonly slot?: string;
  private record?: BoundClientSession;
  private readonly verifiers = new Map<string, string>();
  private readonly callbacks = new AsyncLocalStorage<{ verifier: string; generation: string }>();
  private authorizationUrl?: string;
  private callbackTail: Promise<unknown> = Promise.resolve();
  private readonly operations = new AsyncLocalStorage<{
    failed: boolean;
    requestVersion?: number;
    responses: Record<'token' | 'registration' | 'discovery', Map<string, OAuthResponseTicket>>;
  }>();
  private sseEndpoint?: string;
  private readonly tokenRequests = new WeakMap<
    RequestInit,
    OAuthResponseTicket & { kind: 'token' | 'registration' | 'discovery' }
  >();
  private readonly tokenResponses = new Map<string, OAuthResponseTicket>();
  private readonly registrationResponses = new Map<string, OAuthResponseTicket>();
  private readonly discoveryResponses = new Map<string, OAuthResponseTicket>();
  private readonly migration: Promise<void>;
  private claim?: string;
  readonly fetch: typeof fetch;

  constructor(
    private readonly serverName: string,
    private readonly config: OAuthClientConfig,
    sessionStoragePath?: string,
  ) {
    this.fileStorage = new FileStorageService(sessionStoragePath, AUTH_CONFIG.CLIENT.SESSION.SUBDIR);
    this.sessionRepository = new ClientSessionRepository(this.fileStorage);
    this.context = config.authority;
    this.slot = this.context ? authoritySlot(this.context) : undefined;
    if (this.slot && this.context) {
      const stored = this.sessionRepository.getBound(this.slot);
      if (stored && matchesAuthorityContext(stored.authority, this.context)) {
        if (!config.issuer || config.issuer === stored.authority.issuer) this.record = stored;
      }
    }
    // Never import or stamp server-name-keyed secrets, including on restart after partial migration.
    const observedGeneration = this.slot ? (this.sessionRepository.getClaim(this.slot)?.generation ?? null) : null;
    this.migration = this.sessionRepository.quarantine(serverName).then(async () => {
      if (this.slot && this.context)
        this.claim = await this.sessionRepository.claimContext(this.slot, this.context, observedGeneration);
    });
    void this.migration.catch(() => undefined);
    this.fetch = createOAuthEndpointFetch({
      resource: this.context?.route.url ?? 'https://invalid.invalid/',
      issuer: this.config.issuer,
      isResource: (url) => url.href === this.context?.route.url || url.href === this.sseEndpoint,
      acceptSseEndpoint:
        this.context?.route.kind === 'sse'
          ? (endpoint) => {
              const configured = new URL(this.context!.route.url);
              const target = new URL(endpoint, configured);
              if (target.origin !== configured.origin || target.username || target.password || target.hash)
                throw oauthAuthorityError();
              this.sseEndpoint = target.href;
            }
          : undefined,
      beforeRequest: (url, init) => this.prepareFetch(url, init),
      pinDestination: async (host, addresses, init) => {
        await this.migration;
        if (!this.slot || !this.claim) throw oauthAuthorityError();
        await this.sessionRepository.pinDestination(
          this.slot,
          this.tokenRequests.get(init)?.generation ?? this.claim,
          host,
          addresses,
        );
      },
      onFailure: (resourceRequest) => {
        const operation = this.operations.getStore();
        if (!resourceRequest && operation) operation.failed = true;
      },
      response: (value, _url, init) => {
        const ticket = this.tokenRequests.get(init);
        if (!ticket) return;
        if (ticket.kind === 'token') {
          const tokens = { ...value };
          if (tokens.refresh_token === undefined)
            tokens.refresh_token = new URLSearchParams(String(init.body ?? '')).get('refresh_token') ?? undefined;
          const key = oauthDigest(OAuthTokensSchema.parse(tokens));
          this.recordResponse(this.responseMap('token'), key, ticket);
        } else if (ticket.kind === 'registration') {
          const key = oauthDigest(OAuthClientInformationFullSchema.parse({ ...this.clientMetadata, ...value }));
          this.recordResponse(this.responseMap('registration'), key, ticket);
        }
      },
      metadata: (value, url, init) => {
        const validated = this.validateMetadata(value, url);
        const ticket = this.tokenRequests.get(init);
        if (typeof value.issuer === 'string' && ticket)
          this.recordResponse(this.responseMap('discovery'), this.discoveryKey(value), ticket);
        return validated;
      },
    });
  }

  get redirectUrl(): string {
    return this.config.redirectUrl || '';
  }
  get clientMetadataUrl(): string | undefined {
    return this.config.clientMetadataUrl;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `1MCP Agent - ${this.serverName}`,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.config.clientSecret ? 'client_secret_post' : 'none',
      scope: this.config.scopes?.join(' ') ?? AUTH_CONFIG.CLIENT.OAUTH.DEFAULT_SCOPES.join(' '),
    };
  }

  clientInformation(ctx?: { issuer: string }): (OAuthClientInformationFull & { issuer?: string }) | undefined {
    this.checkIssuer(ctx);
    if (this.record) this.requireCurrent();
    if (this.config.clientId) {
      return {
        ...this.clientMetadata,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...(this.record ? { issuer: this.record.authority.issuer } : {}),
      };
    }
    const record = this.current();
    if (!record?.clientInfo) return undefined;
    try {
      return {
        ...OAuthClientInformationFullSchema.parse(JSON.parse(record.clientInfo)),
        issuer: record.authority.issuer,
      };
    } catch {
      throw oauthAuthorityError();
    }
  }

  async saveClientInformation(clientInfo: OAuthClientInformationFull, ctx?: { issuer: string }): Promise<void> {
    this.assertOperation();
    this.checkIssuer(ctx);
    const record = this.requireCurrent();
    const stamped = clientInfo as OAuthClientInformationFull & { issuer?: string };
    if (stamped.issuer && stamped.issuer !== record.authority.issuer) throw oauthAuthorityError();
    if (this.config.clientId) return;
    const parsed = OAuthClientInformationFullSchema.parse({ ...this.clientMetadata, ...clientInfo });
    const key = oauthDigest(parsed);
    const ticket = this.responseMap('registration').get(key);
    this.responseMap('registration').delete(key);
    if (!ticket && parsed.client_id !== this.config.clientMetadataUrl) throw oauthAuthorityError();
    if (ticket && (ticket.ambiguous || ticket.generation !== record.generation)) throw oauthAuthorityError();
    this.record = await this.sessionRepository.updateBound(
      this.slot!,
      record.generation,
      (current) => {
        if (ticket && current.revision !== ticket.revision) throw oauthAuthorityError();
        current.clientInfo = JSON.stringify(parsed);
        current.revision++;
      },
      ticket?.requestVersion ?? this.operations.getStore()?.requestVersion,
    );
    this.advanceOperation();
  }

  tokens(ctx?: { issuer: string }): OAuthTokens | undefined {
    this.checkIssuer(ctx);
    const record = this.current();
    if (!record?.tokens) return undefined;
    try {
      return { ...OAuthTokensSchema.parse(JSON.parse(record.tokens)), issuer: record.authority.issuer } as OAuthTokens;
    } catch {
      throw oauthAuthorityError();
    }
  }

  async saveTokens(tokens: OAuthTokens, ctx?: { issuer: string }): Promise<void> {
    this.assertOperation();
    this.checkIssuer(ctx);
    const record = this.requireCurrent();
    const stamped = tokens as OAuthTokens & { issuer?: string };
    if (stamped.issuer && stamped.issuer !== record.authority.issuer) throw oauthAuthorityError();
    const parsed = OAuthTokensSchema.parse(tokens);
    if (this.config.scopes && parsed.scope?.split(' ').some((scope) => !this.config.scopes!.includes(scope)))
      throw oauthAuthorityError();
    const responseKey = oauthDigest(parsed);
    const ticket = this.responseMap('token').get(responseKey);
    this.responseMap('token').delete(responseKey);
    if (!ticket || ticket.ambiguous || ticket.generation !== record.generation) this.rejectOperation();
    const expectedRevision = ticket.revision;
    this.record = await this.sessionRepository.updateBound(
      this.slot!,
      record.generation,
      (current) => {
        if (current.revision !== expectedRevision) throw oauthAuthorityError();
        current.tokens = JSON.stringify(parsed);
        current.revision++;
      },
      ticket.requestVersion,
    );
    this.authorizationUrl = undefined;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    const record = this.current();
    this.authorizationUrl = undefined;
    this.verifiers.clear();
    if (!record) return;
    this.record = await this.sessionRepository.updateBound(this.slot!, record.generation, (current) => {
      current.generation = randomUUID();
      current.revision++;
      current.attempts = {};
      if (scope !== 'verifier') current.tokens = undefined;
      if (scope === 'all' || scope === 'client' || scope === 'discovery') current.clientInfo = undefined;
      if (scope === 'all' || scope === 'discovery') current.discovery = '';
    });
    this.claim = this.record.generation;
    // In-flight work retains its old revision and cannot publish into this generation.
  }

  state(): string {
    return randomUUID();
  }
  saveCodeVerifier(verifier: string): void {
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || this.verifiers.size >= 32) throw oauthAuthorityError();
    this.verifiers.set(createHash('sha256').update(verifier).digest('base64url'), verifier);
  }
  codeVerifier(): string {
    const callback = this.callbacks.getStore();
    if (!callback || callback.generation !== this.requireCurrent().generation) throw oauthAuthorityError();
    return callback.verifier;
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    this.assertOperation();
    const record = this.requireCurrent();
    const target = new URL(url);
    const state = target.searchParams.get('state');
    const challenge = target.searchParams.get('code_challenge');
    const verifier = challenge ? this.verifiers.get(challenge) : undefined;
    target.search = '';
    const endpoint = new URL(record.authority.authorizationEndpoint);
    endpoint.search = '';
    if (
      target.href !== endpoint.href ||
      !state ||
      !verifier ||
      url.searchParams.get('redirect_uri') !== this.redirectUrl ||
      url.searchParams.get('resource') !== record.authority.resource
    )
      throw oauthAuthorityError();
    this.assertScopes(url.searchParams.get('scope'));
    await this.sessionRepository.addAttempt(this.slot!, record.generation, state, {
      authority: record.authority,
      generation: record.generation,
      redirect: this.redirectUrl,
      verifier,
      createdAt: Date.now(),
      expires: Date.now() + OAUTH_ATTEMPT_TTL_MS,
      consumed: false,
    });
    this.verifiers.delete(challenge!);
    this.authorizationUrl = url.toString();
  }
  getAuthorizationUrl(): string | undefined {
    return this.authorizationUrl;
  }
  clearAuthorizationUrl(): void {
    this.authorizationUrl = undefined;
  }

  /** Validation and durable consumption happen before the SDK can see a code, for both eras. */
  async withAuthorizationCallback<T>(response: URLSearchParams, operation: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const record = this.requireCurrent();
      for (const key of ['state', 'code', 'iss', 'error', 'redirect_uri']) {
        if (response.getAll(key).length > 1) throw oauthAuthorityError();
      }
      const state = response.get('state');
      if (!state) throw oauthAuthorityError();
      const attempt = await this.sessionRepository.consumeAttempt(this.slot!, record.generation, state, (candidate) => {
        if (
          !sameAuthority(candidate.authority, record.authority) ||
          candidate.generation !== record.generation ||
          candidate.redirect !== this.redirectUrl
        )
          throw oauthAuthorityError();
        const redirect = response.get('redirect_uri');
        if (redirect && redirect !== candidate.redirect) throw oauthAuthorityError();
        const issuer = response.get('iss');
        if (candidate.authority.requireIssuer && !issuer) throw oauthAuthorityError();
        if (issuer !== null && issuer !== candidate.authority.issuer) throw oauthAuthorityError();
        if (!response.get('code') && !response.get('error')) throw oauthAuthorityError();
      });
      if (response.has('error'))
        throw new OAuthAuthorizationDeniedError(
          response.get('error') === 'access_denied' ? 'access_denied' : 'provider_error',
        );
      return this.callbacks.run({ verifier: attempt.verifier, generation: attempt.generation }, operation);
    };
    const pending = this.callbackTail.then(run, run);
    this.callbackTail = pending.catch(() => undefined);
    return pending;
  }

  async bindAdminReturn(state: string, origin: string): Promise<void> {
    const record = this.requireCurrent();
    await this.sessionRepository.updateBound(this.slot!, record.generation, (current) => {
      const attempt = current.attempts[oauthDigest(state)];
      if (!attempt || attempt.consumed || attempt.expires <= Date.now()) throw oauthAuthorityError();
      attempt.adminReturnOrigin = origin;
    });
  }
  getAdminReturn(state: string): string | undefined {
    const attempt = this.current()?.attempts[oauthDigest(state)];
    return attempt && attempt.consumed && attempt.expires > Date.now() ? attempt.adminReturnOrigin : undefined;
  }

  async validateResourceURL(serverUrl: string | URL, resource?: string): Promise<URL> {
    return this.selectResourceURL(serverUrl, resource);
  }

  private selectResourceURL(serverUrl: string | URL, resource?: string): URL {
    try {
      const configured = new URL(this.context?.route.url ?? serverUrl);
      configured.hash = '';
      const requested = new URL(serverUrl);
      requested.hash = '';
      if (requested.href !== configured.href) throw oauthAuthorityError();
      if (resource === undefined) return configured;
      const advertised = new URL(resource);
      if (advertised.username || advertised.password || resource.includes('#')) throw oauthAuthorityError();
      if (advertised.origin !== configured.origin || advertised.search !== configured.search)
        throw oauthAuthorityError();
      // Resource Indicators may describe a parent resource; the transport route remains exact.
      const resourcePath = advertised.pathname.endsWith('/') ? advertised.pathname : advertised.pathname + '/';
      const routePath = configured.pathname.endsWith('/') ? configured.pathname : configured.pathname + '/';
      if (configured.pathname.length < advertised.pathname.length || !routePath.startsWith(resourcePath))
        throw oauthAuthorityError();
      return advertised;
    } catch {
      throw oauthAuthorityError();
    }
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    // A new SDK auth operation may retry transient transport failures. The failed
    // operation itself remains blocked from inferred fallback or credential writes.
    this.operations.enterWith({
      failed: false,
      responses: { token: new Map(), registration: new Map(), discovery: new Map() },
    });
    const current = this.current();
    // Refresh/new authorization re-discovers current destinations. Only a validated
    // callback resumes the exact discovery snapshot captured by its durable attempt.
    if (!this.callbacks.getStore() || !current?.discovery) return undefined;
    try {
      return JSON.parse(current.discovery) as OAuthDiscoveryState;
    } catch {
      throw oauthAuthorityError();
    }
  }
  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.migration;
    this.assertOperation();
    if (!this.context || !this.slot) throw oauthAuthorityError();
    const metadata = state.authorizationServerMetadata;
    let requestVersion = this.operations.getStore()?.requestVersion;
    if (metadata) {
      const key = this.discoveryKey(metadata as unknown as Record<string, unknown>);
      const ticket = this.responseMap('discovery').get(key);
      this.responseMap('discovery').delete(key);
      if (ticket && (ticket.ambiguous || ticket.generation !== this.claim)) throw oauthAuthorityError();
      if (ticket) requestVersion = ticket.requestVersion;
    }
    const issuer = state.authorizationServerUrl;
    if (this.config.issuer && this.config.issuer !== issuer) throw oauthAuthorityError();
    if (metadata?.issuer && metadata.issuer !== issuer) throw oauthAuthorityError();
    const approved = this.record?.authority.issuer;
    const advertised = state.resourceMetadata?.authorization_servers;
    if (advertised?.length) {
      const selected = this.config.issuer ?? (approved && advertised.includes(approved) ? approved : undefined);
      if (selected ? selected !== issuer : advertised.length !== 1 || advertised[0] !== issuer)
        throw oauthAuthorityError();
    } else if (!this.config.legacy && !this.config.issuer) {
      throw oauthAuthorityError();
    }
    const issuerUrl = validateOAuthEndpoint(issuer, this.context.route.url, undefined, this.config.issuer);
    if (issuerUrl.search || issuerUrl.hash) throw oauthAuthorityError();
    const fallback = this.config.legacy && issuerUrl.origin === new URL(this.context.route.url).origin;
    if (!metadata && !fallback) throw oauthAuthorityError();
    const resource = await this.validateResourceURL(this.context.route.url, state.resourceMetadata?.resource);
    const endpoint = (value: string | undefined, pathname: string): string => {
      if (!value && !fallback) throw oauthAuthorityError();
      return validateOAuthEndpoint(
        value ?? new URL(pathname, issuerUrl).href,
        this.context!.route.url,
        value ? undefined : issuerUrl.origin,
        this.config.issuer,
      ).href;
    };
    let registrationEndpoint: string | undefined;
    if (metadata?.registration_endpoint) registrationEndpoint = endpoint(metadata.registration_endpoint, '/register');
    else if (!metadata && fallback) registrationEndpoint = endpoint(undefined, '/register');
    const authority: OAuthAuthority = {
      ...this.context,
      version: 1,
      issuer,
      resource: resource.href,
      authorizationEndpoint: endpoint(metadata?.authorization_endpoint, '/authorize'),
      tokenEndpoint: endpoint(metadata?.token_endpoint, '/token'),
      registrationEndpoint,
      requireIssuer:
        (metadata as { authorization_response_iss_parameter_supported?: boolean } | undefined)
          ?.authorization_response_iss_parameter_supported === true,
    };
    this.record = await this.sessionRepository.activate(
      this.slot,
      authority,
      JSON.stringify(state),
      this.claim!,
      requestVersion,
    );
    this.claim = this.record.generation;
    this.advanceOperation();
  }

  private current(): BoundClientSession | undefined {
    if (!this.record || !this.slot || !this.context) return undefined;
    const current = this.sessionRepository.getBound(this.slot);
    if (this.sessionRepository.getClaim(this.slot)?.generation !== this.record.generation) throw oauthAuthorityError();
    if (
      !current ||
      current.generation !== this.record.generation ||
      !sameAuthority(current.authority, this.record.authority) ||
      !matchesAuthorityContext(current.authority, this.context)
    )
      throw oauthAuthorityError();
    return current;
  }
  private requireCurrent(): BoundClientSession {
    const current = this.current();
    if (!current) throw oauthAuthorityError();
    return current;
  }
  private checkIssuer(ctx?: { issuer: string }): void {
    if (!ctx) return;
    const issuer = this.record?.authority.issuer ?? this.config.issuer;
    if (!issuer || ctx.issuer !== issuer) throw oauthAuthorityError();
  }
  private assertScopes(scope: string | null): void {
    if (this.config.scopes && scope?.split(' ').some((item) => !this.config.scopes!.includes(item)))
      throw oauthAuthorityError();
  }

  private validateMetadata(value: Record<string, unknown>, url: URL): Record<string, unknown> {
    if (!this.context) throw oauthAuthorityError();
    if (Array.isArray(value.authorization_servers)) {
      const issuers = value.authorization_servers;
      if (!issuers.length || issuers.length > 16 || issuers.some((issuer) => typeof issuer !== 'string'))
        throw oauthAuthorityError();
      for (const issuer of issuers)
        validateOAuthEndpoint(String(issuer), this.context.route.url, undefined, this.config.issuer);
      const approved = this.config.issuer ?? this.record?.authority.issuer;
      let selected: string | undefined;
      if (approved && issuers.includes(approved)) selected = approved;
      else if (issuers.length === 1) selected = String(issuers[0]);
      if (!selected || (this.config.issuer && selected !== this.config.issuer)) throw oauthAuthorityError();
      if (typeof value.resource !== 'string') throw oauthAuthorityError();
      this.selectResourceURL(this.context.route.url, value.resource);
      return {
        ...value,
        authorization_servers: [selected],
        ...(this.config.scopes ? { scopes_supported: this.config.scopes } : {}),
      };
    }
    if (typeof value.issuer === 'string') {
      const issuer = validateOAuthEndpoint(value.issuer, this.context.route.url, undefined, this.config.issuer);
      if (issuer.origin !== url.origin || (this.config.issuer && value.issuer !== this.config.issuer))
        throw oauthAuthorityError();
      for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'jwks_uri']) {
        if (value[key] !== undefined)
          validateOAuthEndpoint(String(value[key]), this.context.route.url, undefined, this.config.issuer);
      }
    }
    return value;
  }

  private async prepareFetch(url: URL, init: RequestInit): Promise<RequestInit> {
    await this.migration;
    if (!this.context) throw oauthAuthorityError();
    const resource = new URL(this.context.route.url);
    const headers = new Headers(init.headers);
    const isDiscovery = (init.method ?? 'GET') === 'GET' && url.href !== resource.href && url.href !== this.sseEndpoint;
    if (isDiscovery) {
      this.assertOperation();
      const requestVersion = await this.reserveRequest();
      if (url.search) throw oauthAuthorityError();
      const request: RequestInit = { ...init, headers: { accept: 'application/json' }, redirect: 'error' };
      this.tokenRequests.set(request, {
        generation: this.claim!,
        revision: this.record?.revision ?? 0,
        kind: 'discovery',
        requestVersion,
      });
      return request;
    }
    const record = this.current();
    const isToken = record?.authority.tokenEndpoint === url.href;
    const isRegistration = record?.authority.registrationEndpoint === url.href;
    if (isToken || isRegistration) {
      this.assertOperation();
      const requestVersion = await this.reserveRequest();
      if ((init.method ?? 'GET') !== 'POST') throw oauthAuthorityError();
      const safeHeaders = new Headers();
      safeHeaders.set('content-type', isToken ? 'application/x-www-form-urlencoded' : 'application/json');
      if (isToken) {
        const params = new URLSearchParams(String(init.body ?? ''));
        if (params.get('resource') !== record!.authority.resource) throw oauthAuthorityError();
        this.assertScopes(params.get('scope'));
        if (params.get('grant_type') === 'authorization_code') {
          if (this.callbacks.getStore()?.generation !== record!.generation) throw oauthAuthorityError();
        }
        const client = this.clientInformation();
        const authorization = headers.get('authorization');
        if (authorization?.startsWith('Basic ') && client?.client_secret) {
          const expected = `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64')}`;
          if (authorization !== expected) throw oauthAuthorityError();
          safeHeaders.set('authorization', authorization);
        }
        if (params.has('client_id') && params.get('client_id') !== client?.client_id) throw oauthAuthorityError();
        if (params.has('client_secret') && params.get('client_secret') !== client?.client_secret)
          throw oauthAuthorityError();
      } else {
        const registration = JSON.parse(String(init.body ?? '{}')) as { scope?: string };
        this.assertScopes(registration.scope ?? null);
        if (this.config.clientId || this.config.autoRegister === false) throw oauthAuthorityError();
      }
      const request: RequestInit = { ...init, headers: safeHeaders, redirect: 'error' };
      this.tokenRequests.set(request, {
        generation: record!.generation,
        revision: record!.revision,
        kind: isToken ? 'token' : 'registration',
        requestVersion,
      });
      return request;
    }
    if (url.href !== resource.href && url.href !== this.sseEndpoint) throw oauthAuthorityError();
    // Upstream resource headers never accompany discovery or OAuth endpoint requests.
    return { ...init, redirect: 'error' };
  }

  private responseMap(kind: 'token' | 'registration' | 'discovery'): Map<string, OAuthResponseTicket> {
    const operation = this.operations.getStore();
    if (operation) return operation.responses[kind];
    if (kind === 'token') return this.tokenResponses;
    if (kind === 'registration') return this.registrationResponses;
    return this.discoveryResponses;
  }

  private advanceOperation(): void {
    const operation = this.operations.getStore();
    if (operation && this.slot) operation.requestVersion = this.sessionRepository.getClaim(this.slot)?.requestVersion;
  }

  private rejectOperation(): never {
    const operation = this.operations.getStore();
    if (operation) operation.failed = true;
    throw oauthAuthorityError();
  }

  private assertOperation(): void {
    if (this.operations.getStore()?.failed) throw oauthAuthorityError();
  }

  private async reserveRequest(): Promise<number> {
    const requestVersion = await this.sessionRepository.reserveRequest(this.slot!, this.claim!);
    const operation = this.operations.getStore();
    if (operation) operation.requestVersion = requestVersion;
    return requestVersion;
  }

  private discoveryKey(metadata: Record<string, unknown>): string {
    return oauthDigest([
      metadata.issuer,
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.registration_endpoint,
    ]);
  }

  private recordResponse(target: Map<string, OAuthResponseTicket>, key: string, ticket: OAuthResponseTicket): void {
    if (target.size >= 32 && !target.has(key)) throw oauthAuthorityError();
    const previous = target.get(key);
    if (previous) {
      previous.ambiguous = true;
      return;
    }
    target.set(key, ticket);
  }

  shutdown(): void {
    this.fileStorage.shutdown();
  }
}

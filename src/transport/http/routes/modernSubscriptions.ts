import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import { createCapabilityVisibility } from '@src/core/capabilities/capabilityVisibility.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { filterConnectionsForSession } from '@src/core/protocol/requestHandlerUtils.js';
import { resolveResourceRoute } from '@src/core/protocol/resourceTemplateRouting.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus, type InboundConnectionConfig, type OutboundConnection } from '@src/core/types/index.js';
import { getAuthInfo, revalidateAuthInfo } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';

import type { Request, Response } from 'express';
import { z } from 'zod';

import type { ModernInboundBridge, ModernInboundBridgeFactory } from './modernHttpRoutes.js';

const filterSchema = z
  .object({
    toolsListChanged: z.boolean().optional(),
    promptsListChanged: z.boolean().optional(),
    resourcesListChanged: z.boolean().optional(),
    resourceSubscriptions: z.array(z.string().max(8192)).max(64).optional(),
  })
  .strict();
const listenSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string().max(1024), z.number().finite()]),
    method: z.literal('subscriptions/listen'),
    params: z.object({ notifications: filterSchema }).passthrough(),
  })
  .passthrough();
type Filter = z.infer<typeof filterSchema>;
interface Notification {
  method: string;
  params?: Record<string, unknown>;
}
const subscriptionIdKey = 'io.modelcontextprotocol/subscriptionId';
const serverInfo = { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION };
const MAX_ACTIVE = 256;
const MAX_SETUP = 32;
const MAX_EVENTS = 64;
const MAX_BYTES = 1024 * 1024;
let setups = 0;
const owners = new Set<ModernSubscription>();

/** Discovery reflects current visible providers; listen still verifies upstream acknowledgement. */
export function getModernSubscriptionCapabilities(
  manager: Pick<ServerManager, 'getClients'>,
  config: InboundConnectionConfig,
) {
  const connections = manager.getClients();
  if (!connections.size) return { tools: {}, prompts: {}, resources: {} };
  const visible = FilteringService.getFilteredConnections(filterConnectionsForSession(connections, undefined), config);
  const sources = [...visible.values()].filter((connection) => connection.status === ClientStatus.Connected);
  const supports = (
    connection: OutboundConnection,
    kind: 'tools' | 'resources' | 'prompts',
    flag: 'listChanged' | 'subscribe',
  ) => {
    const capability = connection.capabilities?.[kind];
    if (!capability || typeof capability !== 'object' || Array.isArray(capability)) return false;
    return capability[flag] === true;
  };
  const listCapability = (kind: 'tools' | 'resources' | 'prompts'): { listChanged?: true } => {
    const providers = sources.filter((connection) => connection.capabilities?.[kind]);
    if (!providers.length) return {};
    if (providers.some((connection) => !supports(connection, kind, 'listChanged'))) return {};
    return { listChanged: true };
  };
  return {
    tools: listCapability('tools'),
    prompts: listCapability('prompts'),
    resources: {
      ...listCapability('resources'),
      ...(sources.some((connection) => supports(connection, 'resources', 'subscribe'))
        ? { subscribe: true as const }
        : {}),
    },
  };
}

/** One queue per HTTP exchange. No event IDs, retained history, or reconnect replay. */
class ModernSubscription {
  private queue: Array<{ notification: Notification; bytes: number }> = [];
  private bytes = 0;
  private ready = false;
  private pumping = false;
  private stopped = false;
  private bridge?: ModernInboundBridge;
  private timer?: ReturnType<typeof setInterval>;
  private resolveDone!: () => void;
  readonly done = new Promise<void>((resolve) => {
    this.resolveDone = resolve;
  });
  readonly controller = new AbortController();
  private readonly auth;
  private readonly sources = new Map<
    string,
    { connection: OutboundConnection; adapter: OutboundConnection['adapter']; config: string | undefined }
  >();
  private filter: Filter = {};
  private readonly listProviders = new Map<'tools' | 'resources' | 'prompts', string[]>();
  private readonly onAbort = () => this.close(false);
  constructor(
    readonly manager: ServerManager,
    readonly id: string | number,
    private readonly res: Response,
    readonly config: InboundConnectionConfig,
    private readonly signal: AbortSignal,
  ) {
    this.auth = getAuthInfo(res);
    signal.addEventListener('abort', this.onAbort, { once: true });
    owners.add(this);
  }
  private visible() {
    return FilteringService.getFilteredConnections(
      filterConnectionsForSession(this.manager.getClients(), undefined),
      this.config,
    );
  }
  matches(res: Response, config: InboundConnectionConfig, id: unknown): boolean {
    const auth = getAuthInfo(res);
    // Anonymous exchanges are cancelled by closing their own transport; an id alone is not authority.
    return (
      !!auth &&
      !!this.auth &&
      auth.token === this.auth.token &&
      auth.clientId === this.auth.clientId &&
      JSON.stringify(config) === JSON.stringify(this.config) &&
      id === this.id
    );
  }
  private async authorized(): Promise<boolean> {
    if (this.stopped || this.signal.aborted) return false;
    if (this.auth && !(await revalidateAuthInfo(this.auth))) return false;
    const current = this.visible();
    const configs = getConfiguredServerTargets();
    for (const [kind, captured] of this.listProviders) {
      const keys = [...current]
        .filter(([, connection]) => connection.capabilities?.[kind])
        .map(([key]) => key)
        .sort();
      if (JSON.stringify(keys) !== JSON.stringify(captured)) return false;
      for (const key of keys) {
        const capability = current.get(key)?.capabilities?.[kind];
        if (
          !capability ||
          typeof capability !== 'object' ||
          Array.isArray(capability) ||
          capability.listChanged !== true
        )
          return false;
      }
    }
    for (const [key, source] of this.sources) {
      if (
        current.get(key) !== source.connection ||
        source.connection.adapter !== source.adapter ||
        source.connection.status !== ClientStatus.Connected ||
        JSON.stringify(configs[source.connection.name || key]) !== source.config
      )
        return false;
    }
    return !this.stopped;
  }
  private async captureSources(filter: Filter): Promise<void> {
    const visible = this.visible();
    const selected = new Set<string>();
    for (const [field, kind] of [
      ['toolsListChanged', 'tools'],
      ['promptsListChanged', 'prompts'],
      ['resourcesListChanged', 'resources'],
    ] as const) {
      if (!filter[field]) continue;
      this.listProviders.set(
        kind,
        [...visible]
          .filter(([, connection]) => connection.capabilities?.[kind])
          .map(([key]) => key)
          .sort(),
      );
      for (const [key, connection] of visible) if (connection.capabilities?.[kind]) selected.add(key);
    }
    if (filter.resourceSubscriptions?.length) {
      const visibility = createCapabilityVisibility(
        [...visible].map(([key, connection]) => [key, connection.name || key]),
        undefined,
        { ...this.config },
      );
      const snapshot = await acquireRuntimeCapabilityCatalog(this.manager.getClients(), visibility, {
        signal: this.controller.signal,
        serverConfigs: getConfiguredServerTargets(),
      });
      for (const uri of filter.resourceSubscriptions)
        selected.add(resolveResourceRoute(snapshot, uri).entry.route.connectionKey);
    }
    const configs = getConfiguredServerTargets();
    for (const key of selected) {
      const connection = visible.get(key);
      if (!connection) throw new Error('Subscription route unavailable');
      this.sources.set(key, {
        connection,
        adapter: connection.adapter,
        config: JSON.stringify(configs[connection.name || key]),
      });
    }
  }
  async setup(filter: Filter, createBridge: ModernInboundBridgeFactory): Promise<void> {
    const timeout = setTimeout(() => this.close(false), 30_000);
    timeout.unref();
    try {
      this.bridge = await createBridge(this.manager, this.config, {
        subscriptionSignal: this.controller.signal,
        subscriptionListKinds: (['tools', 'resources', 'prompts'] as const).filter(
          (kind) => filter[`${kind}ListChanged`] === true,
        ),
        subscriptionNotification: (note) => this.enqueue(note),
        subscriptionClosed: () => this.close(true),
      });
      if (this.stopped) {
        await this.bridge.close();
        return;
      }
      if (!this.bridge.subscribe || !this.bridge.prepareSubscriptions)
        throw new Error('Subscription bridge unavailable');
      this.filter = (await this.bridge.prepareSubscriptions(filter)) as Filter;
      if (this.stopped) return;
      const uris = [...new Set(filter.resourceSubscriptions ?? [])];
      if (uris.length) this.filter.resourceSubscriptions = uris;
      await this.captureSources(this.filter);
      if (this.stopped) return;
      for (const uri of uris) {
        await this.bridge.subscribe(uri, this.controller.signal);
        if (this.stopped) return;
      }
      if (!(await this.authorized())) {
        this.close(false);
        return;
      }
      this.res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      this.res.flushHeaders();
      await this.write({
        jsonrpc: '2.0',
        method: 'notifications/subscriptions/acknowledged',
        params: {
          notifications: this.filter,
          _meta: { [subscriptionIdKey]: this.id },
        },
      });
      if (this.stopped) return;
      this.ready = true;
      this.timer = setInterval(() => {
        void this.checkCoverage();
      }, 1000);
      this.timer.unref();
      void this.pump();
    } catch {
      if (!this.res.headersSent && !this.stopped) {
        this.res
          .status(400)
          .json({ jsonrpc: '2.0', id: this.id, error: { code: -32602, message: 'Subscription coverage unavailable' } });
      }
      this.close(false);
    } finally {
      clearTimeout(timeout);
    }
  }
  private checking = false;
  private async checkCoverage() {
    if (this.checking || this.stopped) return;
    this.checking = true;
    try {
      if (!(await this.authorized())) this.close(true);
    } catch {
      this.close(true);
    } finally {
      this.checking = false;
    }
  }
  enqueue(notification: Notification): void {
    if (this.stopped) return;
    const bytes = Buffer.byteLength(JSON.stringify(notification));
    if (this.queue.length >= MAX_EVENTS || this.bytes + bytes > MAX_BYTES) {
      this.close(false);
      return;
    }
    // Capture upstream plain data so later mutations cannot change queued delivery.
    this.queue.push({ notification: structuredClone(notification), bytes });
    this.bytes += bytes;
    if (this.ready) void this.pump();
  }
  private accepts(note: Notification): boolean {
    if (note.method === 'notifications/resources/updated')
      return (
        typeof note.params?.uri === 'string' && this.filter.resourceSubscriptions?.includes(note.params.uri) === true
      );
    const fields = {
      'notifications/tools/list_changed': 'toolsListChanged',
      'notifications/prompts/list_changed': 'promptsListChanged',
      'notifications/resources/list_changed': 'resourcesListChanged',
    } as const;
    const field = fields[note.method as keyof typeof fields];
    return field !== undefined && this.filter[field] === true;
  }
  private async pump(): Promise<void> {
    if (this.pumping || this.stopped || !this.ready) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.stopped) {
        const item = this.queue.shift()!;
        this.bytes -= item.bytes;
        if (!this.accepts(item.notification)) continue;
        if (!(await this.authorized())) {
          this.close(true);
          break;
        }
        const { server: _server, _meta: _meta, ...params } = item.notification.params ?? {};
        await this.write({
          jsonrpc: '2.0',
          method: item.notification.method,
          params: {
            ...params,
            _meta: { [subscriptionIdKey]: this.id },
          },
        });
      }
    } catch {
      this.close(false);
    } finally {
      this.pumping = false;
    }
  }
  private async write(message: unknown): Promise<void> {
    if (this.stopped || this.res.destroyed) return;
    if (this.res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`)) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        this.res.off('drain', finish);
        this.res.off('close', finish);
        this.controller.signal.removeEventListener('abort', finish);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.close(false);
        finish();
      }, 30_000);
      timeout.unref();
      this.res.once('drain', finish);
      this.res.once('close', finish);
      this.controller.signal.addEventListener('abort', finish, { once: true });
    });
  }
  close(graceful: boolean): void {
    if (this.stopped) return;
    this.stopped = true;
    owners.delete(this);
    clearInterval(this.timer);
    this.signal.removeEventListener('abort', this.onAbort);
    this.controller.abort();
    this.queue = [];
    this.bytes = 0;
    if (graceful && this.ready && !this.res.destroyed && this.res.writableLength < MAX_BYTES) {
      this.res.end(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: this.id,
          result: {
            resultType: 'complete',
            _meta: { [subscriptionIdKey]: this.id, 'io.modelcontextprotocol/serverInfo': serverInfo },
          },
        })}\n\n`,
      );
    } else if (!this.res.writableEnded) this.res.destroy();
    void (this.bridge?.close() ?? Promise.resolve()).catch(() => undefined).finally(() => this.resolveDone());
  }
}

export async function serveModernSubscription(
  req: Request,
  res: Response,
  manager: ServerManager,
  config: InboundConnectionConfig,
  createBridge: ModernInboundBridgeFactory,
  signal: AbortSignal,
): Promise<void> {
  const parsed = listenSchema.safeParse(req.body);
  if (!parsed.success || req.get('last-event-id')) {
    const id = (req.body as { id?: unknown } | null)?.id;
    res.status(400).json({
      jsonrpc: '2.0',
      id: typeof id === 'string' || typeof id === 'number' ? id : null,
      error: { code: -32602, message: 'Invalid subscription filter or replay request' },
    });
    return;
  }
  if ([...owners].some((owner) => owner.manager === manager && owner.matches(res, config, parsed.data.id))) {
    res.status(409).json({
      jsonrpc: '2.0',
      id: parsed.data.id,
      error: { code: -32600, message: 'Subscription id already active for this authority' },
    });
    return;
  }
  if (owners.size >= MAX_ACTIVE || setups >= MAX_SETUP) {
    res
      .status(503)
      .json({ jsonrpc: '2.0', id: parsed.data.id, error: { code: -32000, message: 'Subscription capacity exceeded' } });
    return;
  }
  if (signal.aborted) return;
  const owner = new ModernSubscription(manager, parsed.data.id, res, config, signal);
  setups++;
  try {
    await owner.setup(parsed.data.params.notifications, createBridge);
  } finally {
    setups--;
  }
  await owner.done;
}
export function cancelModernSubscription(
  req: Request,
  res: Response,
  manager: ServerManager,
  config: InboundConnectionConfig,
): void {
  for (const owner of owners)
    if (
      owner.manager === manager &&
      owner.matches(res, config, (req.body as { params?: { requestId?: unknown } } | null)?.params?.requestId)
    )
      owner.close(false);
  res.status(202).end();
}
export async function closeModernSubscriptions(manager: ServerManager): Promise<void> {
  const selected = [...owners].filter((owner) => owner.manager === manager);
  for (const owner of selected) owner.close(true);
  await Promise.all(selected.map((owner) => owner.done));
}

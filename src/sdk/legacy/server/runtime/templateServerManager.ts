import { isDeepStrictEqual } from 'node:util';

import {
  canonicalLifecyclePath,
  getProjectLifecycle,
  getVerifiedProjectOwner,
  type ProjectBlocker,
  projectPaths,
  withProjectAdmission,
} from '@src/application/projectLifecycle.js';
import { isOperatorDisabledTemplateDefinition } from '@src/config/configuredServerTargets.js';
import { getRuntimeScopeEnvironment, sanitizeRuntimeScopeError } from '@src/config/runtimeScopeEnv.js';
import { createRuntimeTargetFingerprint } from '@src/config/runtimeTargetFingerprint.js';
import { registerCapabilityPaginationNotifications } from '@src/core/capabilities/capabilityPagination.js';
import {
  clearCompleteConfiguredToolTargetSnapshot,
  clearLastConfiguredToolSnapshot,
} from '@src/core/capabilities/configuredToolSnapshot.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import {
  bindProjectPreparationAuthority,
  getProjectPreparationAuthorityIdentity,
  type ProjectPreparationAuthority,
} from '@src/core/context/projectPreparationAuthority.js';
import { ClientTemplateTracker, TemplateFilteringService, TemplateIndex } from '@src/core/filtering/index.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import type { BackendSupervisionSnapshot } from '@src/core/server/backendStdioSupervisor.js';
import { ClientInstancePool, type PooledClientInstance } from '@src/core/server/clientInstancePool.js';
import {
  DEFAULT_TEMPLATE_INSTANCE_POOL_POLICY,
  type TemplateInstancePoolPolicy,
} from '@src/core/server/clientInstancePoolTypes.js';
import {
  createRenderedIdentity,
  createSessionIdentity,
  resolveTemplateIdentityMode,
  serializeTemplateIdentity,
  templateRenderedHash,
  templateRuntimeHash,
} from '@src/core/server/templateIdentity.js';
import {
  cleanupExpiredEphemeralClients,
  cleanupTemplateServersForSession,
  type EphemeralTemplateClient,
} from '@src/core/server/templateServerCleanup.js';
import type { OutboundConnection, OutboundConnections } from '@src/core/types/client.js';
import { ClientStatus } from '@src/core/types/client.js';
import { MCPServerParams } from '@src/core/types/index.js';
import type { InboundConnectionConfig } from '@src/core/types/server.js';
import { isProjectBackendVisible, resolveProjectPolicies } from '@src/domains/project-selection/projectPolicy.js';
import {
  createProjectBindingId,
  resolveProjectSelection,
  withProjectSelection,
} from '@src/domains/project-selection/projectSelection.js';
import logger, { debugIf } from '@src/logger/logger.js';
import {
  createLegacyOutboundConnection,
  getLegacyClient,
  getLegacyTransport,
  snapshotSupervision,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { Transport } from '@src/sdk/legacy/shared/transport.js';
import type { ContextData } from '@src/types/context.js';

/**
 * Options for rebuilding the template index
 */
export interface TemplateRebuildOptions {
  mcpTemplates?: Record<string, MCPServerParams>;
}

export interface TemplateRebuildResult {
  toolMetadataChanged: boolean;
}

export interface TemplateDefinitionRuntimeImpact {
  activeInstancesBefore: number;
  retiredInstances: number;
  activeInstancesAfter: number;
  retirementObserved: boolean;
  error?: string;
}

export type TemplateClientLifecycle = 'persistent' | 'ephemeral';

export interface RuntimeTemplateReloadTarget {
  sessionId: string;
  templateName: string;
  lifecycle: TemplateClientLifecycle;
}

/**
 * Manages template-based server instances and client pools
 */
export class TemplateServerManager {
  private clientInstancePool: ClientInstancePool;
  private templateSessionMap?: Map<string, string>; // Maps template name to session ID for tracking
  private cleanupTimer?: ReturnType<typeof setInterval>; // Timer for idle instance cleanup
  private instructionAggregator?: InstructionAggregator;
  private ephemeralClients = new Map<string, Map<string, EphemeralTemplateClient>>();
  private persistentSessions = new Set<string>();
  private logicalSessions = new Map<string, { lastUsedAt: number; retainCount: number }>();
  private logicalSessionCleanup = new Set<(sessionId: string) => void>();
  private outboundConns?: OutboundConnections;
  private transports?: Record<string, Transport>;
  private templateConfigHashes = new Map<string, string>();
  private templateToolMetadataHashes = new Map<string, string>();
  private templateRetirements = new Map<string, Promise<void>>();
  private readonly instanceProjects = new Map<string, string[]>();
  private readonly projectCleanup = new Map<string, Set<string>>();
  private ownerBindings = new Map<string, Set<string>>();
  private bindingContexts = new Map<string, ContextData>();
  private bindingPolicies = new Map<string, InboundConnectionConfig[]>();
  private bindingConfigurations = new Map<string, Readonly<InboundConnectionConfig>>();
  private bindingAuthorities = new Map<string, ProjectPreparationAuthority>();
  private ephemeralBindingActivity = new Map<string, number>();

  // Maps sessionId -> (templateName -> renderedHash) for routing shareable servers
  private sessionToRenderedHash = new Map<string, Map<string, string>>();

  // Enhanced filtering components
  private clientTemplateTracker = new ClientTemplateTracker();
  private templateIndex = new TemplateIndex();

  // Track failed template server creation attempts
  private failedTemplates: Array<{
    templateName: string;
    sessionId: string;
    error: string;
    timestamp: Date;
  }> = [];

  private readonly poolPolicy: TemplateInstancePoolPolicy;

  constructor(poolPolicy: Partial<TemplateInstancePoolPolicy> = {}) {
    this.poolPolicy = { ...DEFAULT_TEMPLATE_INSTANCE_POOL_POLICY, ...poolPolicy };
    // Initialize the client instance pool
    this.clientInstancePool = new ClientInstancePool({
      maxInstances: this.poolPolicy.maxInstancesPerTemplate,
      maxTotalInstances: this.poolPolicy.maxTotalInstances,
      idleTimeout: this.poolPolicy.idleTimeoutMs,
    });
    this.clientInstancePool.setSupervisionPublisher?.((instance, snapshot) => {
      this.publishTemplateSupervision(instance, snapshot);
    });

    // Start cleanup timer for idle template instances
    this.startCleanupTimer();
  }

  /**
   * Set the instruction aggregator for extracting and caching server instructions
   */
  public setInstructionAggregator(aggregator: InstructionAggregator): void {
    this.instructionAggregator = aggregator;
  }

  /**
   * Starts the periodic cleanup timer for idle template instances
   */
  private startCleanupTimer(): void {
    const cleanupInterval = this.poolPolicy.cleanupIntervalMs;
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupIdleInstances();
      } catch (error) {
        logger.error('templateServerManager.error.during.idle.instance.cleanup.0cf54b4e', { error: error });
      }
    }, cleanupInterval);

    // Ensure the timer doesn't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }

    debugIf(() => ({ message: 'templateServerManager.templateservermanager.cleanup.timer.started.cd54a757' }));
  }

  /**
   * Create template-based servers for a client connection
   */
  public async createTemplateBasedServers(
    ...args: Parameters<TemplateServerManager['createTemplateBasedServersAdmitted']>
  ): Promise<void> {
    await withProjectAdmission(args[1], () => this.createTemplateBasedServersAdmitted(...args));
  }

  private async createTemplateBasedServersAdmitted(
    sessionId: string,
    context: ContextData,
    opts: InboundConnectionConfig,
    serverConfigData: { mcpTemplates?: Record<string, MCPServerParams> }, // MCPServerConfiguration with templates
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
    lifecycle: TemplateClientLifecycle = 'persistent',
    authority?: ProjectPreparationAuthority,
  ): Promise<void> {
    this.outboundConns = outboundConns;
    this.transports = transports;

    const ownerSessionId = context.sessionId ?? sessionId;
    context = context.projectSet ? withProjectSelection(context, context.projectSet) : context;
    context = { ...context, sessionId: ownerSessionId };
    if (opts.bindingId) {
      sessionId = opts.bindingId;
      const preparedContext = this.bindingContexts.get(sessionId);
      if (!preparedContext) throw new Error('Project binding is no longer available');
      context = preparedContext;
    } else {
      sessionId = await this.registerBindingContext(
        createProjectBindingId(ownerSessionId, context),
        context,
        opts,
        authority,
      );
    }

    if (lifecycle === 'persistent') {
      this.trackPersistentClient(sessionId);
    }

    // Get template servers that match the client's tags/preset
    const selection = resolveProjectSelection(context);
    const templateConfigs = this.getMatchingTemplateConfigs(opts, serverConfigData).filter(([, config]) => {
      if (!context.project && !context.projectSet) return true;
      if (
        !isProjectBackendVisible(
          { ...config, template: config.template ?? {} },
          context,
          this.bindingPolicies.get(sessionId) ?? [],
        )
      )
        return false;
      const mode = config.projectTarget?.mode ?? 'single';
      if (mode === 'independent') return true;
      if (selection.kind === 'unresolved') return false;
      return mode === 'native-set' || selection.kind === 'single';
    });

    logger.info('templateServerManager.creating.template.based.servers.for.session.63a3dddd', {
      templateCount: templateConfigs.length,
      sessionId,
    });

    // Create client instances from templates
    for (const [templateName, templateConfig] of templateConfigs) {
      try {
        const targetTemplateOptions =
          !context.project || templateConfig.projectTarget?.mode === 'independent'
            ? templateConfig.template
            : { ...templateConfig.template, perClient: true, shareable: false };
        // Get or create client instance from template
        const instance = await this.clientInstancePool.getOrCreateClientInstance(
          templateName,
          templateConfig,
          context,
          sessionId,
          targetTemplateOptions,
        );

        this.instanceProjects.set(instance.instanceKey, [
          ...new Set([...(this.instanceProjects.get(instance.instanceKey) ?? []), ...projectPaths(context)]),
        ]);

        // CRITICAL: Register the template server in outbound connections for capability aggregation
        const renderedHash = instance.renderedHash; // From the pooled instance

        const identityMode = resolveTemplateIdentityMode(targetTemplateOptions);
        const outboundKey = serializeTemplateIdentity(
          identityMode === 'session'
            ? createSessionIdentity(templateName, sessionId)
            : createRenderedIdentity(templateName, renderedHash),
        );
        instance.outboundKeys.add(outboundKey);

        const instructions = instance.client.getInstructions();
        // Joining a pooled instance must preserve its adapter and continuation ownership.
        if (!this.matchesPooledTemplateInstance(outboundConns.get(outboundKey), instance)) {
          outboundConns.set(
            outboundKey,
            createLegacyOutboundConnection({
              name: templateName, // Keep clean name for tool namespacing (serena_1mcp_*)
              transport: instance.transport as AuthProviderTransport,
              client: instance.client,
              status: ClientStatus.Connected, // Template servers should be connected
              capabilities: instance.client.getServerCapabilities?.(),
              instructions,
            }),
          );
        }
        registerCapabilityPaginationNotifications(outboundConns, outboundConns.get(outboundKey)!);
        if (instance.supervision) {
          this.publishTemplateSupervision(instance, instance.supervision);
        }

        // Extract and cache instructions for template servers
        // This ensures instructions are available on first connection
        if (this.instructionAggregator) {
          try {
            this.instructionAggregator.setInstructions(
              { source: 'mcpTemplates', name: templateName },
              instructions,
              outboundKey,
            );
            if (instructions?.trim()) {
              debugIf(() => ({
                message: 'templateServerManager.cached.instructions.for.template.server.ee449e76',
                meta: { templateName, instanceId: instance.id },
              }));
            }
          } catch (_error) {
            logger.warn('templateServerManager.failed.to.extract.instructions.from.template.server.07ebbee8', {
              templateName,
              instanceId: instance.id,
              error: _error,
            });
          }
        }

        // Track session -> rendered hash mapping for routing
        if (!this.sessionToRenderedHash.has(sessionId)) {
          this.sessionToRenderedHash.set(sessionId, new Map());
        }
        this.sessionToRenderedHash.get(sessionId)!.set(templateName, renderedHash);

        // Store session ID mapping separately for cleanup tracking
        if (!this.templateSessionMap) {
          this.templateSessionMap = new Map<string, string>();
        }
        this.templateSessionMap.set(templateName, sessionId);

        // Add to transports map as well using instance ID
        transports[instance.id] = instance.transport as Transport;

        // Enhanced client-template tracking
        this.clientTemplateTracker.addClientTemplate(sessionId, templateName, instance.id, {
          shareable: targetTemplateOptions?.shareable,
          perClient: targetTemplateOptions?.perClient,
        });

        if (lifecycle === 'ephemeral') {
          this.trackEphemeralClient(sessionId, templateName, instance, outboundKey);
        }

        debugIf(() => ({
          message:
            'templateServerManager.templateservermanager.createtemplatebasedservers.tracked.client.template.re.b792872d',
          meta: {
            sessionId,
            referenceCount: instance.referenceCount,
            templateName,
            instanceId: instance.id,
            instanceKey: instance.instanceKey,
          },
        }));

        logger.info('templateServerManager.connected.to.template.client.instance.871228b8', {
          templateName,
          instanceId: instance.id,
          instanceKey: instance.instanceKey,
          renderedHash,
          shareable: templateConfig.template?.shareable !== false,
          perClient: templateConfig.template?.perClient ?? false,
          sessionId,
          clientCount: instance.referenceCount,
        });
      } catch (error) {
        const safeError = sanitizeRuntimeScopeError(error);
        logger.error('templateServerManager.failed.to.create.client.instance.from.template.eac81d4e', {
          templateName,
          templateId: templateName,
          sessionId,
          error,
        });

        // Track the failure
        this.failedTemplates.push({
          templateName,
          sessionId,
          error: safeError.message,
          timestamp: new Date(),
        });

        // Keep only last 100 failures to prevent memory growth
        if (this.failedTemplates.length > 100) {
          this.failedTemplates.shift();
        }
      }
    }
  }

  private matchesPooledTemplateInstance(
    connection: OutboundConnection | undefined,
    instance: PooledClientInstance,
  ): boolean {
    if (!connection) return false;
    if (getLegacyClient(connection) !== instance.client) return false;
    return getLegacyTransport(connection) === instance.transport;
  }

  /**
   * Clean up template-based servers when a client disconnects
   */
  public async cleanupTemplateServers(
    sessionId: string,
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
  ): Promise<void> {
    this.outboundConns = outboundConns;
    this.transports = transports;

    const ownedBindings = this.ownerBindings.get(sessionId);
    if (ownedBindings) {
      this.ownerBindings.delete(sessionId);
      for (const bindingId of ownedBindings) {
        await this.cleanupTemplateServers(bindingId, outboundConns, transports);
      }
    }
    this.forgetBindingContext(sessionId);

    this.expireLogicalSession(sessionId);
    await cleanupTemplateServersForSession(sessionId, outboundConns, transports, {
      clientInstancePool: this.clientInstancePool,
      clientTemplateTracker: this.clientTemplateTracker,
      sessionToRenderedHash: this.sessionToRenderedHash,
      ephemeralClients: this.ephemeralClients,
      persistentSessions: this.persistentSessions,
    });
  }

  public registerLogicalTemplateSessionCleanup(listener: (sessionId: string) => void): () => void {
    this.logicalSessionCleanup.add(listener);
    return () => {
      this.logicalSessionCleanup.delete(listener);
    };
  }

  public touchLogicalTemplateSession(sessionId: string): void {
    const session = this.logicalSessions.get(sessionId) ?? { lastUsedAt: Date.now(), retainCount: 0 };
    session.lastUsedAt = Date.now();
    this.logicalSessions.set(sessionId, session);
    this.touchEphemeralClient(sessionId);
  }

  public retainLogicalTemplateSession(sessionId: string): () => void {
    this.touchLogicalTemplateSession(sessionId);
    const session = this.logicalSessions.get(sessionId)!;
    session.retainCount++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      session.retainCount--;
      session.lastUsedAt = Date.now();
      this.touchEphemeralClient(sessionId);
    };
  }

  private expireLogicalSession(sessionId: string): void {
    if (!this.logicalSessions.delete(sessionId)) return;
    for (const listener of this.logicalSessionCleanup) listener(sessionId);
  }

  public trackPersistentClient(sessionId: string): void {
    this.persistentSessions.add(sessionId);
    this.ephemeralBindingActivity.delete(sessionId);
    this.ephemeralClients.delete(sessionId);
  }

  public trackEphemeralClient(
    sessionId: string,
    templateName: string,
    instance: PooledClientInstance,
    outboundKey = `${templateName}:${instance.renderedHash}`,
  ): void {
    if (this.persistentSessions.has(sessionId)) {
      return;
    }

    if (!this.ephemeralClients.has(sessionId)) {
      this.ephemeralClients.set(sessionId, new Map());
    }

    this.ephemeralClients.get(sessionId)!.set(templateName, {
      templateName,
      instanceId: instance.id,
      instanceKey: instance.instanceKey ?? `${templateName}:${instance.renderedHash}`,
      outboundKey,
      lastUsedAt: new Date(),
      idleTimeout: instance.idleTimeout,
    });
  }

  public touchEphemeralClient(sessionId: string, templateName?: string): void {
    if (this.bindingContexts.has(sessionId) && !this.persistentSessions.has(sessionId)) {
      this.ephemeralBindingActivity.set(sessionId, Date.now());
    }
    const clients = this.ephemeralClients.get(sessionId);
    if (!clients || this.persistentSessions.has(sessionId)) {
      return;
    }

    const now = new Date();
    if (templateName) {
      const client = clients.get(templateName);
      if (client) {
        client.lastUsedAt = now;
      }
      return;
    }

    for (const client of clients.values()) {
      client.lastUsedAt = now;
    }
  }

  /**
   * Get template configurations that match the client's filter criteria
   */
  private getMatchingTemplateConfigs(
    opts: InboundConnectionConfig,
    serverConfigData: { mcpTemplates?: Record<string, MCPServerParams> },
  ): Array<[string, MCPServerParams]> {
    if (!serverConfigData?.mcpTemplates) {
      return [];
    }

    // Validate template entries to ensure type safety
    const templateEntries = Object.entries(serverConfigData.mcpTemplates).filter(
      ([_name, config]) => !isOperatorDisabledTemplateDefinition(config),
    );
    const templates: Array<[string, MCPServerParams]> = templateEntries.filter(([_name, config]) => {
      // Basic validation of MCPServerParams structure
      return config && typeof config === 'object' && 'command' in config;
    }) as Array<[string, MCPServerParams]>;

    logger.info(
      'templateServerManager.templateservermanager.getmatchingtemplateconfigs.using.enhanced.filtering.f761ab86',
    );

    return TemplateFilteringService.getMatchingTemplates(templates, opts);
  }

  /**
   * Get idle template instances for cleanup
   */
  public getIdleTemplateInstances(idleTimeoutMs: number = 10 * 60 * 1000): Array<{
    templateName: string;
    instanceId: string;
    idleTime: number;
  }> {
    return this.clientTemplateTracker.getIdleInstances(idleTimeoutMs);
  }

  /**
   * Resolve an operational template instance target by full ID or unique prefix.
   */
  public resolveTemplateInstance(templateName: string, instanceIdOrPrefix: string): PooledClientInstance | undefined {
    return this.clientInstancePool.resolveTemplateInstance(templateName, instanceIdOrPrefix);
  }

  public getTemplateInstances(templateName: string): PooledClientInstance[] {
    return this.clientInstancePool.getTemplateInstances(templateName);
  }

  public getTemplateActiveInstanceCount(templateName: string): number {
    return this.clientInstancePool
      .getTemplateInstances(templateName)
      .filter((instance) => instance.status !== 'terminating').length;
  }

  public getTemplateActiveInstanceIdentities(templateName: string): string[] {
    return this.clientInstancePool
      .getTemplateInstances(templateName)
      .filter((instance) => instance.status !== 'terminating')
      .map((instance) => instance.id);
  }

  public async observeTemplateDefinitionRetirement(
    templateName: string,
    instanceIdentities: readonly string[],
  ): Promise<TemplateDefinitionRuntimeImpact> {
    const activeInstancesBefore = instanceIdentities.length;
    const retirement = this.templateRetirements.get(templateName);
    if (retirement) {
      try {
        await retirement;
      } catch {
        return {
          activeInstancesBefore,
          retiredInstances: 0,
          activeInstancesAfter: this.countRemainingTemplateInstances(templateName, instanceIdentities),
          retirementObserved: false,
          error: 'Template instance retirement could not be confirmed.',
        };
      }
    }
    const activeInstancesAfter = this.countRemainingTemplateInstances(templateName, instanceIdentities);
    return {
      activeInstancesBefore,
      retiredInstances: Math.max(0, activeInstancesBefore - activeInstancesAfter),
      activeInstancesAfter,
      retirementObserved: activeInstancesAfter === 0,
    };
  }

  private countRemainingTemplateInstances(templateName: string, instanceIdentities: readonly string[]): number {
    const snapshot = new Set(instanceIdentities);
    return this.clientInstancePool
      .getTemplateInstances(templateName)
      .filter((instance) => instance.status !== 'terminating' && snapshot.has(instance.id)).length;
  }

  public restartTemplateInstance(instance: PooledClientInstance): Promise<BackendSupervisionSnapshot> {
    return this.clientInstancePool.restartInstance(instance);
  }

  private isCurrentSupervisionPublication(
    connection: OutboundConnection,
    instance: PooledClientInstance,
    status: ClientStatus,
    snapshot: BackendSupervisionSnapshot,
  ): boolean {
    if (!this.matchesPooledTemplateInstance(connection, instance)) return false;
    if (connection.status !== status) return false;
    return isDeepStrictEqual(connection.supervision, snapshotSupervision(snapshot));
  }

  private publishTemplateSupervision(instance: PooledClientInstance, snapshot: BackendSupervisionSnapshot): void {
    instance.supervision = snapshot;
    for (const outboundKey of instance.outboundKeys) {
      const connection = this.outboundConns?.get(outboundKey);
      if (connection) {
        const connected = snapshot.state === 'connected';
        const status = connected
          ? ClientStatus.Connected
          : snapshot.state === 'crash-loop'
            ? ClientStatus.CrashLoop
            : snapshot.state === 'stopped'
              ? ClientStatus.Disconnected
              : ClientStatus.Restarting;
        if (!this.isCurrentSupervisionPublication(connection, instance, status, snapshot)) {
          const replacement = createLegacyOutboundConnection({
            name: connection.name,
            client: instance.client,
            transport: instance.transport as AuthProviderTransport,
            status,
            capabilities: connected ? instance.client.getServerCapabilities?.() : undefined,
            instructions: connected ? instance.client.getInstructions?.() : undefined,
            supervision: snapshot,
          });
          this.outboundConns?.set(outboundKey, replacement);
          registerCapabilityPaginationNotifications(this.outboundConns!, replacement);
        }
      }
      ClientManager.current?.publishBackendSupervisionState(outboundKey, snapshot);
    }
    this.refreshTemplateInstructions(instance.templateName);
    if (this.transports) {
      this.transports[instance.id] = instance.transport as Transport;
    }
  }

  private refreshTemplateInstructions(templateName: string): void {
    if (!this.instructionAggregator) return;

    for (const [outboundKey, connection] of this.outboundConns ?? []) {
      if (connection.name !== templateName) continue;
      this.instructionAggregator.setInstructions(
        { source: 'mcpTemplates', name: templateName },
        connection.status === ClientStatus.Connected ? connection.instructions : undefined,
        outboundKey,
      );
    }
  }

  /**
   * Force cleanup of idle template instances
   */
  public async cleanupIdleInstances(
    outboundConns: OutboundConnections = this.outboundConns ?? new Map<string, OutboundConnection>(),
    transports: Record<string, Transport> = this.transports ?? {},
  ): Promise<number> {
    const sessionsWithMembership = new Set(this.ephemeralClients.keys());
    const retainedBindings = new Set<string>();
    for (const [bindingId, context] of this.bindingContexts) {
      if (projectPaths(context).some((checkout) => getProjectLifecycle()?.status(checkout).blockers.length))
        retainedBindings.add(bindingId);
    }
    // Active requests and subscriptions retain their contextual membership.
    for (const [sessionId, session] of this.logicalSessions) {
      if (session.retainCount > 0) {
        this.touchEphemeralClient(sessionId);
        for (const bindingId of this.ownerBindings.get(sessionId) ?? []) {
          retainedBindings.add(bindingId);
          this.touchEphemeralClient(bindingId);
        }
      }
    }
    await cleanupExpiredEphemeralClients(outboundConns, transports, {
      clientInstancePool: this.clientInstancePool,
      clientTemplateTracker: this.clientTemplateTracker,
      sessionToRenderedHash: this.sessionToRenderedHash,
      ephemeralClients: this.ephemeralClients,
      persistentSessions: new Set([
        ...this.persistentSessions,
        ...retainedBindings,
        ...Array.from(this.logicalSessions)
          .filter(([, session]) => session.retainCount > 0)
          .map(([sessionId]) => sessionId),
      ]),
    });

    for (const [bindingId, lastUsed] of this.ephemeralBindingActivity) {
      if (retainedBindings.has(bindingId)) continue;
      if (Date.now() - lastUsed < this.poolPolicy.idleTimeoutMs) continue;
      if (this.ephemeralClients.get(bindingId)?.size) continue;
      await this.cleanupTemplateServers(bindingId, outboundConns, transports);
    }
    for (const [sessionId, session] of this.logicalSessions) {
      if (session.retainCount > 0) continue;
      if (this.ephemeralClients.has(sessionId)) continue;
      if (this.ownerBindings.get(sessionId)?.size) continue;
      if (!sessionsWithMembership.has(sessionId)) {
        if (Date.now() - session.lastUsedAt <= this.poolPolicy.idleTimeoutMs) continue;
      }
      this.expireLogicalSession(sessionId);
    }

    // Get all instances from the pool
    const allInstances = this.clientInstancePool.getAllInstances();
    const instancesToCleanup: Array<{ templateName: string; instanceId: string; instance: PooledClientInstance }> = [];

    const now = Date.now();
    for (const instance of allInstances) {
      if (
        this.instanceProjects
          .get(instance.instanceKey)
          ?.some((checkout) => getProjectLifecycle()?.status(checkout).admission === 'draining')
      )
        continue;
      if (instance.status === 'idle' && now - instance.lastUsedAt.getTime() >= instance.idleTimeout) {
        instancesToCleanup.push({
          templateName: instance.templateName,
          instanceId: instance.id,
          instance,
        });
      }
    }

    let cleanedUp = 0;

    for (const { templateName, instanceId, instance } of instancesToCleanup) {
      try {
        for (const outboundKey of instance.outboundKeys) {
          outboundConns.delete(outboundKey);
        }
        instance.outboundKeys.clear();
        delete transports[instanceId];
        // Remove the instance from the pool
        await this.clientInstancePool.removeInstance(
          instance.instanceKey ?? `${templateName}:${instance.renderedHash}`,
        );

        // Clean up tracking
        this.clientTemplateTracker.cleanupInstance(templateName, instanceId);

        cleanedUp++;
        logger.info('templateServerManager.cleaned.up.idle.client.instance.e6d1bdd9', { templateName, instanceId });
      } catch (error) {
        logger.warn('templateServerManager.failed.to.cleanup.idle.client.instance.3f56809c', { error: error });
      }
    }

    if (cleanedUp > 0) {
      logger.info('templateServerManager.cleaned.up.idle.client.instances.dbdf5f7d', { cleanedUpCount: cleanedUp });
    }

    return cleanedUp;
  }

  /**
   * Rebuild the template index
   */
  public rebuildTemplateIndex(serverConfigData?: TemplateRebuildOptions): TemplateRebuildResult {
    const templates = Object.fromEntries(
      Object.entries(serverConfigData?.mcpTemplates ?? {}).filter(
        ([_name, config]) => !isOperatorDisabledTemplateDefinition(config),
      ),
    );
    const currentNames = new Set(Object.keys(templates));
    let toolMetadataChanged = false;
    for (const existingName of this.templateConfigHashes.keys()) {
      if (!currentNames.has(existingName)) {
        void this.scheduleTemplateRetirement(existingName);
        this.templateConfigHashes.delete(existingName);
        this.templateToolMetadataHashes.delete(existingName);
        clearLastConfiguredToolSnapshot(existingName);
        clearCompleteConfiguredToolTargetSnapshot('mcpTemplates', existingName);
        toolMetadataChanged = true;
      }
    }
    for (const [templateName, config] of Object.entries(templates)) {
      const nextHash = templateRuntimeHash(config);
      const previousHash = this.templateConfigHashes.get(templateName);
      if (previousHash && previousHash !== nextHash) {
        void this.scheduleTemplateRetirement(templateName);
      }
      this.templateConfigHashes.set(templateName, nextHash);
      const nextToolMetadataHash = templateRenderedHash({
        disabledTools: [...(config.disabledTools ?? [])].sort(),
        toolDescriptionOverrides: Object.fromEntries(
          Object.entries(config.toolDescriptionOverrides ?? {}).sort(([left], [right]) => left.localeCompare(right)),
        ),
      });
      if (this.templateToolMetadataHashes.get(templateName) !== nextToolMetadataHash) {
        toolMetadataChanged = true;
      }
      this.templateToolMetadataHashes.set(templateName, nextToolMetadataHash);
    }
    this.templateIndex.buildIndex(templates);
    logger.info('templateServerManager.template.index.rebuilt.6dc6c57a');
    return { toolMetadataChanged };
  }

  /** Retire only rendered instances whose effective Runtime Scope inputs changed. */
  public async retireTemplatesForRuntimeEnvironment(
    _declaredTemplateNames: readonly string[],
  ): Promise<RuntimeTemplateReloadTarget[]> {
    const runtimeEnvironment = getRuntimeScopeEnvironment();
    const substituteEnv = AgentConfigManager.getInstance().isEnvSubstitutionEnabled();
    const changedInstances = this.clientInstancePool
      .getAllInstances()
      .filter(
        (instance) =>
          createRuntimeTargetFingerprint(instance.processedConfig, runtimeEnvironment, substituteEnv) !==
          instance.runtimeFingerprint,
      );
    const targets = changedInstances.flatMap((instance) =>
      Array.from(instance.clientIds, (sessionId) => ({
        sessionId,
        templateName: instance.templateName,
        lifecycle: this.persistentSessions.has(sessionId) ? ('persistent' as const) : ('ephemeral' as const),
      })),
    );

    for (const instance of changedInstances) {
      await this.retireRuntimeTemplateInstance(instance);
    }
    return targets;
  }

  private async retireRuntimeTemplateInstance(instance: PooledClientInstance): Promise<void> {
    for (const clientId of instance.clientIds) {
      this.clientTemplateTracker.removeClientFromInstance(clientId, instance.templateName, instance.id);
      const hashes = this.sessionToRenderedHash.get(clientId);
      hashes?.delete(instance.templateName);
      if (hashes?.size === 0) this.sessionToRenderedHash.delete(clientId);
      this.ephemeralClients.get(clientId)?.delete(instance.templateName);
    }
    for (const [outboundKey, connection] of this.outboundConns ?? []) {
      if (getLegacyClient(connection) === instance.client) this.outboundConns?.delete(outboundKey);
    }
    if (this.transports) delete this.transports[instance.id];
    await this.clientInstancePool.removeInstance(instance.instanceKey);
  }

  private scheduleTemplateRetirement(templateName: string): Promise<void> {
    const pending = this.templateRetirements.get(templateName);
    const retirement = pending
      ? pending.catch(() => undefined).then(() => this.retireTemplateInstances(templateName))
      : this.retireTemplateInstances(templateName);
    this.templateRetirements.set(templateName, retirement);

    void retirement
      .finally(() => {
        if (this.templateRetirements.get(templateName) === retirement) {
          this.templateRetirements.delete(templateName);
        }
      })
      .catch((error) => {
        logger.warn('templateServerManager.failed.to.retire.template.instances.for.8a4fcc86', { error: error });
      });

    return retirement;
  }

  private async retireTemplateInstances(templateName: string): Promise<void> {
    const instances = this.clientInstancePool.getTemplateInstances(templateName);
    for (const instance of instances) {
      for (const clientId of instance.clientIds) {
        this.clientTemplateTracker.removeClientFromInstance(clientId, templateName, instance.id);
      }
      this.clientTemplateTracker.cleanupInstance(templateName, instance.id);
      for (const [outboundKey, connection] of this.outboundConns ?? []) {
        if (getLegacyClient(connection) === instance.client) {
          this.outboundConns?.delete(outboundKey);
        }
      }
      if (this.transports) delete this.transports[instance.id];
      await this.clientInstancePool.removeInstance(instance.instanceKey);
    }

    for (const [sessionId, hashes] of this.sessionToRenderedHash) {
      hashes.delete(templateName);
      if (hashes.size === 0) this.sessionToRenderedHash.delete(sessionId);
    }
    for (const [sessionId, clients] of this.ephemeralClients) {
      clients.delete(templateName);
      if (clients.size === 0) this.ephemeralClients.delete(sessionId);
    }
    this.templateSessionMap?.delete(templateName);
    if (instances.length > 0) {
      logger.info('templateServerManager.retired.template.instance.s.after.configuration.replacement.a1e75268');
    }
  }

  /**
   * Get enhanced filtering statistics
   */
  public getFilteringStats(): {
    tracker: ReturnType<ClientTemplateTracker['getStats']> | null;
    index: ReturnType<TemplateIndex['getStats']> | null;
    enabled: boolean;
  } {
    const tracker = this.clientTemplateTracker.getStats();
    const index = this.templateIndex.getStats();

    return {
      tracker,
      index,
      enabled: true,
    };
  }

  /**
   * Get detailed client template tracking information
   */
  public getClientTemplateInfo(): ReturnType<ClientTemplateTracker['getDetailedInfo']> {
    return this.clientTemplateTracker.getDetailedInfo();
  }

  /**
   * Get the client instance pool
   */
  public getClientInstancePool(): ClientInstancePool {
    return this.clientInstancePool;
  }

  /**
   * Get failed template server creation attempts
   */
  public getFailedTemplates(): Array<{
    templateName: string;
    sessionId: string;
    error: string;
    timestamp: Date;
  }> {
    return [...this.failedTemplates];
  }

  /**
   * Get the rendered hash for a specific session and template
   * Used by resolveOutboundConnection to determine the correct outbound key
   */
  public getRenderedHashForSession(sessionId: string, templateName: string): string | undefined {
    return this.sessionToRenderedHash.get(sessionId)?.get(templateName);
  }

  public getBindingContext(bindingId: string): ContextData | undefined {
    this.touchEphemeralClient(bindingId);
    return this.bindingContexts.get(bindingId);
  }

  public getBindingContexts(): ReadonlyMap<string, ContextData> {
    return new Map(this.bindingContexts);
  }

  public getBindingPolicies(bindingId: string): readonly InboundConnectionConfig[] {
    return this.bindingPolicies.get(bindingId) ?? [];
  }

  /** Exact selector inputs used in the immutable binding identity; this read never renews its lifetime. */
  public getBindingConfiguration(bindingId: string): Readonly<InboundConnectionConfig> | undefined {
    const config = this.bindingConfigurations.get(bindingId);
    return config ? structuredClone(config) : undefined;
  }

  /** Callers must revalidate this opaque receipt before each preparation admission. */
  public getBindingAuthority(bindingId: string): ProjectPreparationAuthority | undefined {
    return this.bindingAuthorities.get(bindingId);
  }

  public async registerBindingContext(
    bindingId: string,
    context: ContextData,
    filterConfig: InboundConnectionConfig = {},
    authority?: ProjectPreparationAuthority,
  ): Promise<string> {
    getProjectLifecycle()?.assertAdmission(projectPaths(context));
    const preparationAuthority = getProjectPreparationAuthorityIdentity(authority, context);
    const policies = await resolveProjectPolicies(context, filterConfig);
    const bindingConfiguration = structuredClone({
      tags: filterConfig.tags,
      tagExpression: filterConfig.tagExpression,
      tagQuery: filterConfig.tagQuery,
      tagFilterMode: filterConfig.tagFilterMode,
      presetName: filterConfig.presetName,
      projectFilterMode: filterConfig.projectFilterMode,
    });
    if (context.project || context.projectSet) {
      bindingId = createProjectBindingId(context.sessionId ?? bindingId, context, {
        filterConfig: bindingConfiguration,
        policies,
        preparationAuthority,
      });
    }
    const boundAuthority = bindProjectPreparationAuthority(authority, bindingId, context);
    const capacity = Math.max(1, this.poolPolicy.maxTotalInstances) * 32;
    if (!this.bindingContexts.has(bindingId) && this.bindingContexts.size >= capacity) {
      throw new Error('Project binding capacity exceeded');
    }
    getProjectLifecycle()?.assertAdmission(projectPaths(context));
    this.bindingContexts.set(bindingId, context);
    this.bindingPolicies.set(bindingId, policies);
    this.bindingConfigurations.set(bindingId, Object.freeze(bindingConfiguration));
    if (boundAuthority) this.bindingAuthorities.set(bindingId, boundAuthority);
    const ownerSessionId = context.sessionId ?? bindingId;
    const owned = this.ownerBindings.get(ownerSessionId) ?? new Set<string>();
    owned.add(bindingId);
    this.ownerBindings.set(ownerSessionId, owned);
    this.touchEphemeralClient(bindingId);
    return bindingId;
  }

  public getSessionProjectContexts(sessionId: string): ContextData[] {
    return [...this.bindingContexts.entries()]
      .filter(([id, context]) => id === sessionId || context.sessionId === sessionId)
      .map(([, context]) => context);
  }

  /** Inspection does not touch logical membership lifetimes. Unverified callers remain blockers. */
  public getProjectBlockers(checkout: string): ProjectBlocker[] {
    const canonical = canonicalLifecyclePath(checkout);
    const blockers: ProjectBlocker[] = [];
    for (const [bindingId, context] of this.bindingContexts) {
      if (!projectPaths(context).includes(canonical)) continue;
      blockers.push({ kind: 'owner', id: getVerifiedProjectOwner(context)?.ownerId ?? 'unverified:' + bindingId });
      if (projectPaths(context).length > 1)
        blockers.push({ kind: 'shared-binding', id: bindingId, count: projectPaths(context).length });
      const retained = this.logicalSessions.get(context.sessionId ?? bindingId)?.retainCount ?? 0;
      if (retained) blockers.push({ kind: 'requests-or-subscriptions', id: bindingId, count: retained });
    }
    for (const instance of this.clientInstancePool.getAllInstances()) {
      if (!this.instanceProjects.get(instance.instanceKey)?.includes(canonical)) continue;
      blockers.push({ kind: instance.referenceCount ? 'shared-backend' : 'backend-process', id: instance.instanceKey });
    }
    for (const id of this.projectCleanup.get(canonical) ?? []) blockers.push({ kind: 'backend-process', id });
    return blockers;
  }

  public async closeUnusedProjectInstances(checkout: string): Promise<void> {
    const canonical = canonicalLifecyclePath(checkout);
    if (getProjectLifecycle()?.status(canonical).blockers.length) return;
    for (const instance of this.clientInstancePool.getAllInstances()) {
      if (!this.instanceProjects.get(instance.instanceKey)?.includes(canonical)) continue;
      if (instance.referenceCount > 0) continue;
      if ([...this.bindingContexts.values()].some((context) => projectPaths(context).includes(canonical))) continue;
      await this.clientInstancePool.releaseInstance(instance.instanceKey);
      this.instanceProjects.delete(instance.instanceKey);
    }
  }

  public async releaseProjectOwner(
    checkout: string,
    ownerId: string,
    selectedCheckouts: string[] = [checkout],
  ): Promise<void> {
    const canonical = canonicalLifecyclePath(checkout);
    if (getProjectLifecycle()?.status(canonical).blockers.length) return;
    const pending = this.projectCleanup.get(canonical) ?? new Set<string>();
    this.projectCleanup.set(canonical, pending);
    for (const [bindingId, context] of [...this.bindingContexts]) {
      if (getVerifiedProjectOwner(context)?.ownerId !== ownerId) continue;
      const paths = projectPaths(context);
      if (!paths.includes(canonical)) continue;
      if (paths.some((entry) => !selectedCheckouts.map(canonicalLifecyclePath).includes(entry))) continue;
      if ((this.logicalSessions.get(context.sessionId ?? bindingId)?.retainCount ?? 0) > 0) continue;
      const instances = this.clientTemplateTracker.getClientTemplates(bindingId);
      for (const { templateName, instanceId } of instances) {
        const instance = this.clientInstancePool.getAllInstances().find((candidate) => candidate.id === instanceId);
        if (!instance) continue;
        const key = instance.instanceKey ?? `${templateName}:${instance.renderedHash}`;
        this.clientInstancePool.removeClientFromInstance(key, bindingId);
        if (this.clientTemplateTracker.getClientCount(templateName, instanceId) <= 1) pending.add(key);
      }
      await this.cleanupTemplateServers(
        bindingId,
        this.outboundConns ?? new Map<string, OutboundConnection>(),
        this.transports ?? {},
      );
    }
    for (const key of pending) {
      const instance = this.clientInstancePool.getInstance(key);
      if (instance?.referenceCount) continue;
      await this.clientInstancePool.releaseInstance(key);
      pending.delete(key);
      this.instanceProjects.delete(key);
    }
    if (!pending.size) this.projectCleanup.delete(canonical);
  }

  private forgetBindingContext(bindingId: string): void {
    const owner = this.bindingContexts.get(bindingId)?.sessionId ?? bindingId;
    this.bindingContexts.delete(bindingId);
    this.bindingPolicies.delete(bindingId);
    this.bindingConfigurations.delete(bindingId);
    this.bindingAuthorities.delete(bindingId);
    this.ephemeralBindingActivity.delete(bindingId);
    const owned = this.ownerBindings.get(owner);
    owned?.delete(bindingId);
    if (owned?.size === 0) this.ownerBindings.delete(owner);
  }

  /**
   * Get all rendered hashes for a specific session
   * Used by filterConnectionsForSession to determine which connections to include
   * Returns Map<templateName, renderedHash>
   */
  public getAllRenderedHashesForSession(sessionId: string): Map<string, string> | undefined {
    return this.sessionToRenderedHash.get(sessionId);
  }

  /**
   * Clean up resources (for shutdown)
   */
  public async shutdown(): Promise<void> {
    // Clean up cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    for (const sessionId of this.logicalSessions.keys()) this.expireLogicalSession(sessionId);
    this.logicalSessionCleanup.clear();
    this.ephemeralClients.clear();
    this.persistentSessions.clear();
    this.sessionToRenderedHash.clear();
    this.ownerBindings.clear();
    this.bindingContexts.clear();
    this.bindingPolicies.clear();
    this.bindingConfigurations.clear();
    this.bindingAuthorities.clear();
    this.ephemeralBindingActivity.clear();

    await this.clientInstancePool.shutdown();
    this.templateConfigHashes.clear();
    this.templateRetirements.clear();
  }

  public cleanup(): void {
    this.shutdown().catch((error) => {
      logger.warn('templateServerManager.failed.to.clean.up.template.server.manager.3b6ac013', { error: error });
    });
  }
}

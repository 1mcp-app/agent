import {
  authorizeTemplateContext,
  type TemplateContextAuthorization,
  type TemplateContextCapability,
  TemplateContextCapabilityStore,
  type TemplateContextProof,
} from '@src/core/context/templateContextTrust.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { debugIf, infoIf, warnIf } from '@src/logger/logger.js';
import { isContextData } from '@src/transport/http/utils/contextExtractor.js';
import type { ContextData } from '@src/types/context.js';

export interface AuthorizeRequestTemplateContextInput {
  context: ContextData;
  proof?: TemplateContextProof;
  transportSessionId?: string;
  source: 'meta' | 'query' | 'persisted';
}

/**
 * Read the template-context capability for request authorization. If the
 * credential store cannot be secured (insecure permissions, heal denied, etc.)
 * we fail closed: treat the capability as absent so every proof resolves to
 * `untrusted` instead of letting the request crash with a 500.
 */
function readCapabilityFailClosed(storagePath: string): TemplateContextCapability | undefined {
  try {
    return new TemplateContextCapabilityStore({
      storageDir: storagePath,
      runtimeScopeId: new RuntimeIdentityService({ storageDir: storagePath }).getRuntimeScopeId(),
    }).getOrCreate();
  } catch (error) {
    warnIf(`Template context capability unreadable; denying template context trust: ${error}`);
    return undefined;
  }
}

export function authorizeRequestTemplateContext(
  input: AuthorizeRequestTemplateContextInput,
): TemplateContextAuthorization {
  const config = AgentConfigManager.getInstance();
  const mode = config.get('templateContext')?.trust ?? 'verified';
  const storagePath = config.get('runtimeScopeStoragePath');
  const sessionTtlMinutes = config.get('auth')?.sessionTtlMinutes ?? 1440;
  const capability = mode === 'verified' && storagePath ? readCapabilityFailClosed(storagePath) : undefined;
  const result = authorizeTemplateContext({
    mode,
    context: input.context,
    proof: input.proof,
    capability,
    transportSessionId: input.transportSessionId,
    maxAgeMs: sessionTtlMinutes * 60 * 1000,
  });

  const createAudit = () => ({
    source: input.source,
    trustMode: mode,
    verification: result.status,
    reason: 'reason' in result ? result.reason : undefined,
    provenance: 'provenance' in result ? result.provenance : undefined,
    runtimeScopeId: result.runtimeScopeId,
    sessionId: input.transportSessionId ?? input.context.sessionId,
    contextHash: result.contextHash,
    projectName: input.context.project.name,
    projectPath: input.context.project.path,
  });
  const auditLog = result.status === 'trusted' ? infoIf : warnIf;
  auditLog(() => ({ message: 'Template context audit', meta: createAudit() }));
  debugIf(() => ({
    message: 'Template context audit detail',
    meta: {
      ...createAudit(),
      context: redactContextForAudit(input.context),
    },
  }));

  return result;
}

export function redactContextForAudit(context: ContextData): Record<string, unknown> {
  return {
    ...context,
    project: {
      ...context.project,
      custom: redactRecord(context.project.custom),
    },
    user: {
      ...context.user,
      email: context.user.email ? '[REDACTED]' : undefined,
      home: context.user.home ? '[REDACTED]' : undefined,
      shell: context.user.shell ? '[REDACTED]' : undefined,
    },
    environment: {
      ...context.environment,
      variables: redactRecord(context.environment.variables),
    },
  };
}

export function redactTemplateContextBodyForLogging(body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const record = body as Record<string, unknown>;
  const redacted = { ...record };
  if (record._meta && typeof record._meta === 'object') {
    redacted._meta = redactMetaForLogging(record._meta as Record<string, unknown>);
  }
  if (record.params && typeof record.params === 'object') {
    const params = record.params as Record<string, unknown>;
    redacted.params = {
      ...params,
      ...(params._meta && typeof params._meta === 'object'
        ? { _meta: redactMetaForLogging(params._meta as Record<string, unknown>) }
        : {}),
    };
  }
  return redacted;
}

export function redactTemplateContextQueryForLogging(query: unknown): unknown {
  if (!query || typeof query !== 'object') {
    return query;
  }
  const redacted = { ...(query as Record<string, unknown>) };
  if ('context' in redacted) {
    redacted.context = '[DECODED_IN_TEMPLATE_CONTEXT_AUDIT]';
  }
  if ('contextProof' in redacted) {
    redacted.contextProof = '[REDACTED]';
  }
  return redacted;
}

function redactMetaForLogging(meta: Record<string, unknown>): Record<string, unknown> {
  return {
    ...meta,
    ...(meta.context && typeof meta.context === 'object'
      ? { context: redactContextForGeneralLogging(meta.context) }
      : {}),
    ...(meta.contextProof ? { contextProof: { present: true, signature: '[REDACTED]' } } : {}),
  };
}

function redactContextForGeneralLogging(context: object): unknown {
  if (isContextData(context)) {
    return redactContextForAudit(context);
  }

  return {
    invalid: true,
    keys: Object.keys(context),
  };
}

function redactRecord(value: Record<string, unknown> | undefined): Record<string, string> | undefined {
  return value ? Object.fromEntries(Object.keys(value).map((key) => [key, '[REDACTED]'])) : undefined;
}

import { ProtocolError } from '@modelcontextprotocol/server';

import { createHash, randomUUID } from 'node:crypto';

import { MAX_RUNTIME_CATALOG_SCOPES } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import type { ContextData } from '@src/types/context.js';
import { deriveContextSessionId } from '@src/utils/context/sessionIdentity.js';

export interface ModernTemplateContextBinding {
  readonly sessionId: string;
  readonly id: string;
  readonly context: ContextData;
  readonly effectiveHash: string;
}

/** Only contexts authorized by the ingress may enter this session registry. */
export class ModernTemplateContextSessions {
  private readonly bindings = new Map<string, ModernTemplateContextBinding>();

  bind(context: ContextData, projectBindingId?: string): ModernTemplateContextBinding {
    const sessionId = context.sessionId ?? deriveContextSessionId(context);
    const { timestamp: _timestamp, transport, ...facts } = context;
    const { connectionTimestamp: _connectionTimestamp, ...transportFacts } = transport ?? {};
    const effectiveHash = createHash('sha256')
      .update(JSON.stringify({ ...facts, transport: transport ? transportFacts : undefined }, canonicalJson))
      .digest('hex');
    const key = context.projectSet ? (projectBindingId ?? sessionId) : sessionId;
    const existing = this.bindings.get(key);
    if (existing) {
      if (existing.effectiveHash !== effectiveHash) {
        throw new ProtocolError(-32602, 'Template context changed; start a new Request Session');
      }
      return existing;
    }
    if (this.bindings.size >= MAX_RUNTIME_CATALOG_SCOPES) {
      throw new ProtocolError(-32000, 'Template session capacity exceeded');
    }
    const binding = Object.freeze({
      sessionId,
      id: randomUUID(),
      context: structuredClone({ ...context, sessionId }),
      effectiveHash,
    });
    this.bindings.set(key, binding);
    return binding;
  }

  forget(sessionId: string): ModernTemplateContextBinding | undefined {
    const binding = this.bindings.get(sessionId);
    this.bindings.delete(sessionId);
    return binding;
  }

  forgetSession(sessionId: string): ModernTemplateContextBinding[] {
    const forgotten: ModernTemplateContextBinding[] = [];
    for (const [key, binding] of this.bindings) {
      if (binding.sessionId !== sessionId) continue;
      forgotten.push(binding);
      this.bindings.delete(key);
    }
    return forgotten;
  }

  clear(): void {
    this.bindings.clear();
  }
}

function canonicalJson(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

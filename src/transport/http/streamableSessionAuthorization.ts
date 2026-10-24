import type { StreamableSessionAuthorizationBinding } from '@src/auth/sessionTypes.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';

import { z } from 'zod';

const bindingSchema = z.object({
  clientId: z.string().min(1),
  resource: z.url(),
  scopes: z.array(z.string()),
});

/** Only non-secret grant facts cross the session persistence boundary. */
export function canonicalSessionBinding(value: unknown): StreamableSessionAuthorizationBinding | undefined {
  const parsed = bindingSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return {
    clientId: parsed.data.clientId,
    resource: new URL(parsed.data.resource).href,
    scopes: [...new Set(parsed.data.scopes)].sort(),
  };
}

export function sessionBindingsMatch(stored: unknown, current: unknown): boolean {
  const owner = canonicalSessionBinding(stored);
  const requester = canonicalSessionBinding(current);
  if (!owner || !requester) return false;
  return JSON.stringify(owner) === JSON.stringify(requester);
}

const requestBindings = new WeakMap<object, StreamableSessionAuthorizationBinding>();

export function bindAuthenticatedSessionRequest(request: object, binding: StreamableSessionAuthorizationBinding): void {
  const canonical = canonicalSessionBinding(binding);
  if (canonical) requestBindings.set(request, canonical);
}

/** Undefined preserves anonymous compatibility; null makes missing authenticated admission fail closed. */
export function getRequestSessionBinding(request: object): StreamableSessionAuthorizationBinding | null | undefined {
  if (!AgentConfigManager.getInstance().get('features').auth) return undefined;
  return requestBindings.get(request) ?? null;
}

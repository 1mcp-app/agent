import { runtimeAdmission } from '@src/core/server/runtimeDrain.js';

import type { AuthProviderTransport } from './legacyTransport.js';

type RequestId = string | number;
interface DispatchObserver {
  readonly pending: Map<RequestId, (() => void) | null>;
  onmessage?: AuthProviderTransport['onmessage'];
}
const observers = new WeakMap<AuthProviderTransport, DispatchObserver>();

/**
 * SDK cancellation/timeouts discard their response waiter before backend work is done.
 * Retain the admitted root independently until the transport sees its terminal reply.
 * Transport errors/disconnection cannot establish completion and deliberately retain it.
 */
export function observeBackendDispatchLifetime(transport: AuthProviderTransport): void {
  let observer = observers.get(transport);
  if (!observer) {
    observer = { pending: new Map() };
    observers.set(transport, observer);
    const pending = observer.pending;
    const send = transport.send;
    transport.send = function (message, options) {
      if ('id' in message && 'method' in message && message.method !== 'initialize' && message.method !== 'ping') {
        const release = runtimeAdmission.retain();
        if (release) {
          // Reusing a wire ID before completion makes its replies ambiguous. Fail closed.
          if (pending.has(message.id)) pending.set(message.id, null);
          else pending.set(message.id, release);
        }
      }
      return send.call(this, message, options);
    };
  }
  // SDK connect/reconnect replaces onmessage. Preserve the current callback and reattach our observer.
  if (transport.onmessage !== observer.onmessage || !observer.onmessage) {
    const receive = transport.onmessage;
    const pending = observer.pending;
    observer.onmessage = (message, extra) => {
      try {
        receive?.(message, extra);
      } finally {
        if (
          'id' in message &&
          (typeof message.id === 'string' || typeof message.id === 'number') &&
          !('method' in message) &&
          ('result' in message || 'error' in message)
        ) {
          const release = pending.get(message.id);
          if (release) {
            pending.delete(message.id);
            release();
          }
        }
      }
    };
    transport.onmessage = observer.onmessage;
  }
}

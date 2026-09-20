import { runtimeAdmission } from '@src/core/server/runtimeDrain.js';
import type { JSONRPCMessage } from '@src/sdk/legacy/types.js';

import type { AuthProviderTransport } from './legacyTransport.js';

type RequestId = string | number;
interface DispatchObserver {
  readonly pending: Map<RequestId, (() => void) | null>;
  onmessage?: AuthProviderTransport['onmessage'];
}
const observers = new WeakMap<AuthProviderTransport, DispatchObserver>();

function retainDispatch(pending: DispatchObserver['pending'], message: JSONRPCMessage): void {
  if (!('id' in message)) return;
  if (!('method' in message)) return;
  if (message.method === 'initialize' || message.method === 'ping') return;
  const release = runtimeAdmission.retain();
  if (!release) return;
  // Reusing a wire ID before completion makes its replies ambiguous. Fail closed.
  pending.set(message.id, pending.has(message.id) ? null : release);
}

function releaseDispatch(pending: DispatchObserver['pending'], message: JSONRPCMessage): void {
  if (!('id' in message)) return;
  if (typeof message.id !== 'string' && typeof message.id !== 'number') return;
  if ('method' in message) return;
  if (!('result' in message) && !('error' in message)) return;
  const release = pending.get(message.id);
  if (!release) return;
  pending.delete(message.id);
  release();
}

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
      retainDispatch(pending, message);
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
        releaseDispatch(pending, message);
      }
    };
    transport.onmessage = observer.onmessage;
  }
}

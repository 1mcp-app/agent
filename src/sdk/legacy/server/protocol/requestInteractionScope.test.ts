import { createHash } from 'node:crypto';

import * as validation from '@src/gateway/interactions/validateInteractionResponse.js';
import type { InboundConnection, OutboundConnection } from '@src/core/types/index.js';
import { InteractionOwner } from '@src/gateway/interactions/interactionOwner.js';
import type { RequestHandlerExtra } from '@src/sdk/legacy/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@src/sdk/legacy/types.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { forwardScopedNotification, sessionLogLevels, withRequestInteractionScope } from './requestInteractionScope.js';

const handlers = vi.hoisted(() => new Map<string, (request: ServerRequest) => Promise<unknown>>());
vi.mock('@src/sdk/legacy/client/runtime/legacyOutboundConnection.js', () => ({
  setOutboundRequestHandler: (
    _connection: unknown,
    schema: { shape: { method: { value: string } } },
    handler: (request: ServerRequest) => Promise<unknown>,
  ) => handlers.set(schema.shape.method.value, handler),
}));
vi.mock('@src/sdk/legacy/server/runtime/legacyInboundConnection.js', () => ({
  getLegacyInboundServer: (inbound: { capabilities: object }) => ({
    getClientCapabilities: () => inbound.capabilities,
  }),
}));

let sequence = 0;
function fixture() {
  const id = String(++sequence);
  const inbound = { connectionId: `inbound-${id}`, capabilities: { roots: {} } } as unknown as InboundConnection;
  const connection = { adapter: { connectionId: `upstream-${id}` } } as OutboundConnection;
  const extra = {
    signal: new AbortController().signal,
    sendRequest: vi.fn().mockResolvedValue({ roots: [] }),
    sendNotification: vi.fn(),
  } as unknown as RequestHandlerExtra<ServerRequest, ServerNotification>;
  return { inbound, connection, extra };
}

describe('legacy operation interaction ownership', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['cancel', 'adapter replacement'] as const)(
    'rejects a response invalidated during validation by %s',
    async (change) => {
      const { inbound, connection, extra } = fixture();
      const controller = new AbortController();
      let releaseValidation!: () => void;
      let finish!: () => void;
      vi.spyOn(validation, 'validateInteractionResponse').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseValidation = resolve;
          }),
      );
      const operation = withRequestInteractionScope(
        connection,
        inbound,
        { ...extra, signal: controller.signal },
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const response = handlers.get('roots/list')!({ method: 'roots/list' });
      try {
        await vi.waitFor(() => expect(releaseValidation).toBeTypeOf('function'));
        if (change === 'cancel') controller.abort();
        else Object.defineProperty(connection, 'adapter', { value: { connectionId: 'replacement' } });
        releaseValidation();
        await expect(response).rejects.toThrow('interaction_lost');
      } finally {
        releaseValidation?.();
        finish();
        await operation;
        await response.catch(() => undefined);
      }
    },
  );

  it('bounds anonymous private children against their original provider before dispatch', async () => {
    const releases: Array<() => void> = [];
    const operations: Promise<void>[] = [];
    try {
      for (let index = 0; index < 32; index++) {
        const current = fixture();
        operations.push(
          withRequestInteractionScope(
            current.connection,
            { ...current.inbound, canonicalSchemaProjection: true },
            current.extra,
            () => new Promise<void>((resolve) => releases.push(resolve)),
            'original-provider',
          ),
        );
      }
      const candidate = fixture();
      const effect = vi.fn(async () => undefined);
      await expect(
        withRequestInteractionScope(
          candidate.connection,
          { ...candidate.inbound, canonicalSchemaProjection: true },
          candidate.extra,
          effect,
          'original-provider',
        ),
      ).rejects.toMatchObject({ code: 'interaction_capacity_exceeded' });
      expect(effect).not.toHaveBeenCalled();
    } finally {
      for (const release of releases) release();
      await Promise.all(operations);
    }
  });

  it.each(['validation', 'answer'] as const)('caps pending callbacks at 32 while awaiting %s', async (stage) => {
    const { inbound, connection, extra } = fixture();
    let finish!: () => void;
    const pendingValidation: Array<() => void> = [];
    if (stage === 'validation')
      vi.spyOn(validation, 'validateInteractionRequest').mockImplementation(
        () => new Promise<void>((resolve) => pendingValidation.push(resolve)),
      );
    vi.mocked(extra.sendRequest).mockImplementation(
      (_request, _schema, options) =>
        new Promise((_resolve, reject) => {
          const signal = options!.signal!;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          if (signal.aborted) reject(signal.reason);
        }),
    );
    const operation = withRequestInteractionScope(
      connection,
      inbound,
      extra,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const handler = handlers.get('roots/list')!;
    const pending = Array.from({ length: 32 }, () => handler({ method: 'roots/list' }));
    const settled = Promise.allSettled(pending);
    try {
      if (stage === 'answer') await vi.waitFor(() => expect(extra.sendRequest).toHaveBeenCalledTimes(32));
      else expect(pendingValidation).toHaveLength(32);
      await expect(handler({ method: 'roots/list' })).rejects.toThrow('interaction_capacity_exceeded');
      for (const release of pendingValidation) release();
      expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
      expect(extra.sendRequest).toHaveBeenCalledTimes(stage === 'validation' ? 0 : 32);
    } finally {
      for (const release of pendingValidation) release();
      finish();
      await operation;
      await settled;
    }
  });

  it('shares the verified owner quota across legacy sessions and modern brokers before dispatch', async () => {
    const modern = new InteractionOwner();
    const principal = createHash('sha256')
      .update(JSON.stringify(['client', 'grant']))
      .digest('hex');
    const reservation = modern.start(
      { principal, request: 'modern', route: 'modern-route', generation: '1', inbound: 'modern', outbound: 'modern' },
      Date.now() + 5000,
    );
    const releases: Array<() => void> = [];
    const operations: Promise<void>[] = [];
    const authInfo = { token: 'grant', clientId: 'client', scopes: [] };
    try {
      for (let index = 0; index < 15; index++) {
        const current = fixture();
        operations.push(
          withRequestInteractionScope(
            current.connection,
            current.inbound,
            { ...current.extra, authInfo },
            () => new Promise<void>((resolve) => releases.push(resolve)),
          ),
        );
      }
      const candidate = fixture();
      const effect = vi.fn(async () => undefined);
      await expect(
        withRequestInteractionScope(candidate.connection, candidate.inbound, { ...candidate.extra, authInfo }, effect),
      ).rejects.toMatchObject({ code: 'interaction_capacity_exceeded' });
      expect(effect).not.toHaveBeenCalled();
      modern.finish(reservation.id);
      await withRequestInteractionScope(
        candidate.connection,
        candidate.inbound,
        { ...candidate.extra, authInfo },
        effect,
      );
      expect(effect).toHaveBeenCalledOnce();
    } finally {
      for (const release of releases) release();
      await Promise.all(operations);
      await modern.close();
    }
  });

  it('shares the global 128 cap and does not accept a projection flag as an outer reservation', async () => {
    const modern = new InteractionOwner();
    const ids: string[] = [];
    try {
      for (let index = 0; index < 128; index++)
        ids.push(
          modern.start(
            {
              principal: `owner-${index}`,
              request: 'request',
              route: `route-${index}`,
              generation: '1',
              inbound: 'modern',
              outbound: 'modern',
            },
            Date.now() + 5000,
          ).id,
        );
      const current = fixture();
      const inbound = { ...current.inbound, canonicalSchemaProjection: true };
      const effect = vi.fn(async () => undefined);
      await expect(
        withRequestInteractionScope(current.connection, inbound, current.extra, effect),
      ).rejects.toMatchObject({ code: 'interaction_capacity_exceeded' });
      expect(effect).not.toHaveBeenCalled();
      modern.finish(ids[0]);
      await withRequestInteractionScope(current.connection, inbound, current.extra, effect);
      expect(effect).toHaveBeenCalledOnce();
    } finally {
      await modern.close();
    }
  });

  it('bounds anonymous ownership by the exact inbound connection', async () => {
    const { inbound } = fixture();
    const releases: Array<() => void> = [];
    const operations: Promise<void>[] = [];
    try {
      for (let index = 0; index < 16; index++) {
        const current = fixture();
        operations.push(
          withRequestInteractionScope(
            current.connection,
            inbound,
            current.extra,
            () => new Promise<void>((resolve) => releases.push(resolve)),
          ),
        );
      }
      const candidate = fixture();
      const effect = vi.fn(async () => undefined);
      await expect(
        withRequestInteractionScope(candidate.connection, inbound, candidate.extra, effect),
      ).rejects.toMatchObject({ code: 'interaction_capacity_exceeded' });
      expect(effect).not.toHaveBeenCalled();
      await withRequestInteractionScope(candidate.connection, candidate.inbound, candidate.extra, effect);
      expect(effect).toHaveBeenCalledOnce();
    } finally {
      for (const release of releases) release();
      await Promise.all(operations);
    }
  });
  it('rejects competing admission before effects, routes to the owner, and clears the lease', async () => {
    const { inbound, connection, extra } = fixture();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = withRequestInteractionScope(connection, inbound, extra, () => waiting);
    const effect = vi.fn();
    await expect(withRequestInteractionScope(connection, fixture().inbound, fixture().extra, effect)).rejects.toThrow(
      'interaction_capacity_exceeded',
    );
    expect(effect).not.toHaveBeenCalled();
    await handlers.get('roots/list')!({ method: 'roots/list' });
    expect(extra.sendRequest).toHaveBeenCalledOnce();
    release();
    await active;
    await expect(handlers.get('roots/list')!({ method: 'roots/list' })).rejects.toThrow('interaction_lost');
  });

  it('uses the current owner capability and suppresses unowned logs', async () => {
    const { inbound, connection, extra } = fixture();
    sessionLogLevels.set(inbound, 'error');
    await withRequestInteractionScope(connection, inbound, extra, async () => {
      await expect(
        handlers.get('sampling/createMessage')!({
          method: 'sampling/createMessage',
          params: { messages: [], maxTokens: 1 },
        }),
      ).rejects.toThrow('interaction_capability_required');
      await forwardScopedNotification(connection, {
        method: 'notifications/message',
        params: { level: 'info', data: 'hidden' },
      });
      await forwardScopedNotification(connection, {
        method: 'notifications/message',
        params: { level: 'error', data: 'visible' },
      });
    });
    await forwardScopedNotification(connection, {
      method: 'notifications/message',
      params: { level: 'error', data: 'unowned' },
    });
    expect(extra.sendNotification).toHaveBeenCalledTimes(1);
  });
  it('keeps thresholds isolated between sessions sharing an upstream', async () => {
    const first = fixture();
    const second = fixture();
    sessionLogLevels.set(first.inbound, 'error');
    sessionLogLevels.set(second.inbound, 'debug');
    const message = { method: 'notifications/message', params: { level: 'info', data: 'message' } };
    await withRequestInteractionScope(first.connection, first.inbound, first.extra, () =>
      forwardScopedNotification(first.connection, message),
    );
    await withRequestInteractionScope(first.connection, second.inbound, second.extra, () =>
      forwardScopedNotification(first.connection, message),
    );
    expect(first.extra.sendNotification).not.toHaveBeenCalled();
    expect(second.extra.sendNotification).toHaveBeenCalledOnce();
  });
});

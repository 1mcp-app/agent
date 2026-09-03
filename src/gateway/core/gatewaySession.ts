import { gatewayFailureFromUnknown, type GatewayResult, type ImmutableJsonValue } from '../contracts/index.js';
import type { InboundEraAdapter, InboundGatewayResponse } from '../ports/index.js';
import { GatewayDispatcher } from './gatewayDispatcher.js';

function responseFor(requestId: string, result: GatewayResult<ImmutableJsonValue>): InboundGatewayResponse {
  return result.ok
    ? Object.freeze({ type: 'success', requestId, result: result.value })
    : Object.freeze({ type: 'failure', requestId, failure: result.failure });
}

/** Connects inbound request/cancellation events to one gateway dispatcher. */
export class GatewaySession {
  private readonly active = new Map<Promise<void>, string>();

  constructor(private readonly dispatcher: GatewayDispatcher) {}

  async run(inbound: InboundEraAdapter): Promise<void> {
    while (true) {
      let event: Awaited<ReturnType<InboundEraAdapter['nextEvent']>>;
      try {
        event = await inbound.nextEvent();
      } catch (error) {
        await this.cancelAndDrain();
        throw gatewayFailureFromUnknown(error, 'transport');
      }
      switch (event.type) {
        case 'request': {
          let task: Promise<void>;
          task = this.dispatcher
            .dispatch(event.request)
            .then((result) => inbound.respond(responseFor(event.request.requestId, result)))
            .finally(() => this.active.delete(task));
          this.active.set(task, event.request.requestId);
          void task.catch(() => undefined);
          break;
        }
        case 'cancel':
          await this.dispatcher.cancel(event.requestId);
          break;
        case 'failure':
          await this.cancelAndDrain();
          throw event.failure;
        case 'closed':
          await this.cancelAndDrain();
          return;
      }
    }
  }

  private async cancelAndDrain(): Promise<void> {
    await this.cancelActive();
    await this.drain();
  }

  private async cancelActive(): Promise<void> {
    await Promise.all([...new Set(this.active.values())].map((requestId) => this.dispatcher.cancel(requestId)));
  }

  private async drain(): Promise<void> {
    const results = await Promise.allSettled(this.active.keys());
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected) throw gatewayFailureFromUnknown(rejected.reason, 'transport');
  }
}

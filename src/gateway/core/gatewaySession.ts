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
  private readonly active = new Set<Promise<void>>();

  constructor(private readonly dispatcher: GatewayDispatcher) {}

  async run(inbound: InboundEraAdapter): Promise<void> {
    while (true) {
      const event = await inbound.nextEvent();
      switch (event.type) {
        case 'request': {
          let task: Promise<void>;
          task = this.dispatcher
            .dispatch(event.request)
            .then((result) => inbound.respond(responseFor(event.request.requestId, result)))
            .finally(() => this.active.delete(task));
          this.active.add(task);
          void task.catch(() => undefined);
          break;
        }
        case 'cancel':
          await this.dispatcher.cancel(event.requestId);
          break;
        case 'failure':
          await this.drain();
          throw event.failure;
        case 'closed':
          await this.drain();
          return;
      }
    }
  }

  private async drain(): Promise<void> {
    const results = await Promise.allSettled(this.active);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected) throw gatewayFailureFromUnknown(rejected.reason, 'transport');
  }
}

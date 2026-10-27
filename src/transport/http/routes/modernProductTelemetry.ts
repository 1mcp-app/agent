import { McpServer, Server } from '@modelcontextprotocol/server';

import { ownData } from '@src/observability/privacy/fields.js';
import { beginProductOperation } from '@src/productTelemetry/index.js';
import { productClientFamily, productOperationName, productOperationOutcome } from '@src/productTelemetry/operation.js';
import type { CommandCompletion } from '@src/productTelemetry/producer.js';

/** A fresh SDK product owns exactly one validated modern HTTP exchange. */
export function observeModernProduct<T extends McpServer | Server>(product: T): T {
  const server = product instanceof McpServer ? product.server : product;
  const connect = server.connect.bind(server);
  server.connect = async (transport, ...options) => {
    await connect(transport, ...options);
    const receive = transport.onmessage;
    const send = transport.send.bind(transport);
    const onclose = transport.onclose;
    let requestId: string | number | undefined;
    let completion: CommandCompletion | undefined;
    let terminalSending = false;
    const finish = (outcome: 'success' | 'failure') => {
      const operation = completion;
      completion = undefined;
      operation?.finish(outcome);
    };
    transport.onmessage = (message, extra) => {
      const id = ownData(message, 'id');
      const method = ownData(message, 'method');
      if (typeof method === 'string' && (typeof id === 'string' || typeof id === 'number')) {
        requestId = id;
        completion = beginProductOperation(
          productOperationName(method),
          'http',
          productClientFamily(
            ownData(ownData(ownData(message, 'params'), '_meta'), 'io.modelcontextprotocol/clientInfo'),
          ),
        );
      }
      if (method === 'notifications/cancelled' && ownData(ownData(message, 'params'), 'requestId') === requestId)
        finish('failure');
      receive?.(message, extra);
    };
    transport.onclose = () => {
      if (!terminalSending) finish('failure');
      onclose?.();
    };
    transport.send = async (message, ...sendOptions) => {
      const terminal = isResponseFor(message, requestId);
      if (!terminal) return send(message, ...sendOptions);
      terminalSending = true;
      try {
        await send(message, ...sendOptions);
        finish(productOperationOutcome(message));
      } catch (error) {
        finish('failure');
        throw error;
      } finally {
        terminalSending = false;
      }
    };
  };
  return product;
}

function isResponseFor(message: unknown, requestId: string | number | undefined): boolean {
  if (requestId === undefined) return false;
  if (ownData(message, 'method') !== undefined) return false;
  return ownData(message, 'id') === requestId;
}

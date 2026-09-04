import { classifyProtocolEra, type GatewayFailure, type ProtocolEraPin } from '../../contracts/index.js';

/**
 * Validates the only era supported by the modern adapters.
 *
 * A rejected modern classification is thrown as the frozen, plain gateway
 * failure returned by the shared classifier. Callers must treat it as terminal.
 */
export function requireModernPin(revision: unknown): ProtocolEraPin {
  const classified = classifyProtocolEra({ syntax: 'modern', revision });
  if (!classified.ok) throw classified.failure satisfies GatewayFailure;
  return classified.value;
}

import type { GatewayInteractionRequest } from '../ports/outboundEraAdapter.js';

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Capability truth is request-local, including the exact interaction subtype. */
export function hasInteractionCapability(capabilities: unknown, request: GatewayInteractionRequest): boolean {
  if (!record(capabilities)) return false;
  const params = record(request.params) ? request.params : {};
  switch (request.method) {
    case 'roots/list':
      return Object.hasOwn(capabilities, 'roots') && record(capabilities.roots);
    case 'sampling/createMessage': {
      const sampling = capabilities.sampling;
      return (
        Object.hasOwn(capabilities, 'sampling') &&
        record(sampling) &&
        (!(params.tools !== undefined || params.toolChoice !== undefined) ||
          (Object.hasOwn(sampling, 'tools') && record(sampling.tools)))
      );
    }
    case 'elicitation/create': {
      const elicitation = capabilities.elicitation;
      if (!Object.hasOwn(capabilities, 'elicitation') || !record(elicitation)) return false;
      if (params.mode === 'url') return Object.hasOwn(elicitation, 'url') && record(elicitation.url);
      if (params.mode !== undefined && params.mode !== 'form') return false;
      return (
        (Object.hasOwn(elicitation, 'form') && record(elicitation.form)) ||
        (!Object.hasOwn(elicitation, 'form') && !Object.hasOwn(elicitation, 'url'))
      );
    }
    default:
      return false;
  }
}

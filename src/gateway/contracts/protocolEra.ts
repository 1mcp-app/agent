import { createGatewayFailure, gatewayFailure, type GatewayResult, gatewaySuccess } from './gatewayFailure.js';

export const MODERN_PROTOCOL_REVISION = '2026-07-28';
export const LEGACY_PROTOCOL_REVISIONS = Object.freeze([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
] as const);

export type ProtocolEra = 'legacy' | 'modern';
export type ProtocolLeg = 'inbound' | 'outbound';

export interface ProtocolEraPin {
  readonly era: ProtocolEra;
  readonly revision: string;
}

export interface ProtocolEraEvidence {
  /** The era-specific adapter owns syntax detection. Modern syntax is terminal. */
  readonly syntax: ProtocolEra;
  readonly revision: unknown;
}

export function classifyProtocolEra(evidence: ProtocolEraEvidence): GatewayResult<ProtocolEraPin> {
  if (evidence.syntax !== 'legacy' && evidence.syntax !== 'modern') {
    return gatewayFailure(
      createGatewayFailure({
        kind: 'protocol',
        code: 'protocol_evidence_invalid',
        message: 'Protocol era evidence is malformed',
      }),
    );
  }
  if (evidence.syntax === 'modern') {
    if (evidence.revision !== MODERN_PROTOCOL_REVISION) {
      return gatewayFailure(
        createGatewayFailure({
          kind: 'protocol',
          code: 'modern_protocol_invalid',
          message: 'Modern protocol evidence is malformed or unsupported',
          data: { observedEra: 'modern' },
        }),
      );
    }
    return gatewaySuccess(Object.freeze({ era: 'modern', revision: MODERN_PROTOCOL_REVISION }));
  }

  if (
    typeof evidence.revision !== 'string' ||
    !(LEGACY_PROTOCOL_REVISIONS as readonly string[]).includes(evidence.revision)
  ) {
    return gatewayFailure(
      createGatewayFailure({
        kind: 'protocol',
        code: 'legacy_protocol_invalid',
        message: 'Legacy protocol evidence is malformed or unsupported',
        data: { observedEra: 'legacy' },
      }),
    );
  }
  return gatewaySuccess(Object.freeze({ era: 'legacy', revision: evidence.revision }));
}

export class IndependentEraPins {
  private inbound?: ProtocolEraPin;
  private outbound?: ProtocolEraPin;

  get(leg: ProtocolLeg): ProtocolEraPin | undefined {
    return leg === 'inbound' ? this.inbound : this.outbound;
  }

  pin(leg: ProtocolLeg, evidence: ProtocolEraEvidence): GatewayResult<ProtocolEraPin> {
    const classified = classifyProtocolEra(evidence);
    if (!classified.ok) return classified;

    const current = this.get(leg);
    if (current && (current.era !== classified.value.era || current.revision !== classified.value.revision)) {
      return gatewayFailure(
        createGatewayFailure({
          kind: 'protocol',
          code: 'protocol_era_pin_conflict',
          message: `The ${leg} protocol era is already pinned`,
          data: { leg, pinnedEra: current.era, pinnedRevision: current.revision },
        }),
      );
    }

    if (!current) {
      if (leg === 'inbound') this.inbound = classified.value;
      else this.outbound = classified.value;
    }
    return gatewaySuccess(this.get(leg)!);
  }
}

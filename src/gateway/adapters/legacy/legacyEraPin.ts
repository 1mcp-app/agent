import { classifyProtocolEra, type ProtocolEraPin } from '../../contracts/index.js';

export function createLegacyEraPin(pin: ProtocolEraPin): ProtocolEraPin {
  if (pin.era !== 'legacy') {
    throw new TypeError('Legacy gateway adapters require a legacy protocol era pin');
  }

  const classified = classifyProtocolEra({ syntax: 'legacy', revision: pin.revision });
  if (!classified.ok) {
    throw new TypeError(classified.failure.message);
  }
  return classified.value;
}

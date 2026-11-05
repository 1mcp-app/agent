export function fields(bytes: Buffer): Map<number, (Buffer | bigint)[]> {
  const result = new Map<number, (Buffer | bigint)[]>();
  let offset = 0;
  const variable = () => {
    let value = 0n;
    let shift = 0n;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return value;
      shift += 7n;
    }
    throw new Error('truncated protobuf');
  };
  while (offset < bytes.length) {
    const tag = Number(variable());
    const number = tag >>> 3;
    const wire = tag & 7;
    let value: Buffer | bigint;
    if (wire === 0) value = variable();
    else if (wire === 1) {
      value = bytes.readBigUInt64LE(offset);
      offset += 8;
    } else if (wire === 5) {
      value = BigInt(bytes.readUInt32LE(offset));
      offset += 4;
    } else if (wire === 2) {
      const length = Number(variable());
      value = bytes.subarray(offset, offset + length);
      offset += length;
    } else throw new Error('unsupported protobuf wire');
    const entries = result.get(number) ?? [];
    entries.push(value);
    result.set(number, entries);
  }
  return result;
}
export function messages(bytes: Buffer, number: number): Buffer[] {
  return (fields(bytes).get(number) ?? []).filter((entry): entry is Buffer => Buffer.isBuffer(entry));
}
export function bytesAt(bytes: Buffer, number: number): Buffer {
  return messages(bytes, number)[0] ?? Buffer.alloc(0);
}
export function textAt(bytes: Buffer, number: number): string {
  return bytesAt(bytes, number).toString();
}
export function numericAt(bytes: Buffer, number: number): bigint {
  const value = fields(bytes).get(number)?.[0];
  return typeof value === 'bigint' ? value : 0n;
}
export function spans(payloads: { path: string; body: Buffer }[]) {
  return payloads
    .filter((p) => p.path.endsWith('/traces'))
    .flatMap((p) => messages(p.body, 1))
    .flatMap((resource) => messages(resource, 2))
    .flatMap((scope) => messages(scope, 2))
    .map((span) => ({
      name: textAt(span, 5),
      start: numericAt(span, 7),
      end: numericAt(span, 8),
      kind: Number(numericAt(span, 6)),
      id: bytesAt(span, 2).toString('hex'),
      traceId: bytesAt(span, 1).toString('hex'),
      parentId: bytesAt(span, 4).toString('hex'),
      traceState: textAt(span, 3),
      status: Number(numericAt(bytesAt(span, 15), 3)),
      links: messages(span, 13).map((link) => ({
        traceId: bytesAt(link, 1).toString('hex'),
        traceState: textAt(link, 3),
      })),
      attributes: messages(span, 9).map((attribute) => [textAt(attribute, 1), textAt(bytesAt(attribute, 2), 1)]),
    }));
}

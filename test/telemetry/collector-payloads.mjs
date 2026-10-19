import { readFile } from 'node:fs/promises';

export async function decodedPayloads(collector) {
  const text = (await readFile(collector.capture, 'utf8')).trim();
  if (!text) throw new Error('No decoded payloads');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
export function decodedSpans(payloads) {
  return payloads
    .flatMap((payload) => payload.resourceSpans ?? [])
    .flatMap((resource) => resource.scopeSpans ?? [])
    .flatMap((scope) => scope.spans ?? []);
}
export function attributes(span) {
  return Object.fromEntries(
    (span.attributes ?? []).map(({ key, value }) => [
      key,
      value.stringValue ?? value.intValue ?? value.boolValue ?? value.doubleValue,
    ]),
  );
}

// One process-local observer per adapter. No SDK objects or wire notifications
// cross this boundary; the adapter reports only an owned catalog coverage loss.
const observers = new WeakMap<object, () => void>();

export function observeCatalogCoverageLoss(source: object, invalidate: () => void): void {
  if (observers.has(source)) throw new Error('Catalog coverage observer is already registered');
  observers.set(source, invalidate);
}

/** Revoke admitted routes synchronously before any owner callback can dispatch. */
export function reportCatalogCoverageLoss(source: object): void {
  observers.get(source)?.();
}

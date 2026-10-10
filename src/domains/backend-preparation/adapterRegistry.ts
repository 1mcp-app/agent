import type { BackendPreparationAdapter } from './contracts.js';

/** Registration is runtime-owned and keyed by configured backend name. */
export class PreparationAdapterRegistry {
  private readonly adapters = new Map<string, BackendPreparationAdapter>();

  register(backendName: string, adapter: BackendPreparationAdapter): void {
    if (!backendName) throw new Error('A configured backend name is required');
    if (this.adapters.has(backendName)) throw new Error(`Preparation adapter already registered: ${backendName}`);
    this.adapters.set(backendName, adapter);
  }

  get(backendName: string): BackendPreparationAdapter | undefined {
    return this.adapters.get(backendName);
  }
}

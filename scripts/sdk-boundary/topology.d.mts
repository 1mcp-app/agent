export interface SdkTopology {
  readonly schemaVersion: number;
  readonly rootPackages: Readonly<Record<string, { readonly resolved: string | null }>>;
  readonly [key: string]: unknown;
}

export function buildSdkTopology(root: string): Promise<SdkTopology>;
export function topologyDifferences(expected: unknown, actual: unknown): readonly unknown[];

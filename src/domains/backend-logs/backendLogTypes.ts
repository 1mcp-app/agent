export type BackendLogSourceKind = 'static' | 'template';
export type BackendLogCapture = 'managed' | 'not-captured';
export type BackendLogSourceLifecycle = 'active' | 'ended';
export type BackendLogEventKind = 'line' | 'repeated' | 'suppressed';

export interface BackendLogSource {
  readonly id: string;
  readonly canonicalName: string;
  readonly displayName: string;
  readonly kind: BackendLogSourceKind;
  readonly capture: BackendLogCapture;
  readonly lifecycle: BackendLogSourceLifecycle;
}

export interface BackendLogEntry {
  readonly sequence: number;
  readonly timestamp: string;
  readonly sourceId: string;
  readonly canonicalName: string;
  readonly displayName: string;
  readonly sourceKind: BackendLogSourceKind;
  readonly kind: BackendLogEventKind;
  readonly content: string;
  readonly count?: number;
  readonly truncated: boolean;
}

export interface BackendLogSnapshot {
  readonly sequence: number;
  readonly sources: BackendLogSource[];
  readonly entries: BackendLogEntry[];
}

export interface BackendLogSourceUpdate {
  readonly sourceId: string;
  readonly source?: BackendLogSource;
  readonly removed: boolean;
}

export interface BackendLogPublishInput {
  readonly sourceId: string;
  readonly kind: BackendLogEventKind;
  readonly content: string;
  readonly count?: number;
  readonly truncated?: boolean;
}

export type BackendLogReplay =
  | { readonly kind: 'replay'; readonly entries: BackendLogEntry[] }
  | { readonly kind: 'gap'; readonly snapshot: BackendLogSnapshot };

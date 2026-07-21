export interface ManagedStdioStderrMetadata {
  readonly serverName: string;
  readonly source: 'backend-stderr';
  readonly line?: string;
  readonly truncated?: boolean;
  readonly repeatCount?: number;
  readonly suppressedCount?: number;
}

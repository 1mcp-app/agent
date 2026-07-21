import type { ManagedStdioStderrEvent } from './managedStdioStderrEvent.js';
import type { ManagedStdioStderrMetadata } from './managedStdioStderrMetadata.js';

export interface ManagedStdioStderrOptions {
  readonly emit?: (event: ManagedStdioStderrEvent, metadata: ManagedStdioStderrMetadata) => void;
  readonly maxLineBytes?: number;
  readonly maxLinesPerWindow?: number;
  readonly windowMs?: number;
  readonly repeatSummaryIntervalMs?: number;
}

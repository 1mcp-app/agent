export type LocalDiagnosticLevel = 'info' | 'debug' | 'warn' | 'error';
export type LocalDiagnosticEvent =
  `${'backend' | 'tool' | 'config' | 'schema' | 'capability' | 'oauth' | 'session'}.${string}`;
export interface LocalDiagnosticRecord {
  readonly level: LocalDiagnosticLevel;
  readonly event: LocalDiagnosticEvent;
  readonly details: string;
}
const admittedRecords = new WeakSet<object>();

/** Internal sanitizer admission; never an API for caller-constructed diagnostic records. */
export function admitLocalDiagnosticRecord(record: LocalDiagnosticRecord): void {
  admittedRecords.add(record);
}

export function isLocalDiagnosticRecord(record: LocalDiagnosticRecord): boolean {
  return admittedRecords.has(record);
}

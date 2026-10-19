import type { SignalName } from '../../config/telemetryConfig.js';

export type SignalState = 'disabled' | 'starting' | 'healthy' | 'degraded' | 'stopping' | 'stopped';
export type ShutdownOutcome = 'none' | 'success' | 'failed' | 'timeout';
export interface SignalStatus {
  state: SignalState;
  exporter: 'none' | 'otlp';
  protocol?: 'http/protobuf';
  endpointClass?: 'https' | 'loopback-http';
  queueUse: 'empty' | 'low' | 'elevated' | 'high';
  dropped: number;
  overflow: number;
  successAgeMs: number | null;
  failureAgeMs: number | null;
  shutdown: ShutdownOutcome;
}
export interface TelemetryStatus {
  state: SignalState;
  traces: SignalStatus;
  metrics: SignalStatus;
}
export interface TelemetryDiagnostic {
  event: 'telemetry.failure' | 'telemetry.recovered' | 'telemetry.configuration';
  signal: SignalName;
  category: 'export' | 'queue' | 'cardinality' | 'shutdown' | 'configuration';
  suppressed: number;
}
const MAX_COUNT = 2147483647;
export class SignalHealth {
  state: SignalState;
  dropped = 0;
  overflow = 0;
  queueSize = 0;
  shutdown: ShutdownOutcome = 'none';
  private started = Date.now();
  private lastSuccess?: number;
  private lastFailure?: number;
  private failures = 0;
  private recovery = 0;
  private highSince?: number;
  private warnings = new Map<TelemetryDiagnostic['category'], { at: number; suppressed: number }>();
  constructor(
    readonly signal: SignalName,
    readonly interval: number,
    readonly capacity: number,
    readonly config: { exporter: 'none' | 'otlp'; protocol: 'http/protobuf'; endpointClass: 'https' | 'loopback-http' },
    private diagnostic?: (event: TelemetryDiagnostic) => void,
  ) {
    this.state = config.exporter === 'none' ? 'disabled' : 'starting';
  }
  private emit(event: TelemetryDiagnostic) {
    try {
      this.diagnostic?.(event);
    } catch {
      /* Diagnostics never affect callers. */
    }
  }
  warn(category: TelemetryDiagnostic['category']) {
    const now = Date.now();
    const prior = this.warnings.get(category);
    if (prior && now - prior.at < 60000) {
      prior.suppressed = Math.min(MAX_COUNT, prior.suppressed + 1);
      return;
    }
    this.emit({ event: 'telemetry.failure', signal: this.signal, category, suppressed: prior?.suppressed ?? 0 });
    this.warnings.set(category, { at: now, suppressed: 0 });
  }
  fail() {
    this.lastFailure = Date.now();
    this.failures++;
    this.recovery = 0;
    if (this.failures >= 3) this.degrade();
    this.warn('export');
  }
  success() {
    this.lastSuccess = Date.now();
    this.failures = 0;
    if (this.queueSize / this.capacity >= 0.5) {
      this.recovery = 0;
      return;
    }
    this.recovery++;
    if (this.state === 'starting' || this.state === 'healthy' || (this.state === 'degraded' && this.recovery >= 2)) {
      this.state = 'healthy';
      for (const [category, warning] of this.warnings)
        this.emit({ event: 'telemetry.recovered', signal: this.signal, category, suppressed: warning.suppressed });
      this.warnings.clear();
    }
  }
  queue(size: number) {
    this.queueSize = size;
    if (size / this.capacity >= 0.75) this.highSince ??= Date.now();
    else this.highSince = undefined;
  }
  drop() {
    this.dropped = Math.min(MAX_COUNT, this.dropped + 1);
    this.degrade();
    this.warn('queue');
  }
  cardinality(count = 1) {
    this.overflow = Math.min(MAX_COUNT, this.overflow + count);
    this.degrade();
    this.warn('cardinality');
  }
  private degrade() {
    if (['starting', 'healthy', 'degraded'].includes(this.state)) this.state = 'degraded';
    this.recovery = 0;
  }
  tick() {
    if (!['starting', 'healthy', 'degraded'].includes(this.state)) return;
    const now = Date.now();
    if (now - (this.lastSuccess ?? this.started) >= this.interval * 2) this.degrade();
    if (this.highSince !== undefined && now - this.highSince >= this.interval) {
      this.degrade();
      this.warn('queue');
    }
  }
  status(): SignalStatus {
    this.tick();
    const now = Date.now();
    const use = this.queueSize / this.capacity;
    return {
      state: this.state,
      exporter: this.config.exporter,
      ...(this.config.exporter === 'otlp'
        ? { protocol: this.config.protocol, endpointClass: this.config.endpointClass }
        : {}),
      queueUse: use === 0 ? 'empty' : use < 0.5 ? 'low' : use < 0.75 ? 'elevated' : 'high',
      dropped: this.dropped,
      overflow: this.overflow,
      successAgeMs: this.lastSuccess === undefined ? null : Math.max(0, now - this.lastSuccess),
      failureAgeMs: this.lastFailure === undefined ? null : Math.max(0, now - this.lastFailure),
      shutdown: this.shutdown,
    };
  }
}
export function aggregateState(signals: SignalStatus[]): SignalState {
  const active = signals.filter((signal) => signal.state !== 'disabled');
  if (!active.length) return 'disabled';
  for (const state of ['degraded', 'starting', 'stopping', 'healthy', 'stopped'] as const)
    if (active.some((signal) => signal.state === state)) return state;
  return 'disabled';
}

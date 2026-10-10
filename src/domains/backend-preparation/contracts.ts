export type PreparationAction = 'initialize' | 'sync' | 'rebuild' | 'install' | 'paid';

/** All identity and authorization resolution happens before entering this domain. */
export interface PreparationTarget {
  readonly checkoutRoot: string;
  readonly backendName: string;
  readonly backendIdentity: string;
  readonly configurationKey: string;
}

export interface BackendPolicy {
  readonly allowedActions: readonly PreparationAction[];
  readonly executionDeadlineMs?: number;
  readonly transientRetryLimit?: number;
}

export type ProjectPreparationPreferences = Readonly<Record<string, { readonly enabled: boolean }>>;

export interface ReadinessEvidence {
  readonly freshness: 'current' | 'stale' | 'unknown';
  readonly coverage: 'complete' | 'partial' | 'unknown';
  readonly detail: string;
}

export type BackendReadiness =
  | { readonly state: 'ready'; readonly evidence: ReadinessEvidence }
  | {
      readonly state: 'required';
      readonly action: PreparationAction;
      readonly instructions: string;
      readonly evidence: ReadinessEvidence;
    }
  | {
      readonly state: 'unknown';
      readonly reason: 'inspection_timeout' | 'caller_disconnected';
      readonly instructions: string;
    }
  | { readonly state: 'unsupported' | 'conflict'; readonly instructions: string };

export interface PreparationFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly instructions: string;
}

/** Saved status is advisory: never a process ownership credential. */
export interface PreparationRecoveryHint {
  readonly previousJobId: string;
  readonly previousState: string;
}

export interface BackendPreparationAdapter {
  inspect(
    target: PreparationTarget,
    operation: string,
    options?: { readonly signal?: AbortSignal; readonly waitMs?: number },
  ): Promise<BackendReadiness>;
  /** Must settle only once owned work has stopped. Abort must never stop foreign work. */
  prepare(
    target: PreparationTarget,
    action: PreparationAction,
    options: { readonly signal: AbortSignal; readonly executionDeadlineMs: number },
  ): Promise<void>;
  classifyFailure(error: unknown): PreparationFailure;
  /** Must reconcile native readiness and ownership; unsupported recovery reports conflict. */
  reconcile?(
    target: PreparationTarget,
    operation: string,
    advisory: PreparationRecoveryHint,
    options?: { readonly signal?: AbortSignal; readonly waitMs?: number },
  ): Promise<BackendReadiness>;
}

export interface PreparationOptions {
  readonly concurrency: number;
  readonly queueCapacity: number;
  readonly requestWaitMs: number;
  readonly executionDeadlineMs: number;
  readonly maxRecords: number;
}

export interface PreparationRequestOptions {
  readonly waitMs?: number;
  readonly signal?: AbortSignal;
  /** Trusted runtime-only synchronous advisory-capacity reservation; never a backend-operation callback. */
  readonly beforeAdmission?: () => void;
  /** Optional caller-owned asynchronous validation after native inspection, before a new job is scheduled. */
  readonly validateAdmission?: () => Promise<void>;
}

export type PreparationState = 'queued' | 'running' | 'cancelling' | 'ready' | 'failed' | 'cancelled';

export interface PreparationStatus {
  readonly id: string;
  readonly target: PreparationTarget;
  readonly operation: string;
  readonly action: PreparationAction;
  readonly state: PreparationState;
  readonly attempt: number;
  readonly executionDeadlineMs: number;
  readonly readiness?: BackendReadiness;
  readonly failure?: PreparationFailure;
}

export type PreparationResult =
  | { readonly state: 'ready'; readonly readiness: BackendReadiness }
  | { readonly state: 'job'; readonly status: PreparationStatus }
  | Extract<BackendReadiness, { state: 'unknown' }>
  | { readonly state: 'busy' | 'disabled' | 'unsupported' | 'conflict' | 'forbidden'; readonly instructions: string };

export type PreparationAdmission =
  | { readonly state: 'ready'; readonly readiness: BackendReadiness }
  | {
      readonly state: 'pending';
      readonly status: PreparationStatus;
      readonly operationExecuted: false;
      readonly operationQueued: false;
      readonly instructions: string;
    }
  | Exclude<PreparationResult, { state: 'ready' }>;

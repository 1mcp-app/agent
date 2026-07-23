import type {
  AdminConfirmationRequirement,
  AdminOperationContext,
  AdminOperationResult,
  AdminOperationService,
} from './adminOperationService.js';

// Default selection restarts a static target once or unhealthy active instances of a template target.
export type BackendRestartSelection =
  { mode: 'target_default' } | { mode: 'instance'; instanceIdOrPrefix: string } | { mode: 'all_instances' };

export type BackendRestartOutcome =
  | 'restarted'
  | 'target_not_found'
  | 'target_disabled'
  | 'instance_not_found'
  | 'instance_ambiguous'
  | 'no_active_instances'
  | 'no_unhealthy_instances';

export interface RuntimeBackendRestartResult {
  targetName: string;
  targetType?: 'static' | 'template';
  outcome: BackendRestartOutcome;
  restartedInstanceIds: string[];
  candidateInstanceIds?: string[];
}

export interface RuntimeBackendRestartService {
  restart(input: { targetName: string; selection: BackendRestartSelection }): Promise<RuntimeBackendRestartResult>;
}

export interface BackendRestartInput {
  context: AdminOperationContext;
  targetName: string;
  selection: BackendRestartSelection;
  confirmationRequirements?: AdminConfirmationRequirement[];
}

export interface AdminBackendRestartOperations {
  restartBackend(input: BackendRestartInput): Promise<AdminOperationResult<RuntimeBackendRestartResult>>;
}

export class AdminBackendRestartService implements AdminBackendRestartOperations {
  constructor(
    private readonly options: {
      operationService: AdminOperationService;
      runtimeRestartService: RuntimeBackendRestartService;
    },
  ) {}

  async restartBackend(input: BackendRestartInput): Promise<AdminOperationResult<RuntimeBackendRestartResult>> {
    const context = {
      ...input.context,
      target: { type: 'backend', id: input.targetName },
    };

    return this.options.operationService.executeMutation({
      context,
      operationName: 'restartBackend',
      confirmationRequirements: input.confirmationRequirements,
      run: async () =>
        this.options.runtimeRestartService.restart({
          targetName: input.targetName,
          selection: input.selection,
        }),
    });
  }
}

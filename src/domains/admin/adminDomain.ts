import type { OAuthAuthorizationFlow } from '@src/auth/oauthAuthorizationFlow.js';
import type { TemplateDefinitionRuntimeImpact } from '@src/core/server/templateServerManager.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import type { ConfigChangeService } from '@src/domains/config-change/configChange.js';
import { createInstructionTemplateManager } from '@src/domains/instruction-template/instructionTemplateManager.js';
import type { PresetManager } from '@src/domains/preset/manager/presetManager.js';

import {
  type AdminBackendRestartOperations,
  AdminBackendRestartService,
  type RuntimeBackendRestartService,
} from './adminBackendRestartService.js';
import {
  type AdminConfiguredServerOperations,
  AdminConfiguredServerService,
  type ConfiguredServerConfigDocument,
  type ConfiguredServerConnectivityChecker,
} from './adminConfiguredServerService.js';
import { AdminIdentityService } from './adminIdentityService.js';
import {
  type AdminInstructionPreviewInput,
  type AdminInstructionPreviewResult,
  type AdminInstructionTemplateOperations,
  AdminInstructionTemplateService,
  type RuntimeInstructionRenderFailure,
} from './adminInstructionTemplateService.js';
import { type AdminOAuthOperations, AdminOAuthService } from './adminOAuthService.js';
import { AdminOperationService } from './adminOperationService.js';
import { type AdminPresetOperations, AdminPresetService } from './adminPresetService.js';
import type { ConfiguredToolInventory, ConfiguredToolTargetSource } from './configuredToolInventory.js';
import type { AdminMutationAvailability } from './runtimeScopeAdminLock.js';

export interface AdminDomainOptions {
  runtimeScopeId: string;
  storageDir: string;
  sessionTtlMs: number;
  configChangeService: ConfigChangeService;
  getConfigPath?: () => string;
  readConfigDocument: () => ConfiguredServerConfigDocument | null;
  checkConnectivity?: ConfiguredServerConnectivityChecker;
  readToolInventory?: (input: {
    targetName: string;
    source: ConfiguredToolTargetSource;
    config: MCPServerParams;
    model?: string;
  }) => Promise<ConfiguredToolInventory>;
  refreshToolInventory?: (input: {
    targetName: string;
    source: ConfiguredToolTargetSource;
    config: MCPServerParams;
    model?: string;
  }) => Promise<ConfiguredToolInventory>;
  getTemplateActiveInstanceCount?: (templateName: string) => number;
  getTemplateActiveInstanceIdentities?: (templateName: string) => string[];
  observeTemplateDefinitionRetirement?: (
    templateName: string,
    instanceIdentities: readonly string[],
  ) => Promise<TemplateDefinitionRuntimeImpact>;
  mutationAvailability?: AdminMutationAvailability;
  now?: () => Date;
  createOperationId?: () => string;
  auditRetentionMs?: number;
  presetManager?: PresetManager;
  readServerTargets?: () => Record<string, MCPServerParams>;
  runtimeBackendRestartService?: RuntimeBackendRestartService;
  oauthFlow?: OAuthAuthorizationFlow;
  previewInstructions?: (input: AdminInstructionPreviewInput) => Promise<AdminInstructionPreviewResult>;
  getLegacyInitialization?: () => string | undefined;
  getInstructionRenderFailures?: () => Partial<Record<'initialization' | 'cli', RuntimeInstructionRenderFailure>>;
}

export interface AdminDomain {
  adminService: AdminIdentityService;
  operationService: AdminOperationService;
  configuredServerService: AdminConfiguredServerOperations;
  instructionTemplateService?: AdminInstructionTemplateOperations;
  presetService?: AdminPresetOperations;
  backendRestartService?: AdminBackendRestartOperations;
  oauthService?: AdminOAuthOperations;
}

export function createAdminDomain(options: AdminDomainOptions): AdminDomain {
  const adminService = new AdminIdentityService({
    runtimeScopeId: options.runtimeScopeId,
    storageDir: options.storageDir,
    sessionTtlMs: options.sessionTtlMs,
    ...(options.now ? { now: options.now } : {}),
  });
  const operationService = new AdminOperationService({
    runtimeScopeId: options.runtimeScopeId,
    storageDir: options.storageDir,
    mutationAvailability: options.mutationAvailability,
    ...(options.auditRetentionMs !== undefined ? { auditRetentionMs: options.auditRetentionMs } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.createOperationId ? { createOperationId: options.createOperationId } : {}),
  });
  const configuredServerService = new AdminConfiguredServerService({
    operationService,
    configChangeService: options.configChangeService,
    readConfigDocument: options.readConfigDocument,
    mutationAvailability: options.mutationAvailability,
    ...(options.checkConnectivity ? { checkConnectivity: options.checkConnectivity } : {}),
    ...(options.readToolInventory ? { readToolInventory: options.readToolInventory } : {}),
    ...(options.refreshToolInventory ? { refreshToolInventory: options.refreshToolInventory } : {}),
    ...(options.getTemplateActiveInstanceCount
      ? { getTemplateActiveInstanceCount: options.getTemplateActiveInstanceCount }
      : {}),
    ...(options.getTemplateActiveInstanceIdentities
      ? { getTemplateActiveInstanceIdentities: options.getTemplateActiveInstanceIdentities }
      : {}),
    ...(options.observeTemplateDefinitionRetirement
      ? { observeTemplateDefinitionRetirement: options.observeTemplateDefinitionRetirement }
      : {}),
  });
  const instructionTemplateService =
    options.getConfigPath && options.previewInstructions
      ? new AdminInstructionTemplateService({
          operationService,
          manager: createInstructionTemplateManager({
            getConfigPath: options.getConfigPath,
            configChangeService: options.configChangeService,
          }),
          preview: options.previewInstructions,
          getLegacyInitialization: options.getLegacyInitialization ?? (() => undefined),
          getRenderFailures: options.getInstructionRenderFailures ?? (() => ({})),
        })
      : undefined;
  const backendRestartService = options.runtimeBackendRestartService
    ? new AdminBackendRestartService({
        operationService,
        runtimeRestartService: options.runtimeBackendRestartService,
      })
    : undefined;
  const presetService =
    options.presetManager && options.readServerTargets
      ? new AdminPresetService({
          operationService,
          presetManager: options.presetManager,
          readServerTargets: options.readServerTargets,
        })
      : undefined;
  const oauthService = options.oauthFlow
    ? new AdminOAuthService({ operationService, oauthFlow: options.oauthFlow })
    : undefined;

  return {
    adminService,
    operationService,
    configuredServerService,
    instructionTemplateService,
    backendRestartService,
    presetService,
    oauthService,
  };
}

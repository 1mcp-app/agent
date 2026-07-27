import type { MCPServerParams } from '@src/core/types/index.js';
import type { ConfigChangeService } from '@src/domains/config-change/configChange.js';
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
import { AdminOperationService } from './adminOperationService.js';
import { type AdminPresetOperations, AdminPresetService } from './adminPresetService.js';
import type { AdminMutationAvailability } from './runtimeScopeAdminLock.js';

export interface AdminDomainOptions {
  runtimeScopeId: string;
  storageDir: string;
  sessionTtlMs: number;
  configChangeService: ConfigChangeService;
  readConfigDocument: () => ConfiguredServerConfigDocument | null;
  checkConnectivity?: ConfiguredServerConnectivityChecker;
  mutationAvailability?: AdminMutationAvailability;
  now?: () => Date;
  createOperationId?: () => string;
  presetManager?: PresetManager;
  readServerTargets?: () => Record<string, MCPServerParams>;
  runtimeBackendRestartService?: RuntimeBackendRestartService;
}

export interface AdminDomain {
  adminService: AdminIdentityService;
  operationService: AdminOperationService;
  configuredServerService: AdminConfiguredServerOperations;
  presetService?: AdminPresetOperations;
  backendRestartService?: AdminBackendRestartOperations;
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
    ...(options.now ? { now: options.now } : {}),
    ...(options.createOperationId ? { createOperationId: options.createOperationId } : {}),
  });
  const configuredServerService = new AdminConfiguredServerService({
    operationService,
    configChangeService: options.configChangeService,
    readConfigDocument: options.readConfigDocument,
    ...(options.checkConnectivity ? { checkConnectivity: options.checkConnectivity } : {}),
  });
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

  return {
    adminService,
    operationService,
    configuredServerService,
    backendRestartService,
    presetService,
  };
}

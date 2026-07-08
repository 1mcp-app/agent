import type { ConfigChangeService } from '@src/domains/config-change/configChange.js';

import {
  type AdminConfiguredServerOperations,
  AdminConfiguredServerService,
  type ConfiguredServerConfigDocument,
} from './adminConfiguredServerService.js';
import { AdminIdentityService } from './adminIdentityService.js';
import { AdminOperationService } from './adminOperationService.js';
import type { AdminMutationAvailability } from './runtimeScopeAdminLock.js';

export interface AdminDomainOptions {
  runtimeScopeId: string;
  storageDir: string;
  sessionTtlMs: number;
  configChangeService: ConfigChangeService;
  readConfigDocument: () => ConfiguredServerConfigDocument | null;
  mutationAvailability?: AdminMutationAvailability;
  now?: () => Date;
  createOperationId?: () => string;
}

export interface AdminDomain {
  adminService: AdminIdentityService;
  operationService: AdminOperationService;
  configuredServerService: AdminConfiguredServerOperations;
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
  });

  return {
    adminService,
    operationService,
    configuredServerService,
  };
}

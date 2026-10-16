import type { IntegrationDefinition } from './integrationDefinitions.js';

/** Native integrations enter this registry only after their acceptance gates pass. */
export const builtInIntegrationDefinitions: readonly IntegrationDefinition[] = [];

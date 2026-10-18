import type { MCPServerParams } from '@src/core/types/index.js';
import type { ConfigBackupPolicy, ConfigChangeResult } from '@src/domains/config-change/configChange.js';

export interface KnownServerSetupSource {
  type: 'known';
  exampleId: string;
  localName?: string;
  executable?: string;
  checkout?: string;
}

export interface KnownServerSetupInput {
  mode: 'preview' | 'apply';
  source: KnownServerSetupSource;
  force?: boolean;
  backup?: ConfigBackupPolicy;
  expectedSetupFingerprint?: string;
}

export interface KnownServerSetupResult {
  status:
    | 'preview'
    | 'applied'
    | 'unchanged'
    | 'exists'
    | 'template_conflict'
    | 'setup_conflict'
    | 'invalid_input'
    | 'not_found'
    | 'failed';
  mode: 'preview' | 'apply';
  sourceType: 'known';
  setupFingerprint?: string;
  exampleId?: string;
  targetSource?: 'mcpServers' | 'mcpTemplates';
  targetName?: string;
  config?: MCPServerParams;
  metadata?: { localName: string };
  configChange?: ConfigChangeResult;
  warnings: string[];
  fieldErrors?: Record<string, string[]>;
  error?: string;
}

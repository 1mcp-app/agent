import type { CommandName } from '@src/productTelemetry/producer.js';

/** Closed semantic groupings; unknown argv is never exported as a dimension. */
export function productCommandFamily(root: unknown): CommandName | undefined {
  switch (root) {
    case 'admin':
    case 'auth':
      return 'auth';
    case 'app':
    case 'cli-setup':
    case 'target':
      return 'config';
    case 'bootstrap':
    case 'project':
      return 'project';
    case 'registry':
    case 'mcp':
      return 'mcp';
    case 'preset':
    case 'instructions':
    case 'inspect':
    case 'run':
    case 'wait':
      return root;
    default:
      return undefined;
  }
}

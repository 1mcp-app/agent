/**
 * @deprecated This file has been replaced by ./index.ts
 *
 * For backward compatibility, this file re-exports everything from the new index.ts.
 * Please update your imports to use './index.js' instead of './toolHandlers.js'.
 *
 * Migration:
 * OLD: import { handleMcpSearch } from './toolHandlers.js';
 * NEW: import { handleMcpSearch } from './index.js';
 *
 * This file will be removed in a future version.
 */

// Re-export everything from the new index for backward compatibility
export * from './index.js';

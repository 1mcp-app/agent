import { ownData } from '@src/observability/privacy/fields.js';

import type { OperationName } from './producer.js';

export type ProductClientFamily = 'claude' | 'codex' | 'cursor' | 'vscode' | 'other';
export type ProductTransport = 'none' | 'stdio' | 'http' | 'sse';

/** Exact finite aliases only. Never stringify arbitrary client data or invoke getters. */
export function productClientFamily(info: unknown): ProductClientFamily {
  switch (ownData(info, 'name')) {
    case 'claude':
    case 'claude-ai':
    case 'claude-code':
      return 'claude';
    case 'codex':
    case 'codex-mcp-client':
      return 'codex';
    case 'cursor':
      return 'cursor';
    case 'vscode':
    case 'Visual Studio Code':
      return 'vscode';
    default:
      return 'other';
  }
}

export function productOperationName(method: unknown): OperationName {
  switch (method) {
    case 'tools/list':
      return 'tools_list';
    case 'tools/call':
      return 'tools_call';
    case 'resources/list':
      return 'resources_list';
    case 'resources/read':
      return 'resources_read';
    case 'prompts/list':
      return 'prompts_list';
    case 'prompts/get':
      return 'prompts_get';
    case 'completion/complete':
      return 'completion';
    case 'initialize':
      return 'initialize';
    default:
      return 'other';
  }
}

/** Only terminal protocol/error flags determine this coarse outcome. */
export function productOperationOutcome(response: unknown): 'success' | 'failure' {
  if (ownData(response, 'error') !== undefined) return 'failure';
  if (ownData(ownData(response, 'result'), 'isError') === true) return 'failure';
  return 'success';
}

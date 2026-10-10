import { AsyncLocalStorage } from 'node:async_hooks';

import type { ContextData } from '@src/types/context.js';

const projectBindingScope = new AsyncLocalStorage<{ bindingId: string; context?: ContextData }>();

export function withProjectBinding<T>(bindingId: string, context: ContextData | undefined, action: () => T): T {
  return projectBindingScope.run({ bindingId, context }, action);
}

export function getProjectBinding(): { bindingId: string; context?: ContextData } | undefined {
  return projectBindingScope.getStore();
}

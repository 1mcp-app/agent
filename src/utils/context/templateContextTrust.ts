import type { ContextData } from '@src/types/context.js';

declare const trustedTemplateContextBrand: unique symbol;

/**
 * A context that may be used to render template server process settings.
 *
 * This capability is intentionally process-local: HTTP payloads cannot create
 * it, and serialization drops its runtime trust record.
 */
export type TrustedTemplateContext = ContextData & {
  readonly [trustedTemplateContextBrand]: true;
};

const trustedTemplateContexts = new WeakSet<object>();

/**
 * Mark a server-owned context as safe for template rendering.
 *
 * Callers must establish trust before invoking this function. In particular,
 * never call it with HTTP request data.
 */
export function createTrustedTemplateContext(context: ContextData): TrustedTemplateContext {
  const trustedContext = { ...context } as TrustedTemplateContext;
  trustedTemplateContexts.add(trustedContext);
  return trustedContext;
}

export function isTrustedTemplateContext(context: unknown): context is TrustedTemplateContext {
  return typeof context === 'object' && context !== null && trustedTemplateContexts.has(context);
}

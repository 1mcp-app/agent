import { getRuntimeScopeEnvironment } from '@src/config/runtimeScopeEnv.js';

/** Apply the active Runtime Scope's exact-value secret boundary to local diagnostic text. */
export function redactRuntimeScopeDiagnosticText(text: string): string {
  try {
    const secrets = [...new Set(Object.values(getRuntimeScopeEnvironment()).filter((value) => value.length > 0))].sort(
      (left, right) => right.length - left.length,
    );
    return secrets.reduce((value, secret) => value.split(secret).join('[REDACTED]'), text);
  } catch {
    return '[OMITTED: Runtime Scope redaction unavailable]';
  }
}

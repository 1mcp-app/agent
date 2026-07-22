import { McpConnectionHelper } from '@src/commands/shared/connectionHelper.js';

import type { ConfiguredServerConnectivityChecker } from './adminConfiguredServerService.js';

export interface AdminConnectivityCheckerOptions {
  timeoutMs?: number;
  now?: () => Date;
}

export function createAdminConnectivityChecker(
  options: AdminConnectivityCheckerOptions = {},
): ConfiguredServerConnectivityChecker {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? (() => new Date());

  return async ({ targetName, serverConfig }) => {
    const helper = new McpConnectionHelper();
    try {
      const [result] = await helper.connectToServers({ [targetName]: serverConfig }, timeoutMs);
      if (result?.connected) {
        return {
          status: 'passed',
          mode: 'bounded_dry_run',
          checkedAt: now().toISOString(),
        };
      }

      return {
        status: 'failed',
        mode: 'bounded_dry_run',
        message: sanitizeConnectivityMessage(result?.error ?? 'Connectivity check failed.'),
      };
    } catch (error) {
      return {
        status: 'failed',
        mode: 'bounded_dry_run',
        message: sanitizeConnectivityMessage(error instanceof Error ? error.message : String(error)),
      };
    } finally {
      await helper.cleanup().catch(() => undefined);
    }
  };
}

function sanitizeConnectivityMessage(message: string): string {
  return message
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^@/?#]+@/giu, '$1[REDACTED]@')
    .replace(/\b(authorization)\b(\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s"',;]+/giu, '$1$2[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[^\s"',;]+/giu, '$1 [REDACTED]')
    .replace(/([?&][^=\s"',;]*(?:token|secret|password|auth|key|credential)[^=\s"',;]*=)[^&\s"',;]+/giu, '$1[REDACTED]')
    .replace(
      /\b(api[_-]?key|access[_-]?token|token|password|secret|authorization|credential|client[_-]?secret|clientSecret|private[_-]?key|privateKey)\b(\s*[:=]\s*)[^\s"',;]+/giu,
      '$1$2[REDACTED]',
    );
}

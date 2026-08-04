import { isIP } from 'node:net';

import type { TemplateContextTrustMode } from '@src/core/context/templateContextTrust.js';

interface ResolveTemplateContextTrustInput {
  cliTrust?: TemplateContextTrustMode;
  configTrust?: TemplateContextTrustMode;
  host: string;
  confirmUntrusted: boolean;
  transport: string;
}

export function resolveTemplateContextTrust(input: ResolveTemplateContextTrustInput): TemplateContextTrustMode {
  const trust = input.cliTrust ?? input.configTrust ?? 'verified';

  if (
    trust === 'legacy' &&
    input.transport !== 'stdio' &&
    !isLoopbackHost(input.host) &&
    !input.confirmUntrusted
  ) {
    throw new Error(
      'Template context trust mode "legacy" on a non-loopback host requires ' +
        '--confirm-untrusted-template-context because remote clients can control template command, args, cwd, and env',
    );
  }

  return trust;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }
  if (normalized === '::1') {
    return true;
  }
  return isIP(normalized) === 4 && normalized.startsWith('127.');
}

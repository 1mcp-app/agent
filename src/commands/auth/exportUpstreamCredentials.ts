import { exportOAuthCredentialDomains, type ExportOAuthCredentialsOptions } from './exportOAuthCredentials.js';

export type ExportUpstreamCredentialsOptions = ExportOAuthCredentialsOptions;

/** Preserve the upstream-only scope of the existing command. */
export async function exportUpstreamCredentialsCommand(options: ExportUpstreamCredentialsOptions): Promise<void> {
  await exportOAuthCredentialDomains(options, ['upstream']);
}

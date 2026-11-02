import { secureNewPrivateEntry, verifyPrivateDirectory } from '@src/utils/security/privateFileSystem.js';

/** Verify before opening state; only this call's newly created empty root may be initialized. */
export function verifyInstallationPrivacy(
  root: string,
  options: { background?: boolean; created?: boolean } = {},
): Promise<void> {
  return verifyPrivateDirectory(root, { ...options, label: 'Product telemetry' });
}

/** Called immediately after exclusive creation, while empty, before writing any product/owner data. */
export function secureNewInstallationEntry(file: string, directory: boolean, background = false): Promise<void> {
  return secureNewPrivateEntry(file, directory, { background, label: 'Product telemetry' });
}

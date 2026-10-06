import { AUTH_CONFIG } from '@src/constants.js';

import {
  activateProtectedRecordStore,
  getProtectedRecordStoreReadiness,
  ProtectedRecordStorage,
  ProtectedRecordStorageError,
  type ProtectedRecordStorageOptions,
  type ProtectedRecordStoreMode,
} from './protectedRecordStorage.js';

export type UpstreamOAuthStoreMode = ProtectedRecordStoreMode;
export type UpstreamOAuthStorageOptions = Omit<ProtectedRecordStorageOptions, 'layout'>;
export { ProtectedRecordStorageError as UpstreamOAuthStorageError };
const layout = {
  domain: 'upstream-oauth',
  subDir: AUTH_CONFIG.CLIENT.SESSION.SUBDIR,
  legacySubDir: 'clientSessions',
  prefixes: [AUTH_CONFIG.CLIENT.SESSION.FILE_PREFIX],
};

/** Preserves upstream authority/generation repository contracts and native key namespaces. */
export class UpstreamOAuthStorage extends ProtectedRecordStorage {
  constructor(options: UpstreamOAuthStorageOptions) {
    super({ ...options, layout });
  }
}
export async function activateUpstreamOAuthStore(options: UpstreamOAuthStorageOptions): Promise<void> {
  await activateProtectedRecordStore({ ...options, layout });
}
export function createUpstreamOAuthStorage(options: UpstreamOAuthStorageOptions): UpstreamOAuthStorage {
  return new UpstreamOAuthStorage(options);
}

export function getUpstreamOAuthStoreReadiness(options: UpstreamOAuthStorageOptions): {
  mode: 'file' | 'native';
  ready: boolean;
} {
  return getProtectedRecordStoreReadiness({ ...options, layout });
}

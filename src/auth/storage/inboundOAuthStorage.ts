import { AUTH_CONFIG, FILE_PREFIX_MAPPING } from '@src/constants.js';

import {
  activateProtectedRecordStore,
  getProtectedRecordStoreReadiness,
  ProtectedRecordStorage,
  type ProtectedRecordStorageOptions,
} from './protectedRecordStorage.js';

export { ProtectedRecordStorageError as InboundOAuthStorageError } from './protectedRecordStorage.js';
export type InboundOAuthStorageOptions = Omit<ProtectedRecordStorageOptions, 'layout'>;
const layout = {
  domain: 'inbound-oauth',
  subDir: AUTH_CONFIG.SERVER.SESSION.SUBDIR,
  legacySubDir: AUTH_CONFIG.SERVER.STORAGE.DIR,
  prefixes: FILE_PREFIX_MAPPING.SERVER,
  opaqueFileNames: true,
  synchronousWrites: true,
  manageExpiration: true,
};

/** Inbound identities stay separate from upstream authority slots and independent Admin storage. */
export class InboundOAuthStorage extends ProtectedRecordStorage {
  constructor(options: InboundOAuthStorageOptions) {
    super({ ...options, layout });
    this.initializeFileMode();
  }
}
export async function activateInboundOAuthStore(options: InboundOAuthStorageOptions): Promise<void> {
  await activateProtectedRecordStore({ ...options, layout });
}
export function createInboundOAuthStorage(options: InboundOAuthStorageOptions): InboundOAuthStorage {
  return new InboundOAuthStorage(options);
}

export function getInboundOAuthStoreReadiness(options: InboundOAuthStorageOptions): {
  mode: 'file' | 'native';
  ready: boolean;
} {
  return getProtectedRecordStoreReadiness({ ...options, layout });
}

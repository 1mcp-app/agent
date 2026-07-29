import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { AUTH_CONFIG } from '../../../build/constants.js';
import { FileStorageService } from '../../../build/auth/storage/fileStorageService.js';
import { RefreshTokenFamilyRepository } from '../../../build/auth/storage/refreshTokenFamilyRepository.js';
import { SessionRepository } from '../../../build/auth/storage/sessionRepository.js';

const [storageDir, runtimeScopeId, refreshToken, clientId, markerPath, releasePath] = process.argv.slice(2);
const storage = new FileStorageService(storageDir, AUTH_CONFIG.SERVER.SESSION.SUBDIR);
const sessions = new SessionRepository(storage);
const repository = new RefreshTokenFamilyRepository(storage, runtimeScopeId);
const accessTokenId = randomUUID();

try {
  const result = await repository.consume(refreshToken, clientId, accessTokenId, (familyId) => {
    fs.writeFileSync(markerPath, String(process.pid));
    if (releasePath) {
      const deadline = Date.now() + 10_000;
      while (!fs.existsSync(releasePath) && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      if (!fs.existsSync(releasePath)) {
        throw new Error('Timed out waiting for transition release');
      }
    }
    sessions.createWithId(accessTokenId, clientId, 'https://resource.example/mcp', ['tag:alpha'], 60_000, familyId);
  });
  process.stdout.write(`RESULT ${JSON.stringify({ status: result.status })}\n`);
} catch (error) {
  process.stdout.write(
    `RESULT ${JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
} finally {
  storage.shutdown();
}

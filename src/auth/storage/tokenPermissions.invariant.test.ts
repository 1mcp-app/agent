import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { ExpirableData } from '@src/auth/sessionTypes.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileStorageService, InsecureFilePermissionsError } from './fileStorageService.js';

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

interface TestData extends ExpirableData {
  id: string;
  value: string;
  expires: number;
  createdAt: number;
}

const isPosix = process.platform !== 'win32';

describe('token/storage permission invariants (POSIX-only, AUTH-07 gate)', () => {
  let service: FileStorageService;
  let tempDir: string;
  const filePrefix = 'test_';
  const testId = 'sess-12345678-1234-4abc-89de-123456789012';
  const testData: TestData = {
    id: testId,
    value: 'secret-value',
    expires: Date.now() + 60000,
    createdAt: Date.now(),
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(tmpdir(), 'perm-invariant-test-'));
    service = new FileStorageService(tempDir);
  });

  afterEach(() => {
    service.shutdown();
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it.skipIf(!isPosix)('every write path lands 0600 and the storage dir is 0700', () => {
    expect(fs.statSync(service.getStorageDir()).mode & 0o777).toBe(0o700);

    service.writeData(filePrefix, testId, testData);
    expect(fs.statSync(service.getFilePath(filePrefix, testId)).mode & 0o777).toBe(0o600);

    const durableId = 'sess-abcdefab-1234-4abc-89de-123456789012';
    service.writeDataDurable(filePrefix, durableId, { ...testData, id: durableId });
    expect(fs.statSync(service.getFilePath(filePrefix, durableId)).mode & 0o777).toBe(0o600);
  });

  it.skipIf(!isPosix)('fails closed when writeData hits a chmod failure on a permissive file', () => {
    const filePath = service.getFilePath(filePrefix, testId);
    fs.writeFileSync(filePath, JSON.stringify({ ...testData, value: 'old-secret' }), { mode: 0o644 });

    const originalChmodSync = fs.chmodSync;
    vi.spyOn(fs, 'chmodSync').mockImplementation((pathArg, modeArg) => {
      if (pathArg === filePath) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      }
      return originalChmodSync(pathArg, modeArg);
    });

    expect(() => service.writeData(filePrefix, testId, { ...testData, value: 'new-secret' })).toThrow(/EPERM/);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).value).toBe('old-secret');
  });

  it('fails closed when storage directory creation is denied (EACCES)', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    expect(() => new FileStorageService(tempDir)).toThrow(/EACCES/);
  });

  describe('read-side strictModes (POSIX-only)', () => {
    it.skipIf(!isPosix)('self-heals a legacy 0644 credential file to 0600 on read', () => {
      service.writeData(filePrefix, testId, testData);
      const filePath = service.getFilePath(filePrefix, testId);
      fs.chmodSync(filePath, 0o644);

      expect(service.readData<TestData>(filePrefix, testId)).toEqual(testData);
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    });

    it.skipIf(!isPosix)('fails closed when the self-heal chmod is denied (EPERM)', () => {
      service.writeData(filePrefix, testId, testData);
      const filePath = service.getFilePath(filePrefix, testId);
      fs.chmodSync(filePath, 0o644);

      vi.spyOn(fs, 'fchmodSync').mockImplementation(() => {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      });

      expect(() => service.readData<TestData>(filePrefix, testId)).toThrow(InsecureFilePermissionsError);
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o644);
    });

    it.skipIf(!isPosix)('self-heals a group/other-readable storage directory on read', () => {
      service.writeData(filePrefix, testId, testData);
      fs.chmodSync(service.getStorageDir(), 0o755);

      expect(service.readData<TestData>(filePrefix, testId)).toEqual(testData);
      expect(fs.statSync(service.getStorageDir()).mode & 0o777).toBe(0o700);
    });

    it.skipIf(!isPosix)('readData accepts an owner-only file', () => {
      service.writeData(filePrefix, testId, testData);
      expect(service.readData<TestData>(filePrefix, testId)).toEqual(testData);
    });
  });
});

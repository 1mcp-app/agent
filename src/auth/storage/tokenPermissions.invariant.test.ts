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

  it('every write path lands 0600 and the storage dir is 0700', () => {
    if (!isPosix) {
      return;
    }
    expect(fs.statSync(service.getStorageDir()).mode & 0o777).toBe(0o700);

    service.writeData(filePrefix, testId, testData);
    expect(fs.statSync(service.getFilePath(filePrefix, testId)).mode & 0o777).toBe(0o600);

    const durableId = 'sess-abcdefab-1234-4abc-89de-123456789012';
    service.writeDataDurable(filePrefix, durableId, { ...testData, id: durableId });
    expect(fs.statSync(service.getFilePath(filePrefix, durableId)).mode & 0o777).toBe(0o600);
  });

  it('fails closed when writeData hits a chmod failure on a permissive file', () => {
    if (!isPosix) {
      return;
    }
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

  it('read-side strictModes: readData refuses a group/other-readable credential file', () => {
    if (!isPosix) {
      return;
    }
    service.writeData(filePrefix, testId, testData);
    const filePath = service.getFilePath(filePrefix, testId);
    fs.chmodSync(filePath, 0o644);

    expect(() => service.readData<TestData>(filePrefix, testId)).toThrow(InsecureFilePermissionsError);
    expect(() => service.readData<TestData>(filePrefix, testId)).toThrow(/too open/);
  });

  it('read-side strictModes: readData accepts an owner-only file', () => {
    if (!isPosix) {
      return;
    }
    service.writeData(filePrefix, testId, testData);
    expect(service.readData<TestData>(filePrefix, testId)).toEqual(testData);
  });
});

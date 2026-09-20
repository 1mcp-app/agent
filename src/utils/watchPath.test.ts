import fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { resolveWatchPath } from './watchPath.js';

describe('native Windows watch paths', () => {
  it('expands short directory names before registering a watcher', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const native = vi.spyOn(fs.realpathSync, 'native').mockReturnValue('C:\\Users\\runneradmin\\config');
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(resolveWatchPath('C:\\Users\\RUNNER~1\\config')).toBe('C:\\Users\\runneradmin\\config');
      expect(native).toHaveBeenCalledWith('C:\\Users\\RUNNER~1\\config');
    } finally {
      Object.defineProperty(process, 'platform', platform);
      native.mockRestore();
    }
  });

  it('preserves non-Windows watch behavior', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const native = vi.spyOn(fs.realpathSync, 'native');
    try {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(resolveWatchPath('/selected/config')).toBe('/selected/config');
      expect(native).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', platform);
      native.mockRestore();
    }
  });
});

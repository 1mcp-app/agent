import fs from 'node:fs';

/** libuv's Windows watcher compares long event paths against the registered directory (libuv#5010). */
export function resolveWatchPath(target: string): string {
  // The JS realpath implementation can preserve 8.3 components; the native implementation expands them.
  return process.platform === 'win32' ? fs.realpathSync.native(target) : target;
}

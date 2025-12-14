/**
 * Keyboard navigation and input handling utilities for the wizard
 */

/**
 * Cleanup stdin resources
 */
export function cleanup(): void {
  // Ensure stdin is properly cleaned up
  const stdin = process.stdin;

  try {
    // Remove all listeners to prevent leaks
    stdin.removeAllListeners('data');
    stdin.removeAllListeners('keypress');
    stdin.removeAllListeners('readable');
    stdin.removeAllListeners('end');

    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(false);
    }

    // Pause stdin
    stdin.pause();

    // Destroy any pipes
    if (stdin.unpipe) {
      stdin.unpipe();
    }

    // Unref to allow process to exit even if stdin has pending operations
    if (stdin.unref) {
      stdin.unref();
    }
  } catch {
    // Ignore errors during cleanup - best effort
  }
}

/**
 * Get single key input for navigation
 */
export async function getKeyInput(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    // Ensure stdin is in the right mode
    if (!stdin.isTTY) {
      resolve('escape');
      return;
    }

    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
    } catch (_error) {
      resolve('escape');
      return;
    }

    const onKeypress = (key: string | Buffer): void => {
      try {
        if (stdin.isTTY) {
          stdin.setRawMode(false);
        }
        stdin.pause();
        stdin.removeListener('data', onKeypress);
      } catch {
        // Ignore cleanup errors
      }

      let keyStr: string;
      if (Buffer.isBuffer(key)) {
        keyStr = key.toString('utf8');
      } else if (typeof key === 'string') {
        keyStr = key;
      } else {
        keyStr = '';
      }

      // Handle escape sequences for arrow keys
      if (keyStr === '\u001b[A') resolve('up');
      else if (keyStr === '\u001b[B') resolve('down');
      else if (keyStr === '\u001b[D') resolve('left');
      else if (keyStr === '\u001b[C') resolve('right');
      else if (keyStr === ' ') resolve('space');
      else if (keyStr === '\r' || keyStr === '\n') resolve('enter');
      else if (keyStr === '\u001b' || keyStr === '\u0003') {
        // ESC or Ctrl+C - ensure cleanup before resolving
        cleanup();
        resolve('escape');
      } else resolve('unknown');
    };

    stdin.on('data', onKeypress);
  });
}

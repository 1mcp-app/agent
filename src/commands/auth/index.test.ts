import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupAuthCommands } from './index.js';

const { authLoginCommandMock, authStatusCommandMock, authLogoutCommandMock } = vi.hoisted(() => ({
  authLoginCommandMock: vi.fn(),
  authStatusCommandMock: vi.fn(),
  authLogoutCommandMock: vi.fn(),
}));

vi.mock('./login.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./login.js')>();
  return {
    ...actual,
    authLoginCommand: authLoginCommandMock,
  };
});

vi.mock('./status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./status.js')>();
  return {
    ...actual,
    authStatusCommand: authStatusCommandMock,
  };
});

vi.mock('./logout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./logout.js')>();
  return {
    ...actual,
    authLogoutCommand: authLogoutCommandMock,
  };
});

describe('setupAuthCommands', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers context selectors for auth credential commands while preserving url for command-layer rejection', async () => {
    const parser = setupAuthCommands(yargs([]).exitProcess(false).help(false).version(false));

    await parser.parseAsync([
      'auth',
      'login',
      '--context',
      'prod',
      '--token',
      'tk',
      '--url',
      'https://bad.example.com',
    ]);
    await parser.parseAsync(['auth', 'status', '--context', 'prod']);
    await parser.parseAsync(['auth', 'logout', '--context', 'local', '--all-local']);

    expect(authLoginCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'prod',
        token: 'tk',
        url: 'https://bad.example.com',
      }),
    );
    expect(authStatusCommandMock).toHaveBeenCalledWith(expect.objectContaining({ context: 'prod' }));
    expect(authLogoutCommandMock).toHaveBeenCalledWith(expect.objectContaining({ context: 'local', allLocal: true }));
  });
});

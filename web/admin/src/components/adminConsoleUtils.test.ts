import type { OAuthServiceStatus } from '../api/adminApi';
import { isOAuthAttention } from './adminConsoleUtils';

describe('adminConsoleUtils', () => {
  it.each([
    [{ name: 'healthy-oauth', requiresOAuth: true, status: 'connected' }, false],
    [{ name: 'waiting-oauth', requiresOAuth: true, status: 'awaiting_oauth' }, true],
    [{ name: 'failed-oauth', requiresOAuth: true, status: 'connected', lastError: 'token expired' }, true],
    [{ name: 'healthy-public', requiresOAuth: false, status: 'connected' }, false],
    [{ name: 'failed-public', requiresOAuth: false, status: 'error', lastError: 'unavailable' }, false],
  ] satisfies [OAuthServiceStatus, boolean][])('classifies OAuth attention for %s', (service, expected) => {
    expect(isOAuthAttention(service)).toBe(expected);
  });
});

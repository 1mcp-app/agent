import type { OAuthServiceStatus } from '../api/adminApi';
import { isOAuthAttention } from './adminConsoleUtils';

describe('adminConsoleUtils', () => {
  it.each([
    [
      {
        name: 'healthy-oauth',
        id: 'healthy-oauth',
        displayName: 'healthy-oauth',
        requiresOAuth: true,
        status: 'connected',
      },
      false,
    ],
    [
      {
        name: 'waiting-oauth',
        id: 'waiting-oauth',
        displayName: 'waiting-oauth',
        requiresOAuth: true,
        status: 'awaiting_oauth',
      },
      true,
    ],
    [
      {
        name: 'failed-oauth',
        id: 'failed-oauth',
        displayName: 'failed-oauth',
        requiresOAuth: true,
        status: 'connected',
        lastError: 'token expired',
      },
      true,
    ],
    [
      {
        name: 'healthy-public',
        id: 'healthy-public',
        displayName: 'healthy-public',
        requiresOAuth: false,
        status: 'connected',
      },
      false,
    ],
    [
      {
        name: 'failed-public',
        id: 'failed-public',
        displayName: 'failed-public',
        requiresOAuth: false,
        status: 'error',
        lastError: 'unavailable',
      },
      false,
    ],
  ] satisfies [OAuthServiceStatus, boolean][])('classifies OAuth attention for %s', (service, expected) => {
    expect(isOAuthAttention(service)).toBe(expected);
  });
});

import type { AdminConsoleState } from './adminConsoleState';

export const POLL_INTERVAL_VISIBLE_MS = 5000;
export const POLL_INTERVAL_HIDDEN_MS = 60000;

export function pollingDelayForVisibility(visibilityState: string): number {
  return visibilityState === 'visible' ? POLL_INTERVAL_VISIBLE_MS : POLL_INTERVAL_HIDDEN_MS;
}

export function shouldPollConsole(state: AdminConsoleState): boolean {
  return state.view === 'console' && Boolean(state.session?.csrfToken);
}

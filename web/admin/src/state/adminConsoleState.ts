import type { AdminSession, AdminStatus, ConfiguredServerReadModel, UnauthenticatedSession } from '../api/adminApi';

export type AdminConsoleView = 'loading' | 'setupRequired' | 'login' | 'console';
export type ServerMutationState = 'busy' | 'succeeded' | 'failed';

export interface ServerMutation {
  state: ServerMutationState;
  action?: 'enable' | 'disable';
  message?: string;
}

export interface AdminConsoleState {
  view: AdminConsoleView;
  session: AdminSession | null;
  status: AdminStatus | null;
  configuredServers: ConfiguredServerReadModel[];
  serverMutations: Record<string, ServerMutation>;
  banner: { kind: 'success' | 'error'; message: string } | null;
  error: string | null;
  lastUpdatedAt: string | null;
}

export type AdminConsoleAction =
  | { type: 'sessionLoaded'; session: AdminSession }
  | { type: 'sessionUnauthenticated'; adminStatus: NonNullable<UnauthenticatedSession['adminStatus']> }
  | { type: 'refreshSucceeded'; status: AdminStatus; configuredServers: ConfiguredServerReadModel[]; updatedAt: string }
  | { type: 'refreshFailed'; message: string }
  | { type: 'loginFailed'; message: string }
  | { type: 'logoutSucceeded' }
  | { type: 'mutationStarted'; serverId: string; action: 'enable' | 'disable' }
  | { type: 'mutationSucceeded'; serverId: string; action: 'enable' | 'disable' }
  | { type: 'mutationFailed'; serverId: string; action: 'enable' | 'disable'; message: string }
  | { type: 'clearBanner' };

export function createInitialState(): AdminConsoleState {
  return {
    view: 'loading',
    session: null,
    status: null,
    configuredServers: [],
    serverMutations: {},
    banner: null,
    error: null,
    lastUpdatedAt: null,
  };
}

export function reduceAdminConsoleState(state: AdminConsoleState, action: AdminConsoleAction): AdminConsoleState {
  switch (action.type) {
    case 'sessionLoaded':
      return {
        ...state,
        view: 'console',
        session: action.session,
        banner: null,
        error: null,
      };
    case 'sessionUnauthenticated':
      return {
        ...createInitialState(),
        view: action.adminStatus === 'setupRequired' ? 'setupRequired' : 'login',
        session: null,
      };
    case 'refreshSucceeded':
      return {
        ...state,
        view: 'console',
        status: action.status,
        configuredServers: action.configuredServers,
        lastUpdatedAt: action.updatedAt,
        banner: state.banner?.kind === 'error' ? null : state.banner,
        error: null,
      };
    case 'refreshFailed':
    case 'loginFailed':
      return {
        ...state,
        error: action.message,
        banner: { kind: 'error', message: action.message },
      };
    case 'logoutSucceeded':
      return {
        ...createInitialState(),
        view: 'login',
      };
    case 'mutationStarted':
      return withServerMutation(state, action.serverId, {
        state: 'busy',
        action: action.action,
      });
    case 'mutationSucceeded':
      return withServerMutation(state, action.serverId, {
        state: 'succeeded',
        action: action.action,
        message: `Server ${action.action} completed.`,
      });
    case 'mutationFailed':
      return withServerMutation(state, action.serverId, {
        state: 'failed',
        action: action.action,
        message: action.message,
      });
    case 'clearBanner':
      return { ...state, banner: null, error: null };
  }
}

function withServerMutation(state: AdminConsoleState, serverId: string, mutation: ServerMutation): AdminConsoleState {
  return {
    ...state,
    serverMutations: {
      ...state.serverMutations,
      [serverId]: mutation,
    },
    banner:
      mutation.state === 'succeeded' || mutation.state === 'failed'
        ? { kind: mutation.state === 'succeeded' ? 'success' : 'error', message: mutation.message ?? '' }
        : state.banner,
  };
}

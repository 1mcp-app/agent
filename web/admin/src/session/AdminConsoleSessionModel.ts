import type { AdminPresetDraft, AdminPresetListItem, AdminPresetPreview, AdminPresetTarget } from '../api/adminApi';
import type { ConfiguredServerEditModel } from '../configuredServerEdit/useConfiguredServerEdit';
import type { AdminConsoleState } from '../state/adminConsoleState';

export type AdminConsoleRoute = 'dashboard' | 'servers' | 'oauth' | 'audit' | 'presets' | 'about';
export type OAuthAdminAction = 'authorize' | 'restart';
export interface OAuthFeedback {
  kind: 'success' | 'error';
  message: string;
}

export interface AdminConsoleSessionModel {
  state: AdminConsoleState;
  loginBusy: boolean;
  login(input: { username: string; password: string }): void | Promise<void>;
  logout(): void | Promise<void>;
  refresh(): void | Promise<void>;
  navigation: {
    route: AdminConsoleRoute;
    navigate(route: AdminConsoleRoute): void | Promise<void>;
  };
  configuredServers: {
    edit: ConfiguredServerEditModel;
    mutate(serverId: string, action: 'enable' | 'disable'): void | Promise<void>;
    copy(label: string, value: string): void | Promise<void>;
  };
  oauth: {
    busy: { serviceId: string; action: OAuthAdminAction } | null;
    callbackFeedback: OAuthFeedback | null;
    operationFeedback: OAuthFeedback | null;
    operate(serviceId: string, action: OAuthAdminAction): void | Promise<void>;
  };
  presets: {
    items: AdminPresetListItem[];
    targets: AdminPresetTarget[];
    revision: string;
    busy: boolean;
    load(): void | Promise<void>;
    preview(draft: AdminPresetDraft, sourceName?: string): Promise<AdminPresetPreview>;
    save(input: {
      action: 'create' | 'update' | 'duplicate';
      sourceName?: string;
      preview: AdminPresetPreview;
    }): boolean | Promise<boolean>;
    delete(name: string): void | Promise<void>;
  };
}

export type OperatorWorkspaceModel = Pick<AdminConsoleSessionModel, 'state' | 'logout' | 'refresh'> & {
  configuredServers: AdminConsoleSessionModel['configuredServers'];
};

export type PresetAuthoringModel = AdminConsoleSessionModel['presets'];

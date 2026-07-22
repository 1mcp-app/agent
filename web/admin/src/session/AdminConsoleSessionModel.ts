import type { AdminPresetDraft, AdminPresetListItem, AdminPresetPreview, AdminPresetTarget } from '../api/adminApi';
import type { ConfiguredServerEditModel } from '../configuredServerEdit/useConfiguredServerEdit';
import type { AdminConsoleState } from '../state/adminConsoleState';

export interface AdminConsoleSessionModel {
  state: AdminConsoleState;
  loginBusy: boolean;
  login(input: { username: string; password: string }): void | Promise<void>;
  logout(): void | Promise<void>;
  refresh(): void | Promise<void>;
  navigation: {
    route: 'overview' | 'presets' | 'about';
    section: 'inventory' | 'oauth' | 'audit' | null;
    navigate(
      route: 'overview' | 'presets' | 'about',
      section?: 'inventory' | 'oauth' | 'audit' | null,
    ): void | Promise<void>;
  };
  configuredServers: {
    edit: ConfiguredServerEditModel;
    mutate(serverId: string, action: 'enable' | 'disable'): void | Promise<void>;
    copy(label: string, value: string): void | Promise<void>;
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

export type RuntimeOperationsModel = Pick<AdminConsoleSessionModel, 'state' | 'logout' | 'refresh'> & {
  configuredServers: AdminConsoleSessionModel['configuredServers'];
};

export type PresetAuthoringModel = AdminConsoleSessionModel['presets'];

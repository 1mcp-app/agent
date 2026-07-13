import type {
  AdminPresetDraft,
  AdminPresetListItem,
  AdminPresetPreview,
  AdminPresetTarget,
  ConfiguredServerEditDraft,
} from '../api/adminApi';
import type { ConfiguredServerEditorState } from '../components/configuredServerEditor';
import type { AdminConsoleState } from '../state/adminConsoleState';

export interface AdminConsoleSessionModel {
  state: AdminConsoleState;
  loginBusy: boolean;
  login(input: { username: string; password: string }): void | Promise<void>;
  logout(): void | Promise<void>;
  refresh(): void | Promise<void>;
  navigation: {
    route: 'overview' | 'presets' | 'about';
    navigate(route: 'overview' | 'presets' | 'about'): void;
  };
  configuredServers: {
    editor: ConfiguredServerEditorState;
    mutate(serverId: string, action: 'enable' | 'disable'): void | Promise<void>;
    open(serverId: string): void | Promise<void>;
    close(dirty?: boolean): void | Promise<void>;
    setDirty(dirty: boolean): void;
    preview(
      serverId: string,
      edit: ConfiguredServerEditDraft,
      connectivityCheck?: 'auto' | 'manual',
    ): void | Promise<void>;
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
    }): void | Promise<void>;
    delete(name: string): void | Promise<void>;
  };
}

export type RuntimeOperationsModel = Pick<AdminConsoleSessionModel, 'state' | 'logout' | 'refresh'> & {
  configuredServers: AdminConsoleSessionModel['configuredServers'];
};

export type PresetAuthoringModel = AdminConsoleSessionModel['presets'];

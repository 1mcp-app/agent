import type {
  AdminPresetDraft,
  AdminPresetListItem,
  AdminPresetPreview,
  AdminPresetTarget,
  ConfiguredServerDeleteResponse,
} from '../api/adminApi';
import type { ConfiguredServerCreateModel } from '../configuredServerCreate/useConfiguredServerCreate';
import type { ConfiguredServerDeleteModel } from '../configuredServerDelete/useConfiguredServerDelete';
import type { ConfiguredServerEditModel } from '../configuredServerEdit/useConfiguredServerEdit';
import type { InstructionTemplatesModel } from '../instructionTemplates/useInstructionTemplates';
import type { AdminConsoleState } from '../state/adminConsoleState';
import type { BackendLogsModel } from './useBackendLogs';

export type AdminConsoleRoute =
  'dashboard' | 'servers' | 'oauth' | 'audit' | 'presets' | 'instructions' | 'logs' | 'about';
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
    create: ConfiguredServerCreateModel;
    edit: ConfiguredServerEditModel;
    delete: ConfiguredServerDeleteModel;
    deletionNotice: ConfiguredServerDeleteResponse['result'] | null;
    dismissDeletionNotice(): void;
    mutate(
      serverId: string,
      action: 'enable' | 'disable',
      source?: 'mcpServers' | 'mcpTemplates',
    ): void | Promise<void>;
    copy(label: string, value: string): void | Promise<void>;
  };
  oauth: {
    busy: { serviceId: string; action: OAuthAdminAction } | null;
    callbackFeedback: OAuthFeedback | null;
    operationFeedback: OAuthFeedback | null;
    operate(serviceId: string, action: OAuthAdminAction): void | Promise<void>;
  };
  logs: BackendLogsModel;
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
  instructions: InstructionTemplatesModel;
}

export type OperatorWorkspaceModel = Pick<AdminConsoleSessionModel, 'state' | 'logout' | 'refresh'> & {
  configuredServers: AdminConsoleSessionModel['configuredServers'];
};

export type PresetAuthoringModel = AdminConsoleSessionModel['presets'];

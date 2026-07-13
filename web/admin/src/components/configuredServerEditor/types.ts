import type { ConfiguredServerDetailResponse, ConfiguredServerPreviewResponse } from '../../api/adminApi';

export type ConfiguredServerEditorState =
  | { status: 'list' }
  | { status: 'loading'; serverId: string }
  | {
      status: 'loaded';
      serverId: string;
      detail: ConfiguredServerDetailResponse;
      preview?: ConfiguredServerPreviewResponse['preview'];
      previewBusy: boolean;
      previewError?: string;
    }
  | { status: 'missing'; serverId: string }
  | { status: 'failed'; serverId: string; message: string };

export type SecretDraftState = Record<
  string,
  {
    fieldPath: string[];
    action: 'preserve' | 'replace' | 'clear';
    replacementKind: 'environmentReference' | 'inlineSecret';
    replacementValue: string;
  }
>;

export type FieldDraftState = Record<string, unknown>;

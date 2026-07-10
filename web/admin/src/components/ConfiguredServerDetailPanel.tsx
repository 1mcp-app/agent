import { Alert, Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';

import { Pencil, ServerCog } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ConfiguredServerDetailResponse, ConfiguredServerPreviewResponse } from '../api/adminApi';
import type { AdminConsoleAppProps } from './AdminConsoleApp';
import { EmptyState, Panel } from './AdminConsoleShared';
import { fieldKey, transportSummaryLabel } from './adminConsoleUtils';
import { buildPreviewEdit, initialDraftValue } from './configuredServerDraft';
import { ConfiguredServerFieldDraft, editGroupHelp, SecretFieldDraft } from './ConfiguredServerEditControls';
import { PreviewResult } from './ConfiguredServerPreview';

export type ConfiguredServerDetailPanelState =
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

export function ConfiguredServerDetailPanel({
  state,
  onClose,
  onDirtyChange,
  onPreviewServerEdit,
}: {
  state: ConfiguredServerDetailPanelState;
  onClose?: AdminConsoleAppProps['onCloseServerDetail'];
  onDirtyChange?: AdminConsoleAppProps['onServerDetailDirtyChange'];
  onPreviewServerEdit?: AdminConsoleAppProps['onPreviewServerEdit'];
}) {
  const [fieldDraft, setFieldDraft] = useState<FieldDraftState>({});
  const [initialFieldDraft, setInitialFieldDraft] = useState<FieldDraftState>({});
  const [secretDraft, setSecretDraft] = useState<SecretDraftState>({});

  useEffect(() => {
    if (state.status !== 'loaded') {
      setFieldDraft({});
      setInitialFieldDraft({});
      setSecretDraft({});
      return;
    }

    const nextFields: FieldDraftState = {};
    const nextSecrets: SecretDraftState = {};
    for (const group of state.detail.editContract.fieldGroups) {
      for (const field of group.fields) {
        if (field.control === 'secret') {
          nextSecrets[fieldKey(field.fieldPath)] = {
            fieldPath: field.fieldPath,
            action: field.secret?.defaultAction ?? 'preserve',
            replacementKind:
              field.secret?.environmentReference.supported === false ? 'inlineSecret' : 'environmentReference',
            replacementValue: '',
          };
        } else {
          nextFields[fieldKey(field.fieldPath)] = initialDraftValue(field);
        }
      }
    }
    setFieldDraft(nextFields);
    setInitialFieldDraft(nextFields);
    setSecretDraft(nextSecrets);
  }, [state.status === 'loaded' ? state.serverId : state.status]);

  const previewEdit =
    state.status === 'loaded'
      ? buildPreviewEdit(state.detail.editContract.fieldGroups, fieldDraft, initialFieldDraft, secretDraft)
      : {};
  const dirty = Object.keys(previewEdit).length > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  if (state.status === 'list') {
    return (
      <Panel title="Edit server" utility="select a target" icon={<Pencil size={17} />}>
        <Stack className="edit-empty-state" gap="xs">
          <Text fw={700}>Select Edit server to change target settings.</Text>
          <Text c="dimmed" size="sm">
            Edit fields -&gt; Preview change -&gt; Review result
          </Text>
        </Stack>
      </Panel>
    );
  }

  if (state.status === 'loading') {
    return (
      <Panel title="Server detail" utility={state.serverId} icon={<ServerCog size={17} />}>
        <EmptyState message="Loading server detail." />
      </Panel>
    );
  }

  if (state.status === 'missing') {
    return (
      <Panel title="Server detail" utility={state.serverId} icon={<ServerCog size={17} />}>
        <Stack gap="sm">
          <Title order={3}>Server target not found</Title>
          <Text c="dimmed">
            {state.serverId} is no longer available. It may have been renamed or removed. Return to the list, refresh,
            and open the current target ID if a rename succeeded.
          </Text>
          <Alert color="yellow" variant="light">
            Old detail URLs are not aliases. Use the server list after a rename instead of bookmarking the previous ID.
          </Alert>
          <Button variant="default" onClick={() => void onClose?.()}>
            Back to servers
          </Button>
        </Stack>
      </Panel>
    );
  }

  if (state.status === 'failed') {
    return (
      <Panel title="Server detail" utility={state.serverId} icon={<ServerCog size={17} />}>
        <Stack gap="sm">
          <Alert color="red" role="alert">
            {state.message}
          </Alert>
          <Text c="dimmed" size="sm">
            Refresh the console or return to the server list, then retry. Preserve any non-secret request ID from the
            error when asking for support.
          </Text>
          <Button variant="default" onClick={() => void onClose?.()}>
            Back to servers
          </Button>
        </Stack>
      </Panel>
    );
  }

  return (
    <Panel
      title="Edit server"
      utility={state.detail.server.enabled ? 'enabled' : 'disabled'}
      icon={<Pencil size={17} />}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text className="eyebrow" size="xs">
              Configured Server Target
            </Text>
            <Group gap="xs" align="center">
              <Title order={2}>{state.detail.server.id}</Title>
              <Badge color={state.detail.server.enabled ? 'teal' : 'yellow'} variant="light">
                {state.detail.server.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
            <Text c="dimmed" size="sm">
              {transportSummaryLabel(state.detail.server)}
            </Text>
            <Text c="dimmed" size="xs">
              Draft changes stay local until preview.
            </Text>
          </div>
          <Button variant="default" onClick={() => void onClose?.(dirty)}>
            Back
          </Button>
        </Group>
        {state.detail.editContract.fieldGroups.map((group) => (
          <Paper key={group.id} className="edit-section" withBorder>
            <Stack gap="xs">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={800}>{group.label}</Text>
                  <Text c="dimmed" size="xs">
                    {editGroupHelp(group.id)}
                  </Text>
                </div>
                <Badge variant="outline">{group.fields.length} fields</Badge>
              </Group>
              {group.fields.map((field) =>
                field.control === 'secret' ? (
                  <SecretFieldDraft
                    key={fieldKey(field.fieldPath)}
                    field={field}
                    draft={secretDraft[fieldKey(field.fieldPath)]}
                    onChange={(draft) =>
                      setSecretDraft((current) => ({ ...current, [fieldKey(field.fieldPath)]: draft }))
                    }
                  />
                ) : (
                  <ConfiguredServerFieldDraft
                    key={fieldKey(field.fieldPath)}
                    field={field}
                    value={fieldDraft[fieldKey(field.fieldPath)]}
                    onChange={(value) =>
                      setFieldDraft((current) => ({ ...current, [fieldKey(field.fieldPath)]: value }))
                    }
                  />
                ),
              )}
            </Stack>
          </Paper>
        ))}
        <Group className="draft-action-bar" justify="space-between" gap="sm">
          <div>
            <Badge color={dirty ? 'yellow' : 'gray'} variant={dirty ? 'light' : 'outline'}>
              {dirty ? 'Unsaved changes' : 'No changes yet'}
            </Badge>
            <Text c="dimmed" size="xs">
              Preview validates the draft without writing config. Leaving this page with unsaved changes asks for
              confirmation.
            </Text>
          </div>
          <Group gap="xs">
            <Button
              loading={state.previewBusy}
              disabled={!dirty || state.previewBusy}
              onClick={() => void onPreviewServerEdit?.(state.serverId, previewEdit, 'auto')}
            >
              Preview change
            </Button>
            {state.preview ? (
              <Button
                variant="default"
                loading={state.previewBusy}
                onClick={() => void onPreviewServerEdit?.(state.serverId, previewEdit, 'manual')}
              >
                Rerun connectivity
              </Button>
            ) : null}
          </Group>
        </Group>
        {state.previewError ? (
          <Alert color="red" role="alert">
            {state.previewError}
          </Alert>
        ) : null}
        {state.preview ? <PreviewResult preview={state.preview} /> : null}
      </Stack>
    </Panel>
  );
}

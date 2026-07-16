import { Alert, Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';

import { Pencil, ServerCog } from 'lucide-react';

import {
  fieldAppliesToTransport,
  fieldKey,
  selectedTransportType,
} from '../../configuredServerEdit/configuredServerEditDraft';
import type { ConfiguredServerEditModel } from '../../configuredServerEdit/useConfiguredServerEdit';
import { EmptyState, Panel } from '../AdminConsoleShared';
import { transportSummaryLabel } from '../adminConsoleUtils';
import { ConfiguredServerFieldDraft, editGroupHelp, SecretFieldDraft } from './EditControls';
import { PreviewResult } from './PreviewResult';

export function ConfiguredServerEditor({ model }: { model: ConfiguredServerEditModel }) {
  const { state } = model;

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
          <Button variant="default" onClick={() => model.close()}>
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
          <Button variant="default" onClick={() => model.close()}>
            Back to servers
          </Button>
        </Stack>
      </Panel>
    );
  }

  const transportType = selectedTransportType(state.fieldDraft, state.detail.server.transport.type);
  const fieldGroups = state.detail.editContract.fieldGroups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => fieldAppliesToTransport(field, transportType)),
    }))
    .filter((group) => group.fields.length > 0);

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
          <Button variant="default" onClick={() => model.close()}>
            Back
          </Button>
        </Group>
        {fieldGroups.map((group) => (
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
                    draft={state.secretDraft[fieldKey(field.fieldPath)]}
                    onChange={(draft) => model.changeSecret(field.fieldPath, draft)}
                  />
                ) : (
                  <ConfiguredServerFieldDraft
                    key={fieldKey(field.fieldPath)}
                    field={field}
                    value={state.fieldDraft[fieldKey(field.fieldPath)]}
                    onChange={(value) => model.changeField(field.fieldPath, value)}
                  />
                ),
              )}
            </Stack>
          </Paper>
        ))}
        <Group className="draft-action-bar" justify="space-between" gap="sm">
          <div>
            <Badge color={state.dirty ? 'yellow' : 'gray'} variant={state.dirty ? 'light' : 'outline'}>
              {state.dirty ? 'Unsaved changes' : 'No changes yet'}
            </Badge>
            <Text c="dimmed" size="xs">
              Preview validates the draft without writing config. Leaving this page with unsaved changes asks for
              confirmation.
            </Text>
          </div>
          <Group gap="xs">
            <Button
              loading={state.previewBusy}
              disabled={!state.dirty || state.previewBusy}
              onClick={() => void model.preview('auto')}
            >
              Preview change
            </Button>
            {state.preview ? (
              <Button variant="default" loading={state.previewBusy} onClick={() => void model.preview('manual')}>
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

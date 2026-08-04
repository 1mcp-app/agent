import {
  Alert,
  Badge,
  Button,
  Group,
  NativeSelect,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';

import { Pencil, Plus, ServerCog, ShieldCheck, Trash2 } from 'lucide-react';

import type { ConfiguredServerCreateSecretDraft } from '../../configuredServerCreate/configuredServerCreateState';
import {
  configuredServerCreateApplyEligibility,
  type ConfiguredServerCreateModel,
} from '../../configuredServerCreate/useConfiguredServerCreate';
import { fieldAppliesToTransport, fieldKey } from '../../configuredServerEdit/configuredServerEditDraft';
import { EmptyState, Panel } from '../AdminConsoleShared';
import { ConfiguredServerFieldDraft, editGroupHelp } from '../configuredServerEditor/EditControls';
import { PreviewResult } from '../configuredServerEditor/PreviewResult';

export function ConfiguredServerCreator({ model }: { model: ConfiguredServerCreateModel }) {
  const { state } = model;
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return (
      <Panel title="Configure custom server" utility="loading" icon={<ServerCog size={17} />}>
        <EmptyState message="Loading creation controls." />
      </Panel>
    );
  }
  if (state.status === 'failed') {
    return (
      <Panel title="Configure custom server" utility="unavailable" icon={<ServerCog size={17} />}>
        <Stack gap="sm">
          <Alert color="red" role="alert">
            {state.message}
          </Alert>
          <Group>
            <Button onClick={() => void model.open()}>Retry loading</Button>
            <Button variant="default" onClick={() => void model.close()}>
              Back to servers
            </Button>
          </Group>
        </Stack>
      </Panel>
    );
  }
  if (state.status === 'committed') {
    return (
      <Panel title="Configured server created" utility={state.serverId} icon={<ShieldCheck size={17} />}>
        <Stack gap="sm">
          <Alert color="teal" role="status">
            Created {state.serverId}.
          </Alert>
          {state.warning ? <Alert color="yellow">{state.warning}</Alert> : null}
          <Text c="dimmed" size="sm">
            Refreshing the inventory and opening the created target.
          </Text>
          <Button onClick={() => void model.close(`/admin/servers/${encodeURIComponent(state.serverId)}`)}>
            Open server detail
          </Button>
        </Stack>
      </Panel>
    );
  }

  const transportType = state.fieldDraft[fieldKey(['transport', 'type'])];
  const selectedTransport = transportType === 'http' || transportType === 'sse' ? transportType : 'stdio';
  const groups = state.contract.createContract.fieldGroups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => fieldAppliesToTransport(field, selectedTransport)),
    }))
    .filter((group) => group.fields.length > 0);
  const eligibility = configuredServerCreateApplyEligibility(state);
  const staticNameConflict =
    state.preview?.configChange.target.source === 'mcpServers' &&
    state.preview.validation.errors.some((error) =>
      ['configured_server_name_conflict', 'configured_server_destination_conflict'].includes(error.code),
    );

  return (
    <Panel title="Configure custom server" utility="new static target" icon={<Plus size={17} />}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text className="eyebrow" size="xs">
              Configured Server Target
            </Text>
            <Title order={2}>New custom server</Title>
            <Text c="dimmed" size="sm">
              Configure -&gt; Preview -&gt; Confirm creation
            </Text>
          </div>
          <Button variant="default" onClick={() => void model.close()}>
            Back
          </Button>
        </Group>
        {selectedTransport === 'sse' ? (
          <Alert color="yellow" title="Legacy transport">
            SSE is deprecated. Use HTTP for new remote servers when the endpoint supports it.
          </Alert>
        ) : null}
        {groups.map((group) => (
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
              {group.fields.map((field) => (
                <ConfiguredServerFieldDraft
                  key={fieldKey(field.fieldPath)}
                  field={field}
                  value={state.fieldDraft[fieldKey(field.fieldPath)]}
                  onChange={(value) => model.changeField(field.fieldPath, value)}
                />
              ))}
            </Stack>
          </Paper>
        ))}
        <DynamicSecrets
          transport={selectedTransport}
          secrets={state.secrets}
          inlineSupported={
            Boolean(state.contract.createContract.secretPolicy.inlineReplacement) &&
            state.contract.createContract.secretPolicy.allowedActions.includes('replace')
          }
          onAdd={model.addSecret}
          onChange={model.changeSecret}
          onRemove={model.removeSecret}
        />
        <Group className="draft-action-bar" justify="space-between" gap="sm">
          <div>
            <Badge color={state.dirty ? 'yellow' : 'gray'} variant={state.dirty ? 'light' : 'outline'}>
              {state.dirty ? 'Unpreviewed draft' : 'Complete the server details'}
            </Badge>
            <Text c="dimmed" size="xs">
              Preview validates the new target without writing configuration.
            </Text>
          </div>
          <Group gap="xs">
            <Button
              loading={state.previewBusy}
              disabled={!state.dirty || state.previewBusy || state.applyBusy}
              onClick={() => void model.preview('auto')}
            >
              Preview server
            </Button>
            {state.preview ? (
              <Button variant="default" disabled={state.applyBusy} onClick={() => void model.preview('manual')}>
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
        {state.applyError ? (
          <Alert color="red" role="alert">
            {state.applyError}
          </Alert>
        ) : null}
        {state.preview ? (
          <>
            <PreviewResult preview={state.preview} />
            <Group justify="flex-end" align="center">
              {staticNameConflict ? (
                <Button
                  leftSection={<Pencil size={16} />}
                  variant="default"
                  onClick={() => void model.editExisting(state.preview?.targetName ?? '')}
                >
                  Edit existing server
                </Button>
              ) : null}
              {!eligibility.eligible ? (
                <Text c="dimmed" size="sm">
                  {eligibility.reason}
                </Text>
              ) : null}
              <Button
                leftSection={<ShieldCheck size={16} />}
                loading={state.applyBusy}
                disabled={!eligibility.eligible || state.applyBusy}
                onClick={() => void model.apply()}
              >
                Create server
              </Button>
            </Group>
          </>
        ) : null}
      </Stack>
    </Panel>
  );
}

function DynamicSecrets({
  transport,
  secrets,
  inlineSupported,
  onAdd,
  onChange,
  onRemove,
}: {
  transport: 'stdio' | 'http' | 'sse';
  secrets: ConfiguredServerCreateSecretDraft[];
  inlineSupported: boolean;
  onAdd(secret: ConfiguredServerCreateSecretDraft): void;
  onChange(secret: ConfiguredServerCreateSecretDraft): void;
  onRemove(id: string): void;
}) {
  const container = transport === 'stdio' ? 'env' : 'headers';
  const visible = secrets.filter((secret) => secret.container === container);
  const label = container === 'env' ? 'Environment secrets' : 'Header secrets';
  return (
    <Paper className="edit-section" withBorder>
      <Stack gap="xs">
        <Group justify="space-between">
          <div>
            <Text fw={800}>{label}</Text>
            <Text c="dimmed" size="xs">
              Environment Secret Reference is recommended. Only the reference is stored in configuration.
            </Text>
          </div>
          <Button
            size="compact-sm"
            variant="default"
            leftSection={<Plus size={14} />}
            onClick={() =>
              onAdd({
                id: createSecretId(),
                container,
                key: '',
                replacementKind: 'environmentReference',
                replacementValue: '',
              })
            }
          >
            Add secret
          </Button>
        </Group>
        {visible.length === 0 ? (
          <Text c="dimmed" size="sm">
            No secret inputs configured.
          </Text>
        ) : (
          visible.map((secret) => (
            <Paper key={secret.id} className="secret-editor" withBorder>
              <Stack gap="xs">
                <Group align="flex-end" wrap="nowrap">
                  <TextInput
                    label={container === 'env' ? 'Environment variable' : 'Header name'}
                    value={secret.key}
                    onChange={(event) => onChange({ ...secret, key: event.currentTarget.value })}
                  />
                  <NativeSelect
                    label="Secret source"
                    value={secret.replacementKind}
                    data={[
                      { value: 'environmentReference', label: 'Environment Secret Reference' },
                      ...(inlineSupported ? [{ value: 'inlineSecret', label: 'Advanced inline secret' }] : []),
                    ]}
                    onChange={(event) =>
                      onChange({
                        ...secret,
                        replacementKind: event.currentTarget
                          .value as ConfiguredServerCreateSecretDraft['replacementKind'],
                        replacementValue: '',
                      })
                    }
                  />
                  <Button
                    aria-label={`Remove ${secret.key || 'secret'} input`}
                    variant="subtle"
                    color="red"
                    onClick={() => onRemove(secret.id)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </Group>
                {secret.replacementKind === 'environmentReference' ? (
                  <TextInput
                    label={`Environment reference for ${secret.key || label}`}
                    placeholder="MY_SECRET or ${MY_SECRET}"
                    value={secret.replacementValue}
                    onChange={(event) => onChange({ ...secret, replacementValue: event.currentTarget.value })}
                  />
                ) : (
                  <>
                    <Alert color="yellow">
                      Advanced path: inline replacement stores secret material in configuration. Prefer an Environment
                      Secret Reference.
                    </Alert>
                    <PasswordInput
                      label={`Inline secret for ${secret.key || label}`}
                      value={secret.replacementValue}
                      onChange={(event) => onChange({ ...secret, replacementValue: event.currentTarget.value })}
                    />
                  </>
                )}
              </Stack>
            </Paper>
          ))
        )}
      </Stack>
    </Paper>
  );
}

let secretSequence = 0;
function createSecretId(): string {
  secretSequence += 1;
  return `create-secret-${secretSequence}`;
}

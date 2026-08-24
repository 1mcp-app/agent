import { Alert, Button, Code, Group, Paper, Stack, Text, TextInput } from '@mantine/core';

import { Trash2 } from 'lucide-react';

import type { ConfiguredServerTargetIdentity } from '../api/adminApi';
import { configuredServerDeleteEligible, configuredServerDeleteRecoveryRequired } from './configuredServerDeleteState';
import type { ConfiguredServerDeleteModel } from './useConfiguredServerDelete';

export function ConfiguredServerDelete({
  model,
  target,
}: {
  model: ConfiguredServerDeleteModel;
  target: ConfiguredServerTargetIdentity;
}) {
  const { state } = model;
  const preview = state.preview;
  const result = state.result;

  return (
    <Paper className="edit-section configured-server-delete" withBorder>
      <Stack gap="sm">
        <div>
          <Text fw={800} c="red">
            Delete definition
          </Text>
          <Text c="dimmed" size="sm">
            Remove this source-qualified definition after a recovery copy and Runtime Scope reload observation.
          </Text>
        </div>
        {result ? (
          <Alert color={configuredServerDeleteRecoveryRequired(result) ? 'yellow' : 'teal'} role="status">
            {configuredServerDeleteRecoveryRequired(result)
              ? result.configChange.reload.status === 'failed'
                ? 'The definition was deleted from disk, but runtime reload failed and the runtime may still serve this target.'
                : 'The definition was deleted from disk, but Template instance retirement was not confirmed and the runtime may still serve this target.'
              : 'The definition was deleted from disk and the runtime reload was observed.'}{' '}
            {result.configChange.backup.created
              ? 'A recovery backup exists. Restore it if the deletion must be reversed.'
              : 'No recovery backup was reported; inspect runtime and configuration state before continuing.'}
          </Alert>
        ) : !preview ? (
          <Button
            color="red"
            variant="outline"
            leftSection={<Trash2 size={16} />}
            loading={state.previewBusy}
            disabled={state.previewBusy || state.applyBusy}
            onClick={() => void model.preview(target)}
          >
            Preview deletion
          </Button>
        ) : (
          <Stack gap="xs">
            <Alert color="red" title={`Delete ${preview.qualifiedId}`}>
              {preview.runtimeImpact.kind === 'template'
                ? `${preview.runtimeImpact.activeInstanceCount} active instance${preview.runtimeImpact.activeInstanceCount === 1 ? '' : 's'} will be retired after reload.`
                : 'The configured backend will be removed after reload.'}
              {preview.removal.preservesSameNamedOtherSource
                ? ' The same-named definition in the other source remains.'
                : ''}
            </Alert>
            <Stack gap={2} className="configured-server-delete-facts">
              <Text size="xs">Identity: {preview.qualifiedId}</Text>
              <Text size="xs">Authority: {preview.authority}</Text>
              <Text size="xs">Target fingerprint: {preview.targetFingerprint}</Text>
              <Text size="xs">Removal diff: present definition to removed</Text>
              <Text size="xs">Backup: required recovery copy before write</Text>
              <Text size="xs">Reload: observe after write</Text>
              <Text size="xs">Expected reload outcomes: {preview.expectedReload.possibleStatuses.join(', ')}</Text>
              <Text size="xs">
                Runtime impact:{' '}
                {preview.runtimeImpact.kind === 'template'
                  ? `retire ${preview.runtimeImpact.activeInstanceCount} active instance${preview.runtimeImpact.activeInstanceCount === 1 ? '' : 's'} after reload`
                  : 'remove configured backend after reload'}
              </Text>
            </Stack>
            <div>
              <Text size="xs" fw={700}>
                Redacted definition
              </Text>
              <Code block>{JSON.stringify(preview.removal.definition, null, 2)}</Code>
            </div>
            {preview.warnings.map((warning) => (
              <Text key={warning} size="xs" c="dimmed">
                {warning}
              </Text>
            ))}
            <TextInput
              label={`Type ${preview.qualifiedId} to confirm`}
              value={state.confirmation}
              disabled={state.applyBusy}
              autoComplete="off"
              onChange={(event) => model.changeConfirmation(event.currentTarget.value)}
            />
            <Group justify="space-between">
              <Button variant="default" disabled={state.applyBusy} onClick={model.reset}>
                Cancel
              </Button>
              <Button
                color="red"
                leftSection={<Trash2 size={16} />}
                loading={state.applyBusy}
                disabled={!configuredServerDeleteEligible(state)}
                onClick={() => void model.apply(target)}
              >
                Delete definition
              </Button>
            </Group>
          </Stack>
        )}
        {state.error ? (
          <Alert color="red" role="alert">
            {state.error}
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  );
}

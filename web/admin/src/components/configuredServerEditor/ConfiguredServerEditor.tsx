import { Alert, Badge, Button, Group, Paper, SegmentedControl, Stack, Text, Textarea, Title } from '@mantine/core';

import { Pencil, ServerCog, ShieldCheck } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { ConfiguredServerEditField } from '../../api/adminApi';
import { ConfiguredServerDelete } from '../../configuredServerDelete/ConfiguredServerDelete';
import type { ConfiguredServerDeleteModel } from '../../configuredServerDelete/useConfiguredServerDelete';
import {
  fieldAppliesToTransport,
  fieldKey,
  selectedTransportType,
} from '../../configuredServerEdit/configuredServerEditDraft';
import type { ConfiguredServerEditModel } from '../../configuredServerEdit/useConfiguredServerEdit';
import { configuredServerApplyEligibility } from '../../configuredServerEdit/useConfiguredServerEdit';
import { EmptyState, Panel } from '../AdminConsoleShared';
import { transportSummaryLabel } from '../adminConsoleUtils';
import { ConfiguredToolTable } from './ConfiguredToolTable';
import { ConfiguredServerFieldDraft, editGroupHelp, SecretFieldDraft } from './EditControls';
import { PreviewResult } from './PreviewResult';

export function ConfiguredServerEditor({
  model,
  deleteModel,
}: {
  model: ConfiguredServerEditModel;
  deleteModel: ConfiguredServerDeleteModel;
}) {
  const { state } = model;
  const advancedSettingsRef = useRef<HTMLDetailsElement>(null);
  const hasAdvancedPreviewErrors =
    state.status === 'loaded' &&
    Boolean(
      state.preview?.validation.errors.some((error) =>
        state.detail.editContract.fieldGroups
          .flatMap((group) => group.fields)
          .some((field) => fieldKey(field.fieldPath) === fieldKey(error.fieldPath) && !isPrimaryEditField(field)),
      ),
    );

  useEffect(() => {
    if (hasAdvancedPreviewErrors && advancedSettingsRef.current) advancedSettingsRef.current.open = true;
  }, [hasAdvancedPreviewErrors]);

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

  if (state.status === 'committed' || state.status === 'committedRefreshFailed') {
    return (
      <Panel title="Server detail" utility={state.serverId} icon={<ServerCog size={17} />}>
        <Stack gap="sm">
          <Alert color="teal" role="status">
            {state.success}
          </Alert>
          {state.warning ? (
            <Alert color="yellow" role="status">
              {state.warning}
            </Alert>
          ) : null}
          {state.status === 'committed' ? (
            <EmptyState message="Refreshing the committed server detail." />
          ) : (
            <Alert color="yellow" role="status">
              {state.message}
            </Alert>
          )}
          <Text c="dimmed" size="sm">
            Editing stays unavailable until the runtime returns a fresh server detail model.
          </Text>
          <Group>
            {state.status === 'committedRefreshFailed' ? (
              <Button onClick={() => void model.open(state.serverId)}>Retry detail</Button>
            ) : null}
            <Button variant="default" onClick={() => void model.close('/admin/servers')}>
              Back to servers
            </Button>
          </Group>
        </Stack>
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
          <Button variant="default" onClick={() => model.close('/admin/servers')}>
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
          <Button variant="default" onClick={() => model.close('/admin/servers')}>
            Back to servers
          </Button>
        </Stack>
      </Panel>
    );
  }

  const transportType = selectedTransportType(state.fieldDraft, state.detail.server.transport.type);
  const templateTarget = state.detail.server.source === 'mcpTemplates';
  const fieldGroups = state.detail.editContract.fieldGroups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => fieldAppliesToTransport(field, transportType)),
    }))
    .filter((group) => group.fields.length > 0);
  const primaryGroups = fieldGroups
    .map((group) => ({ ...group, fields: group.fields.filter(isPrimaryEditField) }))
    .filter((group) => group.fields.length > 0);
  const advancedFields = fieldGroups.flatMap((group) => group.fields).filter((field) => !isPrimaryEditField(field));
  const applyEligibility = configuredServerApplyEligibility(state);

  const renderField = (field: ConfiguredServerEditField) => {
    const overrideKey = field.fieldPath[0] === 'transport' ? field.fieldPath[1] : field.fieldPath[0];
    const overrideCleared = Boolean(overrideKey && state.clearedTransportOverrides.includes(overrideKey));
    const timeout = ['timeout', 'connectionTimeout', 'requestTimeout'].includes(field.fieldPath[1] ?? '');
    const presentedField = timeout ? { ...field, label: `${field.label} (ms)` } : field;
    return (
      <Stack key={fieldKey(field.fieldPath)} gap={4}>
        {field.control === 'secret' ? (
          <SecretFieldDraft
            field={presentedField}
            draft={state.secretDraft[fieldKey(field.fieldPath)]}
            onChange={(draft) => model.changeSecret(field.fieldPath, draft)}
          />
        ) : (
          <ConfiguredServerFieldDraft
            field={presentedField}
            value={state.fieldDraft[fieldKey(field.fieldPath)]}
            onChange={(value) => model.changeField(field.fieldPath, value)}
          />
        )}
        {field.overrideSupported && overrideKey ? (
          <Group justify="space-between" gap="xs">
            <Badge variant="outline">
              {overrideCleared ? 'will inherit' : field.source === 'inherited' ? 'inherited' : field.source}
            </Badge>
            {field.clearOverrideSupported ? (
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => model.changeTransportOverride(overrideKey, !overrideCleared)}
              >
                {overrideCleared ? 'Restore override' : 'Clear override'}
              </Button>
            ) : null}
          </Group>
        ) : null}
      </Stack>
    );
  };

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
              <Badge variant="outline">{templateTarget ? 'Template' : 'Static'}</Badge>
              {state.detail.server.definition?.authority && state.detail.server.definition.authority !== 'sole' ? (
                <Badge color={state.detail.server.definition.authority === 'authoritative' ? 'teal' : 'yellow'}>
                  {state.detail.server.definition.authority}
                </Badge>
              ) : null}
            </Group>
            <Text c="dimmed" size="sm">
              {transportSummaryLabel(state.detail.server)}
            </Text>
            <Text c="dimmed" size="xs">
              {state.detail.server.definition?.qualifiedId ?? `${state.detail.server.source}/${state.detail.server.id}`}{' '}
              · Draft changes stay local until preview.
            </Text>
          </div>
          <Button variant="default" onClick={() => model.close('/admin/servers')}>
            Back
          </Button>
        </Group>
        {templateTarget ? (
          <Paper className="edit-section" withBorder>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text fw={800}>Template definition</Text>
                <Badge variant="outline">
                  {state.detail.server.runtime?.activeInstanceCount ?? 0} active instance
                  {(state.detail.server.runtime?.activeInstanceCount ?? 0) === 1 ? '' : 's'}
                </Badge>
              </Group>
              <Text size="sm" c="dimmed">
                This is a definition, not a live instance. Rename or structural changes retire active instances;
                metadata-only changes retain them. Future matching requests recreate retired instances lazily.
              </Text>
              <Text size="sm">
                Request Context variables:{' '}
                {state.detail.server.templateAnalysis?.unresolvedVariables.join(', ') || 'none'}
              </Text>
              {state.detail.server.templateAnalysis?.syntax.valid === false ? (
                <Alert color="red">Template syntax is invalid. Preview lists each affected field.</Alert>
              ) : null}
            </Stack>
          </Paper>
        ) : null}
        {primaryGroups.map((group) => (
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
              {group.fields.map(renderField)}
            </Stack>
          </Paper>
        ))}
        {state.detail.toolInventory ? (
          <Paper className="edit-section" withBorder>
            <ConfiguredToolTable
              inventory={state.detail.toolInventory}
              draft={state.toolDraft}
              disabled={state.applyBusy}
              refreshBusy={state.toolInventoryBusy}
              refreshError={state.toolInventoryError}
              onToolChange={model.changeTool}
              onBulkChange={model.changeVisibleTools}
              onModelChange={model.changeToolModel}
              onRefresh={() => model.refreshToolInventory?.()}
            />
          </Paper>
        ) : null}
        {advancedFields.length > 0 ? (
          <details ref={advancedSettingsRef} className="advanced-settings">
            <summary>Advanced settings</summary>
            <Stack gap="sm" mt="sm">
              <Text c="dimmed" size="xs">
                Timeouts use milliseconds. Prefer Connection Timeout and Request Timeout over Deprecated Timeout.
              </Text>
              {advancedFields.map(renderField)}
            </Stack>
          </details>
        ) : null}
        <Paper className="edit-section instruction-override-editor" withBorder>
          <Stack gap="xs">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text fw={800}>Server instructions</Text>
                <Text c="dimmed" size="xs">
                  Choose whether clients receive upstream instructions, an operator replacement, or no instructions.
                </Text>
              </div>
              <Badge variant="outline">
                Effective:{' '}
                {state.instructionOverride.mode === 'replace' ? 'replacement' : state.instructionOverride.mode}
              </Badge>
            </Group>
            <SegmentedControl
              fullWidth
              aria-label="Instruction override outcome"
              value={state.instructionOverride.mode}
              onChange={(value) => model.changeInstructionOverride(value as 'upstream' | 'replace' | 'suppress')}
              data={[
                { value: 'upstream', label: 'Use upstream' },
                { value: 'replace', label: 'Replace' },
                { value: 'suppress', label: 'Suppress' },
              ]}
            />
            {state.instructionOverride.mode === 'replace' ? (
              <Textarea
                label="Replacement instructions"
                minRows={5}
                value={state.instructionOverride.value}
                onChange={(event) => model.changeInstructionOverride('replace', event.currentTarget.value)}
              />
            ) : (
              <Text size="sm" className="instruction-override-readonly">
                {state.instructionOverride.mode === 'upstream'
                  ? 'Upstream state is preserved. Effective instructions are resolved when the server connects.'
                  : 'Effective instructions are an intentional empty value.'}
              </Text>
            )}
          </Stack>
        </Paper>
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
              disabled={!state.dirty || state.previewBusy || state.applyBusy || state.toolInventoryBusy}
              onClick={() => void model.preview('auto')}
            >
              Preview change
            </Button>
            {state.preview && !templateTarget ? (
              <Button
                variant="default"
                loading={state.previewBusy}
                disabled={state.applyBusy || state.toolInventoryBusy}
                onClick={() => void model.preview('manual')}
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
        {state.applyError ? (
          <Alert color="red" role="alert">
            {state.applyError}
          </Alert>
        ) : null}
        {state.applyWarning ? (
          <Alert color="yellow" role="status">
            {state.applyWarning}
          </Alert>
        ) : null}
        {state.applySuccess ? (
          <Alert color="teal" role="status">
            {state.applySuccess}
          </Alert>
        ) : null}
        {state.preview ? (
          <>
            <Group justify="flex-end" align="center">
              {!applyEligibility.eligible ? (
                <Text c="dimmed" size="sm">
                  {applyEligibility.reason}
                </Text>
              ) : null}
              <Button
                leftSection={<ShieldCheck size={16} />}
                loading={state.applyBusy}
                disabled={!applyEligibility.eligible || state.applyBusy || state.toolInventoryBusy}
                onClick={() => void model.apply()}
              >
                Apply changes
              </Button>
            </Group>
            <PreviewResult preview={state.preview} />
          </>
        ) : null}
        {!state.dirty && state.detail.editContract.capabilities.delete.supported ? (
          <ConfiguredServerDelete model={deleteModel} target={state.detail.server.target} />
        ) : null}
      </Stack>
    </Panel>
  );
}

function isPrimaryEditField(field: ConfiguredServerEditField): boolean {
  if (field.control === 'secret') return false;
  return field.fieldPath[0] !== 'transport' || ['type', 'command', 'args', 'url'].includes(field.fieldPath[1] ?? '');
}

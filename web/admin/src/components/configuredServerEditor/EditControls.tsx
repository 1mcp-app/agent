import {
  Alert,
  Badge,
  Button,
  Group,
  NativeSelect,
  Paper,
  PasswordInput,
  Radio,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';

import { useState } from 'react';

import type { ConfiguredServerEditField } from '../../api/adminApi';
import { DetailRow } from '../AdminConsoleShared';
import { displayFieldValue, objectRecord, splitStringList, stringArray } from './draft';
import type { SecretDraftState } from './types';

export function editGroupHelp(groupId: string): string {
  if (groupId === 'identity') {
    return 'Rename or enable this target before previewing.';
  }
  if (groupId === 'secrets') {
    return 'Choose preserve, replace, or clear without revealing current values.';
  }
  if (groupId === 'transport') {
    return 'Change how the runtime connects to this server.';
  }
  return 'Edit normalized fields owned by the Admin Domain.';
}

export function ConfiguredServerFieldDraft({
  field,
  value,
  onChange,
}: {
  field: ConfiguredServerEditField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (!field.editable || field.control === 'readonly') {
    return <DetailRow label={field.label} value={displayFieldValue(value)} />;
  }

  if (field.control === 'switch') {
    return (
      <Switch
        label={field.label}
        checked={Boolean(value)}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    );
  }

  if (field.control === 'tag-list') {
    return <TagsInput label={field.label} value={stringArray(value)} onChange={onChange} />;
  }

  if (field.control === 'select') {
    return (
      <NativeSelect
        label={field.label}
        value={String(value ?? '')}
        data={field.options ?? []}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  if (field.control === 'string-list') {
    return (
      <Textarea
        label={field.label}
        value={stringArray(value).join('\n')}
        autosize
        minRows={2}
        onChange={(event) => onChange(splitStringList(event.currentTarget.value))}
      />
    );
  }

  if (field.control === 'record') {
    return <RecordFieldDraft label={field.label} value={objectRecord(value)} onChange={onChange} />;
  }

  return (
    <TextInput
      label={field.label}
      value={String(value ?? '')}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function RecordFieldDraft({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  function updateEntry(key: string, entryValue: string) {
    onChange({ ...value, [key]: entryValue });
  }

  function removeEntry(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }

  function addEntry() {
    const key = newKey.trim();
    if (!key) {
      return;
    }
    onChange({ ...value, [key]: newValue });
    setNewKey('');
    setNewValue('');
  }

  return (
    <Stack className="record-editor" gap="xs">
      <Text fw={700}>{label}</Text>
      {Object.entries(value).map(([key, entryValue]) => (
        <Group key={key} gap="xs" align="flex-end" wrap="nowrap">
          <TextInput
            className="record-editor-value"
            label={`${label} ${key}`}
            value={String(entryValue ?? '')}
            onChange={(event) => updateEntry(key, event.currentTarget.value)}
          />
          <Button
            aria-label={`Remove ${label} ${key}`}
            size="compact-xs"
            variant="subtle"
            color="red"
            onClick={() => removeEntry(key)}
          >
            Remove
          </Button>
        </Group>
      ))}
      <Group gap="xs" align="flex-end">
        <TextInput
          label={`New ${label} key`}
          value={newKey}
          onChange={(event) => setNewKey(event.currentTarget.value)}
        />
        <TextInput
          label={`New ${label} value`}
          value={newValue}
          onChange={(event) => setNewValue(event.currentTarget.value)}
        />
        <Button variant="default" onClick={addEntry}>
          Add entry
        </Button>
      </Group>
    </Stack>
  );
}

export function SecretFieldDraft({
  field,
  draft,
  onChange,
}: {
  field: ConfiguredServerEditField;
  draft?: SecretDraftState[string];
  onChange: (draft: SecretDraftState[string]) => void;
}) {
  const current =
    draft ??
    ({
      fieldPath: field.fieldPath,
      action: 'preserve',
      replacementKind: field.secret?.environmentReference.supported === false ? 'inlineSecret' : 'environmentReference',
      replacementValue: '',
    } satisfies SecretDraftState[string]);
  const actions = field.secret?.allowedActions ?? ['preserve', 'replace', 'clear'];
  const environmentSupported = field.secret?.environmentReference.supported ?? true;
  const environmentRecommended = field.secret?.environmentReference.recommended ?? environmentSupported;
  const inlineSupported = field.secret?.inlineReplacement.supported ?? false;

  return (
    <Paper className="secret-editor" withBorder>
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700}>{field.label}</Text>
            <Text size="xs" c="dimmed">
              {field.secret?.environmentReference.guidance ??
                'Store only an environment variable name or substitution expression when possible.'}
            </Text>
          </div>
          <Group gap={4}>
            <Badge variant="light">redacted</Badge>
            {environmentRecommended ? (
              <Badge color="teal" variant="light">
                env reference recommended
              </Badge>
            ) : null}
          </Group>
        </Group>
        <Radio.Group
          value={current.action}
          onChange={(value) => onChange({ ...current, action: value as SecretDraftState[string]['action'] })}
        >
          <Group gap="sm">
            {actions.map((action) => (
              <Radio key={action} value={action} label={secretActionLabel(action, field.label)} />
            ))}
          </Group>
        </Radio.Group>
        {current.action === 'replace' ? (
          <Stack gap="xs">
            <Alert color="teal" variant="light">
              Recommended: keep secret material outside 1MCP config by writing only an environment variable name or
              substitution expression.
            </Alert>
            <Radio.Group
              label="Replacement source"
              value={current.replacementKind}
              onChange={(value) =>
                onChange({ ...current, replacementKind: value as SecretDraftState[string]['replacementKind'] })
              }
            >
              <Group gap="sm">
                <Radio
                  disabled={!environmentSupported}
                  value="environmentReference"
                  label="Environment variable (recommended)"
                />
              </Group>
            </Radio.Group>
            {current.replacementKind === 'environmentReference' ? (
              <>
                <TextInput
                  label={`Environment variable for ${field.label}`}
                  description="Example: GITHUB_TOKEN or ${GITHUB_TOKEN}"
                  value={current.replacementValue}
                  onChange={(event) => onChange({ ...current, replacementValue: event.currentTarget.value })}
                />
                {inlineSupported ? (
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    color="yellow"
                    onClick={() => onChange({ ...current, replacementKind: 'inlineSecret', replacementValue: '' })}
                  >
                    Use advanced inline secret instead
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Alert color="yellow" role="alert">
                  Advanced path: inline replacement stores secret material in configuration. Prefer an environment
                  reference unless the deployment cannot provide one.
                </Alert>
                <PasswordInput
                  label={`Inline secret for ${field.label}`}
                  value={current.replacementValue}
                  onChange={(event) => onChange({ ...current, replacementValue: event.currentTarget.value })}
                />
                {environmentSupported ? (
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    onClick={() =>
                      onChange({ ...current, replacementKind: 'environmentReference', replacementValue: '' })
                    }
                  >
                    Use environment variable instead
                  </Button>
                ) : null}
              </>
            )}
            <Text size="xs" c="dimmed">
              {current.replacementKind === 'environmentReference'
                ? field.secret?.environmentReference.guidance
                : field.secret?.inlineReplacement.guidance}
            </Text>
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}

function secretActionLabel(action: SecretDraftState[string]['action'], label: string): string {
  if (action === 'preserve') {
    return `Preserve existing ${label}`;
  }
  if (action === 'replace') {
    return `Replace ${label}`;
  }
  return `Clear saved ${label}`;
}

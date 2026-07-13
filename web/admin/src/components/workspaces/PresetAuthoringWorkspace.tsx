import { Alert, Badge, Button, Group, Paper, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';

import { Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  buildTagAuthoringQuery,
  evaluateTagAuthoringQuery,
  parseTagAuthoringQuery,
  type TagAuthoringState,
} from '../../../../../src/domains/preset/tagAuthoring';
import type { AdminPresetDraft, AdminPresetListItem, AdminPresetPreview, AdminPresetTarget } from '../../api/adminApi';
import type { PresetAuthoringModel } from '../../session/AdminConsoleSessionModel';

export function PresetAuthoringWorkspace({
  model,
  runtimeScopeId,
}: {
  model: PresetAuthoringModel;
  runtimeScopeId?: string;
}) {
  const {
    items: presets,
    targets: presetTargets,
    busy,
    load,
    preview: previewPreset,
    save: savePreset,
    delete: deletePreset,
  } = model;
  const [sourceName, setSourceName] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [strategy, setStrategy] = useState<'or' | 'and' | 'advanced'>('or');
  const [tagStates, setTagStates] = useState<Record<string, TagAuthoringState>>({});
  const [advanced, setAdvanced] = useState('{}');
  const [preview, setPreview] = useState<AdminPresetPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [structuredConversion, setStructuredConversion] = useState<AdminPresetPreview['structuredConversion']>({
    lossless: true,
  });

  function editPreset(preset: AdminPresetListItem, duplicate = false) {
    setSourceName(duplicate ? preset.name : preset.name);
    setName(duplicate ? `${preset.name}-copy` : preset.name);
    setDescription(preset.description ?? '');
    const parsedQuery = parseTagAuthoringQuery(preset.tagQuery);
    setStrategy(parsedQuery ? parsedQuery.strategy : 'advanced');
    setAdvanced(JSON.stringify(preset.tagQuery, null, 2));
    const conversion = parsedQuery ? { tags: Object.keys(parsedQuery.states) } : null;
    setTagStates(parsedQuery?.states ?? {});
    setStructuredConversion(
      conversion
        ? {
            lossless: true,
            strategy: parsedQuery?.strategy,
            tags: conversion.tags,
            states: parsedQuery?.states,
          }
        : { lossless: false, reason: 'This advanced query cannot be represented losslessly in structured mode.' },
    );
    setPreview(null);
  }

  function draft(): AdminPresetDraft {
    let tagQuery: Record<string, unknown>;
    if (strategy === 'advanced') {
      const parsed: unknown = JSON.parse(advanced);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Advanced JSON must be an object.');
      }
      tagQuery = parsed as Record<string, unknown>;
    } else {
      tagQuery = buildTagAuthoringQuery(tagStates, strategy);
    }
    return {
      name,
      description: description || undefined,
      strategy,
      tagQuery,
    };
  }

  async function createPreview() {
    try {
      const next = await previewPreset(draft(), sourceName);
      setPreview(next);
      setStructuredConversion(next.structuredConversion);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preset preview failed.');
    }
  }

  async function save() {
    if (!preview) return;
    const action = sourceName ? (sourceName === preview.draft.name ? 'update' : 'duplicate') : 'create';
    if (
      !window.confirm(
        `Confirm ${action} preset ${preview.draft.name}${preview.matchCount === 0 ? ' with zero matches' : ''}?`,
      )
    )
      return;
    await savePreset({ action, sourceName, preview });
    setPreview(null);
    setMessage(`Preset ${preview.draft.name} saved.`);
  }

  return (
    <section aria-labelledby="presets-title" className="operations-workspace">
      <Group justify="space-between" align="flex-start" className="workspace-heading">
        <div>
          <Text className="eyebrow" size="xs">
            Runtime Scope / {runtimeScopeId ?? 'unavailable'}
          </Text>
          <Title id="presets-title" order={2}>
            Presets
          </Title>
          <Text c="dimmed" size="sm">
            Manage the preset store owned by this running Runtime Scope.
          </Text>
        </div>
        <Group>
          <Button variant="default" onClick={() => void load()} loading={busy}>
            Refresh
          </Button>
          <Button
            onClick={() => {
              setSourceName(undefined);
              setName('');
              setDescription('');
              setStrategy('or');
              setTagStates({});
              setAdvanced('{}');
              setPreview(null);
            }}
          >
            New preset
          </Button>
        </Group>
      </Group>
      <div className="workspace-grid">
        <Paper withBorder p="md">
          <Stack gap="sm">
            {presets.map((preset) => (
              <Paper key={preset.name} withBorder p="sm">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text fw={800}>{preset.name}</Text>
                    <Text size="sm" c="dimmed">
                      {preset.description || 'No description'}
                    </Text>
                    <Text size="xs">
                      {preset.strategy.toUpperCase()} · {preset.querySummary || 'empty query'} · {preset.matchCount}{' '}
                      matches
                    </Text>
                  </div>
                  <Group gap="xs">
                    <Button size="xs" variant="default" onClick={() => editPreset(preset)}>
                      Edit
                    </Button>
                    <Button size="xs" variant="default" onClick={() => editPreset(preset, true)}>
                      Duplicate
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      leftSection={<Trash2 size={14} />}
                      onClick={() => void deletePreset(preset.name)}
                    >
                      Delete
                    </Button>
                  </Group>
                </Group>
              </Paper>
            ))}
            {!busy && presets.length === 0 ? <Text c="dimmed">No presets in this Runtime Scope.</Text> : null}
          </Stack>
        </Paper>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Title order={3}>{sourceName ? `Edit ${sourceName}` : 'Create preset'}</Title>
            <TextInput
              label="Preset name"
              value={name}
              disabled={Boolean(sourceName && sourceName === name)}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setPreview(null);
              }}
            />
            <TextInput
              label="Description"
              value={description}
              onChange={(event) => {
                setDescription(event.currentTarget.value);
                setPreview(null);
              }}
            />
            <Group>
              <Button
                variant={strategy === 'or' ? 'filled' : 'default'}
                aria-pressed={strategy === 'or'}
                disabled={strategy === 'advanced' && !structuredConversion.lossless}
                title={
                  strategy === 'advanced' && !structuredConversion.lossless ? structuredConversion.reason : undefined
                }
                onClick={() => {
                  setStrategy('or');
                  if (structuredConversion.states) setTagStates(structuredConversion.states);
                  else if (structuredConversion.tags) setTagStates(includedTagStates(structuredConversion.tags));
                  setPreview(null);
                }}
              >
                Match any included tag
              </Button>
              <Button
                variant={strategy === 'and' ? 'filled' : 'default'}
                aria-pressed={strategy === 'and'}
                disabled={strategy === 'advanced' && !structuredConversion.lossless}
                title={
                  strategy === 'advanced' && !structuredConversion.lossless ? structuredConversion.reason : undefined
                }
                onClick={() => {
                  setStrategy('and');
                  if (structuredConversion.states) setTagStates(structuredConversion.states);
                  else if (structuredConversion.tags) setTagStates(includedTagStates(structuredConversion.tags));
                  setPreview(null);
                }}
              >
                Match all included tags
              </Button>
              <Button
                variant={strategy === 'advanced' ? 'filled' : 'default'}
                aria-pressed={strategy === 'advanced'}
                onClick={() => {
                  setAdvanced(
                    JSON.stringify(buildTagAuthoringQuery(tagStates, strategy === 'and' ? 'and' : 'or'), null, 2),
                  );
                  setStrategy('advanced');
                  setPreview(null);
                }}
              >
                Advanced JSON
              </Button>
            </Group>
            {strategy === 'advanced' ? (
              <Textarea
                label="Advanced JSON"
                minRows={8}
                value={advanced}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setAdvanced(value);
                  try {
                    const parsed: unknown = JSON.parse(value);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                      const structured = parseTagAuthoringQuery(parsed as Record<string, unknown>);
                      setStructuredConversion(
                        structured
                          ? {
                              lossless: true,
                              strategy: structured.strategy,
                              tags: Object.keys(structured.states),
                              states: structured.states,
                            }
                          : { lossless: false, reason: 'This advanced query cannot be represented losslessly.' },
                      );
                    } else {
                      setStructuredConversion({ lossless: false, reason: 'Advanced JSON must be an object.' });
                    }
                  } catch {
                    setStructuredConversion({
                      lossless: false,
                      reason: 'Advanced JSON must be valid before conversion.',
                    });
                  }
                  setPreview(null);
                }}
              />
            ) : (
              <TagMatrix
                targets={presetTargets}
                strategy={strategy}
                states={tagStates}
                onChange={(nextStates) => {
                  setTagStates(nextStates);
                  setPreview(null);
                }}
              />
            )}
            <Button leftSection={<SlidersHorizontal size={16} />} onClick={() => void createPreview()}>
              Preview matches
            </Button>
            {preview ? (
              <Paper withBorder p="sm">
                <Text fw={800}>{preview.matchCount} current matches</Text>
                {preview.validation.globalErrors.map((error) => (
                  <Text key={error} c="red">
                    {error}
                  </Text>
                ))}
                {preview.validation.fieldErrors.map((error) => (
                  <Text key={`${error.field}-${error.message}`} c="red">
                    {error.field}: {error.message}
                  </Text>
                ))}
                {preview.validation.warnings.map((warning) => (
                  <Text key={warning} c="yellow">
                    {warning}
                  </Text>
                ))}
                {preview.matches.map((match) => (
                  <Text key={match.name} size="sm">
                    {match.matched ? '✓' : '–'} {match.name} · {match.enabled ? 'enabled' : 'disabled'} · {match.reason}
                  </Text>
                ))}
                <Button
                  mt="sm"
                  disabled={preview.validation.status === 'invalid'}
                  leftSection={<Save size={16} />}
                  onClick={() => void save()}
                >
                  Confirm and save
                </Button>
              </Paper>
            ) : null}
            {message ? <Alert>{message}</Alert> : null}
          </Stack>
        </Paper>
      </div>
    </section>
  );
}

function TagMatrix({
  targets,
  strategy,
  states,
  onChange,
}: {
  targets: AdminPresetTarget[];
  strategy: 'or' | 'and';
  states: Record<string, TagAuthoringState>;
  onChange: (states: Record<string, TagAuthoringState>) => void;
}) {
  const catalog = tagCatalog(targets, states);
  const query = buildTagAuthoringQuery(states, strategy);
  const matchingServers = targets.filter((server) => evaluateTagAuthoringQuery(query, server.tags));
  const activeTags = catalog.filter(({ tag }) => (states[tag] ?? 'neutral') !== 'neutral');

  function setTagState(tag: string, state: TagAuthoringState) {
    onChange({ ...states, [tag]: state });
  }

  return (
    <section className="preset-tag-builder" aria-labelledby="preset-tag-matrix-title">
      <Group justify="space-between" align="flex-start" gap="md">
        <div>
          <Title id="preset-tag-matrix-title" order={4}>
            Tag matrix
          </Title>
          <Text size="sm" c="dimmed">
            Discover tags from configured targets. Include tags select servers; exclude tags remove them.
          </Text>
        </div>
        <Badge variant="light" color={matchingServers.length > 0 ? 'teal' : 'yellow'}>
          {matchingServers.length} / {targets.length} match
        </Badge>
      </Group>
      <Stack gap="xs" mt="sm" className="preset-tag-list">
        {catalog.map(({ tag, servers, enabledCount, disabledCount, discovered }) => {
          const state = states[tag] ?? 'neutral';
          return (
            <div className={`preset-tag-row preset-tag-${state}`} key={tag}>
              <div className="preset-tag-identity">
                <Text fw={800}>{tag}</Text>
                <Text size="xs" c="dimmed">
                  {servers.length} {servers.length === 1 ? 'server' : 'servers'} · {enabledCount} enabled ·{' '}
                  {disabledCount} disabled · {servers.join(', ') || 'no current targets'}
                  {!discovered ? ' · no longer discovered' : ''}
                </Text>
              </div>
              <Group gap={4} wrap="nowrap" role="group" aria-label={`${tag} tag state`}>
                <Button
                  size="compact-xs"
                  variant={state === 'include' ? 'filled' : 'subtle'}
                  color="teal"
                  aria-pressed={state === 'include'}
                  aria-label={`Include ${tag}, ${servers.length} ${servers.length === 1 ? 'server' : 'servers'}`}
                  onClick={() => setTagState(tag, state === 'include' ? 'neutral' : 'include')}
                >
                  Include
                </Button>
                <Button
                  size="compact-xs"
                  variant={state === 'exclude' ? 'filled' : 'subtle'}
                  color="red"
                  aria-pressed={state === 'exclude'}
                  aria-label={`Exclude ${tag}, ${servers.length} ${servers.length === 1 ? 'server' : 'servers'}`}
                  onClick={() => setTagState(tag, state === 'exclude' ? 'neutral' : 'exclude')}
                >
                  Exclude
                </Button>
              </Group>
            </div>
          );
        })}
        {catalog.length === 0 ? <Text c="dimmed">No configured target tags are available.</Text> : null}
      </Stack>
      <div className="preset-query-strip">
        <Text size="xs" fw={800} tt="uppercase">
          Draft query
        </Text>
        <Group gap="xs" mt={6}>
          {activeTags.length === 0 ? <Text c="dimmed">Select tags to build a query.</Text> : null}
          {activeTags.map(({ tag }) => (
            <Badge key={tag} color={states[tag] === 'exclude' ? 'red' : 'teal'} variant="light">
              {states[tag] === 'exclude' ? 'EXCLUDE' : 'INCLUDE'} {tag}
            </Badge>
          ))}
        </Group>
        <Text size="sm" mt="xs">
          {matchingServers.length} of {targets.length} configured targets match this draft.
        </Text>
        <Stack gap={3} mt="xs">
          {targets.map((server) => {
            const matched = matchingServers.some((candidate) => candidate.name === server.name);
            return (
              <Text key={server.name} size="xs" c={matched ? undefined : 'dimmed'}>
                {matched ? '✓' : '–'} {server.name} · {server.enabled ? 'enabled' : 'disabled'} ·{' '}
                {server.tags.join(', ') || 'untagged'}
              </Text>
            );
          })}
        </Stack>
      </div>
    </section>
  );
}

function tagCatalog(targets: AdminPresetTarget[], states: Record<string, TagAuthoringState>) {
  const catalog = new Map<string, { servers: string[]; enabledCount: number; disabledCount: number }>();
  for (const server of targets) {
    for (const tag of server.tags) {
      const current = catalog.get(tag) ?? { servers: [], enabledCount: 0, disabledCount: 0 };
      current.servers.push(server.name);
      if (server.enabled) current.enabledCount += 1;
      else current.disabledCount += 1;
      catalog.set(tag, current);
    }
  }
  for (const tag of Object.keys(states)) {
    if (!catalog.has(tag)) catalog.set(tag, { servers: [], enabledCount: 0, disabledCount: 0 });
  }
  return Array.from(catalog, ([tag, details]) => ({ tag, ...details, discovered: details.servers.length > 0 })).sort(
    (left, right) => left.tag.localeCompare(right.tag),
  );
}

function includedTagStates(tags: string[]): Record<string, TagAuthoringState> {
  return Object.fromEntries(tags.map((tag) => [tag, 'include' as const]));
}

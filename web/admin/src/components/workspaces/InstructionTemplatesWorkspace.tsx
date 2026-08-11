import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';

import { CheckCircle2, Copy, FileInput, FileText, Play, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { InstructionTemplateSelection, InstructionTemplateSurface } from '../../api/adminApi';
import type { InstructionTemplatesModel } from '../../instructionTemplates/useInstructionTemplates';

export function InstructionTemplatesWorkspace({
  model,
  runtimeScopeId,
}: {
  model: InstructionTemplatesModel;
  runtimeScopeId?: string;
}) {
  const selected = model.items.find((item) => item.identity === model.selectedIdentity);
  const [copyIdentity, setCopyIdentity] = useState('');
  const [legacyIdentity, setLegacyIdentity] = useState('legacy');
  const valid = selected?.validation.valid !== false;
  const activationReady = Boolean(model.activationValidation && !model.dirty && valid);

  return (
    <section aria-labelledby="instruction-templates-title" className="operations-workspace">
      <Group justify="space-between" align="flex-start" className="workspace-heading">
        <div>
          <Text className="eyebrow" size="xs">
            Runtime Scope / {runtimeScopeId ?? 'unavailable'}
          </Text>
          <Title id="instruction-templates-title" order={2}>
            Instruction templates
          </Title>
          <Text c="dimmed" size="sm">
            Author the initialization and CLI instructions used by new client surfaces.
          </Text>
        </div>
        <Group gap="xs">
          <Badge color={model.selectionExplicit ? 'teal' : 'gray'} variant="light">
            {model.selectionExplicit ? `Active: ${model.activeIdentity ?? 'none'}` : 'Legacy selection'}
          </Badge>
          <Button
            aria-label="Refresh instruction templates"
            leftSection={<RefreshCw size={15} />}
            variant="default"
            loading={model.busy}
            onClick={() => void model.load()}
          >
            Refresh
          </Button>
          <Button leftSection={<FileText size={15} />} onClick={model.newDraft}>
            New template
          </Button>
        </Group>
      </Group>

      {model.error ? (
        <Alert color="red" role="alert" mb="md">
          {model.error}
        </Alert>
      ) : null}
      {model.reloadWarning ? (
        <Alert color="yellow" role="status" mb="md" title="Runtime reload needs attention">
          {model.reloadWarning}
        </Alert>
      ) : null}
      {Object.values(model.renderFailures).map((failure) => (
        <Alert key={failure.surface} color="yellow" mb="sm" role="status">
          {surfaceLabel(failure.surface)} rendering fell back to the built-in template for {failure.templateIdentity}.
          <Text component="span" size="xs" c="dimmed">
            {' '}
            {failure.code}
          </Text>
        </Alert>
      ))}

      <div className="instruction-workspace-grid">
        <aside className="instruction-template-list" aria-label="Instruction template library">
          <Group justify="space-between" className="instruction-pane-heading">
            <Text fw={800}>Template library</Text>
            <Badge variant="outline">{model.items.length}</Badge>
          </Group>
          <Stack gap={4} className="instruction-template-scroll">
            {model.items.map((item) => (
              <button
                type="button"
                key={item.identity}
                className={`instruction-template-row${item.identity === model.selectedIdentity ? ' instruction-template-row-active' : ''}`}
                aria-pressed={item.identity === model.selectedIdentity}
                onClick={() => model.select(item.identity)}
              >
                <span className="instruction-template-identity">{item.identity}</span>
                <span className="instruction-template-badges">
                  {item.active ? <Badge color="teal">Active</Badge> : null}
                  {item.protected ? <Badge variant="outline">Built-in</Badge> : null}
                  <Badge color={item.validation.valid ? 'teal' : 'red'} variant="light">
                    {item.validation.valid ? 'valid' : 'invalid'}
                  </Badge>
                </span>
              </button>
            ))}
            {!model.busy && model.items.length === 0 ? (
              <Text c="dimmed" size="sm" p="sm">
                No managed templates in this Runtime Scope.
              </Text>
            ) : null}
          </Stack>

          {model.selectedIdentity ? (
            <Stack gap="xs" className="instruction-library-actions">
              <TextInput
                label="Clone as"
                placeholder="template-copy"
                value={copyIdentity}
                onChange={(event) => setCopyIdentity(event.currentTarget.value)}
              />
              <Button
                leftSection={<Copy size={14} />}
                variant="default"
                disabled={!copyIdentity.trim() || model.busy}
                onClick={() => void model.clone(copyIdentity.trim()).then(() => setCopyIdentity(''))}
              >
                Clone template
              </Button>
            </Stack>
          ) : null}

          {model.legacyAvailable ? (
            <Stack gap="xs" className="instruction-library-actions">
              <TextInput
                label="Import legacy as"
                value={legacyIdentity}
                onChange={(event) => setLegacyIdentity(event.currentTarget.value)}
              />
              <Button
                leftSection={<FileInput size={14} />}
                variant="default"
                disabled={!legacyIdentity.trim() || model.busy}
                onClick={() => void model.importLegacy(legacyIdentity.trim())}
              >
                Import legacy template
              </Button>
            </Stack>
          ) : null}
        </aside>

        <main className="instruction-editor-pane">
          <Group justify="space-between" align="flex-start" className="instruction-pane-heading">
            <div>
              <Text className="eyebrow" size="xs">
                {model.selectedIdentity ? 'Managed draft' : 'New managed draft'}
              </Text>
              <Title order={3}>{model.selectedIdentity ?? 'Untitled template'}</Title>
            </div>
            <Group gap="xs">
              {selected?.protected ? <Badge variant="outline">Protected built-in</Badge> : null}
              {selected ? (
                <Badge color={valid ? 'teal' : 'red'} variant="light">
                  {valid ? 'Valid draft' : 'Invalid draft'}
                </Badge>
              ) : null}
              <Badge color={model.dirty ? 'yellow' : 'gray'} variant={model.dirty ? 'light' : 'outline'}>
                {model.dirty ? 'Unsaved changes' : 'Saved'}
              </Badge>
            </Group>
          </Group>

          <TextInput
            label="Template name"
            value={model.draft.identity}
            disabled={Boolean(model.selectedIdentity)}
            onChange={(event) => model.changeIdentity(event.currentTarget.value)}
          />

          <Tabs
            value={model.surface}
            onChange={(value) => value && model.changeSurface(value as InstructionTemplateSurface)}
          >
            <Tabs.List grow>
              <Tabs.Tab value="initialize">Initialization</Tabs.Tab>
              <Tabs.Tab value="cli">CLI</Tabs.Tab>
            </Tabs.List>
            {(['initialize', 'cli'] as const).map((surface) => (
              <Tabs.Panel key={surface} value={surface} pt="sm">
                <Textarea
                  className="instruction-template-editor"
                  aria-label={`${surface === 'cli' ? 'CLI' : 'Initialization'} template`}
                  autosize
                  minRows={12}
                  maxRows={24}
                  disabled={selected?.protected}
                  value={model.draft.variants[surface === 'initialize' ? 'initialization' : 'cli']}
                  onChange={(event) => model.changeVariant(surface, event.currentTarget.value)}
                />
              </Tabs.Panel>
            ))}
          </Tabs>

          {selected && !selected.validation.valid ? (
            <Alert color="red" title="Draft validation">
              {selected.validation.initialization.error ? (
                <Text size="sm">Initialization: {selected.validation.initialization.error}</Text>
              ) : null}
              {selected.validation.cli.error ? <Text size="sm">CLI: {selected.validation.cli.error}</Text> : null}
            </Alert>
          ) : null}

          <Group justify="space-between" className="instruction-editor-actions">
            <Button
              aria-label="Delete template"
              color="red"
              leftSection={<Trash2 size={15} />}
              variant="light"
              disabled={!model.selectedIdentity || selected?.protected || model.busy}
              onClick={() => void model.deleteSelected()}
            >
              Delete
            </Button>
            <Button
              leftSection={<Save size={15} />}
              disabled={!model.draft.identity.trim() || !model.dirty || selected?.protected || model.busy}
              loading={model.busy}
              onClick={() => void model.saveDraft()}
            >
              Save draft
            </Button>
          </Group>
        </main>

        <aside className="instruction-preview-pane" aria-label="Template preview">
          <Group justify="space-between" className="instruction-pane-heading">
            <div>
              <Text fw={800}>Effective preview</Text>
              <Text size="xs" c="dimmed">
                {surfaceLabel(model.surface)} surface
              </Text>
            </div>
            {model.previewStale ? <Badge color="yellow">Preview is stale</Badge> : null}
          </Group>

          <SegmentedControl
            fullWidth
            aria-label="Preview target selection"
            value={model.selection.mode}
            onChange={(value) => model.changeSelection(defaultSelection(value))}
            data={[
              { value: 'all', label: 'All' },
              { value: 'preset', label: 'Preset' },
              { value: 'tags', label: 'Tags' },
              { value: 'tag-filter', label: 'Filter' },
            ]}
          />
          <SelectionInput selection={model.selection} onChange={model.changeSelection} />
          <RequestContextForm value={model.requestContext} onChange={model.changeRequestContext} />
          <Button
            leftSection={<Play size={15} />}
            disabled={!model.selectedIdentity || model.dirty || model.busy}
            loading={model.busy}
            onClick={() => void model.previewDraft()}
          >
            Preview {model.surface}
          </Button>

          <div className="instruction-preview-output" aria-live="polite">
            {model.preview ? (
              <>
                <Group justify="space-between">
                  <Badge color={model.preview.validation ? 'yellow' : 'teal'} variant="light">
                    {model.preview.validation ? 'Preview failed' : 'Rendered'}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    One-shot preview
                  </Text>
                </Group>
                <Code block>{model.preview.rendered ?? model.preview.validation?.message ?? '(suppressed)'}</Code>
                {model.preview.unresolvedTemplates.length > 0 ? (
                  <Alert color="yellow" title="Context required" role="status">
                    Unresolved Template Servers: {model.preview.unresolvedTemplates.join(', ')}
                  </Alert>
                ) : null}
                <Stack gap={4} aria-label="Effective servers">
                  <Group justify="space-between">
                    <Text size="xs" fw={800}>
                      Effective servers
                    </Text>
                    <Badge variant="outline">{model.preview.effectiveServers.length}</Badge>
                  </Group>
                  {model.preview.effectiveServers.map((server) => (
                    <Group key={`${server.target.source}:${server.target.name}`} justify="space-between" wrap="nowrap">
                      <Text size="xs">
                        <Text component="span" c="dimmed" inherit>
                          {server.target.source} /
                        </Text>{' '}
                        {server.target.name}
                      </Text>
                      <Badge color={server.hasInstructions ? 'teal' : 'gray'} variant="light">
                        {server.hasInstructions ? 'Instructions' : 'No instructions'}
                      </Badge>
                    </Group>
                  ))}
                  {model.preview.effectiveServers.length === 0 ? (
                    <Text size="xs" c="dimmed">
                      No effective servers matched this selection.
                    </Text>
                  ) : null}
                </Stack>
              </>
            ) : (
              <Stack align="center" gap={4} className="instruction-preview-empty">
                <CheckCircle2 size={20} />
                <Text size="sm" fw={700}>
                  Save, then preview this surface
                </Text>
                <Text size="xs" c="dimmed" ta="center">
                  Changing the draft, surface, target selection, or request context expires the preview.
                </Text>
              </Stack>
            )}
          </div>
          <Button
            variant="default"
            disabled={!model.selectedIdentity || model.dirty || model.busy}
            onClick={() => void model.validateDraft()}
          >
            Validate both surfaces
          </Button>
          <Button
            leftSection={<ShieldCheck size={15} />}
            disabled={!activationReady || model.busy}
            onClick={() => void model.activate()}
          >
            Activate template
          </Button>
        </aside>
      </div>
    </section>
  );
}

function RequestContextForm({ value, onChange }: { value: string; onChange(value: string): void }) {
  const context = parseContextFormValue(value);
  const enabled = value.trim().length > 0;
  const update = (next: Partial<typeof context>) => onChange(JSON.stringify({ ...context, ...next }));

  return (
    <Stack gap="xs">
      <Checkbox
        label="Use explicit request context"
        checked={enabled}
        onChange={(event) =>
          onChange(event.currentTarget.checked ? JSON.stringify({ project: {}, user: {}, environment: {} }) : '')
        }
      />
      {enabled ? (
        <>
          <TextInput
            label="Project name"
            value={context.project.name ?? ''}
            onChange={(event) => update({ project: { name: event.currentTarget.value } })}
          />
          <TextInput
            label="User name"
            value={context.user.name ?? ''}
            onChange={(event) => update({ user: { name: event.currentTarget.value } })}
          />
          <TextInput
            label="Environment prefixes"
            description="Comma-separated"
            value={(context.environment.prefixes ?? []).join(', ')}
            onChange={(event) =>
              update({
                environment: {
                  prefixes: event.currentTarget.value
                    .split(',')
                    .map((prefix) => prefix.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </>
      ) : null}
    </Stack>
  );
}

function parseContextFormValue(value: string): {
  project: { name?: string };
  user: { name?: string };
  environment: { prefixes?: string[] };
} {
  if (!value.trim()) return { project: {}, user: {}, environment: {} };
  try {
    const parsed = JSON.parse(value) as {
      project?: { name?: string };
      user?: { name?: string };
      environment?: { prefixes?: string[] };
    };
    return {
      project: parsed.project ?? {},
      user: parsed.user ?? {},
      environment: parsed.environment ?? {},
    };
  } catch {
    return { project: {}, user: {}, environment: {} };
  }
}

function SelectionInput({
  selection,
  onChange,
}: {
  selection: InstructionTemplateSelection;
  onChange(selection: InstructionTemplateSelection): void;
}) {
  if (selection.mode === 'all') return null;
  if (selection.mode === 'preset') {
    return (
      <TextInput
        label="Preset"
        value={selection.preset}
        onChange={(event) => onChange({ mode: 'preset', preset: event.currentTarget.value })}
      />
    );
  }
  if (selection.mode === 'tags') {
    return (
      <TextInput
        label="Tags"
        description="Comma-separated"
        value={selection.tags.join(', ')}
        onChange={(event) =>
          onChange({
            mode: 'tags',
            tags: event.currentTarget.value
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
          })
        }
      />
    );
  }
  return (
    <TextInput
      label="Tag filter"
      value={selection.expression}
      onChange={(event) => onChange({ mode: 'tag-filter', expression: event.currentTarget.value })}
    />
  );
}

function defaultSelection(mode: string): InstructionTemplateSelection {
  if (mode === 'preset') return { mode, preset: '' };
  if (mode === 'tags') return { mode, tags: [] };
  if (mode === 'tag-filter') return { mode, expression: '' };
  return { mode: 'all' };
}

function surfaceLabel(surface: InstructionTemplateSurface): string {
  return surface === 'cli' ? 'CLI' : 'Initialization';
}

import {
  Alert,
  AppShell,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';

import {
  Boxes,
  FileClock,
  Gauge,
  Info,
  LogOut,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

import {
  buildTagAuthoringQuery,
  evaluateTagAuthoringQuery,
  parseTagAuthoringQuery,
  type TagAuthoringState,
} from '../../../../src/domains/preset/tagAuthoring';
import type {
  AdminPresetDraft,
  AdminPresetListItem,
  AdminPresetPreview,
  AdminPresetTarget,
  ConfiguredServerEditDraft,
} from '../api/adminApi';
import type { AdminConsoleState } from '../state/adminConsoleState';
import {
  disabledServers,
  enabledServers,
  humanize,
  isOAuthAttention,
  runtimeEndpointSummary,
  runtimeSummary,
  viewBadgeColor,
  viewLabel,
} from './adminConsoleUtils';
import { ConfiguredServerDetailPanel, type ConfiguredServerDetailPanelState } from './ConfiguredServerDetailPanel';
import { ConfiguredServersPanel } from './ConfiguredServersPanel';
import { AuditPanel, OAuthPanel, RuntimePanel } from './OperationsStatusPanels';

export type { ConfiguredServerDetailPanelState } from './ConfiguredServerDetailPanel';

export interface AdminConsoleAppProps {
  state: AdminConsoleState;
  serverDetail?: ConfiguredServerDetailPanelState;
  onLogin?: (input: { username: string; password: string }) => void | Promise<void>;
  onLogout?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onServerAction?: (serverId: string, action: 'enable' | 'disable') => void | Promise<void>;
  onOpenServerDetail?: (serverId: string) => void | Promise<void>;
  onCloseServerDetail?: (dirty?: boolean) => void | Promise<void>;
  onServerDetailDirtyChange?: (dirty: boolean) => void;
  onPreviewServerEdit?: (
    serverId: string,
    edit: ConfiguredServerEditDraft,
    connectivityCheck?: 'auto' | 'manual',
  ) => void | Promise<void>;
  onCopyText?: (label: string, value: string) => void | Promise<void>;
  loginBusy?: boolean;
  route?: 'overview' | 'presets' | 'about';
  onNavigate?: (route: 'overview' | 'presets' | 'about') => void;
  presets?: AdminPresetListItem[];
  presetTargets?: AdminPresetTarget[];
  presetRevision?: string;
  presetBusy?: boolean;
  onLoadPresets?: () => void | Promise<void>;
  onPreviewPreset?: (draft: AdminPresetDraft, sourceName?: string) => Promise<AdminPresetPreview>;
  onSavePreset?: (input: {
    action: 'create' | 'update' | 'duplicate';
    sourceName?: string;
    preview: AdminPresetPreview;
  }) => void | Promise<void>;
  onDeletePreset?: (name: string) => void | Promise<void>;
}

export function AdminConsoleApp({
  state,
  serverDetail = { status: 'list' },
  onLogin,
  onLogout,
  onRefresh,
  onServerAction,
  onOpenServerDetail,
  onCloseServerDetail,
  onServerDetailDirtyChange,
  onPreviewServerEdit,
  onCopyText,
  loginBusy = false,
  route = 'overview',
  onNavigate,
  presets = [],
  presetTargets = [],
  presetBusy = false,
  onLoadPresets,
  onPreviewPreset,
  onSavePreset,
  onDeletePreset,
}: AdminConsoleAppProps) {
  if (state.view !== 'console') {
    return (
      <AuthShell state={state}>
        {state.view === 'setupRequired' ? <SetupRequiredView /> : null}
        {state.view === 'loading' || state.view === 'login' ? (
          <LoginView loading={state.view === 'loading' || loginBusy} onLogin={onLogin} />
        ) : null}
      </AuthShell>
    );
  }

  return (
    <AppShell
      className="admin-app-shell"
      header={{ height: 66 }}
      navbar={{ width: 224, breakpoint: 'md', collapsed: { mobile: true } }}
      padding={0}
    >
      <AppShell.Header aria-label="Admin Console" className="admin-app-header">
        <Group h="100%" px="lg" justify="space-between" wrap="nowrap" className="command-bar">
          <Group gap="sm" wrap="nowrap">
            <div className="brand-mark" aria-hidden="true">
              1
            </div>
            <div>
              <Text className="eyebrow command-eyebrow" size="xs">
                1MCP control plane
              </Text>
              <Title order={1} size="h4">
                Admin Console
              </Title>
            </div>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <div className="runtime-live" aria-label="Runtime online">
              <span className="runtime-live-dot" />
              <Text size="xs" fw={800}>
                Runtime online
              </Text>
            </div>
            <Badge variant="light" color={viewBadgeColor(state)}>
              {viewLabel(state)}
            </Badge>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar className="admin-app-navbar" aria-label="Operations navigation">
        <Stack gap="xs" className="nav-stack">
          <Text className="nav-section-label">Workspace</Text>
          <NavItem
            icon={<Gauge size={17} />}
            label="Overview"
            active={route === 'overview'}
            onClick={() => onNavigate?.('overview')}
          />
          <NavItem icon={<Boxes size={17} />} label="Server inventory" />
          <NavItem icon={<ShieldCheck size={17} />} label="OAuth services" />
          <NavItem icon={<FileClock size={17} />} label="Audit trail" />
          <NavItem
            icon={<SlidersHorizontal size={17} />}
            label="Presets"
            active={route === 'presets'}
            onClick={() => onNavigate?.('presets')}
          />
          <NavItem
            icon={<Info size={17} />}
            label="About"
            active={route === 'about'}
            onClick={() => onNavigate?.('about')}
          />
        </Stack>
        <Stack gap="xs" className="nav-runtime-card">
          <Text className="nav-section-label">Runtime target</Text>
          <Text fw={800} className="truncate">
            {runtimeSummary(state.status?.runtime)}
          </Text>
          <Text size="xs" c="dimmed" className="truncate">
            {runtimeEndpointSummary(state.status?.runtime)}
          </Text>
          <Text size="xs" className="nav-scope truncate">
            {state.status?.runtime.runtimeScopeId ?? 'scope unavailable'}
          </Text>
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main className="admin-shell-main">
        <Stack gap="md" className="admin-console">
          <Banner state={state} />
          {route === 'presets' ? (
            <PresetsView
              presets={presets}
              busy={presetBusy}
              onLoad={onLoadPresets}
              onPreview={onPreviewPreset}
              onSave={onSavePreset}
              onDelete={onDeletePreset}
              runtimeScopeId={state.status?.runtime.runtimeScopeId}
              presetTargets={
                presetTargets.length > 0
                  ? presetTargets
                  : state.configuredServers.map((server) => ({
                      name: server.id,
                      tags: server.tags,
                      enabled: server.enabled,
                    }))
              }
            />
          ) : route === 'about' ? (
            <AboutView state={state} />
          ) : (
            <ConsoleView
              state={state}
              onLogout={onLogout}
              onRefresh={onRefresh}
              onServerAction={onServerAction}
              onOpenServerDetail={onOpenServerDetail}
              onCloseServerDetail={onCloseServerDetail}
              onServerDetailDirtyChange={onServerDetailDirtyChange}
              onPreviewServerEdit={onPreviewServerEdit}
              onCopyText={onCopyText}
              serverDetail={serverDetail}
            />
          )}
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}

function NavItem({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={`nav-item${active ? ' nav-item-active' : ''}`} onClick={onClick}>
      {icon}
      <Text size="sm" fw={700}>
        {label}
      </Text>
    </button>
  );
}

function AuthShell({ state, children }: { state: AdminConsoleState; children: ReactNode }) {
  return (
    <main className="admin-auth-shell" aria-label="Admin authentication">
      <Stack gap="md" className="admin-auth-card">
        <Banner state={state} />
        {children}
      </Stack>
    </main>
  );
}

function SetupRequiredView() {
  return (
    <Paper component="section" className="operations-panel" aria-labelledby="setup-required-title" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text className="eyebrow" size="xs">
              Runtime gate
            </Text>
            <Title id="setup-required-title" order={2}>
              Setup required
            </Title>
          </div>
          <Badge color="yellow" variant="filled">
            No Admin Account
          </Badge>
        </Group>
        <Text c="dimmed">
          Run CLI bootstrap from the runtime host, then refresh this page. The browser setup page does not create admin
          accounts.
        </Text>
        <Code block>1mcp admin bootstrap --username operator --password 'use-a-long-random-password'</Code>
      </Stack>
    </Paper>
  );
}

function LoginView({ loading, onLogin }: { loading: boolean; onLogin?: AdminConsoleAppProps['onLogin'] }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Paper component="section" className="login-panel" aria-labelledby="login-title" withBorder>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!loading) {
            void onLogin?.({ username, password });
          }
        }}
      >
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <div>
              <Text className="eyebrow" size="xs">
                Admin Session
              </Text>
              <Title id="login-title" order={2}>
                Operator login
              </Title>
            </div>
            <Badge variant="light">{loading ? 'Checking session' : 'Login required'}</Badge>
          </Group>
          <TextInput
            label="Username"
            autoComplete="username"
            disabled={loading}
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            required
          />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            disabled={loading}
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
          />
          <Button type="submit" loading={loading} disabled={loading}>
            {loading ? 'Checking' : 'Log in'}
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}

function ConsoleView({
  state,
  onLogout,
  onRefresh,
  onServerAction,
  onOpenServerDetail,
  onCloseServerDetail,
  onServerDetailDirtyChange,
  onPreviewServerEdit,
  onCopyText,
  serverDetail,
}: {
  state: AdminConsoleState;
  onLogout?: AdminConsoleAppProps['onLogout'];
  onRefresh?: AdminConsoleAppProps['onRefresh'];
  onServerAction?: AdminConsoleAppProps['onServerAction'];
  onOpenServerDetail?: AdminConsoleAppProps['onOpenServerDetail'];
  onCloseServerDetail?: AdminConsoleAppProps['onCloseServerDetail'];
  onServerDetailDirtyChange?: AdminConsoleAppProps['onServerDetailDirtyChange'];
  onPreviewServerEdit?: AdminConsoleAppProps['onPreviewServerEdit'];
  onCopyText?: AdminConsoleAppProps['onCopyText'];
  serverDetail: ConfiguredServerDetailPanelState;
}) {
  const failedAudits = (state.status?.audit.facts ?? []).filter((fact) => fact.result === 'failed').length;
  const oauthAttention = (state.status?.oauth.services ?? []).filter(isOAuthAttention).length;
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  async function copyText(label: string, value: string): Promise<void> {
    try {
      await onCopyText?.(label, value);
      setCopyFeedback(`${humanize(label)} copied.`);
    } catch {
      setCopyFeedback(`Could not copy ${humanize(label)}. Select the value manually.`);
    }
  }

  return (
    <section aria-labelledby="runtime-operations-title" className="operations-workspace">
      <Title id="runtime-operations-title" order={2} className="sr-only">
        Runtime operations
      </Title>
      <Group justify="space-between" align="flex-start" className="workspace-heading">
        <div>
          <Text className="eyebrow" size="xs">
            Operator workspace / live
          </Text>
          <Title order={2}>Operations overview</Title>
          <Text c="dimmed" size="sm">
            Runtime operations for {state.session?.account.username ?? 'operator'} · {state.configuredServers.length}{' '}
            configured targets · updated {state.lastUpdatedAt ?? 'never'}
          </Text>
        </div>
        <Group gap="xs">
          <Button variant="default" leftSection={<RefreshCw size={16} />} onClick={() => void onRefresh?.()}>
            Refresh
          </Button>
          <Button color="red" variant="light" leftSection={<LogOut size={16} />} onClick={() => void onLogout?.()}>
            Log out
          </Button>
        </Group>
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" className="summary-grid">
        <SummaryCounter label="Enabled servers" value={enabledServers(state.configuredServers)} tone="good" icon="01" />
        <SummaryCounter
          label="Disabled servers"
          value={disabledServers(state.configuredServers)}
          tone="warn"
          icon="02"
        />
        <SummaryCounter
          label="OAuth attention"
          value={oauthAttention}
          tone={oauthAttention > 0 ? 'warn' : 'good'}
          icon="03"
        />
        <SummaryCounter label="Failed audits" value={failedAudits} tone={failedAudits > 0 ? 'bad' : 'good'} icon="04" />
      </SimpleGrid>
      <div className="workspace-grid">
        <div className="inventory-column">
          <ConfiguredServersPanel
            state={state}
            onServerAction={onServerAction}
            onOpenServerDetail={onOpenServerDetail}
          />
          <AuditPanel facts={state.status?.audit.facts ?? []} onCopyText={copyText} />
        </div>
        <div className="inspector-column">
          <ConfiguredServerDetailPanel
            state={serverDetail}
            onClose={onCloseServerDetail}
            onDirtyChange={onServerDetailDirtyChange}
            onPreviewServerEdit={onPreviewServerEdit}
          />
          <RuntimePanel runtime={state.status?.runtime} onCopyText={copyText} />
          <OAuthPanel services={state.status?.oauth.services ?? []} />
        </div>
      </div>
      {copyFeedback ? (
        <Alert aria-live="polite" color={copyFeedback.startsWith('Could not') ? 'red' : 'teal'} mt="sm">
          {copyFeedback}
        </Alert>
      ) : null}
    </section>
  );
}

function SummaryCounter({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'good' | 'warn' | 'bad';
  icon: string;
}) {
  return (
    <Paper className={`summary-counter summary-${tone}`} withBorder>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed" fw={800} tt="uppercase">
            {label}
          </Text>
          <Text className="summary-value">{value}</Text>
        </div>
        <Text className="summary-index">{icon}</Text>
      </Group>
    </Paper>
  );
}

function Banner({ state }: { state: AdminConsoleState }) {
  const banner = state.banner ?? (state.error ? { kind: 'error' as const, message: state.error } : null);
  if (!banner) {
    return null;
  }

  return (
    <Alert color={banner.kind === 'error' ? 'red' : 'teal'} role={banner.kind === 'error' ? 'alert' : 'status'}>
      {banner.message}
    </Alert>
  );
}

function PresetsView({
  presets,
  busy,
  onLoad,
  onPreview,
  onSave,
  onDelete,
  runtimeScopeId,
  presetTargets,
}: {
  presets: AdminPresetListItem[];
  busy: boolean;
  onLoad?: () => void | Promise<void>;
  onPreview?: (draft: AdminPresetDraft, sourceName?: string) => Promise<AdminPresetPreview>;
  onSave?: AdminConsoleAppProps['onSavePreset'];
  onDelete?: AdminConsoleAppProps['onDeletePreset'];
  runtimeScopeId?: string;
  presetTargets: AdminPresetTarget[];
}) {
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
      const next = await onPreview?.(draft(), sourceName);
      setPreview(next ?? null);
      if (next) setStructuredConversion(next.structuredConversion);
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
    await onSave?.({ action, sourceName, preview });
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
          <Button variant="default" onClick={() => void onLoad?.()} loading={busy}>
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
                      onClick={() => void onDelete?.(preset.name)}
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

function AboutView({ state }: { state: AdminConsoleState }) {
  const about = state.status?.about;
  if (!about) return <Alert>About metadata is unavailable.</Alert>;
  return (
    <section aria-labelledby="about-title" className="operations-workspace">
      <Text className="eyebrow" size="xs">
        Product and protocol metadata
      </Text>
      <Title id="about-title" order={2}>
        About {about.productName}
      </Title>
      {!about.protocolCompatible ? (
        <Alert color="red" title="Admin UI protocol incompatibility">
          This Admin UI build expects protocol {about.adminUiProtocolVersion ?? 'Unavailable'}, but the runtime exposes{' '}
          {about.adminApiProtocolVersion}.
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 1, md: 2 }} mt="md">
        <AboutPanel
          title="Versions"
          values={[
            ['Runtime Version', about.runtimeVersion],
            ['Admin UI Build Version', about.adminUiBuildVersion ?? 'Unavailable'],
            ['Admin API Protocol Version', about.adminApiProtocolVersion],
            ['Admin UI Protocol Version', about.adminUiProtocolVersion ?? 'Unavailable'],
          ]}
        />
        <AboutPanel
          title="Runtime Scope"
          values={[
            ['Runtime Scope ID', about.runtime.runtimeScopeId],
            ['External URL', about.runtime.externalUrl ?? 'Unavailable'],
          ]}
        />
        <AboutPanel
          title="Build"
          values={[
            ['Commit', about.build.commit ?? 'Unavailable'],
            ['Build timestamp', about.build.timestamp ?? 'Unavailable'],
          ]}
        />
        <Paper withBorder p="md">
          <Title order={3}>Project</Title>
          <Stack gap="xs" mt="sm">
            {about.project.repository ? (
              <SafeExternalLink label="Repository" href={about.project.repository} />
            ) : (
              <Text>Repository · Unavailable</Text>
            )}
            {about.project.documentation ? (
              <SafeExternalLink label="Documentation" href={about.project.documentation} />
            ) : (
              <Text>Documentation · Unavailable</Text>
            )}
            {about.project.issues ? (
              <SafeExternalLink label="Report an issue" href={about.project.issues} />
            ) : (
              <Text>Issue reporting · Unavailable</Text>
            )}
            <Text>License · {about.project.license ?? 'Unavailable'}</Text>
          </Stack>
        </Paper>
      </SimpleGrid>
    </section>
  );
}

function AboutPanel({ title, values }: { title: string; values: Array<[string, string]> }) {
  return (
    <Paper withBorder p="md">
      <Title order={3}>{title}</Title>
      <Stack gap="xs" mt="sm">
        {values.map(([label, value]) => (
          <div key={label}>
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text>{value}</Text>
          </div>
        ))}
      </Stack>
    </Paper>
  );
}

function SafeExternalLink({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`}>
      {label}
    </a>
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

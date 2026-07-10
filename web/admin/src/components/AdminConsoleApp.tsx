import {
  Alert,
  AppShell,
  Badge,
  Button,
  Code,
  Group,
  NativeSelect,
  Paper,
  PasswordInput,
  Radio,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';

import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clipboard,
  FileClock,
  Gauge,
  LogOut,
  Pencil,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import type {
  AdminAuditFact,
  ConfiguredServerDetailResponse,
  ConfiguredServerEditDraft,
  ConfiguredServerEditField,
  ConfiguredServerPreviewResponse,
  ConfiguredServerReadModel,
  OAuthServiceStatus,
  RuntimeIdentity,
} from '../api/adminApi';
import type { AdminConsoleState, ServerMutation } from '../state/adminConsoleState';

type ServerFilter = 'all' | 'enabled' | 'disabled';

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
}

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
          <NavItem icon={<Gauge size={17} />} label="Overview" active />
          <NavItem icon={<Boxes size={17} />} label="Server inventory" />
          <NavItem icon={<ShieldCheck size={17} />} label="OAuth services" />
          <NavItem icon={<FileClock size={17} />} label="Audit trail" />
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
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}

function NavItem({ icon, label, active = false }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <div className={`nav-item${active ? ' nav-item-active' : ''}`}>
      {icon}
      <Text size="sm" fw={700}>
        {label}
      </Text>
    </div>
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

function ConfiguredServersPanel({
  state,
  onServerAction,
  onOpenServerDetail,
}: {
  state: AdminConsoleState;
  onServerAction?: AdminConsoleAppProps['onServerAction'];
  onOpenServerDetail?: AdminConsoleAppProps['onOpenServerDetail'];
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ServerFilter>('all');
  const servers = useMemo(
    () => filterServers(state.configuredServers, query, filter),
    [filter, query, state.configuredServers],
  );

  return (
    <Panel
      title="Server inventory"
      utility={`${servers.length} of ${state.configuredServers.length} targets`}
      icon={<ServerCog size={17} />}
    >
      <Group align="flex-end" gap="sm" className="server-filter-row">
        <TextInput
          className="server-search"
          leftSection={<Search size={16} />}
          label="Search servers"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <SegmentedControl
          aria-label="Server status filter"
          value={filter}
          onChange={(value) => setFilter(value as ServerFilter)}
          data={[
            { label: 'All', value: 'all' },
            { label: 'Enabled', value: 'enabled' },
            { label: 'Disabled', value: 'disabled' },
          ]}
        />
      </Group>
      {servers.length === 0 ? (
        <EmptyState message="No servers match the current filter." />
      ) : (
        <Table.ScrollContainer minWidth={820}>
          <Table className="admin-table" verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Server</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Transport</Table.Th>
                <Table.Th>Secrets</Table.Th>
                <Table.Th>Action</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {servers.map((server) => (
                <ServerRow
                  key={server.id}
                  server={server}
                  mutation={state.serverMutations[server.id]}
                  onServerAction={onServerAction}
                  onOpenServerDetail={onOpenServerDetail}
                />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Panel>
  );
}

function ServerRow({
  server,
  mutation,
  onServerAction,
  onOpenServerDetail,
}: {
  server: ConfiguredServerReadModel;
  mutation?: ServerMutation;
  onServerAction?: AdminConsoleAppProps['onServerAction'];
  onOpenServerDetail?: AdminConsoleAppProps['onOpenServerDetail'];
}) {
  const action = server.enabled ? 'disable' : 'enable';
  const busy = mutation?.state === 'busy';
  const tags = serverTags(server);
  const actionState = serverActionState(server, action);
  const actionUnavailable = !serverMutationsAvailable(server) || !actionState.available;

  return (
    <Table.Tr className={mutation ? `server-action-${mutation.state}` : undefined}>
      <Table.Td>
        <Text fw={700}>{server.id}</Text>
        {tags.length > 0 ? (
          <Text size="xs" c="dimmed">
            {tags.join(' / ')}
          </Text>
        ) : null}
        {mutation?.message ? (
          <Text size="xs" c={mutation.state === 'failed' ? 'red' : 'dimmed'}>
            {mutation.message}
          </Text>
        ) : null}
      </Table.Td>
      <Table.Td>
        <Badge color={server.enabled ? 'teal' : 'yellow'} variant="light">
          {server.enabled ? 'enabled' : 'disabled'}
        </Badge>
      </Table.Td>
      <Table.Td>{transportSummaryLabel(server)}</Table.Td>
      <Table.Td>{secretSummary(server)}</Table.Td>
      <Table.Td>
        <Group gap="xs" wrap="wrap">
          <Button
            aria-label={`Edit ${server.id} server`}
            leftSection={<Pencil size={14} />}
            size="xs"
            variant="default"
            onClick={() => void onOpenServerDetail?.(server.id)}
          >
            Edit server
          </Button>
          <Button
            size="xs"
            color={action === 'disable' ? 'red' : 'teal'}
            variant={action === 'disable' ? 'light' : 'filled'}
            loading={busy}
            disabled={busy || actionUnavailable}
            onClick={() => void onServerAction?.(server.id, action)}
          >
            {actionState.label}
          </Button>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

type SecretDraftState = Record<
  string,
  {
    fieldPath: string[];
    action: 'preserve' | 'replace' | 'clear';
    replacementKind: 'environmentReference' | 'inlineSecret';
    replacementValue: string;
  }
>;

type FieldDraftState = Record<string, unknown>;

function ConfiguredServerDetailPanel({
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

function editGroupHelp(groupId: string): string {
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

function ConfiguredServerFieldDraft({
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

function SecretFieldDraft({
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

function PreviewResult({ preview }: { preview: ConfiguredServerPreviewResponse['preview'] }) {
  const connectivity = preview.connectivityCheck;
  const validationTone = preview.validation.status === 'valid' ? 'teal' : 'red';
  const connectivityTone =
    connectivity.status === 'passed' ? 'teal' : connectivity.status === 'failed' ? 'red' : 'yellow';

  return (
    <Paper className="preview-result" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={800}>Preview result</Text>
            <Text c="dimmed" size="xs">
              Domain facts only. No config has been written.
            </Text>
          </div>
          <Code className="preview-fingerprint">{preview.previewFingerprint}</Code>
        </Group>
        <Alert color="blue" variant="light">
          Preview only - no config has been written.
        </Alert>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <DetailRow label="Target" value={preview.targetName} meta={`Proposed: ${preview.proposedTargetName}`} />
          <DetailRow
            label="Validation"
            value={preview.validation.status}
            meta={
              preview.validation.errors.length > 0
                ? `${preview.validation.errors.length} field issue${preview.validation.errors.length === 1 ? '' : 's'}`
                : 'Ready for confirmation when apply is available'
            }
          />
          <DetailRow
            label="Config change"
            value={preview.configChange.status}
            meta={`${preview.configChange.operation} / ${preview.configChange.changed ? 'changed' : 'unchanged'}`}
          />
          <DetailRow
            label="Reload"
            value={preview.configChange.reload.status}
            meta={preview.configChange.reload.error}
          />
          <DetailRow
            label="Backup"
            value={preview.configChange.backup.created ? 'created' : 'not created'}
            meta={preview.configChange.backup.path}
          />
          <Paper className={`connectivity-card connectivity-${connectivity.status}`} withBorder>
            <Stack gap={4}>
              <Group justify="space-between" gap="xs">
                <Text fw={700}>Connectivity</Text>
                <Badge color={connectivityTone} variant="light">
                  {connectivity.status}
                </Badge>
              </Group>
              <Text size="sm">{connectivitySummary(connectivity)}</Text>
              {connectivityMeta(preview) ? (
                <Text c="dimmed" size="xs">
                  {connectivityMeta(preview)}
                </Text>
              ) : null}
            </Stack>
          </Paper>
        </SimpleGrid>
        {preview.configChange.warnings?.map((warning) => (
          <DetailRow key={`warning:${warning}`} label="Warning" value={warning} />
        ))}
        {preview.configChange.retentionCleanup.warnings.map((warning) => (
          <DetailRow key={`retention:${warning}`} label="Retention warning" value={warning} />
        ))}
        {preview.validation.errors.length > 0 ? (
          <Stack gap="xs">
            <Group gap="xs">
              <Text fw={800}>Validation issues</Text>
              <Badge color={validationTone} variant="light">
                {preview.validation.errors.length}
              </Badge>
            </Group>
            {preview.validation.errors.map((error) => (
              <DetailRow
                key={`${fieldKey(error.fieldPath)}:${error.code}`}
                label={error.fieldPath.join('.') || 'form'}
                value={error.code}
                meta={error.message}
              />
            ))}
          </Stack>
        ) : null}
        {preview.diff.length > 0 ? (
          <Stack gap="xs">
            <Group gap="xs">
              <Text fw={800}>Redacted diff</Text>
              <Badge variant="outline">
                {preview.diff.length} change{preview.diff.length === 1 ? '' : 's'}
              </Badge>
            </Group>
            {preview.diff.map((entry) => (
              <Paper key={fieldKey(entry.fieldPath)} className="preview-diff-entry" withBorder>
                <Stack gap={6}>
                  <Group justify="space-between" align="flex-start" gap="xs">
                    <Text fw={700}>{entry.fieldPath.join('.')}</Text>
                    <Group gap={4}>
                      {entry.secretAction ? (
                        <Badge color="grape" variant="light">
                          secret: {entry.secretAction}
                        </Badge>
                      ) : null}
                      {entry.riskFlags.map((flag) => (
                        <Badge key={flag} color={riskFlagColor(flag)} variant="light">
                          {riskFlagLabel(flag)}
                        </Badge>
                      ))}
                    </Group>
                  </Group>
                  <Text size="sm">
                    <Text span c="dimmed">
                      from{' '}
                    </Text>
                    {formatPreviewValue(entry.oldValue)}
                    <Text span c="dimmed">
                      {' '}
                      to{' '}
                    </Text>
                    {formatPreviewValue(entry.newValue)}
                  </Text>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Text c="dimmed" size="sm">
            No field-level changes were reported by preview.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function buildPreviewEdit(
  fieldGroups: ConfiguredServerDetailResponse['editContract']['fieldGroups'],
  fieldDraft: FieldDraftState,
  initialFieldDraft: FieldDraftState,
  secretDraft: SecretDraftState,
): ConfiguredServerEditDraft {
  const edit: Record<string, unknown> = {};
  const transport: Record<string, unknown> = {};

  for (const group of fieldGroups) {
    for (const field of group.fields) {
      if (field.control === 'secret' || !field.editable || field.control === 'readonly') {
        continue;
      }

      const key = fieldKey(field.fieldPath);
      const value = draftValueForField(field, fieldDraft[key]);
      if (stableDisplayValue(value) === stableDisplayValue(draftValueForField(field, initialFieldDraft[key]))) {
        continue;
      }

      const root = field.fieldPath[0];
      if (root === 'id') {
        edit.id = String(value ?? '');
      } else if (root === 'enabled') {
        edit.enabled = Boolean(value);
      } else if (root === 'tags') {
        edit.tags = stringArray(value);
      } else if (root === 'transport' && field.fieldPath.length > 1) {
        setNestedDraftValue(transport, field.fieldPath.slice(1), value);
      } else if (root) {
        setNestedDraftValue(edit, field.fieldPath, value);
      }
    }
  }

  const secrets = Object.values(secretDraft)
    .filter((draft) => draft.action !== 'preserve')
    .map((draft) => ({
      fieldPath: draft.fieldPath,
      action: draft.action,
      ...(draft.action === 'replace'
        ? {
            replacement: {
              kind: draft.replacementKind,
              value: draft.replacementValue,
            },
          }
        : {}),
    }));

  return {
    ...edit,
    ...(Object.keys(transport).length > 0 ? { transport } : {}),
    ...(secrets.length > 0 ? { secrets } : {}),
  } as ConfiguredServerEditDraft;
}

function setNestedDraftValue(target: Record<string, unknown>, path: string[], value: unknown) {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  const leaf = path.at(-1);
  if (leaf) {
    cursor[leaf] = value;
  }
}

function initialDraftValue(field: ConfiguredServerEditField): unknown {
  return draftValueForField(field, field.value);
}

function draftValueForField(field: ConfiguredServerEditField, value: unknown): unknown {
  if (field.control === 'switch') {
    return Boolean(value);
  }
  if (field.control === 'tag-list' || field.control === 'string-list') {
    return stringArray(value);
  }
  if (field.control === 'record') {
    return objectRecord(value);
  }
  if (field.control === 'text' || field.control === 'select') {
    return String(value ?? '');
  }
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function splitStringList(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function displayFieldValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).length > 0 ? Object.keys(value).join(', ') : '-';
  }
  return String(value ?? '-');
}

function formatPreviewValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '-';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatPreviewValue).join(', ');
  }
  if (typeof value !== 'object') {
    return '-';
  }

  const record = value as Record<string, unknown>;
  if (record.secret === true || record.value === '[REDACTED]') {
    return '[REDACTED]';
  }
  if (record.kind === 'inlineSecret') {
    return 'inline secret: [REDACTED]';
  }
  if (typeof record.kind === 'string' && typeof record.value === 'string') {
    return `${humanize(record.kind)}: ${record.value}`;
  }

  return Object.entries(record)
    .map(([key, nestedValue]) => `${key}: ${secretLikeKey(key) ? '[REDACTED]' : formatPreviewValue(nestedValue)}`)
    .join('; ');
}

function secretLikeKey(key: string): boolean {
  return /authorization|password|secret|token/iu.test(key);
}

function stableDisplayValue(value: unknown): string {
  return JSON.stringify(value);
}

function RuntimePanel({
  runtime,
  onCopyText,
}: {
  runtime?: RuntimeIdentity;
  onCopyText?: (label: string, value: string) => Promise<void>;
}) {
  return (
    <Panel title="Runtime identity" utility="Runtime health · support details" icon={<Activity size={17} />}>
      {runtime ? (
        <Stack gap="xs">
          <DetailRow label="Version" value={runtime.runtimeVersion} />
          <DetailRow
            label="External URL"
            value={runtime.externalUrl ?? '-'}
            copyLabel="externalUrl"
            onCopyText={onCopyText}
          />
          <Paper className="identity-details" withBorder>
            <Stack gap={4}>
              <Text className="eyebrow" size="xs">
                Identity details
              </Text>
              <Text size="sm" c="dimmed">
                Full runtime scope ID is support metadata. Prefer version and external URL in the main scan path.
              </Text>
              <DetailRow
                label="Runtime scope"
                value={runtime.runtimeScopeId}
                copyLabel="runtimeScopeId"
                onCopyText={onCopyText}
              />
            </Stack>
          </Paper>
        </Stack>
      ) : (
        <EmptyState message="Runtime status has not loaded." />
      )}
    </Panel>
  );
}

function OAuthPanel({ services }: { services: OAuthServiceStatus[] }) {
  return (
    <Panel title="OAuth status" utility={`${services.length} services`} icon={<CheckCircle2 size={17} />}>
      {services.length === 0 ? (
        <EmptyState message="No OAuth services reported." />
      ) : (
        <Stack gap="xs">
          {services.map((service) => (
            <DetailRow
              key={service.name}
              label={service.name}
              value={service.status}
              meta={service.requiresOAuth ? 'OAuth required' : 'No OAuth'}
              description={service.lastError}
            />
          ))}
        </Stack>
      )}
    </Panel>
  );
}

function AuditPanel({
  facts,
  onCopyText,
}: {
  facts: AdminAuditFact[];
  onCopyText?: (label: string, value: string) => Promise<void>;
}) {
  return (
    <Panel title="Recent audit facts" utility="redacted" icon={<AlertTriangle size={17} />}>
      {facts.length === 0 ? (
        <EmptyState message="No recent admin audit facts." />
      ) : (
        <Stack gap="xs">
          {facts.map((fact) => (
            <DetailRow
              key={fact.operationId ?? `${fact.operationName}-${fact.timestamp}`}
              label={fact.operationName}
              value={fact.result}
              meta={fact.target?.id ?? fact.operationId ?? '-'}
              description={fact.timestamp}
              copyLabel={fact.request?.requestId ? 'requestId' : undefined}
              copyValue={fact.request?.requestId}
              onCopyText={onCopyText}
            />
          ))}
        </Stack>
      )}
    </Panel>
  );
}

function DetailRow({
  label,
  value,
  meta,
  description,
  copyLabel,
  copyValue,
  onCopyText,
}: {
  label: string;
  value: string;
  meta?: string;
  description?: string;
  copyLabel?: string;
  copyValue?: string;
  onCopyText?: (label: string, value: string) => Promise<void>;
}) {
  const valueToCopy = copyValue ?? value;

  return (
    <Group className="detail-row" justify="space-between" wrap="nowrap">
      <div className="detail-row-main">
        <Text fw={700}>{label}</Text>
        <Text className="truncate" size="sm">
          {value}
        </Text>
        {meta ? (
          <Text c="dimmed" size="xs">
            {meta}
          </Text>
        ) : null}
        {description ? (
          <Text c="dimmed" size="xs">
            {description}
          </Text>
        ) : null}
      </div>
      {copyLabel && valueToCopy !== '-' ? (
        <Button
          aria-label={`Copy ${humanize(copyLabel)}`}
          size="compact-xs"
          variant="subtle"
          leftSection={<Clipboard size={14} />}
          onClick={() => void onCopyText?.(copyLabel, valueToCopy)}
        >
          Copy
        </Button>
      ) : null}
    </Group>
  );
}

function Panel({
  title,
  utility,
  icon,
  children,
}: {
  title: string;
  utility: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper component="section" className="operations-panel" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            {icon}
            <Title order={3}>{title}</Title>
          </Group>
          <Text c="dimmed" size="xs">
            {utility}
          </Text>
        </Group>
        {children}
      </Stack>
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

function EmptyState({ message }: { message: string }) {
  return <Text c="dimmed">{message}</Text>;
}

function filterServers(servers: ConfiguredServerReadModel[], query: string, filter: ServerFilter) {
  const normalizedQuery = query.trim().toLowerCase();
  return servers.filter((server) => {
    const matchesQuery =
      !normalizedQuery ||
      server.id.toLowerCase().includes(normalizedQuery) ||
      serverTags(server).some((tag) => tag.toLowerCase().includes(normalizedQuery)) ||
      transportSummaryLabel(server).toLowerCase().includes(normalizedQuery) ||
      describeTransport(server.transport).toLowerCase().includes(normalizedQuery);
    const matchesFilter =
      filter === 'all' || (filter === 'enabled' && server.enabled) || (filter === 'disabled' && !server.enabled);
    return matchesQuery && matchesFilter;
  });
}

function enabledServers(servers: ConfiguredServerReadModel[]): number {
  return servers.filter((server) => server.enabled).length;
}

function disabledServers(servers: ConfiguredServerReadModel[]): number {
  return servers.filter((server) => !server.enabled).length;
}

function isOAuthAttention(service: OAuthServiceStatus): boolean {
  return Boolean(service.requiresOAuth) || service.status !== 'ready' || Boolean(service.lastError);
}

function describeTransport(transport: Record<string, unknown>): string {
  if (typeof transport.command === 'string') {
    return transport.command;
  }
  if (typeof transport.url === 'string') {
    return transport.url;
  }
  if (typeof transport.type === 'string') {
    return transport.type;
  }
  return 'configured';
}

function transportSummaryLabel(server: ConfiguredServerReadModel): string {
  return server.transportSummary?.label ?? describeTransport(server.transport);
}

function serverTags(server: ConfiguredServerReadModel): string[] {
  return Array.isArray(server.tags) ? server.tags : [];
}

function serverMutationsAvailable(server: ConfiguredServerReadModel): boolean {
  return server.mutationAvailability?.available ?? true;
}

function serverActionState(server: ConfiguredServerReadModel, action: 'enable' | 'disable') {
  return (
    server.actionState?.[action] ?? {
      available: true,
      label: action === 'enable' ? `Enable ${server.id}` : `Disable ${server.id}`,
    }
  );
}

function fieldKey(fieldPath: string[]): string {
  return fieldPath.join('\0');
}

function connectivityMeta(preview: ConfiguredServerPreviewResponse['preview']): string | undefined {
  const check = preview.connectivityCheck;
  if (check.status === 'skipped') {
    return connectivitySkipReason(check.reason);
  }
  if (check.status === 'failed') {
    return check.message;
  }
  return check.checkedAt ? `Checked at ${check.checkedAt}` : undefined;
}

function connectivitySummary(check: ConfiguredServerPreviewResponse['preview']['connectivityCheck']): string {
  if (check.status === 'passed') {
    return 'Bounded dry-run connectivity check passed.';
  }
  if (check.status === 'failed') {
    return 'Connectivity check failed. Apply remains blocked until the check passes or a later override path is available.';
  }
  return 'Connectivity check was skipped for this preview.';
}

function connectivitySkipReason(reason: string): string {
  switch (reason) {
    case 'connection_critical_fields_unchanged':
      return 'Connection-critical fields are unchanged. Rerun connectivity if you want an explicit check.';
    case 'target_disabled':
      return 'Target is disabled, so automatic connectivity was skipped.';
    case 'validation_failed':
      return 'Validation failed before a connectivity check could run.';
    case 'local_stdio_transport':
      return 'Local stdio transport does not use remote connectivity checks.';
    case 'checker_unavailable':
      return 'Connectivity checker is unavailable on this runtime.';
    case 'endpoint_changed_with_preserved_secrets':
      return 'Endpoint changed while secrets stayed preserved. Supply replacements or rerun after updating secrets.';
    default:
      return reason;
  }
}

function riskFlagColor(flag: string): string {
  switch (flag) {
    case 'rename':
      return 'violet';
    case 'connection_critical':
      return 'red';
    case 'secret':
      return 'grape';
    case 'template_risk':
      return 'orange';
    default:
      return 'gray';
  }
}

function riskFlagLabel(flag: string): string {
  switch (flag) {
    case 'rename':
      return 'rename';
    case 'connection_critical':
      return 'connection critical';
    case 'secret':
      return 'secret';
    case 'template_risk':
      return 'template risk';
    default:
      return flag;
  }
}

function secretSummary(server: ConfiguredServerReadModel): string {
  if (server.secretInputs.length === 0) {
    return 'No secret inputs';
  }
  return `${server.secretInputs.length} redacted`;
}

function runtimeSummary(runtime?: RuntimeIdentity): string {
  return runtime?.runtimeVersion ?? 'unknown';
}

function runtimeEndpointSummary(runtime?: RuntimeIdentity): string {
  return runtime?.externalUrl ?? 'not reported';
}

function viewLabel(state: AdminConsoleState): string {
  return state.view === 'setupRequired' ? 'Setup required' : state.view;
}

function viewBadgeColor(state: AdminConsoleState): string {
  if (state.view === 'setupRequired') {
    return 'yellow';
  }
  return state.view === 'console' ? 'teal' : 'gray';
}

function humanize(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').toLowerCase();
}

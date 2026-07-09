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
  CheckCircle2,
  Clipboard,
  LogOut,
  Pencil,
  RefreshCw,
  Search,
  ServerCog,
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
    <AppShell className="admin-app-shell" header={{ height: 64 }} padding="md">
      <AppShell.Header aria-label="Admin Console" className="admin-app-header">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <div>
            <Text className="eyebrow" size="xs">
              1MCP
            </Text>
            <Title order={1} size="h3">
              Admin Console
            </Title>
          </div>
          <Badge variant="light" color={viewBadgeColor(state)}>
            {viewLabel(state)}
          </Badge>
        </Group>
      </AppShell.Header>
      <AppShell.Main className="admin-shell-main">
        <StatusStrip state={state} />
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

function StatusStrip({ state }: { state: AdminConsoleState }) {
  return (
    <section className="status-strip" aria-label="Runtime identity">
      <StatusCell label="Session" value={state.session?.account.username ?? sessionStatus(state)} />
      <StatusCell label="Runtime" value={runtimeSummary(state.status?.runtime)} />
      <StatusCell label="OAuth" value={state.status?.oauth.status ?? 'unknown'} />
      <StatusCell label="Servers" value={`${enabledServers(state.configuredServers)} enabled`} />
      <StatusCell label="Updated" value={state.lastUpdatedAt ?? 'never'} />
    </section>
  );
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-cell">
      <Text className="status-label">{label}</Text>
      <Text className="status-value">{value}</Text>
    </div>
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
    <section aria-labelledby="runtime-operations-title">
      <Group justify="space-between" align="flex-start" className="toolbar">
        <div>
          <Text className="eyebrow" size="xs">
            Operator workspace
          </Text>
          <Title id="runtime-operations-title" order={2}>
            Runtime operations
          </Title>
          <Text c="dimmed" size="sm">
            {state.session
              ? `${state.session.account.username} / ${state.session.account.role} / expires ${state.session.expiresAt}`
              : 'Not authenticated'}
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
        <SummaryCounter label="Enabled servers" value={enabledServers(state.configuredServers)} tone="good" />
        <SummaryCounter label="Disabled servers" value={disabledServers(state.configuredServers)} tone="warn" />
        <SummaryCounter label="OAuth attention" value={oauthAttention} tone={oauthAttention > 0 ? 'warn' : 'good'} />
        <SummaryCounter label="Failed audits" value={failedAudits} tone={failedAudits > 0 ? 'bad' : 'good'} />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" mt="md">
        <ConfiguredServersPanel state={state} onServerAction={onServerAction} onOpenServerDetail={onOpenServerDetail} />
        <ConfiguredServerDetailPanel
          state={serverDetail}
          onClose={onCloseServerDetail}
          onDirtyChange={onServerDetailDirtyChange}
          onPreviewServerEdit={onPreviewServerEdit}
        />
        <RuntimePanel runtime={state.status?.runtime} onCopyText={copyText} />
        <OAuthPanel services={state.status?.oauth.services ?? []} />
        <AuditPanel facts={state.status?.audit.facts ?? []} onCopyText={copyText} />
      </SimpleGrid>
      {copyFeedback ? (
        <Alert aria-live="polite" color={copyFeedback.startsWith('Could not') ? 'red' : 'teal'} mt="sm">
          {copyFeedback}
        </Alert>
      ) : null}
    </section>
  );
}

function SummaryCounter({ label, value, tone }: { label: string; value: number; tone: 'good' | 'warn' | 'bad' }) {
  return (
    <Paper className={`summary-counter summary-${tone}`} withBorder>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text className="summary-value">{value}</Text>
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
      title="Configured servers"
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
            {state.serverId} is no longer available. Return to the list and refresh before editing.
          </Text>
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
        <Alert color="red" role="alert">
          {state.message}
        </Alert>
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
              Preview validates the draft without writing config.
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
  const inlineSupported = field.secret?.inlineReplacement.supported ?? false;

  return (
    <Paper className="secret-editor" withBorder>
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700}>{field.label}</Text>
            <Text size="xs" c="dimmed">
              {field.secret?.environmentReference.guidance}
            </Text>
          </div>
          <Badge variant="light">redacted</Badge>
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
            <Radio.Group
              label="Replacement source"
              value={current.replacementKind}
              onChange={(value) =>
                onChange({ ...current, replacementKind: value as SecretDraftState[string]['replacementKind'] })
              }
            >
              <Group gap="sm">
                <Radio disabled={!environmentSupported} value="environmentReference" label="Environment variable" />
              </Group>
            </Radio.Group>
            {current.replacementKind === 'environmentReference' ? (
              <>
                <TextInput
                  label={`Environment variable for ${field.label}`}
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
                  Inline replacement stores secret material in configuration. Use it only when an environment reference
                  is not suitable.
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
  return (
    <Paper className="preview-result" withBorder>
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={800}>Preview</Text>
          <Code>{preview.previewFingerprint}</Code>
        </Group>
        <Alert color="blue" variant="light">
          Preview only - no config has been written.
        </Alert>
        <DetailRow label="Target" value={preview.targetName} meta={`Proposed: ${preview.proposedTargetName}`} />
        <DetailRow label="Validation" value={preview.validation.status} />
        <DetailRow
          label="Config change"
          value={preview.configChange.status}
          meta={`${preview.configChange.operation} / ${preview.configChange.changed ? 'changed' : 'unchanged'}`}
        />
        <DetailRow label="Reload" value={preview.configChange.reload.status} meta={preview.configChange.reload.error} />
        <DetailRow
          label="Backup"
          value={preview.configChange.backup.created ? 'created' : 'not created'}
          meta={preview.configChange.backup.path}
        />
        {preview.configChange.warnings?.map((warning) => (
          <DetailRow key={`warning:${warning}`} label="Warning" value={warning} />
        ))}
        {preview.configChange.retentionCleanup.warnings.map((warning) => (
          <DetailRow key={`retention:${warning}`} label="Retention warning" value={warning} />
        ))}
        <DetailRow label="Connectivity" value={preview.connectivityCheck.status} meta={connectivityMeta(preview)} />
        {preview.validation.errors.map((error) => (
          <DetailRow
            key={`${fieldKey(error.fieldPath)}:${error.code}`}
            label={error.fieldPath.join('.')}
            value={error.code}
            meta={error.message}
          />
        ))}
        {preview.diff.map((entry) => (
          <DetailRow
            key={fieldKey(entry.fieldPath)}
            label={entry.fieldPath.join('.')}
            value={`${formatPreviewValue(entry.oldValue)} -> ${formatPreviewValue(entry.newValue)}`}
            meta={entry.riskFlags.join(' / ')}
            description={entry.secretAction ? `Secret action: ${entry.secretAction}` : undefined}
          />
        ))}
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
    <Panel title="Runtime identity" utility="low disclosure" icon={<Activity size={17} />}>
      {runtime ? (
        <Stack gap="xs">
          <DetailRow label="Version" value={runtime.runtimeVersion} />
          <DetailRow
            label="External URL"
            value={runtime.externalUrl ?? '-'}
            copyLabel="externalUrl"
            onCopyText={onCopyText}
          />
          <DetailRow
            label="Runtime scope"
            value={runtime.runtimeScopeId}
            copyLabel="runtimeScopeId"
            onCopyText={onCopyText}
          />
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
    return check.reason;
  }
  if (check.status === 'failed') {
    return check.message;
  }
  return check.checkedAt;
}

function secretSummary(server: ConfiguredServerReadModel): string {
  if (server.secretInputs.length === 0) {
    return 'No secret inputs';
  }
  return `${server.secretInputs.length} redacted`;
}

function runtimeSummary(runtime?: RuntimeIdentity): string {
  return runtime ? `${runtime.runtimeVersion} / ${runtime.runtimeScopeId}` : 'unknown';
}

function sessionStatus(state: AdminConsoleState): string {
  if (state.view === 'setupRequired') {
    return 'setup required';
  }
  return state.view === 'loading' ? 'checking' : 'logged out';
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

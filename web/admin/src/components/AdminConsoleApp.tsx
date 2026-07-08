import {
  Alert,
  AppShell,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  PasswordInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';

import { Activity, AlertTriangle, CheckCircle2, Clipboard, LogOut, RefreshCw, Search, ServerCog } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import type { AdminAuditFact, ConfiguredServerReadModel, OAuthServiceStatus, RuntimeIdentity } from '../api/adminApi';
import type { AdminConsoleState, ServerMutation } from '../state/adminConsoleState';

type ServerFilter = 'all' | 'enabled' | 'disabled';

export interface AdminConsoleAppProps {
  state: AdminConsoleState;
  onLogin?: (input: { username: string; password: string }) => void | Promise<void>;
  onLogout?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onServerAction?: (serverId: string, action: 'enable' | 'disable') => void | Promise<void>;
  onCopyText?: (label: string, value: string) => void | Promise<void>;
  loginBusy?: boolean;
}

export function AdminConsoleApp({
  state,
  onLogin,
  onLogout,
  onRefresh,
  onServerAction,
  onCopyText,
  loginBusy = false,
}: AdminConsoleAppProps) {
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
          {state.view === 'setupRequired' ? <SetupRequiredView /> : null}
          {state.view === 'loading' || state.view === 'login' ? (
            <LoginView loading={state.view === 'loading' || loginBusy} onLogin={onLogin} />
          ) : null}
          {state.view === 'console' ? (
            <ConsoleView
              state={state}
              onLogout={onLogout}
              onRefresh={onRefresh}
              onServerAction={onServerAction}
              onCopyText={onCopyText}
            />
          ) : null}
        </Stack>
      </AppShell.Main>
    </AppShell>
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
  onCopyText,
}: {
  state: AdminConsoleState;
  onLogout?: AdminConsoleAppProps['onLogout'];
  onRefresh?: AdminConsoleAppProps['onRefresh'];
  onServerAction?: AdminConsoleAppProps['onServerAction'];
  onCopyText?: AdminConsoleAppProps['onCopyText'];
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
        <ConfiguredServersPanel state={state} onServerAction={onServerAction} />
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
}: {
  state: AdminConsoleState;
  onServerAction?: AdminConsoleAppProps['onServerAction'];
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
        <Table.ScrollContainer minWidth={660}>
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
}: {
  server: ConfiguredServerReadModel;
  mutation?: ServerMutation;
  onServerAction?: AdminConsoleAppProps['onServerAction'];
}) {
  const action = server.enabled ? 'disable' : 'enable';
  const busy = mutation?.state === 'busy';

  return (
    <Table.Tr className={mutation ? `server-action-${mutation.state}` : undefined}>
      <Table.Td>
        <Text fw={700}>{server.id}</Text>
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
      <Table.Td>{describeTransport(server.transport)}</Table.Td>
      <Table.Td>{secretSummary(server)}</Table.Td>
      <Table.Td>
        <Button
          size="xs"
          color={action === 'disable' ? 'red' : 'teal'}
          variant={action === 'disable' ? 'light' : 'filled'}
          loading={busy}
          disabled={busy}
          onClick={() => void onServerAction?.(server.id, action)}
        >
          {action === 'disable' ? `Disable ${server.id}` : `Enable ${server.id}`}
        </Button>
      </Table.Td>
    </Table.Tr>
  );
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

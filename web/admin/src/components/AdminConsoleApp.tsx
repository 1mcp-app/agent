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
  TextInput,
  Title,
} from '@mantine/core';

import { Boxes, FileClock, Gauge, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import type { ConfiguredServerEditDraft } from '../api/adminApi';
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

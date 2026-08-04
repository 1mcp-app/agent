import {
  Alert,
  AppShell,
  Badge,
  Burger,
  Button,
  Code,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';

import { Boxes, FileClock, Gauge, Info, ShieldCheck, SlidersHorizontal, SquareTerminal } from 'lucide-react';
import { type MouseEvent, type ReactNode, useState } from 'react';

import type { AdminConsoleRoute, AdminConsoleSessionModel } from '../session/AdminConsoleSessionModel';
import type { AdminConsoleState } from '../state/adminConsoleState';
import { runtimeEndpointSummary, runtimeSummary, viewBadgeColor, viewLabel } from './adminConsoleUtils';
import { AboutRuntimeWorkspace } from './workspaces/AboutRuntimeWorkspace';
import { BackendLogsWorkspace } from './workspaces/BackendLogsWorkspace';
import { OAuthServicesWorkspace } from './workspaces/OAuthServicesWorkspace';
import { PresetAuthoringWorkspace } from './workspaces/PresetAuthoringWorkspace';
import { AuditTrailWorkspace, DashboardWorkspace, ServersWorkspace } from './workspaces/RuntimeOperationsWorkspace';

export interface AdminConsoleAppProps {
  session: AdminConsoleSessionModel;
}

export function AdminConsoleApp({ session }: AdminConsoleAppProps) {
  const { state, loginBusy, navigation } = session;
  const route = navigation.route;
  const [mobileNavigationOpened, setMobileNavigationOpened] = useState(false);
  if (state.view !== 'console') {
    return (
      <AuthShell state={state}>
        {state.view === 'setupRequired' ? <SetupRequiredView /> : null}
        {state.view === 'loading' || state.view === 'login' ? (
          <LoginView loading={state.view === 'loading' || loginBusy} onLogin={session.login} />
        ) : null}
      </AuthShell>
    );
  }

  return (
    <AppShell
      className="admin-app-shell"
      header={{ height: 66 }}
      navbar={{ width: 224, breakpoint: 'md', collapsed: { mobile: !mobileNavigationOpened } }}
      padding={0}
    >
      <AppShell.Header aria-label="Admin Console" className="admin-app-header">
        <Group h="100%" px="lg" justify="space-between" wrap="nowrap" className="command-bar">
          <Group gap="sm" wrap="nowrap">
            <Burger
              aria-label={mobileNavigationOpened ? 'Close operations navigation' : 'Open operations navigation'}
              className="mobile-navigation-toggle"
              color="var(--admin-ink)"
              opened={mobileNavigationOpened}
              size="sm"
              onClick={() => setMobileNavigationOpened((opened) => !opened)}
            />
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
            label="Dashboard"
            href="/admin"
            active={route === 'dashboard'}
            onNavigate={() => navigate('dashboard')}
          />
          <NavItem
            icon={<Boxes size={17} />}
            label="Server inventory"
            href="/admin/servers"
            active={route === 'servers'}
            onNavigate={() => navigate('servers')}
          />
          <NavItem
            icon={<ShieldCheck size={17} />}
            label="OAuth services"
            href="/admin/oauth"
            active={route === 'oauth'}
            onNavigate={() => navigate('oauth')}
          />
          <NavItem
            icon={<FileClock size={17} />}
            label="Audit trail"
            href="/admin/audit"
            active={route === 'audit'}
            onNavigate={() => navigate('audit')}
          />
          <NavItem
            icon={<SlidersHorizontal size={17} />}
            label="Presets"
            href="/admin/presets"
            active={route === 'presets'}
            onNavigate={() => navigate('presets')}
          />
          <NavItem
            icon={<SquareTerminal size={17} />}
            label="Backend logs"
            href="/admin/logs"
            active={route === 'logs'}
            onNavigate={() => navigate('logs')}
          />
          <NavItem
            icon={<Info size={17} />}
            label="About"
            href="/admin/about"
            active={route === 'about'}
            onNavigate={() => navigate('about')}
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
          <ConsoleWorkspace session={session} />
        </Stack>
      </AppShell.Main>
    </AppShell>
  );

  function navigate(route: AdminConsoleRoute) {
    void navigation.navigate(route);
    setMobileNavigationOpened(false);
  }
}

function ConsoleWorkspace({ session }: { session: AdminConsoleSessionModel }) {
  const { state, navigation, configuredServers, presets } = session;
  const operatorModel = { state, logout: session.logout, refresh: session.refresh, configuredServers };

  switch (navigation.route) {
    case 'servers':
      return <ServersWorkspace model={operatorModel} />;
    case 'oauth':
      return <OAuthServicesWorkspace model={operatorModel} oauth={session.oauth} />;
    case 'audit':
      return <AuditTrailWorkspace model={operatorModel} />;
    case 'presets':
      return (
        <PresetAuthoringWorkspace
          model={{
            ...presets,
            targets:
              presets.targets.length > 0
                ? presets.targets
                : state.configuredServers.map((server) => ({
                    name: server.id,
                    tags: server.tags,
                    enabled: server.enabled,
                  })),
          }}
          runtimeScopeId={state.status?.runtime.runtimeScopeId}
        />
      );
    case 'logs':
      return <BackendLogsWorkspace logs={session.logs} />;
    case 'about':
      return <AboutRuntimeWorkspace state={state} />;
    case 'dashboard':
      return <DashboardWorkspace model={operatorModel} navigate={navigation.navigate} />;
  }
}

function NavItem({
  icon,
  label,
  href,
  active = false,
  onNavigate,
}: {
  icon: ReactNode;
  label: string;
  href: string;
  active?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`nav-item${active ? ' nav-item-active' : ''}`}
      onClick={(event) => {
        if (!isSamePageNavigation(event)) return;
        event.preventDefault();
        onNavigate?.();
      }}
    >
      {icon}
      <Text size="sm" fw={700}>
        {label}
      </Text>
    </a>
  );
}

function isSamePageNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
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

function LoginView({
  loading,
  onLogin,
}: {
  loading: boolean;
  onLogin?: (input: { username: string; password: string }) => void | Promise<void>;
}) {
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

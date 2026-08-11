import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { vi } from 'vitest';

import { createMockBackendLogEntry, createMockBackendLogSource } from '../../../../test/unit-utils/MockFactories';
import { createInitialState } from '../state/adminConsoleState';
import { AdminConsoleApp } from './AdminConsoleApp';
import { configuredServerDetailState, consoleState, fixtureSession, renderApp } from './AdminConsoleApp.fixtures';

describe('AdminConsoleApp', () => {
  it('renders managed, ended, and unavailable backend log states as text', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    renderApp(consoleState(), {
      navigation: { route: 'logs' },
      logs: {
        connection: 'active',
        selectedSourceId: 'static:filesystem',
        sources: [
          createMockBackendLogSource(),
          createMockBackendLogSource({
            id: 'static:manual',
            canonicalName: 'manual',
            displayName: 'manual',
            capture: 'not-captured',
          }),
          createMockBackendLogSource({
            id: 'template:0123456789abcdef',
            canonicalName: '0123456789abcdef',
            displayName: 'search (0123456789ab)',
            kind: 'template',
            lifecycle: 'ended',
          }),
        ],
        entries: [
          createMockBackendLogEntry({
            sequence: 7,
            content: '<script>window.injected=true</script>',
          }),
        ],
        unread: { 'template:0123456789abcdef': 2 },
        cursors: { 'static:filesystem': 7 },
        select,
      },
    });

    expect(await screen.findByRole('heading', { name: 'Backend logs' })).toBeInTheDocument();
    expect(screen.getByText('<script>window.injected=true</script>')).toBeInTheDocument();
    expect(document.querySelector('.backend-log-content script')).toBeNull();
    expect(screen.getByText('Not captured')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /manual, not captured/i }));
    expect(select).toHaveBeenCalledWith('static:manual');
  });

  it('distinguishes a retained-history load failure from an empty log', async () => {
    renderApp(consoleState(), {
      navigation: { route: 'logs' },
      logs: {
        connection: 'active',
        selectedSourceId: 'static:filesystem',
        sources: [createMockBackendLogSource()],
        selectionError: 'Failed to load retained backend logs. Live entries will continue to appear.',
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load retained backend logs');
    expect(screen.queryByText('No captured stderr in retained runtime history.')).not.toBeInTheDocument();
  });

  it('guides operators from empty logs without claiming a live stream', async () => {
    const open = vi.fn();
    renderApp(consoleState(), {
      navigation: { route: 'logs' },
      configuredServers: { create: idleCreateModel(open) },
      logs: { connection: 'active', sources: [] },
    });

    expect(await screen.findByText('Waiting for sources')).toBeInTheDocument();
    expect(screen.queryByText('Live stream')).not.toBeInTheDocument();
    expect(screen.getByText(/Configure a stdio server/i)).toBeInTheDocument();
    const configureLink = screen.getByRole('link', { name: /configure stdio server/i });
    expect(configureLink).toHaveAttribute('href', '/admin/servers/new');
    fireEvent.click(configureLink, { metaKey: true });
    expect(open).not.toHaveBeenCalled();
    await userEvent.click(configureLink);
    expect(open).toHaveBeenCalledOnce();
  });
  it('renders setup-required guidance without authenticated console chrome', () => {
    render(
      <MantineProvider>
        <AdminConsoleApp session={fixtureSession({ ...createInitialState(), view: 'setupRequired' })} />
      </MantineProvider>,
    );

    expect(screen.queryByRole('banner', { name: /admin console/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /runtime identity/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /setup required/i })).toBeInTheDocument();
    expect(
      screen.getByText("1mcp admin bootstrap --username operator --password 'use-a-long-random-password'"),
    ).toBeInTheDocument();
    expect(screen.queryByText('1mcp admin bootstrap')).not.toBeInTheDocument();
  });

  it('renders login and loading states without account-management controls', async () => {
    const user = userEvent.setup();
    const { rerender } = renderApp({ ...createInitialState(), view: 'login' });

    expect(screen.getByRole('heading', { name: /operator login/i })).toBeInTheDocument();
    expect(screen.queryByRole('banner', { name: /admin console/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /runtime identity/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toHaveAttribute('autocomplete', 'username');
    const passwordInput = screen.getByLabelText(/^Password/, { selector: 'input' });
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
    const visibilityToggle = screen.getByRole('button', { name: 'Show password' });
    expect(visibilityToggle).toHaveAttribute('aria-pressed', 'false');
    visibilityToggle.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveFocus();
    expect(screen.queryByText(/create account|disable account|delete account|password reset/i)).not.toBeInTheDocument();

    rerender(
      <MantineProvider>
        <AdminConsoleApp session={fixtureSession(createInitialState())} />
      </MantineProvider>,
    );

    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled();
    expect(screen.queryByRole('banner', { name: /admin console/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /runtime identity/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeDisabled();
  });

  it('renders a summary-only dashboard with direct workspace links', async () => {
    const user = userEvent.setup();
    const onCopyText = vi.fn();
    const onConfigureServer = vi.fn();
    const onNavigate = vi.fn();

    renderApp(consoleState(), {
      navigation: { navigate: onNavigate },
      configuredServers: { copy: onCopyText, create: idleCreateModel(onConfigureServer) },
    });

    const navigation = screen.getByRole('navigation', { name: /operations navigation/i });
    expect(screen.getByRole('banner', { name: /admin console/i })).toHaveTextContent(/runtime online/i);
    expect(screen.getByRole('heading', { name: /^overview$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByText('Enabled servers')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('Disabled servers')).toBeInTheDocument();
    expect(screen.getByText('OAuth attention')).toBeInTheDocument();
    expect(screen.getByText('Failed audits')).toBeInTheDocument();
    expect(screen.getAllByText('https://runtime.example.com').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1.2.3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('scope_123').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('heading', { name: /server inventory/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /oauth services/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /audit trail/i })).not.toBeInTheDocument();
    expect(screen.queryByText('npx -y @modelcontextprotocol/server-filesystem /tmp/project')).not.toBeInTheDocument();
    expect(screen.queryByText('awaiting_oauth')).not.toBeInTheDocument();
    expect(screen.queryByText('enableConfiguredServer')).not.toBeInTheDocument();

    expect(within(navigation).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/admin');
    expect(within(navigation).getByRole('link', { name: 'Server inventory' })).toHaveAttribute(
      'href',
      '/admin/servers',
    );
    expect(within(navigation).getByRole('link', { name: 'OAuth services' })).toHaveAttribute('href', '/admin/oauth');
    expect(within(navigation).getByRole('link', { name: 'Audit trail' })).toHaveAttribute('href', '/admin/audit');
    expect(within(navigation).getByRole('link', { name: 'Presets' })).toHaveAttribute('href', '/admin/presets');
    expect(within(navigation).getByRole('link', { name: 'About' })).toHaveAttribute('href', '/admin/about');

    await user.click(screen.getByRole('button', { name: /copy runtime scope/i }));
    expect(onCopyText).toHaveBeenCalledWith('runtimeScopeId', 'scope_123');
    await user.click(screen.getByRole('button', { name: /copy external url/i }));
    expect(onCopyText).toHaveBeenCalledWith('externalUrl', 'https://runtime.example.com');
    await user.click(screen.getByRole('button', { name: 'Configure server' }));
    expect(onConfigureServer).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('keeps custom server creation available when the inventory is empty', async () => {
    const open = vi.fn();
    const state = { ...consoleState(), configuredServers: [] };
    const create = {
      state: { status: 'idle' as const },
      open,
      close: async () => true,
      changeField: vi.fn(),
      addSecret: vi.fn(),
      changeSecret: vi.fn(),
      removeSecret: vi.fn(),
      preview: vi.fn(),
      apply: vi.fn(),
    };
    renderApp(state, { navigation: { route: 'servers' }, configuredServers: { create } });

    expect(screen.getByText('No servers configured')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: /search servers/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Configure server' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('clears a filtered empty server inventory without changing true-empty guidance', async () => {
    const user = userEvent.setup();
    renderApp(consoleState(), { navigation: { route: 'servers' } });

    await user.type(screen.getByRole('searchbox', { name: /search servers/i }), 'missing');
    expect(screen.getByText(/No servers match the current search/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(screen.getByRole('searchbox', { name: /search servers/i })).toHaveValue('');
    expect(screen.getByText('filesystem')).toBeInTheDocument();
  });

  it('uses the full workspace for an active server task and hides the browse inventory', () => {
    const create = {
      state: { status: 'loading' as const },
      open: vi.fn(),
      close: vi.fn(async () => true),
      editExisting: vi.fn(),
      changeField: vi.fn(),
      addSecret: vi.fn(),
      changeSecret: vi.fn(),
      removeSecret: vi.fn(),
      preview: vi.fn(),
      apply: vi.fn(),
    };
    renderApp(consoleState(), { navigation: { route: 'servers' }, configuredServers: { create } });

    expect(screen.getByRole('heading', { name: /configure custom server/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /server inventory/i })).not.toBeInTheDocument();
    expect(document.querySelector('.server-task-workspace')).toBeInTheDocument();
  });

  it('renders the full inventory and editor only in the servers workspace', async () => {
    const user = userEvent.setup();
    const onServerAction = vi.fn();

    renderApp(consoleState(), {
      navigation: { route: 'servers' },
      configuredServers: { mutate: onServerAction },
    });

    expect(screen.getByRole('heading', { name: /server inventory/i })).toBeInTheDocument();
    expect(screen.getByText('local / storage')).toBeInTheDocument();
    expect(screen.getByText('npx -y @modelcontextprotocol/server-filesystem /tmp/project')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: /search servers/i }), 'git');
    expect(within(screen.getByRole('table')).queryByText('filesystem')).not.toBeInTheDocument();
    expect(screen.getAllByText('github').length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('radio', { name: /enabled/i }));
    expect(screen.getByText(/No servers match/i)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /disabled/i }));
    await user.click(screen.getByRole('switch', { name: /enable github/i }));
    expect(onServerAction).toHaveBeenCalledWith('github', 'enable');
  });

  it('navigates with real links and keeps Presets and About as final top-level items', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderApp(consoleState(), { navigation: { navigate: onNavigate } });

    const navigation = screen.getByRole('navigation', { name: /operations navigation/i });
    const links = within(navigation).getAllByRole('link');
    expect(links.at(-1)).toHaveTextContent('About');
    await user.click(screen.getByRole('link', { name: 'Presets' }));
    await user.click(screen.getByRole('link', { name: 'About' }));
    expect(onNavigate).toHaveBeenNthCalledWith(1, 'presets');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'about');
  });

  it('exposes the current direct workspace and navigates without hash sections', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderApp(consoleState(), { navigation: { route: 'oauth', navigate: onNavigate } });

    expect(screen.getByRole('link', { name: 'OAuth services' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: 'Server inventory' }));
    await user.click(screen.getByRole('link', { name: 'Audit trail' }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'servers');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'audit');
  });

  it('operates OAuth services by full identity while keeping template labels compact', async () => {
    const user = userEvent.setup();
    const state = consoleState();
    const onCopyText = vi.fn();
    const onOperate = vi.fn();
    state.status!.oauth.services = [
      {
        name: 'context7:0123456789abcdef',
        id: 'context7:0123456789abcdef',
        displayName: 'context7:0123456789ab',
        status: 'awaiting_oauth',
        requiresOAuth: true,
      },
      {
        name: 'github',
        id: 'github',
        displayName: 'github',
        status: 'connected',
        requiresOAuth: true,
      },
    ];

    renderApp(state, {
      navigation: { route: 'oauth' },
      configuredServers: { copy: onCopyText },
      oauth: { operate: onOperate },
    });

    expect(screen.getByRole('heading', { name: /^oauth services$/i })).toBeInTheDocument();
    expect(screen.getByText('context7:0123456789ab')).toBeInTheDocument();
    expect(screen.getByText('context7:0123456789abcdef')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /copy full service id for context7:0123456789ab/i }));
    expect(onCopyText).toHaveBeenCalledWith('serviceId', 'context7:0123456789abcdef');

    await user.click(screen.getByRole('button', { name: /authorize context7:0123456789ab/i }));
    await user.click(screen.getByRole('button', { name: /restart github/i }));
    expect(onOperate).toHaveBeenNthCalledWith(1, 'context7:0123456789abcdef', 'authorize');
    expect(onOperate).toHaveBeenNthCalledWith(2, 'github', 'restart');
  });

  it('links an empty OAuth workspace to server configuration', async () => {
    const state = consoleState();
    state.status!.oauth.services = [];
    const open = vi.fn();
    renderApp(state, {
      navigation: { route: 'oauth' },
      configuredServers: { create: idleCreateModel(open) },
    });

    expect(await screen.findByText('No OAuth services reported')).toBeInTheDocument();
    expect(screen.getByText(/appear when a configured server requires/i)).toBeInTheDocument();
    const configureLink = screen.getByRole('link', { name: /configure server/i });
    expect(configureLink).toHaveAttribute('href', '/admin/servers/new');
    fireEvent.click(configureLink, { ctrlKey: true });
    expect(open).not.toHaveBeenCalled();
    await userEvent.click(configureLink);
    expect(open).toHaveBeenCalledOnce();
  });

  it('shows OAuth callback, busy, and operation feedback in the OAuth workspace', () => {
    const state = consoleState();
    state.status!.oauth.services.push({
      name: 'gitlab',
      id: 'gitlab',
      displayName: 'gitlab',
      status: 'connected',
      requiresOAuth: true,
    });
    renderApp(state, {
      navigation: { route: 'oauth' },
      oauth: {
        busy: { serviceId: 'github', action: 'authorize' },
        callbackFeedback: { kind: 'success', message: 'OAuth authorization completed.' },
        operationFeedback: { kind: 'error', message: 'Authorization could not be started.' },
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent('OAuth authorization completed.');
    expect(screen.getByRole('alert')).toHaveTextContent('Authorization could not be started.');
    expect(screen.getByRole('button', { name: /authorize github/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /restart gitlab/i })).toBeDisabled();
    expect(screen.getByText('Starting authorization...')).toBeInTheDocument();
  });

  it('opens and closes the accessible mobile navigation control', async () => {
    const user = userEvent.setup();
    renderApp(consoleState());

    const toggle = screen.getByRole('button', { name: 'Open operations navigation' });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Close operations navigation' })).toBeInTheDocument();
  });

  it('renders compatible version skew without warning and unavailable optional metadata', async () => {
    const state = consoleState();
    state.status!.about.adminUiBuildVersion = '9.9.9';
    state.status!.about.build = {};
    renderApp(state, { navigation: { route: 'about' } });

    expect(await screen.findByRole('heading', { name: /About 1MCP Agent/i })).toBeInTheDocument();
    expect(screen.getByText('9.9.9')).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.queryByText(/protocol incompatibility/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Repository.*new tab/i })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('warns when the Admin UI and API protocol contracts are incompatible', async () => {
    const state = consoleState();
    state.status!.about.adminUiProtocolVersion = '2';
    state.status!.about.protocolCompatible = false;
    renderApp(state, { navigation: { route: 'about' } });
    expect(await screen.findByText(/Admin UI protocol incompatibility/i)).toBeInTheDocument();
  });

  it('blocks lossy conversion from advanced JSON to structured mode', async () => {
    const user = userEvent.setup();
    renderApp(consoleState(), {
      navigation: { route: 'presets' },
      presets: {
        items: [
          {
            name: 'complex',
            strategy: 'advanced',
            tagQuery: { $or: [{ tag: 'public' }, { $not: { tag: 'private' } }] },
            querySummary: 'public OR NOT private',
            matchCount: 1,
          },
        ],
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: /Match any included tag/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Match all included tags/i })).toBeDisabled();
  });

  it('previews and confirms preset creation including disabled matches', async () => {
    const user = userEvent.setup();
    const onPreviewPreset = vi.fn().mockResolvedValue({
      draft: { name: 'web', strategy: 'or', tagQuery: { $or: [{ tag: 'web' }] } },
      revision: 'rev',
      previewFingerprint: 'preview',
      validation: { status: 'valid', fieldErrors: [], globalErrors: [], warnings: [] },
      matches: [{ name: 'disabled-web', tags: ['web'], enabled: false, matched: true, reason: 'Matched web' }],
      matchCount: 1,
      structuredConversion: { lossless: true, strategy: 'or', tags: ['web'] },
    });
    const onSavePreset = vi.fn(async () => true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp(consoleState(), {
      navigation: { route: 'presets' },
      presets: { preview: onPreviewPreset, save: onSavePreset },
    });

    await user.type(await screen.findByLabelText('Preset name'), 'web');
    await user.click(getTagStateRadio('local', 'Include'));
    await user.click(screen.getByRole('button', { name: /Preview matches/i }));
    expect(await screen.findByText(/disabled-web · disabled/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Confirm and save/i }));
    expect(onSavePreset).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        preview: expect.objectContaining({ previewFingerprint: 'preview' }),
      }),
    );
  });

  it('uses a single first-preset workspace and validates preview inputs locally', async () => {
    const user = userEvent.setup();
    const preview = vi.fn();
    renderApp(consoleState(), {
      navigation: { route: 'presets' },
      presets: { items: [], preview },
    });

    expect(await screen.findByRole('heading', { name: 'Create preset' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New preset' })).not.toBeInTheDocument();
    expect(document.querySelector('.preset-workspace-grid-empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview matches/i })).toBeDisabled();
    expect(screen.getByText(/Enter a preset name before previewing/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Preset name'), 'invalid name');
    expect(screen.getByText(/Use only letters, numbers/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview matches/i })).toBeDisabled();
    await user.clear(screen.getByLabelText('Preset name'));
    await user.type(screen.getByLabelText('Preset name'), 'first-preset');
    expect(screen.getByRole('button', { name: /preview matches/i })).toBeEnabled();
    expect(screen.getByText(/empty tag query is allowed/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Advanced JSON' }));
    await user.clear(screen.getByLabelText('Advanced JSON'));
    fireEvent.change(screen.getByLabelText('Advanced JSON'), { target: { value: '{' } });
    expect(screen.getByRole('button', { name: /preview matches/i })).toBeDisabled();
    expect(screen.getByText(/valid object before previewing/i)).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
  });

  it('builds presets from discovered tags with include, exclude, and live server impact', async () => {
    const user = userEvent.setup();
    const onPreviewPreset = vi.fn().mockResolvedValue({
      draft: {
        name: 'local-only',
        strategy: 'and',
        tagQuery: { $and: [{ tag: 'local' }, { $not: { tag: 'storage' } }] },
      },
      revision: 'rev',
      previewFingerprint: 'preview',
      validation: { status: 'valid', fieldErrors: [], globalErrors: [], warnings: [] },
      matches: [],
      matchCount: 0,
      structuredConversion: { lossless: false, reason: 'Contains an exclusion.' },
    });
    renderApp(consoleState(), { navigation: { route: 'presets' }, presets: { preview: onPreviewPreset } });

    expect(await screen.findByRole('heading', { name: /Tag matrix/i })).toBeInTheDocument();
    expect(getTagStateRadio('local', 'Include')).toBeInTheDocument();
    expect(getTagStateRadio('storage', 'Exclude')).toBeInTheDocument();
    expect(screen.getByText(/filesystem · enabled/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Preset name'), 'local-only');
    await user.click(screen.getByRole('button', { name: /Match all included tags/i }));
    await user.click(getTagStateRadio('local', 'Include'));
    await user.click(getTagStateRadio('storage', 'Exclude'));

    expect(screen.getByText(/INCLUDE local/i)).toBeInTheDocument();
    expect(screen.getByText(/EXCLUDE storage/i)).toBeInTheDocument();
    expect(document.querySelector('.preset-query-strip')).toHaveTextContent(/0 of 2 targets match/i);

    await user.click(screen.getByRole('button', { name: /Preview matches/i }));
    expect(onPreviewPreset).toHaveBeenCalledWith(
      {
        name: 'local-only',
        description: undefined,
        strategy: 'and',
        tagQuery: { $and: [{ tag: 'local' }, { $not: { tag: 'storage' } }] },
      },
      undefined,
    );
  });

  it('restores structured include and exclude states when editing a preset', async () => {
    const user = userEvent.setup();
    renderApp(consoleState(), {
      navigation: { route: 'presets' },
      presets: {
        items: [
          {
            name: 'local-not-storage',
            strategy: 'and',
            tagQuery: { $and: [{ tag: 'local' }, { $not: { tag: 'storage' } }] },
            querySummary: 'local AND NOT storage',
            matchCount: 0,
          },
        ],
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(getTagStateRadio('local', 'Include')).toBeChecked();
    expect(getTagStateRadio('storage', 'Exclude')).toBeChecked();
    expect(screen.getByText(/INCLUDE local/i)).toBeInTheDocument();
    expect(screen.getByText(/EXCLUDE storage/i)).toBeInTheDocument();
  });

  it('discovers template targets and serializes structured edits into Advanced JSON', async () => {
    const user = userEvent.setup();
    renderApp(consoleState(), {
      navigation: { route: 'presets' },
      presets: {
        targets: [
          { name: 'filesystem', tags: ['local'], enabled: true },
          { name: 'template-search', tags: ['template', 'search'], enabled: false },
        ],
      },
    });

    expect(await screen.findByRole('heading', { name: /Tag matrix/i })).toBeInTheDocument();
    expect(getTagStateRadio('template', 'Include')).toBeInTheDocument();
    expect(screen.getAllByText(/0 enabled/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/1 disabled/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('template-search').length).toBeGreaterThanOrEqual(1);
    await user.click(getTagStateRadio('template', 'Include'));
    await user.click(screen.getByRole('button', { name: /Advanced JSON/i }));
    expect(screen.getByLabelText('Advanced JSON')).toHaveValue(JSON.stringify({ tag: 'template' }, null, 2));
  });

  it('shows and allows clearing criteria whose tags are no longer discovered', async () => {
    const user = userEvent.setup();
    renderApp(consoleState(), {
      navigation: { route: 'presets' },
      presets: {
        targets: [{ name: 'filesystem', tags: ['local'], enabled: true }],
        items: [
          { name: 'legacy', strategy: 'or', tagQuery: { tag: 'retired' }, querySummary: 'retired', matchCount: 0 },
        ],
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const retiredGroup = screen.getByRole('group', { name: /retired tag state/i }).parentElement;
    expect(retiredGroup).toHaveTextContent(/retired.*Retired/i);
    await user.click(getTagStateRadio('retired', 'Neutral'));
    expect(screen.queryByText(/INCLUDE retired/i)).not.toBeInTheDocument();
  });

  it('searches and filters tag states while expanding long server coverage', async () => {
    const user = userEvent.setup();
    renderApp(consoleState(), {
      navigation: { route: 'presets' },
      presets: {
        targets: [
          { name: 'alpha-documentation-server', tags: ['shared', 'docs'], enabled: true },
          { name: 'beta-documentation-server', tags: ['shared'], enabled: true },
          { name: 'gamma-documentation-server', tags: ['shared'], enabled: false },
          { name: 'delta-documentation-server', tags: ['shared'], enabled: true },
        ],
      },
    });

    await user.type(await screen.findByRole('searchbox', { name: /search tags and servers/i }), 'docs');
    expect(screen.getByRole('group', { name: 'docs tag state' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'shared tag state' })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: /search tags and servers/i }));
    await user.click(getTagStateRadio('shared', 'Include'));
    await user.click(screen.getByRole('radio', { name: 'Included' }));
    expect(screen.getByRole('group', { name: 'shared tag state' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'docs tag state' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show all servers tagged shared/i }));
    const sharedRow = screen.getByRole('group', { name: 'shared tag state' }).closest('article');
    expect(sharedRow).not.toBeNull();
    expect(within(sharedRow!).getByText(/gamma-documentation-server/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /collapse servers tagged shared/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows visible copy feedback when clipboard writing fails', async () => {
    const user = userEvent.setup();

    renderApp(consoleState(), {
      configuredServers: {
        copy: vi.fn(async () => {
          throw new Error('clipboard unavailable');
        }),
      },
    });

    await user.click(screen.getByRole('button', { name: /copy runtime scope/i }));

    expect(screen.getByText('Could not copy runtime scope id. Select the value manually.')).toBeInTheDocument();
  });

  it('makes configured-server editing obvious from the server list', async () => {
    const user = userEvent.setup();
    const onOpenServerDetail = vi.fn();

    renderApp(consoleState(), {
      navigation: { route: 'servers' },
      configuredServers: { open: onOpenServerDetail },
    });

    await user.click(screen.getByRole('button', { name: /edit github server/i }));

    expect(onOpenServerDetail).toHaveBeenCalledWith('github');
  });

  it('renders configured-server detail controls from the normalized contract without raw JSON or apply controls', async () => {
    const user = userEvent.setup();
    const onPreviewServerEdit = vi.fn();

    renderApp(consoleState(), {
      navigation: { route: 'servers' },
      configuredServers: { editor: configuredServerDetailState(), preview: onPreviewServerEdit },
    });

    expect(screen.getByRole('heading', { name: 'github' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /edit server/i })).toBeInTheDocument();
    expect(screen.getByText(/Draft changes stay local until preview/i)).toBeInTheDocument();
    expect(screen.getByText(/No changes yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview change/i })).toBeDisabled();
    expect(screen.getByDisplayValue('https://example.com/mcp?token=REDACTED')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /preserve existing url\.query\.token/i })).toBeChecked();
    expect(screen.getByText(/Store only the environment variable name/i)).toBeInTheDocument();
    expect(screen.queryByText(/raw-token|Bearer raw/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /raw json/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('URL'));
    await user.type(screen.getByLabelText('URL'), 'https://example.com/v2/mcp');
    await user.click(screen.getByRole('radio', { name: /clear saved url\.query\.token/i }));
    expect(screen.getByText('Unsaved changes', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview change/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /preview change/i }));

    expect(onPreviewServerEdit).toHaveBeenCalledWith('auto');
  });

  it('explains how to start editing when no configured server is selected', () => {
    renderApp(consoleState(), { navigation: { route: 'servers' } });

    expect(screen.queryByText(/Select Edit server to change target settings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Edit fields -> Preview change -> Review result/i)).not.toBeInTheDocument();
  });

  it('normalizes configured-server structured edit controls without raw JSON', async () => {
    const user = userEvent.setup();
    const onPreviewServerEdit = vi.fn();

    renderApp(consoleState(), {
      navigation: { route: 'servers' },
      configuredServers: {
        editor: configuredServerDetailState({
          fieldGroups: [
            {
              id: 'identity',
              label: 'Target',
              fields: [
                { fieldPath: ['id'], label: 'Target ID', control: 'text', value: 'github', editable: true },
                { fieldPath: ['enabled'], label: 'Enabled', control: 'switch', value: true, editable: true },
                { fieldPath: ['tags'], label: 'Tags', control: 'tag-list', value: ['remote', 'oauth'], editable: true },
              ],
            },
            {
              id: 'transport',
              label: 'Transport',
              fields: [
                {
                  fieldPath: ['transport', 'type'],
                  label: 'Transport Type',
                  control: 'select',
                  value: 'http',
                  options: ['stdio', 'http', 'sse'],
                  editable: true,
                },
                {
                  fieldPath: ['transport', 'args'],
                  label: 'Args',
                  control: 'string-list',
                  value: ['--old'],
                  editable: true,
                },
                {
                  fieldPath: ['transport', 'headers'],
                  label: 'Headers',
                  control: 'record',
                  value: { 'X-Feature': 'old' },
                  editable: true,
                },
              ],
            },
            {
              id: 'secrets',
              label: 'Secrets',
              fields: [
                {
                  fieldPath: ['url', 'query', 'token'],
                  label: 'headers.authorization',
                  control: 'secret',
                  editable: true,
                  secret: {
                    state: 'present',
                    defaultAction: 'preserve',
                    allowedActions: ['preserve', 'replace', 'clear'],
                    environmentReference: {
                      supported: true,
                      recommended: true,
                      valueFormat: 'env_var_name_or_substitution',
                      storesSecretMaterial: false,
                      guidance: 'Keep secret material in the runtime environment.',
                    },
                    inlineReplacement: {
                      supported: true,
                      emphasis: 'secondary',
                      guidance: 'Use inline replacement only when an environment reference is not suitable.',
                    },
                  },
                },
              ],
            },
          ],
        }),
        preview: onPreviewServerEdit,
      },
    });

    await user.clear(screen.getByLabelText('Target ID'));
    await user.type(screen.getByLabelText('Target ID'), 'github-v2');
    await user.click(screen.getByRole('switch', { name: 'Enabled' }));
    await user.type(screen.getByRole('textbox', { name: 'Tags' }), 'beta{Enter}');
    await user.selectOptions(screen.getByLabelText('Transport Type'), 'sse');
    fireEvent.change(screen.getByLabelText('Args'), { target: { value: '--one\n--two' } });
    expect(screen.getByRole('button', { name: /remove headers x-feature/i })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Headers X-Feature'));
    await user.type(screen.getByLabelText('Headers X-Feature'), 'new');
    await user.click(screen.getByRole('radio', { name: /replace headers\.authorization/i }));
    await user.click(screen.getByRole('button', { name: /use advanced inline secret/i }));
    expect(
      screen
        .getAllByRole('alert')
        .some((alert) => /stores secret material in configuration/i.test(alert.textContent ?? '')),
    ).toBe(true);
    await user.type(screen.getByLabelText(/inline secret for headers\.authorization/i), 'raw-secret');
    await user.click(screen.getByRole('button', { name: /preview change/i }));

    expect(screen.queryByRole('textbox', { name: /raw json/i })).not.toBeInTheDocument();
    expect(onPreviewServerEdit).toHaveBeenCalledWith('auto');
  });

  it('switches configured-server fields with the selected transport type', async () => {
    const user = userEvent.setup();
    renderApp(consoleState(), {
      navigation: { route: 'servers' },
      configuredServers: {
        editor: configuredServerDetailState({
          schemaVersion: 2,
          fieldGroups: [
            {
              id: 'transport',
              label: 'Transport',
              fields: [
                {
                  fieldPath: ['transport', 'type'],
                  label: 'Transport Type',
                  control: 'select',
                  value: 'http',
                  options: ['stdio', 'http', 'sse', 'streamableHttp'],
                  editable: true,
                },
                {
                  fieldPath: ['transport', 'url'],
                  label: 'URL',
                  control: 'text',
                  value: 'https://example.com/mcp',
                  editable: true,
                  applicableTransportTypes: ['http', 'sse', 'streamableHttp'],
                },
                {
                  fieldPath: ['transport', 'headers'],
                  label: 'Headers',
                  control: 'record',
                  value: {},
                  editable: true,
                  applicableTransportTypes: ['http', 'sse', 'streamableHttp'],
                },
                {
                  fieldPath: ['transport', 'command'],
                  label: 'Command',
                  control: 'text',
                  value: '',
                  editable: true,
                  applicableTransportTypes: ['stdio'],
                },
                {
                  fieldPath: ['transport', 'args'],
                  label: 'Args',
                  control: 'string-list',
                  value: [],
                  editable: true,
                  applicableTransportTypes: ['stdio'],
                },
                {
                  fieldPath: ['transport', 'cwd'],
                  label: 'Working Directory',
                  control: 'text',
                  value: '',
                  editable: true,
                  applicableTransportTypes: ['stdio'],
                },
                {
                  fieldPath: ['transport', 'env'],
                  label: 'Environment',
                  control: 'record',
                  value: {},
                  editable: true,
                  applicableTransportTypes: ['stdio'],
                },
                {
                  fieldPath: ['transport', 'restartOnExit'],
                  label: 'Restart On Exit',
                  control: 'switch',
                  value: false,
                  editable: true,
                  applicableTransportTypes: ['stdio'],
                },
              ],
            },
          ],
        }),
      },
    });

    expect(screen.getByLabelText('URL')).toBeInTheDocument();
    expect(screen.getByLabelText('New Headers key')).toBeInTheDocument();
    expect(screen.queryByLabelText('Command')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Transport Type'), 'stdio');

    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New Headers key')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Command')).toBeInTheDocument();
    expect(screen.getByLabelText('Args')).toBeInTheDocument();
    expect(screen.getByLabelText('Working Directory')).toBeInTheDocument();
    expect(screen.getByLabelText('New Environment key')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Restart On Exit' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Transport Type'), 'http');
    expect(screen.getByLabelText('URL')).toHaveValue('https://example.com/mcp');
    expect(screen.queryByLabelText('Command')).not.toBeInTheDocument();
  });

  it('delegates closing a modified configured-server detail form to the edit model', async () => {
    const user = userEvent.setup();
    const onCloseServerDetail = vi.fn();

    renderApp(consoleState(), {
      navigation: { route: 'servers' },
      configuredServers: { editor: configuredServerDetailState(), close: onCloseServerDetail },
    });

    await user.clear(screen.getByLabelText('URL'));
    await user.type(screen.getByLabelText('URL'), 'https://example.com/v2/mcp');
    await user.click(screen.getByRole('button', { name: /^back$/i }));

    expect(onCloseServerDetail).toHaveBeenCalledWith('/admin/servers');
  });

  it('reruns preview connectivity on demand after a preview exists', async () => {
    const user = userEvent.setup();
    const onPreviewServerEdit = vi.fn();

    renderApp(consoleState(), {
      navigation: { route: 'servers' },
      configuredServers: {
        editor: {
          ...configuredServerDetailState(),
          preview: {
            targetName: 'github',
            proposedTargetName: 'github',
            previewFingerprint: 'preview_123',
            validation: { status: 'valid', errors: [] },
            diff: [],
            configChange: {
              status: 'unchanged',
              operation: 'set_static',
              target: { name: 'github', source: 'mcpServers' },
              changed: false,
              backup: { created: false },
              retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
              reload: { status: 'skipped' },
              warnings: [],
            },
            connectivityCheck: { status: 'skipped', reason: 'connection_critical_fields_unchanged' },
          },
        },
        preview: onPreviewServerEdit,
      },
    });

    await user.click(screen.getByRole('button', { name: /rerun connectivity/i }));

    expect(onPreviewServerEdit).toHaveBeenCalledWith('manual');
  });

  it('opens advanced edit settings when preview errors target a hidden secret field', () => {
    renderApp(consoleState(), {
      navigation: { route: 'servers' },
      configuredServers: {
        editor: {
          ...configuredServerDetailState(),
          preview: {
            targetName: 'github',
            proposedTargetName: 'github',
            previewFingerprint: 'preview_advanced_error',
            validation: {
              status: 'invalid',
              errors: [
                {
                  fieldPath: ['url', 'query', 'token'],
                  code: 'invalid_secret_reference',
                  message: 'Secret reference is invalid.',
                },
              ],
            },
            diff: [],
            configChange: {
              status: 'unchanged',
              operation: 'set_static',
              target: { name: 'github', source: 'mcpServers' },
              changed: false,
              backup: { created: false },
              retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
              reload: { status: 'skipped' },
              warnings: [],
            },
            connectivityCheck: { status: 'skipped', reason: 'validation_failed' },
          },
        },
      },
    });

    expect(screen.getByText('Advanced settings').closest('details')).toHaveAttribute('open');
  });

  it('renders preview validation, diff, config-change, and connectivity facts', () => {
    renderApp(consoleState(), {
      navigation: { route: 'servers' },
      configuredServers: {
        editor: {
          ...configuredServerDetailState(),
          preview: {
            targetName: 'github',
            proposedTargetName: 'github',
            previewFingerprint: 'preview_123',
            validation: {
              status: 'invalid',
              errors: [{ fieldPath: ['transport', 'url'], code: 'invalid_url', message: 'URL is invalid.' }],
            },
            diff: [
              {
                fieldPath: ['transport', 'url'],
                oldValue: 'https://example.com/mcp?token=REDACTED',
                newValue: 'not-a-url',
                riskFlags: ['connection_critical'],
              },
            ],
            configChange: {
              status: 'unchanged',
              operation: 'set_static',
              target: { name: 'github', source: 'mcpServers' },
              changed: false,
              backup: { created: false },
              retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
              reload: { status: 'skipped' },
              warnings: [],
            },
            connectivityCheck: { status: 'skipped', reason: 'validation_failed' },
          },
        },
      },
    });

    expect(screen.getByText('preview_123')).toBeInTheDocument();
    expect(screen.getByText(/Preview only - no config has been written/i)).toBeInTheDocument();
    expect(screen.getByText('invalid')).toBeInTheDocument();
    expect(screen.getByText(/set_static \/ unchanged/i)).toBeInTheDocument();
    expect(screen.getByText(/Validation failed before a connectivity check could run/i)).toBeInTheDocument();
    expect(screen.getAllByText('transport.url').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/from/i)).toBeInTheDocument();
    expect(screen.getAllByText(/https:\/\/example\.com\/mcp\?token=REDACTED/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/not-a-url/i)).toBeInTheDocument();
    expect(screen.getByText(/connection critical/i)).toBeInTheDocument();
  });

  it('keeps legacy configured-server rows usable while read-model fields roll forward', async () => {
    const user = userEvent.setup();
    const onServerAction = vi.fn();

    renderApp(
      {
        ...consoleState(),
        configuredServers: [
          {
            id: 'legacy',
            source: 'mcpServers',
            enabled: false,
            transport: { type: 'stdio', command: 'node' },
            secretInputs: [],
          } as any,
        ],
      },
      { navigation: { route: 'servers' }, configuredServers: { mutate: onServerAction } },
    );

    expect(screen.getByText('node')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /enable legacy/i }));
    expect(onServerAction).toHaveBeenCalledWith('legacy', 'enable');
  });

  it('disables server actions when the read model marks mutations unavailable', async () => {
    const user = userEvent.setup();
    const onServerAction = vi.fn();

    renderApp(
      {
        ...consoleState(),
        configuredServers: [
          {
            id: 'locked',
            source: 'mcpServers',
            target: { type: 'configured_server', id: 'locked', source: 'mcpServers' },
            enabled: false,
            tags: [],
            transportSummary: { kind: 'http', label: 'https://example.com/mcp' },
            mutationAvailability: { available: false, operations: ['enable', 'disable'] },
            actionState: {
              enable: { available: true, label: 'Enable locked' },
              disable: { available: false, label: 'Disable locked', disabledReason: 'already_disabled' },
            },
            transport: { type: 'http', url: 'https://example.com/mcp' },
            secretInputs: [],
          },
        ],
      },
      { navigation: { route: 'servers' }, configuredServers: { mutate: onServerAction } },
    );

    const control = screen.getByRole('switch', { name: /enable locked/i });
    expect(control).toBeDisabled();
    await user.click(control);
    expect(onServerAction).not.toHaveBeenCalled();
  });

  it('submits login, logout, refresh, and direct disable actions through callbacks', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    const onLogout = vi.fn();
    const onRefresh = vi.fn();
    const onServerAction = vi.fn();

    const { rerender } = renderApp(
      { ...createInitialState(), view: 'login' },
      { login: onLogin, logout: onLogout, refresh: onRefresh, configuredServers: { mutate: onServerAction } },
    );

    await user.type(screen.getByLabelText(/username/i), 'operator');
    await user.type(screen.getByLabelText(/^Password/, { selector: 'input' }), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    expect(onLogin).toHaveBeenCalledWith({ username: 'operator', password: 'correct horse battery staple' });

    rerender(
      <MantineProvider>
        <AdminConsoleApp
          session={fixtureSession(consoleState(), {
            login: onLogin,
            logout: onLogout,
            refresh: onRefresh,
            navigation: { route: 'servers' },
            configuredServers: { mutate: onServerAction },
          })}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole('button', { name: /refresh runtime data/i }));
    await user.click(screen.getByRole('switch', { name: /disable filesystem/i }));
    await user.click(screen.getByRole('button', { name: /log out/i }));

    expect(onRefresh).toHaveBeenCalled();
    expect(onServerAction).toHaveBeenCalledWith('filesystem', 'disable');
    expect(onLogout).toHaveBeenCalled();
  });
});

function getTagStateRadio(tag: string, state: 'Neutral' | 'Include' | 'Exclude') {
  return within(screen.getByRole('group', { name: `${tag} tag state` })).getByRole('radio', { name: state });
}

function idleCreateModel(open = vi.fn()) {
  return {
    state: { status: 'idle' as const },
    open,
    close: async () => true,
    editExisting: vi.fn(),
    changeField: vi.fn(),
    addSecret: vi.fn(),
    changeSecret: vi.fn(),
    removeSecret: vi.fn(),
    preview: vi.fn(),
    apply: vi.fn(),
  };
}

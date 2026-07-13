import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';

import type { ConfiguredServerReadModel } from '../api/adminApi';
import type { AdminConsoleSessionModel } from '../session/AdminConsoleSessionModel';
import type { AdminConsoleState } from '../state/adminConsoleState';
import { createInitialState } from '../state/adminConsoleState';
import { AdminConsoleApp } from './AdminConsoleApp';
import type { ConfiguredServerEditorState } from './configuredServerEditor';

interface SessionOverrides {
  loginBusy?: boolean;
  login?: AdminConsoleSessionModel['login'];
  logout?: AdminConsoleSessionModel['logout'];
  refresh?: AdminConsoleSessionModel['refresh'];
  navigation?: Partial<AdminConsoleSessionModel['navigation']>;
  configuredServers?: Partial<AdminConsoleSessionModel['configuredServers']>;
  presets?: Partial<AdminConsoleSessionModel['presets']>;
}

export function renderApp(state: AdminConsoleState, overrides: SessionOverrides = {}) {
  const session = fixtureSession(state, overrides);
  return render(
    <MantineProvider>
      <AdminConsoleApp session={session} />
    </MantineProvider>,
  );
}

export function fixtureSession(state: AdminConsoleState, overrides: SessionOverrides = {}): AdminConsoleSessionModel {
  return {
    state,
    loginBusy: overrides.loginBusy ?? false,
    login: overrides.login ?? (() => undefined),
    logout: overrides.logout ?? (() => undefined),
    refresh: overrides.refresh ?? (() => undefined),
    navigation: {
      route: overrides.navigation?.route ?? 'overview',
      navigate: overrides.navigation?.navigate ?? (() => undefined),
    },
    configuredServers: {
      editor: overrides.configuredServers?.editor ?? { status: 'list' },
      mutate: overrides.configuredServers?.mutate ?? (() => undefined),
      open: overrides.configuredServers?.open ?? (() => undefined),
      close: overrides.configuredServers?.close ?? (() => undefined),
      setDirty: overrides.configuredServers?.setDirty ?? (() => undefined),
      preview: overrides.configuredServers?.preview ?? (() => undefined),
      copy: overrides.configuredServers?.copy ?? (() => undefined),
    },
    presets: {
      items: overrides.presets?.items ?? [],
      targets: overrides.presets?.targets ?? [],
      revision: overrides.presets?.revision ?? '',
      busy: overrides.presets?.busy ?? false,
      load: overrides.presets?.load ?? (() => undefined),
      preview:
        overrides.presets?.preview ??
        (async () => {
          throw new Error('Preset preview was not configured for this test');
        }),
      save: overrides.presets?.save ?? (() => undefined),
      delete: overrides.presets?.delete ?? (() => undefined),
    },
  };
}

export function consoleState(): AdminConsoleState {
  return {
    ...createInitialState(),
    view: 'console',
    session: {
      authenticated: true,
      account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
      csrfToken: 'csrf_123',
      expiresAt: '2026-07-07T01:00:00.000Z',
    },
    status: {
      ok: true,
      runtime: {
        identityProtocolVersion: '1',
        runtimeScopeId: 'scope_123',
        externalUrl: 'https://runtime.example.com',
        runtimeVersion: '1.2.3',
      },
      session: {
        authenticated: true,
        account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
        expiresAt: '2026-07-07T01:00:00.000Z',
      },
      oauth: {
        status: 'ready',
        services: [
          {
            name: 'github',
            status: 'awaiting_oauth',
            requiresOAuth: true,
            lastError: 'token: [REDACTED]',
          },
        ],
      },
      audit: {
        facts: [
          {
            timestamp: '2026-07-07T00:00:00.000Z',
            operationId: 'op_1',
            operationName: 'enableConfiguredServer',
            result: 'failed',
            target: { type: 'configured_server', id: 'filesystem' },
            request: { requestId: 'req_1' },
          },
        ],
      },
      about: {
        productName: '1MCP Agent',
        runtimeVersion: '1.2.3',
        adminUiBuildVersion: '1.2.4',
        adminApiProtocolVersion: '1',
        adminUiProtocolVersion: '1',
        protocolCompatible: true,
        runtime: { runtimeScopeId: 'scope_123', externalUrl: 'https://runtime.example.com' },
        build: { commit: 'abc123', timestamp: '2026-07-07T00:00:00.000Z' },
        project: {
          repository: 'https://github.com/1mcp-app/agent',
          documentation: 'https://docs.1mcp.app',
          issues: 'https://github.com/1mcp-app/agent/issues',
          license: 'Apache-2.0',
        },
      },
    },
    configuredServers: [
      {
        id: 'filesystem',
        source: 'mcpServers',
        target: { type: 'configured_server', id: 'filesystem', source: 'mcpServers' },
        enabled: true,
        tags: ['local', 'storage'],
        transportSummary: {
          kind: 'stdio',
          label: 'npx -y @modelcontextprotocol/server-filesystem /tmp/project',
        },
        mutationAvailability: { available: true, operations: ['enable', 'disable'] },
        actionState: {
          enable: { available: false, label: 'Enable filesystem', disabledReason: 'already_enabled' },
          disable: { available: true, label: 'Disable filesystem' },
        },
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project'],
        },
        secretInputs: [],
      },
      {
        id: 'github',
        source: 'mcpServers',
        target: { type: 'configured_server', id: 'github', source: 'mcpServers' },
        enabled: false,
        tags: [],
        transportSummary: { kind: 'http', label: 'https://example.com/mcp?token=REDACTED' },
        mutationAvailability: { available: true, operations: ['enable', 'disable'] },
        actionState: {
          enable: { available: true, label: 'Enable github' },
          disable: { available: false, label: 'Disable github', disabledReason: 'already_disabled' },
        },
        transport: { type: 'http', url: 'https://example.com/mcp?token=REDACTED' },
        secretInputs: [{ fieldPath: ['url', 'query', 'token'], label: 'url.query.token', state: 'present' }],
      },
    ],
    lastUpdatedAt: '00:01:02',
  };
}

export function configuredServerDetailState(
  overrides: Partial<Extract<ConfiguredServerEditorState, { status: 'loaded' }>['detail']['editContract']> = {},
): ConfiguredServerEditorState {
  const server: ConfiguredServerReadModel = {
    id: 'github',
    source: 'mcpServers',
    target: { type: 'configured_server' as const, id: 'github', source: 'mcpServers' as const },
    enabled: true,
    tags: ['remote'],
    transportSummary: { kind: 'http', label: 'https://example.com/mcp?token=REDACTED' },
    mutationAvailability: { available: true, operations: ['enable' as const, 'disable' as const] },
    actionState: {
      enable: { available: false, label: 'Enable github', disabledReason: 'already_enabled' as const },
      disable: { available: true, label: 'Disable github' },
    },
    transport: { type: 'http', url: 'https://example.com/mcp?token=REDACTED' },
    secretInputs: [{ fieldPath: ['url', 'query', 'token'], label: 'url.query.token', state: 'present' as const }],
  };

  return {
    status: 'loaded',
    serverId: 'github',
    previewBusy: false,
    detail: {
      ok: true,
      operationId: 'op_detail',
      server,
      editContract: {
        schemaVersion: 1,
        target: server.target,
        capabilities: {
          singleTargetEdit: true,
          rename: { supported: true },
          create: { supported: false },
          delete: { supported: false },
          bulkEdit: { supported: false },
          rawJson: { supported: false },
          preview: { supported: true },
          apply: { supported: false },
        },
        fieldGroups: [
          {
            id: 'transport',
            label: 'Transport',
            fields: [
              {
                fieldPath: ['transport', 'url'],
                label: 'URL',
                control: 'text',
                value: 'https://example.com/mcp?token=REDACTED',
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
                label: 'url.query.token',
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
                    guidance:
                      'Store only the environment variable name or substitution expression; keep secret material outside 1MCP config.',
                  },
                  inlineReplacement: {
                    supported: true,
                    emphasis: 'secondary',
                    guidance:
                      'Use inline replacement only as a secondary path when an environment reference is not suitable.',
                  },
                },
              },
            ],
          },
        ],
        ...overrides,
      },
    },
  };
}

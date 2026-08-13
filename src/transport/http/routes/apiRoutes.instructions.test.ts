import { formatInstructionsOutput } from '@src/commands/instructions/instructionsUtils.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { ClientStatus } from '@src/core/types/index.js';

import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiRoutes } from './apiRoutes.js';

const mockedBuildServerSummaries = vi.hoisted(() => vi.fn());
const mockedLoadDeclaredServerConfigs = vi.hoisted(() => vi.fn());
const mockedGetRuntimeInstructionConfiguration = vi.hoisted(() => vi.fn());
const mockedEnsureRequestContextInitialized = vi.hoisted(() =>
  vi.fn(() => Promise.resolve<string | undefined>('request-session')),
);

vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: vi.fn(() => ({
      loadDeclaredServerConfigs: mockedLoadDeclaredServerConfigs,
      getRuntimeInstructionConfiguration: mockedGetRuntimeInstructionConfiguration,
    })),
  },
}));

vi.mock('./inspectRoutes.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./inspectRoutes.js')>();
  return { ...original, buildServerSummaries: mockedBuildServerSummaries };
});

vi.mock('./inspectRequestContext.js', () => ({
  ensureRequestContextInitialized: mockedEnsureRequestContextInitialized,
}));

describe('apiRoutes /api/instructions', () => {
  const scopeAuthMiddleware: RequestHandler = (_req, res, next) => {
    res.locals.validatedTags = res.locals.tags ?? [];
    next();
  };

  beforeEach(() => {
    mockedBuildServerSummaries.mockReset();
    mockedLoadDeclaredServerConfigs.mockReset();
    mockedGetRuntimeInstructionConfiguration.mockReset();
    mockedEnsureRequestContextInitialized.mockReset();
    mockedEnsureRequestContextInitialized.mockResolvedValue('request-session');
  });

  it('renders the active CLI variant with effective overrides and the selected filters', async () => {
    const aggregator = new InstructionAggregator();
    aggregator.setInstructions({ source: 'mcpServers', name: 'alpha' }, 'upstream alpha');
    mockedBuildServerSummaries.mockResolvedValue([
      {
        server: 'alpha',
        type: 'external',
        status: 'connected',
        available: true,
        loadTracked: true,
        toolCount: 2,
        hasInstructions: true,
      },
    ]);
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: { alpha: { tags: ['coding'] } },
      templateServers: {},
    });
    const runtimeConfiguration = {
      activeInstructionTemplate: 'team',
      instructionTemplates: { team: { initialization: 'init', cli: '{{servers.[0].instructions}}' } },
      configuredTargets: {
        mcpServers: { alpha: { tags: ['coding'], instructionOverride: 'operator alpha' } },
        mcpTemplates: {},
      },
    };
    aggregator.setRuntimeInstructionConfiguration(runtimeConfiguration);
    mockedGetRuntimeInstructionConfiguration.mockReturnValue(runtimeConfiguration);
    const serverManager = makeServerManager(aggregator);
    const app = express().use('/api/v1', createApiRoutes(serverManager as never, scopeAuthMiddleware));

    const response = await request(app).get('/api/v1/instructions?tags=coding');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      rendered: 'operator alpha',
      templateIdentity: 'team',
      fallback: false,
    });
    expect(mockedBuildServerSummaries).toHaveBeenCalledWith(
      expect.any(Map),
      undefined,
      undefined,
      expect.anything(),
      aggregator,
      expect.anything(),
      expect.objectContaining({ tagFilterMode: 'simple-or', tags: ['coding'] }),
    );
    expect(Object.keys(response.body).sort()).toEqual(['fallback', 'rendered', 'templateIdentity']);
  });

  it('preserves the built-in CLI formatter layout for connected, disconnected, and template servers', async () => {
    const aggregator = new InstructionAggregator();
    aggregator.setInstructions({ source: 'mcpServers', name: 'alpha' }, 'Alpha instructions');
    const servers = [
      {
        server: 'alpha',
        type: 'external',
        status: 'connected',
        available: true,
        loadTracked: true,
        toolCount: 2,
        hasInstructions: true,
      },
      {
        server: 'beta',
        type: 'external',
        status: 'disconnected',
        available: false,
        loadTracked: true,
        toolCount: 0,
        hasInstructions: false,
      },
      {
        server: 'gamma',
        type: 'template',
        status: 'unknown',
        available: false,
        loadTracked: false,
        toolCount: 0,
        hasInstructions: false,
      },
    ];
    mockedBuildServerSummaries.mockResolvedValue(servers);
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: { alpha: {}, beta: {} },
      templateServers: { gamma: {} },
    });
    mockedGetRuntimeInstructionConfiguration.mockReturnValue({
      configuredTargets: { mcpServers: { alpha: {}, beta: {} }, mcpTemplates: { gamma: {} } },
    });
    const app = express().use('/api/v1', createApiRoutes(makeServerManager(aggregator) as never, scopeAuthMiddleware));

    const response = await request(app).get('/api/v1/instructions');

    expect(response.status).toBe(200);
    expect(response.body.rendered).toBe(
      formatInstructionsOutput({
        servers,
        details: [
          { ...servers[0], instructions: 'Alpha instructions' },
          { ...servers[1], note: '(unavailable: server is not currently connected)' },
          { ...servers[2], note: '(unavailable: template server could not be initialized with the current context)' },
        ],
      }),
    );
    expect(response.body.formatting).toEqual({
      servers,
      details: [
        { ...servers[0], instructions: 'Alpha instructions' },
        { ...servers[1], note: '(unavailable: server is not currently connected)' },
        { ...servers[2], note: '(unavailable: template server could not be initialized with the current context)' },
      ],
    });
  });

  it('reports sanitized managed-template fallback facts without exposing template source', async () => {
    const aggregator = new InstructionAggregator();
    mockedBuildServerSummaries.mockResolvedValue([]);
    mockedLoadDeclaredServerConfigs.mockReturnValue({ staticServers: {}, templateServers: {} });
    const runtimeConfiguration = {
      activeInstructionTemplate: 'broken',
      instructionTemplates: { broken: { initialization: 'init', cli: '{{#if SECRET_MARKER_DO_NOT_EXPOSE' } },
      configuredTargets: { mcpServers: {}, mcpTemplates: {} },
    };
    aggregator.setRuntimeInstructionConfiguration(runtimeConfiguration);
    mockedGetRuntimeInstructionConfiguration.mockReturnValue(runtimeConfiguration);
    const app = express().use('/api/v1', createApiRoutes(makeServerManager(aggregator) as never, scopeAuthMiddleware));

    const response = await request(app).get('/api/v1/instructions');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      templateIdentity: 'broken',
      fallback: true,
      fallbackReason: 'managed_template_render_failed',
      rendered: expect.stringContaining('1MCP CLI Instructions'),
      formatting: { servers: [], details: [] },
    });
    expect(JSON.stringify(response.body)).not.toContain('SECRET_MARKER_DO_NOT_EXPOSE');
    expect(response.body).not.toHaveProperty('instructionTemplates');
    expect(response.body).not.toHaveProperty('configuredTargets');
  });

  it('preserves source-qualified effective instructions for same-name static and template connections', async () => {
    const aggregator = new InstructionAggregator();
    aggregator.setInstructions({ source: 'mcpServers', name: 'shared' }, 'static upstream', 'shared');
    aggregator.setInstructions({ source: 'mcpTemplates', name: 'shared' }, 'template upstream', 'shared:instance');
    const runtimeConfiguration = {
      activeInstructionTemplate: 'team',
      instructionTemplates: {
        team: { initialization: 'init', cli: '{{#each servers}}{{source}}={{instructions}};{{/each}}' },
      },
      configuredTargets: {
        mcpServers: { shared: { instructionOverride: 'static override' } },
        mcpTemplates: { shared: { instructionOverride: 'template override' } },
      },
    };
    aggregator.setRuntimeInstructionConfiguration(runtimeConfiguration);
    mockedGetRuntimeInstructionConfiguration.mockReturnValue(runtimeConfiguration);
    mockedBuildServerSummaries.mockResolvedValue([
      {
        server: 'shared',
        type: 'template',
        status: 'connected',
        available: true,
        loadTracked: false,
        toolCount: 2,
        hasInstructions: true,
      },
    ]);
    mockedLoadDeclaredServerConfigs.mockReturnValue({
      staticServers: { shared: {} },
      templateServers: { shared: {} },
    });
    const clients = new Map([
      ['shared', makeConnection('shared')],
      ['shared:instance', makeConnection('shared')],
    ]);
    const app = express().use(
      '/api/v1',
      createApiRoutes(
        makeServerManager(aggregator, clients, new Map([['shared', 'instance']])) as never,
        scopeAuthMiddleware,
      ),
    );

    const response = await request(app).get('/api/v1/instructions');

    expect(response.status).toBe(200);
    expect(response.body.rendered).toBe('mcpServers=static override;mcpTemplates=template override;');
  });

  it.each([
    ['template override', 'mcpTemplates|template override|true'],
    ['', 'mcpTemplates||false'],
  ])(
    'uses unresolved template provenance for a %s instruction override when a static target has the same name',
    async (instructionOverride, expected) => {
      const aggregator = new InstructionAggregator();
      const runtimeConfiguration = {
        activeInstructionTemplate: 'team',
        instructionTemplates: {
          team: {
            initialization: 'init',
            cli: '{{servers.[0].source}}|{{servers.[0].instructions}}|{{servers.[0].hasInstructions}}',
          },
        },
        configuredTargets: {
          mcpServers: { shared: { instructionOverride: 'wrong static override' } },
          mcpTemplates: { shared: { instructionOverride } },
        },
      };
      aggregator.setRuntimeInstructionConfiguration(runtimeConfiguration);
      mockedGetRuntimeInstructionConfiguration.mockReturnValue(runtimeConfiguration);
      mockedBuildServerSummaries.mockResolvedValue([
        {
          server: 'shared',
          type: 'template',
          status: 'unknown',
          available: false,
          loadTracked: false,
          toolCount: 0,
          hasInstructions: false,
        },
      ]);
      mockedLoadDeclaredServerConfigs.mockReturnValue({
        staticServers: { shared: {} },
        templateServers: { shared: {} },
      });
      const app = express().use(
        '/api/v1',
        createApiRoutes(makeServerManager(aggregator, new Map()) as never, scopeAuthMiddleware),
      );

      const response = await request(app).get('/api/v1/instructions');

      expect(response.status).toBe(200);
      expect(response.body.rendered).toBe(expected);
    },
  );

  it('includes only contextual template connections belonging to the request session', async () => {
    const aggregator = new InstructionAggregator();
    aggregator.setInstructions({ source: 'mcpTemplates', name: 'contextual' }, 'own', 'contextual:request-session');
    aggregator.setInstructions({ source: 'mcpTemplates', name: 'contextual' }, 'other', 'contextual:other-session');
    mockedBuildServerSummaries.mockImplementation(async (connections: Map<string, { name: string }>) =>
      Array.from(connections.values()).map((connection) => ({
        server: connection.name,
        type: 'template',
        status: 'connected',
        available: true,
        loadTracked: false,
        toolCount: 0,
        hasInstructions: true,
      })),
    );
    mockedLoadDeclaredServerConfigs.mockReturnValue({ staticServers: {}, templateServers: {} });
    const runtimeConfiguration = {
      activeInstructionTemplate: 'team',
      instructionTemplates: { team: { initialization: 'init', cli: '{{instructions}}' } },
      configuredTargets: { mcpServers: {}, mcpTemplates: {} },
    };
    aggregator.setRuntimeInstructionConfiguration(runtimeConfiguration);
    mockedGetRuntimeInstructionConfiguration.mockReturnValue(runtimeConfiguration);
    const clients = new Map([
      ['contextual:request-session', makeConnection('contextual')],
      ['contextual:other-session', makeConnection('contextual')],
    ]);
    const app = express().use(
      '/api/v1',
      createApiRoutes(makeServerManager(aggregator, clients) as never, scopeAuthMiddleware),
    );

    const response = await request(app).get('/api/v1/instructions');

    expect(response.status).toBe(200);
    expect(response.body.rendered).toContain('own');
    expect(response.body.rendered).not.toContain('other');
  });

  it('does not inherit contextual template connections when no request context exists', async () => {
    mockedEnsureRequestContextInitialized.mockResolvedValue(undefined);
    const aggregator = new InstructionAggregator();
    aggregator.setInstructions({ source: 'mcpTemplates', name: 'contextual' }, 'private', 'contextual:other-session');
    mockedBuildServerSummaries.mockResolvedValue([]);
    mockedLoadDeclaredServerConfigs.mockReturnValue({ staticServers: {}, templateServers: {} });
    const runtimeConfiguration = {
      activeInstructionTemplate: 'team',
      instructionTemplates: { team: { initialization: 'init', cli: '{{instructions}}' } },
      configuredTargets: { mcpServers: {}, mcpTemplates: {} },
    };
    aggregator.setRuntimeInstructionConfiguration(runtimeConfiguration);
    mockedGetRuntimeInstructionConfiguration.mockReturnValue(runtimeConfiguration);
    const clients = new Map([['contextual:other-session', makeConnection('contextual')]]);
    const app = express().use(
      '/api/v1',
      createApiRoutes(makeServerManager(aggregator, clients) as never, scopeAuthMiddleware),
    );

    const response = await request(app).get('/api/v1/instructions');

    expect(response.status).toBe(200);
    expect(response.body.rendered).not.toContain('private');
  });
});

function makeServerManager(
  aggregator: InstructionAggregator,
  clients = new Map([['alpha', makeConnection('alpha', ['coding'])]]),
  renderedHashes?: Map<string, string>,
) {
  return {
    getInstructionAggregator: vi.fn(() => aggregator),
    getClients: vi.fn(() => clients),
    getLazyLoadingOrchestrator: vi.fn(() => undefined),
    getServerRegistry: vi.fn(() => ({})),
    getTemplateServerManager: vi.fn(() => ({
      getAllRenderedHashesForSession: vi.fn(() => renderedHashes),
      getRenderedHashForSession: vi.fn((_sessionId: string, name: string) => renderedHashes?.get(name)),
    })),
  };
}

function makeConnection(name: string, tags: string[] = []) {
  return {
    name,
    status: ClientStatus.Connected,
    transport: { tags },
    client: {},
  };
}

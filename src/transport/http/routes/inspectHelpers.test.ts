import { buildCatalogGeneration } from '@src/core/capabilities/catalogGeneration.js';
import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { ClientStatus } from '@src/core/types/client.js';

import { describe, expect, it } from 'vitest';

import { deriveServerState, parseTarget, qualifyToolName, summarizeDirectServerTool } from './inspectHelpers.js';

describe('tool name projection', () => {
  it.each(['read-file.v2', `long tool_1mcp_${'x'.repeat(60)}`, '读取😀'])(
    'keeps REST targets and summaries consistent with the catalog: %s',
    (name) => {
      const server = 'files';
      const object = { name, inputSchema: { type: 'object' as const } };
      const entry = buildCatalogGeneration(1, [{ kind: 'tools', server, connectionKey: server, object }]).entries[0];
      expect(parseTarget(`${server}/${name}`)).toEqual({
        kind: 'tool',
        serverName: server,
        toolName: name,
        qualifiedName: entry.route.publicIdentity,
      });
      expect(qualifyToolName(server, name)).toBe(entry.route.publicIdentity);
      expect(summarizeDirectServerTool(server, object)).toMatchObject({
        tool: name,
        qualifiedName: entry.route.publicIdentity,
      });
    },
  );
});

describe('deriveServerState', () => {
  it('keeps a tracked loading state authoritative over a stale connected client', () => {
    expect(
      deriveServerState('connected', true, { status: ClientStatus.Connected } as never, {
        name: 'slow',
        state: LoadingState.Loading,
        retryCount: 0,
      }),
    ).toEqual({ status: 'loading', available: false });
  });

  it('uses the connected client once the loading tracker is ready', () => {
    expect(
      deriveServerState(undefined, undefined, { status: ClientStatus.Connected } as never, {
        name: 'ready',
        state: LoadingState.Ready,
        retryCount: 0,
      }),
    ).toEqual({ status: 'connected', available: true });
  });
});

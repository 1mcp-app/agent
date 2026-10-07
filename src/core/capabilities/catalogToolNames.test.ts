import { parseInspectTarget } from '@src/commands/inspect/inspectUtils.js';
import { parseToolReference } from '@src/commands/run/runUtils.js';
import { parseTarget, qualifyToolName } from '@src/transport/http/routes/inspectHelpers.js';

import { describe, expect, it } from 'vitest';

import { buildCatalogGeneration, type CapabilitySource, readPublicCapabilityRoute } from './catalogGeneration.js';

const tool = (server: string, name: string, connectionKey = server): CapabilitySource => ({
  kind: 'tools',
  server,
  connectionKey,
  object: { name, inputSchema: { type: 'object' } },
});

describe('public tool name protocol limits', () => {
  it('keeps an already valid 64-character qualified name unchanged', () => {
    const name = 'a'.repeat(64 - 'files_1mcp_'.length);
    expect(buildCatalogGeneration(1, [tool('files', name)]).entries[0].route.publicIdentity).toBe(`files_1mcp_${name}`);
  });

  it.each([
    ['official_conformance', 'test_input_required_result_multiple_inputs'],
    ['a'.repeat(100), 'read'],
    ['files', 'read:document'],
    ['文件', 'read'],
  ])('exposes a valid, stable name for %s / %s while retaining exact routing', (server, name) => {
    const first = buildCatalogGeneration(1, [tool(server, name)]);
    const entry = first.entries[0];
    expect(entry.route.publicIdentity).toMatch(/^[A-Za-z0-9_./-]{1,64}$/);
    expect(first.resolve('tools', entry.route.publicIdentity)?.route.upstreamIdentity).toBe(name);
    expect(readPublicCapabilityRoute(entry.publicObject)).toEqual({ kind: 'tools', server, upstreamIdentity: name });
    expect(buildCatalogGeneration(2, [tool(server, name, 'reconnected')]).entries[0].route.publicIdentity).toBe(
      entry.route.publicIdentity,
    );
    expect(qualifyToolName(server, name)).toBe(entry.route.publicIdentity);
    expect(parseTarget(`${server}/${name}`)).toMatchObject({ qualifiedName: entry.route.publicIdentity });
    expect(parseToolReference(`${server}/${name}`)).toMatchObject({ qualifiedName: entry.route.publicIdentity });
    expect(parseInspectTarget(`${server}/${name}`)).toMatchObject({
      reference: { qualifiedName: entry.route.publicIdentity },
    });
  });

  it('does not collapse equal truncated prefixes or different source tuples', () => {
    const name = 'n'.repeat(90);
    const sources = [tool('files', name), tool('files', `${name}2`), tool('other', name)];
    const first = buildCatalogGeneration(1, sources);
    const second = buildCatalogGeneration(2, [...sources].reverse());
    expect(first.quarantine).toEqual([]);
    expect(new Set(first.entries.map((entry) => entry.route.publicIdentity)).size).toBe(3);
    expect(second.entries.map((entry) => entry.route.publicIdentity).sort()).toEqual(
      first.entries.map((entry) => entry.route.publicIdentity).sort(),
    );
  });

  it('quarantines a compact-name collision instead of picking a route', () => {
    const source = tool('files', 'n'.repeat(90));
    const publicIdentity = buildCatalogGeneration(1, [source]).entries[0].route.publicIdentity;
    const alias = { ...tool('1mcp', 'internal'), origin: 'internal' as const, publicIdentity };
    for (const sources of [
      [source, alias],
      [alias, source],
    ]) {
      const generation = buildCatalogGeneration(2, sources);
      expect(generation.entries).toEqual([]);
      expect(generation.quarantine.map((item) => item.reason)).toEqual(['identity-collision', 'identity-collision']);
    }
  });
});

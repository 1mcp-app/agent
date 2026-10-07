import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { buildCatalogGeneration } from '@src/core/capabilities/catalogGeneration.js';
import { toProtocolTool } from '@src/sdk/contracts/index.js';
import { buildPublicToolName } from '@src/utils/core/toolNames.js';

import { describe, expect, it } from 'vitest';

import {
  applyEffectiveToolDescription,
  applySourceToolDescription,
  getEffectiveToolDescription,
  withToolDescriptionOverride,
} from './toolDescriptionOverrides.js';

describe('tool description overrides', () => {
  const config = {
    type: 'stdio' as const,
    command: 'node',
    toolDescriptionOverrides: {
      read_file: 'Read a workspace file safely',
    },
  };

  it('resolves override-first descriptions by logical or qualified tool name', () => {
    expect(getEffectiveToolDescription(config, 'filesystem', 'read_file', 'Upstream description')).toBe(
      'Read a workspace file safely',
    );
    expect(getEffectiveToolDescription(config, 'filesystem', 'filesystem_1mcp_read_file', 'Upstream description')).toBe(
      'Read a workspace file safely',
    );
    expect(getEffectiveToolDescription(config, 'filesystem', 'write_file', 'Write upstream')).toBe('Write upstream');
  });

  it('changes only the tool description', () => {
    const upstream: Tool = {
      name: 'read_file',
      description: 'Upstream description',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { content: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    };

    expect(applyEffectiveToolDescription(upstream, config, 'filesystem')).toEqual({
      ...upstream,
      description: 'Read a workspace file safely',
    });
  });

  it('removes blank overrides and omits the empty record', () => {
    expect(withToolDescriptionOverride(config, 'read_file', '   ').toolDescriptionOverrides).toBeUndefined();
    expect(withToolDescriptionOverride(config, 'write_file', ' Write a file ')).toMatchObject({
      toolDescriptionOverrides: {
        read_file: 'Read a workspace file safely',
        write_file: 'Write a file',
      },
    });
  });

  it.each(['raw', 'qualified', 'public'] as const)(
    'uses the %s override for source and compact public objects without decoding the public name',
    (referenceKind) => {
      const server = 'files';
      const name = `files_1mcp_${'x'.repeat(80)}`;
      const publicIdentity = buildPublicToolName(server, name);
      const references = { raw: name, qualified: `${server}_1mcp_${name}`, public: publicIdentity };
      const tool = { name, description: 'upstream', inputSchema: { type: 'object' as const } };
      const config = { toolDescriptionOverrides: { [references[referenceKind]]: 'custom' } };
      const entry = buildCatalogGeneration(1, [{ kind: 'tools', server, connectionKey: server, object: tool }])
        .entries[0];
      expect(applySourceToolDescription(tool, config, server)).toEqual({ ...tool, description: 'custom' });
      expect(applyEffectiveToolDescription(toProtocolTool(entry.publicObject), config, server)).toMatchObject({
        name: publicIdentity,
        description: 'custom',
      });
    },
  );

  it('preserves compact override keys when writing and removes equivalent existing raw keys', () => {
    const server = 'files';
    const name = 'x'.repeat(80);
    const publicIdentity = buildPublicToolName(server, name);
    const configured = { type: 'stdio' as const, command: 'node', toolDescriptionOverrides: { [name]: 'old' } };
    const updated = withToolDescriptionOverride(configured, publicIdentity, 'new', server);
    expect(updated.toolDescriptionOverrides).toEqual({ [publicIdentity]: 'new' });
    expect(applySourceToolDescription({ name, description: 'upstream' }, updated, server).description).toBe('new');
    expect(withToolDescriptionOverride(updated, name, undefined, server).toolDescriptionOverrides).toBeUndefined();
  });
});

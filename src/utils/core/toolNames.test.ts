import { describe, expect, it } from 'vitest';

import { buildUri } from './parsing.js';
import { buildPublicToolName, isValidPublicToolName } from './toolNames.js';

describe('public tool names', () => {
  it.each(['read', 'read-file.v2', 'nested_1mcp_read', 'name/part', 'x'.repeat(53)])(
    'preserves valid canonical names: %s',
    (upstreamIdentity) => {
      expect(buildPublicToolName('files', upstreamIdentity)).toBe(`files_1mcp_${upstreamIdentity}`);
    },
  );

  it.each([
    ['files', 'x'.repeat(54)],
    ['files', 'x'.repeat(200)],
    ['server'.repeat(30), 'read'],
    ['my server', 'read'],
    ['files', 'read:file'],
    ['文件', '读取😀'],
  ])('bounds and sanitizes names without losing logical source distinction: %s/%s', (server, upstreamIdentity) => {
    const name = buildPublicToolName(server, upstreamIdentity);
    expect(name).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
    expect(name).not.toBe(`${server}_1mcp_${upstreamIdentity}`);
    expect(buildPublicToolName(server, upstreamIdentity)).toBe(name);
    expect(buildPublicToolName(server, `${upstreamIdentity}2`)).not.toBe(name);
  });

  it('hashes structured parts rather than an ambiguous delimiter-containing canonical name', () => {
    const tail = 'x'.repeat(70);
    expect(buildPublicToolName('a', `b_1mcp_${tail}`)).not.toBe(buildPublicToolName('a_1mcp_b', tail));
  });

  it('keeps compact identities stable for cached client references', () => {
    expect(buildPublicToolName('files', 'x'.repeat(80))).toBe('files_1mcp_fad53fd1a47a0feebcc2a7bac662643ca231db7f');
  });

  it('preserves exact source tuples for invalid canonical names', () => {
    const upstreamIdentity = 'long name'.repeat(10);
    expect(buildPublicToolName(' files ', ` ${upstreamIdentity} `)).not.toBe(
      buildPublicToolName('files', upstreamIdentity),
    );
  });

  it.each([
    ['files', 'bad-\ud800'],
    ['bad-\udc00', 'read'],
    ['', 'read'],
    ['files', ' '],
  ])('rejects invalid source identities instead of repairing them: %s/%s', (server, upstreamIdentity) => {
    expect(() => buildPublicToolName(server, upstreamIdentity)).toThrow();
  });

  it('validates raw internal public names and leaves generic URI building intact', () => {
    expect(isValidPublicToolName('tool_list')).toBe(true);
    expect(isValidPublicToolName('name/part')).toBe(true);
    expect(isValidPublicToolName('a'.repeat(64))).toBe(true);
    for (const name of ['', 'a'.repeat(65), '文件', ' name ', 'tool_list\n']) {
      expect(isValidPublicToolName(name)).toBe(false);
    }
    expect(buildUri('files', 'file:///{path}', '_1mcp_')).toBe('files_1mcp_file:///{path}');
  });
});

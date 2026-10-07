import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';

import { describe, expect, it } from 'vitest';

import {
  buildPublicResourceTemplate,
  buildPublicResourceUri,
  isValidResourceTemplate,
  isValidResourceUri,
} from './resourceUris.js';

const prefix = 'mcp+1mcp.e7f5adcc8bd9b212+';

describe('public resource URI identities', () => {
  it.each([
    'test://static-text',
    'custom:',
    'custom:?q=one',
    'custom:#part',
    'file:///a%2fb%3F%23%25?q=a%20b#part%2f',
    'https://[::1]:8080/path?q=one#two',
    'urn:example:item',
    'mailto:user@example.test',
  ])('extends the scheme while preserving every upstream URI byte for %s', (upstream) => {
    const identity = buildPublicResourceUri('files', upstream);
    expect(identity).toBe(`${prefix}${upstream}`);
    expect(isValidResourceUri(identity)).toBe(true);
    expect(new URL(identity).protocol).toBe(`${prefix}${upstream.split(':')[0]}:`);
    expect(buildPublicResourceUri(' files ', upstream)).toBe(identity);
    expect(buildPublicResourceUri('other', upstream)).not.toBe(identity);
  });

  it('preserves already valid legacy URI and template identities exactly', () => {
    expect(buildPublicResourceUri('urn:tenant', 'test://static-text')).toBe('urn:tenant_1mcp_test://static-text');
    expect(buildPublicResourceTemplate('urn:tenant', 'file:///{id}')).toBe('urn:tenant_1mcp_file:///{id}');
  });

  it.each([
    ['file:///{user.name}', { 'user.name': 'one' }, 'file:///one'],
    ['file:///{%61}', { '%61': 'one' }, 'file:///one'],
    ['file:///{id}', { id: 'a/b' }, 'file:///a%2Fb'],
    ['https://[::1]/path{?q}{#fragment}', { q: 'a/b', fragment: 'part' }, 'https://[::1]/path?q=a%2Fb#part'],
    ['{scheme}:///path/{id}', { scheme: 'file', id: 'one' }, 'file:///path/one'],
    ['{+uri}', { uri: 'https://example.test/a%2fb?q=one#two' }, 'https://example.test/a%252fb?q=one#two'],
  ])('preserves template expressions and absolute expanded routing for %s', (upstream, variables, expanded) => {
    const identity = buildPublicResourceTemplate('files', upstream);
    expect(identity).toBe(`${prefix}${upstream}`);
    expect(isValidResourceTemplate(identity)).toBe(true);
    expect(new UriTemplate(upstream).expand(variables)).toBe(expanded);
    expect(new UriTemplate(identity).expand(variables)).toBe(`${prefix}${expanded}`);
    expect(isValidResourceUri(`${prefix}${expanded}`)).toBe(true);
  });

  it('rejects malformed logical server names instead of hashing them into valid display identities', () => {
    expect(() => buildPublicResourceUri('bad-\ud800', 'file:///one')).toThrow();
    expect(() => buildPublicResourceTemplate('bad-\ud800', 'file:///{id}')).toThrow();
  });

  it('keeps server namespace expressions literal by using one resource/template scheme prefix', () => {
    const server = 'urn:{tenant}';
    const template = buildPublicResourceTemplate(server, 'file:///{id}');
    const identity = buildPublicResourceUri(server, 'file:///one');
    expect(template).not.toContain('{tenant}');
    expect(new UriTemplate(template).expand({ id: 'one' })).toBe(identity);
  });

  it.each(['{user.name}', '{0name}', '{_name}', '{%61.name}', '{.name}', '{;name}', '{?name:9999}', '{name*}'])(
    'accepts RFC6570 variable grammar for %s',
    (value) => {
      expect(isValidResourceTemplate(value)).toBe(true);
    },
  );
  it.each([
    '{user..name}',
    '{user.}',
    '{user-name}',
    '{user%}',
    '{name:0}',
    '{name:10000}',
    '{name*:2}',
    '{é}',
    'file:///\u0080',
    'file:///\ufdd0',
  ])('rejects malformed RFC6570 grammar for %s', (value) => {
    expect(isValidResourceTemplate(value)).toBe(false);
  });

  it('retains relative RFC6570 templates without accepting relative concrete resource URIs', () => {
    const relative = '/path/{id}';
    expect(buildPublicResourceTemplate('files', relative)).toBe(`${prefix}${relative}`);
    expect(isValidResourceTemplate(relative)).toBe(true);
    expect(isValidResourceUri('/path/one')).toBe(false);
    expect(isValidResourceUri(`${prefix}/path/one`)).toBe(false);
  });

  it.each([
    '',
    '/relative',
    'file:///space here',
    'test://[bad]/path',
    'file:///bad%',
    'file:///x\n',
    'file:///\ud800',
    'file:///😀',
    'custom:?bad%',
    'custom:#bad%',
    'custom:##part',
  ])('rejects malformed absolute source URI %j', (identity) => {
    expect(isValidResourceUri(identity)).toBe(false);
    expect(() => buildPublicResourceUri('files', identity)).toThrow();
  });

  it.each(['', 'file:///{', 'file:///{id:0}', 'file:///bad%', 'file:///x\n', 'file:///\ud800'])(
    'rejects malformed source template %j',
    (identity) => {
      expect(isValidResourceTemplate(identity)).toBe(false);
      expect(() => buildPublicResourceTemplate('files', identity)).toThrow();
    },
  );
});

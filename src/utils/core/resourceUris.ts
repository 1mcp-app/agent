import { createHash } from 'node:crypto';

import { MCP_URI_SEPARATOR } from '@src/constants/mcp.js';

import addFormats from 'ajv-formats';

import { InvalidRequestError } from './errorTypes.js';
import { buildUri } from './parsing.js';

const uriFormat = addFormats.default.get('uri', 'full');
// ajv-formats omits RFC3986 path-empty and RFC6570 dotted variable names.
const queryOrFragment = "(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[A-Fa-f0-9]{2})*";
const pathEmptyUri = new RegExp(`^[A-Za-z][A-Za-z0-9+.-]*:(?:\\?${queryOrFragment})?(?:#${queryOrFragment})?$`, 'u');
const varchar = '(?:[A-Za-z0-9_]|%[A-Fa-f0-9]{2})';
const varname = `${varchar}(?:\\.?${varchar})*`;
const varspec = `${varname}(?::[1-9][0-9]{0,3}|\\*)?`;
const expression = new RegExp(`^[+#./;?&=,!@|]?${varspec}(?:,${varspec})*$`, 'u');

function hasOnlyUnicodeScalars(value: string): boolean {
  return Array.from(value).every((character) => {
    const point = character.codePointAt(0)!;
    return point < 0xd800 || point > 0xdfff;
  });
}

function hasUriCharacters(value: string): boolean {
  if (!value) return false;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point <= 0x20 || point === 0x7f) return false;
  }
  return hasOnlyUnicodeScalars(value);
}

export function isValidResourceUri(value: string): boolean {
  if (!hasUriCharacters(value)) return false;
  if (typeof uriFormat === 'function' && uriFormat(value) === true) return true;
  return pathEmptyUri.test(value);
}

/** RFC6570 sections 1.5 and 2; percent-encoded variable names are preserved, never decoded. */
export function isValidResourceTemplate(value: string): boolean {
  if (!hasUriCharacters(value)) return false;
  let offset = 0;
  while (offset < value.length) {
    const character = String.fromCodePoint(value.codePointAt(offset)!);
    if (character === '{') {
      const close = value.indexOf('}', offset + 1);
      if (close < 0 || !expression.test(value.slice(offset + 1, close))) return false;
      offset = close + 1;
      continue;
    }
    if (character === '%') {
      if (!/^[A-Fa-f0-9]{2}$/u.test(value.slice(offset + 1, offset + 3))) return false;
      offset += 3;
      continue;
    }
    if (!isTemplateLiteral(character)) return false;
    offset += character.length;
  }
  return true;
}

function isTemplateLiteral(character: string): boolean {
  const point = character.codePointAt(0)!;
  if (point <= 0x7e) return !/["'<>%\\^`{|}]/u.test(character);
  if (point >= 0xa0 && point <= 0xd7ff) return true;
  if (point >= 0xe000 && point <= 0xfdcf) return true;
  if (point >= 0xfdf0 && point <= 0xffef) return true;
  if ((point & 0xffff) > 0xfffd) return false;
  if (point >= 0x10000 && point <= 0xdfffd) return true;
  if (point >= 0xe1000 && point <= 0xefffd) return true;
  return point >= 0xf0000 && point <= 0x10fffd;
}

function projectResourceIdentity(
  server: string,
  upstreamIdentity: string,
  valid: (identity: string) => boolean,
  preserveLegacy: (identity: string) => boolean = valid,
): string {
  if (!valid(upstreamIdentity)) throw new InvalidRequestError('Unsupported upstream resource identity');
  const canonical = buildUri(server, upstreamIdentity, MCP_URI_SEPARATOR);
  if (!hasOnlyUnicodeScalars(canonical)) throw new InvalidRequestError('Invalid resource server identity');
  if (preserveLegacy(canonical)) return canonical;

  // Extending the scheme keeps the complete source URI/template suffix in its original component positions.
  // All resource kinds share one server prefix; sessions, backend instances and reloads do not change it.
  const hash = createHash('sha256')
    .update(JSON.stringify([server.trim()]))
    .digest('hex')
    .slice(0, 16);
  return `mcp+1mcp.${hash}+${upstreamIdentity}`;
}

export function buildPublicResourceUri(server: string, upstreamIdentity: string): string {
  return projectResourceIdentity(server, upstreamIdentity, isValidResourceUri);
}

export function buildPublicResourceTemplate(server: string, upstreamIdentity: string): string {
  // RFC6570 permits variable schemes and relative references. Concrete resource reads still require absolute URIs.
  return projectResourceIdentity(
    server,
    upstreamIdentity,
    isValidResourceTemplate,
    (canonical) => isValidResourceUri(`${server.trim()}${MCP_URI_SEPARATOR}`) && isValidResourceTemplate(canonical),
  );
}

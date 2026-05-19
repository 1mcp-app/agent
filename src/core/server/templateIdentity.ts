import { createHash } from '@src/utils/crypto.js';

export type TemplateIdentityMode = 'rendered' | 'session';

export interface StaticTemplateIdentity {
  kind: 'static';
  templateName: string;
}

export interface RenderedTemplateIdentity {
  kind: 'rendered';
  templateName: string;
  renderedHash: string;
}

export interface SessionTemplateIdentity {
  kind: 'session';
  templateName: string;
  sessionId: string;
}

export interface InvalidTemplateIdentity {
  kind: 'invalid';
  key: string;
}

export type TemplateIdentity = StaticTemplateIdentity | RenderedTemplateIdentity | SessionTemplateIdentity;
export type ParsedTemplateConnectionKey = TemplateIdentity | InvalidTemplateIdentity;

export interface PoolTemplateIdentity {
  templateName: string;
  renderedHash: string;
  sessionId?: string;
}

function assertIdentityComponent(label: string, value: string): void {
  if (!value) {
    throw new Error(`${label} must not be empty`);
  }

  if (value.includes(':')) {
    throw new Error(`${label} must not contain ':'`);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

export function templateRenderedHash(renderedConfig: unknown): string {
  return createHash(stableStringify(renderedConfig));
}

export function resolveTemplateIdentityMode(options?: {
  perClient?: boolean;
  shareable?: boolean;
}): TemplateIdentityMode {
  return options?.perClient || options?.shareable === false ? 'session' : 'rendered';
}

export function createStaticIdentity(templateName: string): StaticTemplateIdentity {
  assertIdentityComponent('templateName', templateName);
  return { kind: 'static', templateName };
}

export function createRenderedIdentity(templateName: string, renderedHash: string): RenderedTemplateIdentity {
  assertIdentityComponent('templateName', templateName);
  assertIdentityComponent('renderedHash', renderedHash);
  return { kind: 'rendered', templateName, renderedHash };
}

export function createSessionIdentity(templateName: string, sessionId: string): SessionTemplateIdentity {
  assertIdentityComponent('templateName', templateName);
  assertIdentityComponent('sessionId', sessionId);
  return { kind: 'session', templateName, sessionId };
}

export function serializeTemplateIdentity(identity: TemplateIdentity): string {
  switch (identity.kind) {
    case 'static':
      return identity.templateName;
    case 'rendered':
      return `${identity.templateName}:${identity.renderedHash}`;
    case 'session':
      return `${identity.templateName}:${identity.sessionId}`;
  }
}

export function serializePoolIdentity(identity: PoolTemplateIdentity): string {
  assertIdentityComponent('templateName', identity.templateName);
  assertIdentityComponent('renderedHash', identity.renderedHash);

  if (!identity.sessionId) {
    return `${identity.templateName}:${identity.renderedHash}`;
  }

  assertIdentityComponent('sessionId', identity.sessionId);
  return `${identity.templateName}:${identity.renderedHash}:${identity.sessionId}`;
}

export function parsePoolIdentity(key: string): PoolTemplateIdentity | InvalidTemplateIdentity {
  const parts = key.split(':');

  if (parts.length !== 2 && parts.length !== 3) {
    return { kind: 'invalid', key };
  }

  const [templateName, renderedHash, sessionId] = parts;
  if (!templateName || !renderedHash || (parts.length === 3 && !sessionId)) {
    return { kind: 'invalid', key };
  }

  return { templateName, renderedHash, sessionId };
}

export function parseTemplateConnectionKey(key: string): ParsedTemplateConnectionKey {
  const parts = key.split(':');

  if (parts.length === 1) {
    return parts[0] ? { kind: 'static', templateName: parts[0] } : { kind: 'invalid', key };
  }

  if (parts.length !== 2) {
    return { kind: 'invalid', key };
  }

  const [templateName, suffix] = parts;
  if (!templateName || !suffix) {
    return { kind: 'invalid', key };
  }

  return { kind: 'rendered', templateName, renderedHash: suffix };
}

export function createTemplateLookupCandidates(input: {
  templateName: string;
  sessionId?: string;
  renderedHash?: string;
}): TemplateIdentity[] {
  const candidates: TemplateIdentity[] = [];

  if (input.sessionId) {
    candidates.push(createSessionIdentity(input.templateName, input.sessionId));
  }

  if (input.renderedHash) {
    candidates.push(createRenderedIdentity(input.templateName, input.renderedHash));
  }

  candidates.push(createStaticIdentity(input.templateName));
  return candidates;
}

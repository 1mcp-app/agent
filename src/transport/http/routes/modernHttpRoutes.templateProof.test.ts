import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createTemplateContextProof,
  TemplateContextCapabilityStore,
  type TemplateContextProof,
} from '@src/core/context/templateContextTrust.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import type { InboundConnectionConfig } from '@src/core/types/index.js';
import type { ContextData } from '@src/types/context.js';

import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupModernHttpRoutes } from './modernHttpRoutes.js';

const context: ContextData = { project: { path: '/project/a' }, user: {}, environment: {}, sessionId: 'proxy-a' };
const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};
let directory: string | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
function fixture(mode: 'verified' | 'disabled' | 'legacy' = 'verified') {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-template-proof-'));
  // The real authority reads its Runtime Scope identity and owner-only capability from disk.
  const capability = new TemplateContextCapabilityStore({
    storageDir: directory,
    runtimeScopeId: new RuntimeIdentityService({ storageDir: directory }).getRuntimeScopeId(),
  }).getOrCreate();
  vi.spyOn(AgentConfigManager, 'getInstance').mockReturnValue({
    get: (key: string) => {
      if (key === 'runtimeScopeStoragePath') return directory;
      if (key === 'templateContext') return { trust: mode };
      if (key === 'auth') return { sessionTtlMinutes: 60 };
      return undefined;
    },
  } as AgentConfigManager);
  const prepare = vi.fn(async () => undefined);
  const bridgeConfigs: InboundConnectionConfig[] = [];
  const manager = {
    registerCleanup: vi.fn(),
    getClients: () => new Map(),
    prepareLogicalTemplateSession: prepare,
    retainLogicalTemplateSession: () => () => undefined,
    registerLogicalTemplateSessionCleanup: vi.fn(),
  };
  const instance = express();
  instance.use(express.json());
  setupModernHttpRoutes(
    instance as never,
    manager as never,
    [],
    async (_manager, config) => {
      bridgeConfigs.push(config);
      return {
        targetConnectionId: 'private',
        close: async () => undefined,
        outbound: {
          role: 'outbound',
          pin: { era: 'legacy', revision: '2025-11-25' },
          request: async () => ({ tools: [{ name: 'static_1mcp_safe', inputSchema: { type: 'object' } }] }),
          cancel: async () => undefined,
          close: async () => undefined,
        },
      } as never;
    },
    { allowsHost: () => true, allowsOrigin: () => true },
  );
  const post = (proof?: TemplateContextProof, session = 'proxy-a') =>
    request(instance)
      .post('/mcp')
      .set('MCP-Protocol-Version', '2026-07-28')
      .set('Mcp-Method', 'tools/list')
      .set('mcp-session-id', session)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: { ...meta, context, contextProof: proof } },
      });
  return { capability, post, prepare, bridgeConfigs };
}

describe('modern ingress reauthorizes signed template memberships', () => {
  it.each(['missing', 'tampered', 'expired', 'scope', 'session'] as const)(
    'denies %s proofs after a trusted request without reusing template membership',
    async (kind) => {
      const f = fixture();
      const valid = createTemplateContextProof(context, f.capability);
      const first = await f.post(valid);
      expect(first.body.error, JSON.stringify(first.body)).toBeUndefined();
      expect(f.prepare).toHaveBeenCalledOnce();
      let invalid: TemplateContextProof | undefined = valid;
      if (kind === 'missing') invalid = undefined;
      if (kind === 'tampered') invalid = { ...valid, signature: 'tampered' };
      if (kind === 'expired')
        invalid = createTemplateContextProof(context, f.capability, { now: () => new Date('2000-01-01T00:00:00Z') });
      if (kind === 'scope')
        invalid = createTemplateContextProof(context, { ...f.capability, runtimeScopeId: 'other-scope' });
      if (kind === 'session') invalid = createTemplateContextProof({ ...context, sessionId: 'proxy-b' }, f.capability);
      const next = await f.post(invalid);
      expect(f.prepare).toHaveBeenCalledOnce();
      if (kind === 'missing') {
        expect(next.body.result.tools).toContainEqual(expect.objectContaining({ name: 'static_1mcp_safe' }));
        expect(f.bridgeConfigs[1]).not.toHaveProperty('logicalTemplateSessionId');
        expect(f.bridgeConfigs[1]).not.toHaveProperty('context');
      } else {
        expect(next.status).toBe(400);
        expect(next.body.error.message).toBe('Request context proof rejected');
        expect(f.bridgeConfigs).toHaveLength(1);
      }
    },
  );

  it('never prepares signed caller templates in disabled mode', async () => {
    const f = fixture('disabled');
    const response = await f.post(createTemplateContextProof(context, f.capability));
    expect(response.status).toBe(400);
    expect(f.bridgeConfigs).toHaveLength(0);
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it('preserves explicit legacy policy for unsigned caller context', async () => {
    const f = fixture('legacy');
    const response = await f.post();
    expect(response.body.error).toBeUndefined();
    expect(f.prepare).toHaveBeenCalledWith(
      'proxy-a',
      context,
      expect.objectContaining({ logicalTemplateSessionId: 'proxy-a' }),
    );
  });
});

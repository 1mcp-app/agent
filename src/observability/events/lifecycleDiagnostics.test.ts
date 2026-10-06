import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { LoadingState, LoadingStateTracker } from '@src/core/loading/loadingStateTracker.js';
import { configureLogger } from '@src/logger/logger.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeEvent } from './normalize.js';

describe('runtime lifecycle diagnostics', () => {
  const directories: string[] = [];
  afterEach(() => {
    configureLogger({ logLevel: 'info', transport: 'http' });
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('captures actual loading and instruction counts without placeholders or instruction text', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-log-'));
    directories.push(directory);
    const logFile = path.join(directory, 'runtime.log');
    configureLogger({ logLevel: 'info', logFile, transport: 'stdio' });
    const tracker = new LoadingStateTracker();
    tracker.startLoading(['backend-one', 'backend-two']);
    tracker.updateServerState('backend-one', LoadingState.Ready);
    tracker.updateServerState('backend-two', LoadingState.AwaitingOAuth);
    const instructions = new InstructionAggregator();
    instructions.setInstructions('backend-one', 'private upstream instruction content');
    await vi.waitFor(() => expect(fs.readFileSync(logFile, 'utf8')).toContain('Instructions changed'));
    const output = fs.readFileSync(logFile, 'utf8');
    expect(output).not.toContain('<private>');
    expect(output).not.toContain('private upstream instruction content');
    expect(output).toContain('"totalServers":2');
    expect(output).toContain('"ready":1');
    expect(output).toContain('"awaitingOAuth":1');
    expect(output).toContain('"successRate":50');
    expect(output).toContain('"serverCount":1');
  });

  it('identifies cleaned up instances without exposing configuration-derived keys', () => {
    const result = normalizeEvent('templateServerManager.cleaned.up.idle.client.instance.e6d1bdd9', {
      templateName: 'serena',
      instanceId: '0123456789abcdef'.repeat(4),
      instanceKey: 'serena:secret-config:secret-session',
    });
    expect(result).toMatchObject({ templateName: 'serena', instanceId: '0123456789abcdef'.repeat(4) });
    expect(result?.message).not.toContain('<private>');
    expect(JSON.stringify(result)).not.toContain('secret-config');
    expect(JSON.stringify(result)).not.toContain('secret-session');
  });
});

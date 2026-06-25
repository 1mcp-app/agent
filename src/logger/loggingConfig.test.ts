import { DEFAULT_LOG_LEVEL, parseByteSize, resolveLoggingConfig } from '@src/logger/loggingConfig.js';

import { describe, expect, it } from 'vitest';

describe('parseByteSize', () => {
  it('returns undefined for missing values', () => {
    expect(parseByteSize(undefined)).toBeUndefined();
  });

  it('passes through positive numbers as bytes', () => {
    expect(parseByteSize(1048576)).toBe(1048576);
  });

  it('rejects non-positive numbers', () => {
    expect(parseByteSize(0)).toBeUndefined();
    expect(parseByteSize(-5)).toBeUndefined();
  });

  it('parses unit-suffixed strings (case-insensitive, optional b)', () => {
    expect(parseByteSize('512')).toBe(512);
    expect(parseByteSize('1k')).toBe(1024);
    expect(parseByteSize('10m')).toBe(10 * 1024 * 1024);
    expect(parseByteSize('1G')).toBe(1024 ** 3);
    expect(parseByteSize('10MB')).toBe(10 * 1024 * 1024);
    expect(parseByteSize('1.5m')).toBe(Math.floor(1.5 * 1024 * 1024));
  });

  it('returns undefined for unparseable strings', () => {
    expect(parseByteSize('abc')).toBeUndefined();
    expect(parseByteSize('')).toBeUndefined();
  });
});

describe('resolveLoggingConfig precedence', () => {
  // Every tier supplies a distinct value so the winner is unambiguous.
  const allTiers = {
    cli: { level: 'error', file: '/cli.log' },
    structured: { level: 'warn', file: '/structured.log' },
    flat: { level: 'info', file: '/flat.log' },
    env: { level: 'debug', file: '/env.log' },
  };

  it('CLI flag wins over everything', () => {
    const { resolved } = resolveLoggingConfig(allTiers);
    expect(resolved.level).toBe('error');
    expect(resolved.file).toBe('/cli.log');
  });

  it('structured logging.* wins when CLI is absent', () => {
    const { resolved } = resolveLoggingConfig({ ...allTiers, cli: {} });
    expect(resolved.level).toBe('warn');
    expect(resolved.file).toBe('/structured.log');
  });

  it('deprecated flat alias wins over env when CLI and structured are absent', () => {
    const { resolved } = resolveLoggingConfig({ cli: {}, structured: {}, flat: allTiers.flat, env: allTiers.env });
    expect(resolved.level).toBe('info');
    expect(resolved.file).toBe('/flat.log');
  });

  it('environment variable wins over default when only env is set', () => {
    const { resolved } = resolveLoggingConfig({ env: { level: 'debug', file: '/env.log' } });
    expect(resolved.level).toBe('debug');
    expect(resolved.file).toBe('/env.log');
  });

  it('falls back to the default level when nothing is set', () => {
    const { resolved } = resolveLoggingConfig({});
    expect(resolved.level).toBe(DEFAULT_LOG_LEVEL);
    expect(resolved.file).toBeUndefined();
  });

  it('reports which deprecated flat keys were present', () => {
    expect(resolveLoggingConfig({ flat: { level: 'info', file: '/flat.log' } }).deprecatedKeys).toEqual([
      'logLevel',
      'logFile',
    ]);
    expect(resolveLoggingConfig({ flat: { level: 'info' } }).deprecatedKeys).toEqual(['logLevel']);
    expect(resolveLoggingConfig({ structured: { level: 'warn' } }).deprecatedKeys).toEqual([]);
  });

  it('sources rotation only from the structured block and parses maxSize', () => {
    const { resolved } = resolveLoggingConfig({
      structured: { maxSize: '10m', maxFiles: 5 },
    });
    expect(resolved.maxSize).toBe(10 * 1024 * 1024);
    expect(resolved.maxFiles).toBe(5);
  });
});

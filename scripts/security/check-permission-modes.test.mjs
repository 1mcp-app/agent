// Behavioral tests for scripts/security/check-permission-modes.mjs.
// Table-driven minus-the-CLI: ESLint RuleTester mental model — every scanner
// branch gets one false-positive case (must NOT report) and one false-negative
// case (MUST report), because a silently broken security gate is worse than a
// noisy one. scanContent covers the scanner; runGate covers the command-level
// behavior (baseline match, template-reason audit, new/stale findings,
// --update/--prune writes, exit codes) against a synthetic tree + baseline.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runGate, scanContent } from './check-permission-modes.mjs';

const REL = 'fixture/file.ts';
const scan = (source) => scanContent(REL, source);

describe('check-permission-modes scanContent', () => {
  it('flags a mode-less fs.writeFileSync', () => {
    const findings = scan("fs.writeFileSync('a', data);");
    expect(findings).toHaveLength(1);
    expect(findings[0].call).toBe('writeFileSync');
  });

  it('accepts writeFileSync with owner-only mode 0o600', () => {
    expect(scan("fs.writeFileSync('a', data, { mode: 0o600 });")).toHaveLength(0);
  });

  it('flags writeFileSync with permissive mode 0o644 (value check, not presence check)', () => {
    const findings = scan("fs.writeFileSync('a', data, { mode: 0o644 });");
    expect(findings).toHaveLength(1);
  });

  it('flags writeFileSync with world-writable mode 0o666', () => {
    expect(scan("fs.writeFileSync('a', data, 'utf8', 0o666);")).toHaveLength(1);
  });

  it('flags writeFileSync with a permissive hex mode (radix check)', () => {
    // 0x1B4 === 0o664 — a radix-8 parseInt would read it as 0 and suppress.
    expect(scan("fs.writeFileSync('a', data, { mode: 0x1B4 });")).toHaveLength(1);
  });

  it('accepts writeFileSync with owner-only numeric-separator mode 0o6_00', () => {
    expect(scan("fs.writeFileSync('a', data, { mode: 0o6_00 });")).toHaveLength(0);
  });

  it('accepts mkdirSync with owner-only mode 0o700', () => {
    expect(scan("fs.mkdirSync('d', { recursive: true, mode: 0o700 });")).toHaveLength(0);
  });

  it('flags mkdirSync with permissive mode 0o755', () => {
    expect(scan("fs.mkdirSync('d', { mode: 0o755 });")).toHaveLength(1);
  });

  it('flags mode passed as a leading positional argument (writeFileSync(path, data, 0o644))', () => {
    expect(scan("fs.writeFileSync('a', data, 0o644);")).toHaveLength(1);
  });

  it('reads the mode across a multi-line call (no line-window dependency)', () => {
    const src = [
      'fs.writeFileSync(',
      "  'a',",
      '  data,',
      '  {',
      "    encoding: 'utf8',",
      '    mode: 0o600,',
      '  },',
      ');',
    ].join('\n');
    expect(scan(src)).toHaveLength(0);
  });

  it('treats a read-only fs.openSync as not permission-relevant', () => {
    expect(scan("const fd = fs.openSync('a', 'r');")).toHaveLength(0);
  });

  it('accepts fs.openSync with exclusive flag and owner-only mode', () => {
    expect(scan("const fd = fs.openSync('a', 'wx', 0o600);")).toHaveLength(0);
  });

  it('flags fs.openSync with writable flag and no mode', () => {
    const findings = scan("const fd = fs.openSync('a', 'w');");
    expect(findings).toHaveLength(1);
    expect(findings[0].call).toBe('openSync');
  });

  it('flags fs.openSync with writable flag but permissive mode', () => {
    expect(scan("const fd = fs.openSync('a', 'w', 0o644);")).toHaveLength(1);
  });

  it('flags fs.openSync with numeric write flags (O_WRONLY|O_CREAT|O_TRUNC)', () => {
    expect(scan("const fd = fs.openSync('a', 0o1301);")).toHaveLength(1);
  });

  it('accepts fs.openSync with the numeric O_RDONLY flag (0)', () => {
    expect(scan("const fd = fs.openSync('a', 0);")).toHaveLength(0);
  });

  it('flags fs.openSync with variable flags (conservative: unevaluable flags are treated as writes)', () => {
    const src = ["const flags = 'wx';", "const fd = fs.openSync('a', flags);"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags fs.openSync with a call-expression flags argument (credentialReadFlags-style)', () => {
    expect(scan("const fd = fs.openSync('a', credentialReadFlags());")).toHaveLength(1);
  });

  it('flags fs.open with a write flag', () => {
    expect(scan("fs.open('a', 'w', (err, fd) => {});")).toHaveLength(1);
  });

  it('accepts fs.open with a provably read-only flag', () => {
    expect(scan("fs.open('a', 'r', (err, fd) => {});")).toHaveLength(0);
  });

  it('accepts fs.open with exclusive flag and owner-only mode', () => {
    expect(scan("fs.open('a', 'wx', 0o600, (err, fd) => {});")).toHaveLength(0);
  });

  it('flags promises.open imported by name', () => {
    const src = ["import { open } from 'node:fs/promises';", "await open('a', 'w');"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags promises.open through a default import', () => {
    const src = ["import fsp from 'node:fs/promises';", "await fsp.open('a', 'w');"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('accepts fs.copyFileSync followed by a chmod on the destination', () => {
    const src = ['fs.copyFileSync(src, dest);', 'fs.chmodSync(dest, 0o600);'].join('\n');
    expect(scan(src)).toHaveLength(0);
  });

  it('flags fs.copyFileSync without a trailing chmod (destination inherits source mode)', () => {
    const findings = scan("fs.copyFileSync('src', 'dest');");
    expect(findings).toHaveLength(1);
    expect(findings[0].call).toBe('copyFileSync');
  });

  it('flags copyFileSync followed by a chmod on a different target (false-negative regression)', () => {
    const src = ['fs.copyFileSync(src, dest);', 'fs.chmodSync(other, 0o777);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags copyFileSync followed by a permissive chmod on the right target (value check, not target check)', () => {
    const src = ['fs.copyFileSync(src, dest);', 'fs.chmodSync(dest, 0o644);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('accepts copyFileSync followed by an owner-only 0o700 chmod on the destination (dir-exec bit)', () => {
    const src = ['fs.copyFileSync(src, dest);', 'fs.chmodSync(dest, 0o700);'].join('\n');
    expect(scan(src)).toHaveLength(0);
  });

  it('flags async fs.writeFile without a mode', () => {
    expect(scan("await fs.writeFile('a', data);")).toHaveLength(1);
  });

  it('flags destructured writeFile imported from node:fs/promises', () => {
    const src = ["import { writeFile } from 'node:fs/promises';", 'await writeFile(target, payload);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('does not treat a bare writeFile call as guarded without a node:fs import binding', () => {
    expect(scan('await writeFile(target, payload);')).toHaveLength(0);
  });

  it('produces stable file#occurrence#call fingerprints across multiple findings', () => {
    const src = ["fs.writeFileSync('a', d);", "fs.mkdirSync('b');", "fs.writeFileSync('c', d);"].join('\n');
    const findings = scan(src);
    expect(findings.map((f) => f.fingerprint)).toEqual([
      `${REL}#1#writeFileSync`,
      `${REL}#2#mkdirSync`,
      `${REL}#3#writeFileSync`,
    ]);
  });

  it('associates a mode appearing before the call on a prior line (leading arg)', () => {
    // mode on the line above belongs to a different statement — must still flag.
    const src = ['const opts = { mode: 0o600 };', 'fs.writeFileSync(path, data);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  // --- reviewer-demonstrated false negatives (mode association) ---

  it('does not let an unrelated mode literal suppress a mode-less write (reviewer example 1)', () => {
    const src = ['fs.writeFileSync(secretPath, data);', 'const unrelated = { mode: 0o600 };'].join('\n');
    const findings = scan(src);
    expect(findings).toHaveLength(1);
    expect(findings[0].call).toBe('writeFileSync');
  });

  it('does not let another call mode suppress a mode-less write (reviewer example 2)', () => {
    const src = ['fs.writeFileSync(secretPath, data);', 'fs.mkdirSync(otherDir, { mode: 0o700 });'].join('\n');
    const findings = scan(src);
    expect(findings).toHaveLength(1);
    expect(findings[0].call).toBe('writeFileSync');
  });

  it('still flags a mode-less write followed by a mode-less mkdirSync (both unguarded)', () => {
    const src = ['fs.writeFileSync(secretPath, data);', 'fs.mkdirSync(otherDir);'].join('\n');
    expect(scan(src)).toHaveLength(2);
  });

  // --- reviewer-demonstrated false negatives (import awareness) ---

  it('flags a named static import used as a bare call (reviewer example 3)', () => {
    const src = ["import { writeFileSync } from 'node:fs';", 'writeFileSync(path, secret);'].join('\n');
    const findings = scan(src);
    expect(findings).toHaveLength(1);
    expect(findings[0].call).toBe('writeFileSync');
  });

  it('flags a default-import alias used with a property call (reviewer example 4)', () => {
    const src = ["import fsSync from 'node:fs';", 'fsSync.writeFileSync(path, secret);'].join('\n');
    const findings = scan(src);
    expect(findings).toHaveLength(1);
    expect(findings[0].call).toBe('writeFileSync');
  });

  it('flags a namespace import', () => {
    const src = ["import * as fs from 'node:fs';", "fs.mkdirSync('d');"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a renamed named import', () => {
    const src = ["import { writeFileSync as wfs } from 'node:fs';", 'wfs(path, secret);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a CommonJS require binding', () => {
    const src = ["const fs = require('node:fs');", "fs.appendFileSync('a', data);"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a destructured CommonJS require binding', () => {
    const src = ["const { writeFileSync } = require('node:fs');", 'writeFileSync(path, secret);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a default import from node:fs/promises', () => {
    const src = ["import fsp from 'node:fs/promises';", "await fsp.writeFile('a', data);"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a one-level const alias of a module method', () => {
    const src = ["import fs from 'node:fs';", 'const w = fs.writeFileSync;', 'w(path, secret);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags the promises sub-namespace through a module property chain', () => {
    const src = ["import fs from 'node:fs';", "await fs.promises.writeFile('a', data);"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a promises-as named import binding', () => {
    const src = ["import { promises as fsp } from 'node:fs';", "await fsp.copyFile('a', 'b');"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags an unaliased promises named import binding', () => {
    const src = ["import { promises } from 'node:fs';", "await promises.writeFile('a', data);"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a default-as named import binding', () => {
    const src = ["import { default as fs } from 'node:fs';", 'fs.writeFileSync(path, secret);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a const alias of the promises sub-namespace', () => {
    const src = ["import fs from 'node:fs';", 'const fsp = fs.promises;', "await fsp.writeFile('a', data);"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags an inline require chain', () => {
    expect(scan("require('node:fs').writeFileSync(path, secret);")).toHaveLength(1);
  });

  it('flags an inline require chain through the promises sub-namespace', () => {
    expect(scan("require('node:fs').promises.writeFile(path, secret);")).toHaveLength(1);
  });

  it('flags a destructured require of the promises sub-namespace', () => {
    const src = ["const { promises } = require('node:fs');", "await promises.writeFile('a', data);"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a destructured require of default', () => {
    const src = ["const { default: fs } = require('node:fs');", 'fs.writeFileSync(path, secret);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a const alias of a require-chain method', () => {
    const src = ["const w = require('node:fs').writeFileSync;", 'w(path, secret);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('flags a const alias of the require-chained promises sub-namespace', () => {
    const src = ["const fsp = require('node:fs').promises;", "await fsp.writeFile('a', data);"].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('does not flag an unrelated local function named like an fs write', () => {
    const src = ['function writeFile(target: string) {}', 'writeFile(target);'].join('\n');
    expect(scan(src)).toHaveLength(0);
  });

  it('accepts a named-import write that carries its own owner-only mode', () => {
    const src = ["import { writeFileSync } from 'node:fs';", 'writeFileSync(path, secret, { mode: 0o600 });'].join(
      '\n',
    );
    expect(scan(src)).toHaveLength(0);
  });

  it('flags a mode carried by a variable (conservative: unevaluable mode is treated as missing)', () => {
    const src = ['const MODE = 0o600;', 'fs.writeFileSync(path, data, MODE);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('fails closed on unparseable source', () => {
    expect(() => scan("fs.writeFileSync('a', data); const broken = {")).toThrow(/failed to parse/);
  });
});

describe('check-permission-modes runGate (command-level)', () => {
  const makeRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'perm-gate-test-'));
  const writeSrc = (root, rel, content) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const noopLog = () => ({ log: () => {}, warn: () => {}, error: () => {} });
  const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

  it('enforce exits 0 when every finding matches a reviewed baseline entry', () => {
    const root = makeRoot();
    const baselinePath = path.join(root, 'baseline.json');
    writeSrc(root, 'a.ts', "fs.writeFileSync('a', data);");
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        schema: 1,
        entries: [
          {
            fingerprint: 'a.ts#1#writeFileSync',
            file: 'a.ts',
            call: 'writeFileSync',
            line: 1,
            reason: 'audited (test)',
          },
        ],
      }),
    );
    expect(runGate({ root, baselinePath, mode: 'enforce', sourceFiles: ['a.ts'], log: noopLog() })).toBe(0);
    cleanup(root);
  });

  it('enforce exits 1 on a new finding with no baseline entry', () => {
    const root = makeRoot();
    const baselinePath = path.join(root, 'baseline.json');
    writeSrc(root, 'a.ts', "fs.writeFileSync('a', data);");
    fs.writeFileSync(baselinePath, JSON.stringify({ schema: 1, entries: [] }));
    expect(runGate({ root, baselinePath, mode: 'enforce', sourceFiles: ['a.ts'], log: noopLog() })).toBe(1);
    cleanup(root);
  });

  it('enforce exits 1 when a baseline entry still carries the --update template reason', () => {
    const root = makeRoot();
    const baselinePath = path.join(root, 'baseline.json');
    writeSrc(root, 'a.ts', "fs.writeFileSync('a', data);");
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        schema: 1,
        entries: [
          {
            fingerprint: 'a.ts#1#writeFileSync',
            file: 'a.ts',
            call: 'writeFileSync',
            line: 1,
            reason: 'pre-existing, recorded at ticket-05 gate baseline; triage under 08-lowseverity-hardening',
          },
        ],
      }),
    );
    expect(runGate({ root, baselinePath, mode: 'enforce', sourceFiles: ['a.ts'], log: noopLog() })).toBe(1);
    cleanup(root);
  });

  it('enforce exits 0 on a stale baseline entry (warning only, never fails the gate)', () => {
    const root = makeRoot();
    const baselinePath = path.join(root, 'baseline.json');
    writeSrc(root, 'a.ts', "fs.writeFileSync('a', data);");
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        schema: 1,
        entries: [
          {
            fingerprint: 'a.ts#1#writeFileSync',
            file: 'a.ts',
            call: 'writeFileSync',
            line: 1,
            reason: 'audited (test)',
          },
          { fingerprint: 'gone.ts#1#mkdirSync', file: 'gone.ts', call: 'mkdirSync', line: 1, reason: 'audited (test)' },
        ],
      }),
    );
    const warns = [];
    const code = runGate({
      root,
      baselinePath,
      mode: 'enforce',
      sourceFiles: ['a.ts'],
      log: { log: () => {}, warn: (m) => warns.push(m), error: () => {} },
    });
    expect(code).toBe(0);
    expect(warns.some((w) => w.includes('stale-baseline'))).toBe(true);
    cleanup(root);
  });

  it('--update writes one baseline entry per finding and exits 0', () => {
    const root = makeRoot();
    const baselinePath = path.join(root, 'baseline.json');
    writeSrc(root, 'a.ts', "fs.writeFileSync('a', data);");
    writeSrc(root, 'b.ts', "fs.mkdirSync('d');");
    expect(runGate({ root, baselinePath, mode: 'update', sourceFiles: ['a.ts', 'b.ts'], log: noopLog() })).toBe(0);
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    expect(baseline.entries.map((e) => e.fingerprint).sort()).toEqual(['a.ts#1#writeFileSync', 'b.ts#1#mkdirSync']);
    cleanup(root);
  });

  it('--update preserves the reason and record date of an exactly matching reviewed entry', () => {
    const root = makeRoot();
    const baselinePath = path.join(root, 'baseline.json');
    writeSrc(root, 'a.ts', "fs.writeFileSync('a', data);");
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        schema: 1,
        entries: [
          {
            fingerprint: 'a.ts#1#writeFileSync',
            file: 'a.ts',
            call: 'writeFileSync',
            line: 1,
            reason: 'audited (test)',
            enteredAt: '2020-01-01',
            ticket: '08-lowseverity-hardening',
          },
        ],
      }),
    );
    expect(runGate({ root, baselinePath, mode: 'update', sourceFiles: ['a.ts'], log: noopLog() })).toBe(0);
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    expect(baseline.entries[0].reason).toBe('audited (test)');
    expect(baseline.entries[0].enteredAt).toBe('2020-01-01');
    cleanup(root);
  });

  it('--prune removes stale entries, keeps matching ones, and exits 0', () => {
    const root = makeRoot();
    const baselinePath = path.join(root, 'baseline.json');
    writeSrc(root, 'a.ts', "fs.writeFileSync('a', data);");
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        schema: 1,
        entries: [
          {
            fingerprint: 'a.ts#1#writeFileSync',
            file: 'a.ts',
            call: 'writeFileSync',
            line: 1,
            reason: 'audited (test)',
          },
          { fingerprint: 'gone.ts#1#mkdirSync', file: 'gone.ts', call: 'mkdirSync', line: 1, reason: 'audited (test)' },
        ],
      }),
    );
    expect(runGate({ root, baselinePath, mode: 'prune', sourceFiles: ['a.ts'], log: noopLog() })).toBe(0);
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    expect(baseline.entries.map((e) => e.fingerprint)).toEqual(['a.ts#1#writeFileSync']);
    cleanup(root);
  });
});

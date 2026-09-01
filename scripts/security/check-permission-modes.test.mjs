// Behavioral tests for scripts/security/check-permission-modes.mjs.
// Table-driven minus-the-CLI: ESLint RuleTester mental model — every scanner
// branch gets one false-positive case (must NOT report) and one false-negative
// case (MUST report), because a silently broken security gate is worse than a
// noisy one. runGate() spawns the real CLI only where exit-code behavior is
// asserted; everything else goes through the scanContent seam.
import { describe, expect, it } from 'vitest';

import { scanContent } from './check-permission-modes.mjs';

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

  it('accepts mkdirSync with owner-only mode 0o700', () => {
    expect(scan("fs.mkdirSync('d', { recursive: true, mode: 0o700 });")).toHaveLength(0);
  });

  it('flags mkdirSync with permissive mode 0o755', () => {
    expect(scan("fs.mkdirSync('d', { mode: 0o755 });")).toHaveLength(1);
  });

  it('flags mode passed as a leading positional argument (writeFileSync(path, data, 0o644))', () => {
    expect(scan("fs.writeFileSync('a', data, 0o644);")).toHaveLength(1);
  });

  it('reads the mode across a multi-line call (6-line statement window)', () => {
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

  it('accepts fs.copyFileSync followed by a chmod on the destination', () => {
    const src = ['fs.copyFileSync(src, dest);', 'fs.chmodSync(dest, 0o600);'].join('\n');
    expect(scan(src)).toHaveLength(0);
  });

  it('flags fs.copyFileSync without a trailing chmod (destination inherits source mode)', () => {
    const findings = scan("fs.copyFileSync('src', 'dest');");
    expect(findings).toHaveLength(1);
    expect(findings[0].call).toBe('copyFileSync');
  });

  it('flags async fs.writeFile without a mode', () => {
    expect(scan("await fs.writeFile('a', data);")).toHaveLength(1);
  });

  it('flags destructured writeFile imported from node:fs/promises', () => {
    const src = ["import { writeFile } from 'node:fs/promises';", 'await writeFile(target, payload);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('does not treat a bare writeFile call as guarded without the destructured fs import', () => {
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
    // mode on the line above is NOT in the statement window — must still flag.
    const src = ['const opts = { mode: 0o600 };', 'fs.writeFileSync(path, data);'].join('\n');
    expect(scan(src)).toHaveLength(1);
  });
});

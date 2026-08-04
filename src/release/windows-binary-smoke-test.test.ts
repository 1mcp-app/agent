import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

function readWindowsBinarySmokeTest(): string {
  return fs.readFileSync(path.join(process.cwd(), 'scripts', 'test-binary-windows.ps1'), 'utf8');
}

describe('Windows binary smoke test', () => {
  it('writes JSON fixtures as UTF-8 without a byte-order mark', () => {
    const script = readWindowsBinarySmokeTest();

    expect(script).toContain('[System.Text.UTF8Encoding]::new($false)');
    expect(script.match(/\[System\.IO\.File\]::WriteAllText/g)).toHaveLength(2);
    expect(script).not.toMatch(/Out-File[^\r\n]+-Encoding utf8/);
  });
});

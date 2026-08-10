import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

function readWindowsBinarySmokeTest(): string {
  return fs.readFileSync(path.join(process.cwd(), 'scripts', 'test-binary-windows.ps1'), 'utf8');
}

describe('Windows binary smoke test', () => {
  it('writes JSON fixtures as UTF-8 without a byte-order mark', () => {
    const script = readWindowsBinarySmokeTest();
    const writeCalls = script.match(/\[System\.IO\.File\]::WriteAllText[^\r\n]+/g) ?? [];

    expect(script).toContain('[System.Text.UTF8Encoding]::new($false)');
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls.every((call) => call.includes('$Utf8NoBom'))).toBe(true);
    expect(script).not.toMatch(/Out-File[^\r\n]+-Encoding utf8/);
  });

  it('uses basic response parsing for Windows PowerShell 5.1 web requests', () => {
    const script = readWindowsBinarySmokeTest();
    const webRequests = script.match(/Invoke-WebRequest[^\r\n]+/g);

    expect(webRequests).toHaveLength(3);
    for (const request of webRequests ?? []) {
      expect(request).toContain('-UseBasicParsing');
    }
  });
});

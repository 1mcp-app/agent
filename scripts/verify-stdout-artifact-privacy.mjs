#!/usr/bin/env node
/** Windows-only synthetic spill/ACL smoke; changes ACLs only inside its owned temporary tree. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createTestProcessEnvironment, isolatedTestEnvironment } from './test-process-environment.mjs';

assert.equal(process.platform, 'win32', 'Run this native ACL smoke on Windows.');
const execute = promisify(execFile);
const isolated = isolatedTestEnvironment();
Object.assign(process.env, createTestProcessEnvironment(isolated.env));
const scratch = await mkdtemp(path.join(os.tmpdir(), 'stdout-privacy-smoke-'));
const output = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
  : undefined;
const powershell = path.win32.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe',
);
async function acl(file, body) {
  const encoded = Buffer.from(file, 'utf8').toString('base64');
  const script = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; ${body}`;
  return execute(
    powershell,
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { timeout: 20000 },
  );
}
async function inspect(file) {
  const result = await acl(
    file,
    `
    $a=(Get-Item -LiteralPath $p).GetAccessControl()
    @{ current=$sid.Value; owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value; protected=$a.AreAccessRulesProtected;
       rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {
         @{ sid=$_.IdentityReference.Value; rights=$_.FileSystemRights.ToString(); allow=$_.AccessControlType.ToString() }
       }) } | ConvertTo-Json -Depth 4 -Compress
  `,
  );
  return JSON.parse(result.stdout);
}
try {
  const broad = path.join(scratch, 'broad-parent');
  await mkdir(broad, { mode: 0o700 });
  await acl(
    broad,
    `
    $item=[IO.DirectoryInfo]::new($p); $a=[Security.AccessControl.DirectorySecurity]::new()
    $a.SetOwner($sid); $a.SetAccessRuleProtection($true,$false)
    $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'))
    $item.SetAccessControl($a)
  `,
  );
  const inherited = path.join(broad, 'inherited');
  await mkdir(inherited, { mode: 0o700 });
  assert(
    (await inspect(inherited)).rules.some((rule) => rule.sid === 'S-1-1-0'),
    'Fixture must inherit broad read access.',
  );
  process.env.TEMP = broad;
  process.env.TMP = broad;
  process.env.TMPDIR = broad;
  const { formatBudgetedToolOutput, validateStdoutBudget } = await import('../build/commands/run/stdoutBudget.js');
  const { secureNewPrivateEntry, verifyPrivateDirectory } =
    await import('../build/utils/security/privateFileSystem.js');
  const result = {
    content: [{ type: 'text', text: 'synthetic-private-result'.repeat(1000) }],
    _meta: { synthetic: true },
  };
  const stdout = await formatBudgetedToolOutput(result, 'json', 2000, validateStdoutBudget(4096, 'json'));
  assert(Buffer.byteLength(`${stdout}\n`) <= 4096);
  const receipt = JSON.parse(stdout);
  assert.equal(path.dirname(path.dirname(receipt.path)), broad);
  assert.deepEqual(JSON.parse(await readFile(receipt.path, 'utf8')), result);
  const directoryAcl = await inspect(path.dirname(receipt.path));
  const fileAcl = await inspect(receipt.path);
  for (const entry of [directoryAcl, fileAcl]) {
    assert.equal(entry.owner, entry.current);
    assert.deepEqual(entry.rules, [{ sid: entry.current, rights: 'FullControl', allow: 'Allow' }]);
  }
  assert.equal(directoryAcl.protected, true);
  await verifyPrivateDirectory(path.dirname(receipt.path));
  await acl(
    receipt.path,
    `
    $item=[IO.FileInfo]::new($p); $a=$item.GetAccessControl()
    $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow'))
    $item.SetAccessControl($a)
  `,
  );
  await assert.rejects(verifyPrivateDirectory(path.dirname(receipt.path)), /privacy verification denied/);
  await assert.rejects(secureNewPrivateEntry(receipt.path, false), /privacy verification denied/);
  const evidence = {
    platform: process.platform,
    node: process.versions.node,
    broadInheritanceProved: true,
    directoryOwnerOnly: true,
    fileOwnerOnly: true,
    completeArtifact: true,
    populatedAclTamperingRejected: true,
  };
  if (output) await writeFile(output, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  await rm(scratch, { recursive: true, force: true });
  isolated.cleanup();
}

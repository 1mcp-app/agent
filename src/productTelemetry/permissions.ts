import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

/** Verify before opening state; only this call's newly created empty root may be initialized. */
export async function verifyInstallationPrivacy(
  root: string,
  options: { background?: boolean; created?: boolean } = {},
): Promise<void> {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Product telemetry path is redirected');
  if (process.platform !== 'win32') {
    if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
      throw new Error('Product telemetry path is not owner-only');
    return;
  }
  await windowsPrivacy(root, options.created ? 'initialize' : 'verify', true, options.background ?? false);
}

/** Called immediately after exclusive creation, while empty, before writing any product/owner data. */
export async function secureNewInstallationEntry(file: string, directory: boolean, background = false): Promise<void> {
  if (process.platform !== 'win32') return;
  await windowsPrivacy(file, 'repair-empty', directory, background);
}

function windowsPrivacy(
  file: string,
  action: 'initialize' | 'verify' | 'repair-empty',
  directory: boolean,
  background: boolean,
): Promise<void> {
  const encodedPath = Buffer.from(file, 'utf8').toString('base64');
  // Only base64 path data and closed operation flags enter this fixed script.
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $sid = $identity.User
  $item = if (${directory ? '$true' : '$false'}) { [IO.DirectoryInfo]::new($p) } else { [IO.FileInfo]::new($p) }
  $ancestor = if ($item -is [IO.DirectoryInfo]) { $item } else { $item.Directory }
  for (; $null -ne $ancestor; $ancestor = $ancestor.Parent) {
    if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'redirected' }
  }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'redirected' }
  function AssertPrivateRules($entry) {
    $a = $entry.GetAccessControl()
    $rules = @($a.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 1) { throw 'rules' }
    $r = $rules[0]
    if ($r.IdentityReference.Value -ne $sid.Value -or $r.AccessControlType -ne 'Allow' -or $r.FileSystemRights -ne 'FullControl') { throw 'rights' }
    if ($entry -is [IO.DirectoryInfo] -and (($r.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ContainerInherit) -eq 0 -or ($r.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ObjectInherit) -eq 0)) { throw 'inheritance' }
  }
  $acl = $item.GetAccessControl()
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ('${action}' -ne 'verify') {
    $empty = if ($item -is [IO.DirectoryInfo]) { @(Get-ChildItem -LiteralPath $p -Force).Count -eq 0 } else { $item.Length -eq 0 }
    if (!$empty) { throw 'populated' }
    if ($owner -ne $sid.Value -and $owner -ne $identity.Owner.Value) { throw 'owner' }
    if ('${action}' -eq 'initialize') {
      $acl = [Security.AccessControl.DirectorySecurity]::new()
      $acl.SetAccessRuleProtection($true, $false)
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    } else {
      AssertPrivateRules $item
      if ($acl.AreAccessRulesProtected) { throw 'not-inherited' }
      $parent = if ($item -is [IO.DirectoryInfo]) { $item.Parent } else { $item.Directory }
      AssertPrivateRules $parent
      if ($parent.GetAccessControl().GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'parent-owner' }
    }
    $acl.SetOwner($sid)
    $item.SetAccessControl($acl)
  }
  $items = if ('${action}' -eq 'verify') { @($item) + @(Get-ChildItem -LiteralPath $p -Force -Recurse) } else { @($item) }
  if ($items.Count -gt 256) { throw 'oversized' }
  foreach ($entry in $items) {
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'redirected' }
    $entryAcl = $entry.GetAccessControl()
    if ($entryAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
      $empty = if ($entry -is [IO.DirectoryInfo]) { @(Get-ChildItem -LiteralPath $entry.FullName -Force).Count -eq 0 } else { $entry.Length -eq 0 }
      # Unpublished empty inherited entries may be between exclusive creation and owner repair. Never repair on reads.
      if ('${action}' -ne 'verify' -or $entry.FullName -eq $item.FullName -or !$empty -or $entryAcl.AreAccessRulesProtected -or $entryAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.Owner.Value) { throw 'owner' }
    }
    AssertPrivateRules $entry
  }
  if ('${action}' -eq 'verify' -and !$item.GetAccessControl().AreAccessRulesProtected) { throw 'root-inheritance' }
  exit 0
} catch { exit 1 }
`;
  return runPrivacyScript(script, background);
}

function runPrivacyScript(script: string, background: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const executable = path.win32.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const child = spawn(
      executable,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    if (background) child.unref();
    // Explicit controls can wait for cold PowerShell startup; background observation keeps its short bound.
    const timeoutMs = background ? 3000 : 10_000;
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error('Product telemetry privacy verification timed out'));
    }, timeoutMs);
    if (background) deadline.unref();
    child.once('error', () => {
      clearTimeout(deadline);
      reject(new Error('Product telemetry privacy verification unavailable'));
    });
    child.once('exit', (code) => {
      clearTimeout(deadline);
      if (code === 0) resolve();
      else reject(new Error('Product telemetry privacy verification denied'));
    });
  });
}

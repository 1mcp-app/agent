import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { getBackgroundLaunchConfigPath, readBackgroundLaunchConfig } from './backgroundLaunchConfig.js';
import {
  type BackgroundSupervisorState,
  getBackgroundSupervisorStatePath,
} from './backgroundRuntimeSupervisorState.js';
import { getPidFilePath, type ServerPidInfo } from './pidFileManager.js';
import { type ProcessEvidence, readProcessEvidence } from './processEvidence.js';
import type { RuntimeScopeOwnershipRecord } from './runtimeScopeOwnership.js';

/** Evidence is operation-local, never a replacement for persisted modern identity. */
export function processEvidenceMatches(expected: ProcessEvidence, observed: ProcessEvidence | undefined): boolean {
  return observed !== undefined && isDeepStrictEqual(expected, observed);
}

/** Read-only proof for the narrow, identity-less, supervised legacy shape. */
export function verifyLegacyRuntimeOwner(
  configDir: string,
  owner: RuntimeScopeOwnershipRecord | null,
  supervisorState: BackgroundSupervisorState | null,
  pidInfo: ServerPidInfo | null,
  dependencies: { readEvidence?: typeof readProcessEvidence } = {},
): { supervisor: ProcessEvidence; worker: ProcessEvidence } | undefined {
  try {
    if (!owner || !supervisorState || !pidInfo) return undefined;
    if (!isLegacySupervisedPair(owner, supervisorState, pidInfo)) return undefined;

    const scope = fs.realpathSync(configDir);
    if (!path.isAbsolute(pidInfo.configDir) || fs.realpathSync(pidInfo.configDir) !== scope) return undefined;
    const readEvidence = dependencies.readEvidence ?? readProcessEvidence;
    const caller = readEvidence(process.pid);
    const supervisor = readEvidence(owner.pid);
    const worker = readEvidence(pidInfo.pid);
    if (!caller || !supervisor || !worker) return undefined;
    const participants = [caller, supervisor, worker];
    if (participants.some((evidence) => evidence.exited)) return undefined;
    if (worker.ppid !== supervisor.pid) return undefined;
    if (!participants.every((evidence) => belongsToCaller(evidence, caller))) return undefined;

    const files = [
      path.join(scope, 'runtime.owner', 'owner.json'),
      getBackgroundSupervisorStatePath(scope),
      getPidFilePath(scope),
      getBackgroundLaunchConfigPath(scope),
    ];
    const before = snapshotFiles(scope, files, caller.uid);
    if (!isDeepStrictEqual(JSON.parse(before[1].content), owner)) return undefined;
    if (!isDeepStrictEqual(JSON.parse(before[2].content), supervisorState)) return undefined;
    if (!isDeepStrictEqual(JSON.parse(before[3].content), pidInfo)) return undefined;
    if (readBackgroundLaunchConfig(files[3]).claimId !== owner.claimId) return undefined;

    // Namespace equality alone does not exclude a chroot in the same mount namespace.
    for (const evidence of participants) {
      for (const file of [scope, ...files]) {
        const local = fs.statSync(file);
        const remote = fs.statSync(`/proc/${evidence.pid}/root${file}`);
        if (local.dev !== remote.dev || local.ino !== remote.ino) return undefined;
      }
    }

    const supervisorArgs = invocationArgs(supervisor);
    const workerArgs = invocationArgs(worker);
    if (!supervisorArgs || !workerArgs) return undefined;
    if (supervisor.executable !== worker.executable) return undefined;
    if (invocationPrefix(supervisor, supervisorArgs) !== invocationPrefix(worker, workerArgs)) return undefined;
    if (!hasSupervisorRole(supervisorArgs)) return undefined;
    if (!hasWorkerClaim(workerArgs, owner.claimId, files[3])) return undefined;

    for (const args of [supervisorArgs, workerArgs]) {
      const scopes = values(args, 'config-dir');
      if (scopes.length > 1) return undefined;
      if (scopes.length === 1 && !isScopePath(scopes[0], scope)) return undefined;
      if (args.some((arg) => /^(--(stop|restart|status|background)(=|$)|--$)/.test(arg))) return undefined;
    }

    if (!isDeepStrictEqual(before, snapshotFiles(scope, files, caller.uid))) return undefined;
    if (!processEvidenceMatches(caller, readEvidence(process.pid))) return undefined;
    if (!processEvidenceMatches(supervisor, readEvidence(owner.pid))) return undefined;
    if (!processEvidenceMatches(worker, readEvidence(pidInfo.pid))) return undefined;
    return { supervisor, worker };
  } catch {
    // Missing, inaccessible, or malformed evidence never grants signal authority.
    return undefined;
  }
}

function isLegacySupervisedPair(
  owner: RuntimeScopeOwnershipRecord,
  state: BackgroundSupervisorState,
  info: ServerPidInfo,
): boolean {
  if (owner.kind !== 'background-supervisor') return false;
  const identities = [owner.processIdentity, state.supervisorIdentity, state.runtimeIdentity, info.processIdentity];
  if (identities.some((identity) => identity !== undefined)) return false;
  if (owner.pid !== state.supervisorPid) return false;
  if (info.pid !== state.runtimePid) return false;
  if (owner.pid === info.pid) return false;
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(owner.claimId);
}

function belongsToCaller(evidence: ProcessEvidence, caller: ProcessEvidence): boolean {
  if (evidence.uid !== caller.uid) return false;
  if (evidence.realUid !== caller.uid) return false;
  return isDeepStrictEqual(evidence.context, caller.context);
}

function invocationPrefix(evidence: ProcessEvidence, args: string[]): string {
  return evidence.argv.slice(0, evidence.argv.length - args.length).join('\0');
}

function hasSupervisorRole(args: string[]): boolean {
  if (values(args, 'background-bootstrap').join() !== 'true') return false;
  if (values(args, 'runtime-owner-claim-id').length !== 0) return false;
  return values(args, 'background-launch-config').length === 0;
}

function hasWorkerClaim(args: string[], claimId: string, launchConfig: string): boolean {
  if (values(args, 'background-bootstrap').length !== 0) return false;
  if (!isSingleValue(args, 'runtime-owner-claim-id', claimId)) return false;
  return isSingleValue(args, 'background-launch-config', launchConfig);
}

function isScopePath(candidate: string, scope: string): boolean {
  if (!path.isAbsolute(candidate)) return false;
  return fs.realpathSync(candidate) === scope;
}

function isInspectableMetadata(file: string, scope: string, stat: fs.Stats, uid: number): boolean {
  if (stat.isSymbolicLink()) return false;
  if (stat.uid !== uid) return false;
  const expectedType = file === scope ? stat.isDirectory() : stat.isFile();
  if (!expectedType) return false;
  if ((stat.mode & 0o022) !== 0) return false;
  if (stat.size > 1024 * 1024) return false;
  return fs.realpathSync(file) === file;
}

function snapshotFiles(scope: string, files: string[], uid: number) {
  return [scope, ...files].map((file) => {
    const stat = fs.lstatSync(file);
    if (!isInspectableMetadata(file, scope, stat, uid)) {
      throw new Error('Unverifiable legacy metadata');
    }
    return {
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      content: file === scope ? '' : fs.readFileSync(file, 'utf8'),
    };
  });
}

function invocationArgs(evidence: ProcessEvidence): string[] | undefined {
  if (!path.isAbsolute(evidence.executable)) return undefined;
  const executable = path.basename(evidence.executable);
  let serveIndex: number;
  if (/^node(?:js)?$/.test(executable)) {
    const script = evidence.argv[1];
    if (!script || !path.isAbsolute(script) || !/[/\\]build[/\\]index\.(?:c|m)?js$/.test(script)) return undefined;
    if (fs.realpathSync(script) !== script || !fs.statSync(script).isFile()) return undefined;
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(script), '..', 'package.json'), 'utf8'),
    );
    if (typeof manifest !== 'object' || manifest === null || !('name' in manifest) || manifest.name !== '@1mcp/agent')
      return undefined;
    serveIndex = 2;
  } else {
    if (!/^1mcp(?:-[a-z0-9_-]+)?$/i.test(executable)) return undefined;
    serveIndex = 1;
  }
  if (evidence.argv[serveIndex] !== 'serve') return undefined;
  return evidence.argv.slice(serveIndex + 1);
}

function values(args: string[], name: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) {
      result.push(name === 'background-bootstrap' ? 'true' : (args[i + 1] ?? ''));
    } else if (args[i].startsWith(`--${name}=`)) {
      result.push(args[i].slice(name.length + 3));
    }
  }
  return result;
}

function isSingleValue(args: string[], name: string, expected: string): boolean {
  const observed = values(args, name);
  return observed.length === 1 && observed[0] === expected;
}

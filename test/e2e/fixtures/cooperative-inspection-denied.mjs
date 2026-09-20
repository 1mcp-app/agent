import childProcess from 'node:child_process';
import fs from 'node:fs';

import { syncBuiltinESMExports } from 'node:module';

// Node-only fault injection. SEA runs do not claim this preload is supported.
const log = process.env.COOPERATIVE_TEST_INSPECTION_LOG;
const record = (kind, detail = '') => {
  if (log) fs.appendFileSync(log, `${JSON.stringify({ kind, pid: process.pid, detail })}\n`);
};
const denied = (detail) => {
  record('attempt', detail);
  const error = new Error('Process inspection denied by cooperative lifecycle fixture');
  error.code = 'EACCES';
  throw error;
};
const execute = childProcess.execFileSync;
childProcess.execFileSync = function (file, args, ...rest) {
  const command = [file, ...(Array.isArray(args) ? args : [])].join(' ');
  if (/(?:^|[/\\\s])(ps|sysctl|powershell(?:\.exe)?|pwsh|wmic)(?:$|[\s])/i.test(command)) denied(command);
  return execute.call(this, file, args, ...rest);
};
for (const method of ['readFileSync', 'readlinkSync']) {
  const original = fs[method];
  fs[method] = function (file, ...args) {
    const location = String(file);
    if (/^\/proc\/(?:\d+\/(?:stat|ns\/pid)|sys\/kernel\/random\/boot_id)$/.test(location)) denied(location);
    return original.call(this, file, ...args);
  };
}
// Native Windows aborts bypass JS exception hooks; keep their stderr in the isolated fixture.
if (process.platform === 'win32' && log) {
  const spawn = childProcess.spawn;
  childProcess.spawn = function (command, args, options) {
    if (Array.isArray(args) && args.includes('--cooperative-bootstrap=worker') && Array.isArray(options?.stdio)) {
      const descriptor = fs.openSync(`${log}.worker-stderr`, 'a', 0o600);
      try {
        return spawn.call(this, command, args, {
          ...options,
          stdio: [options.stdio[0], options.stdio[1], descriptor, 'ipc'],
        });
      } finally {
        fs.closeSync(descriptor);
      }
    }
    return spawn.call(this, command, args, options);
  };
}
syncBuiltinESMExports();
record('loaded');

// Preserve test-process failure evidence without changing exception handling or exit policy.
if (process.platform === 'win32') {
  const diagnostic = (kind, detail) => {
    try {
      record(kind, detail);
    } catch {
      /* Scope may already be torn down. */
    }
  };
  process.on('uncaughtExceptionMonitor', (error) => diagnostic('uncaught', error.stack ?? String(error)));
  process.on('exit', (code) => diagnostic('exit', String(code)));
  const exit = process.exit;
  process.exit = function (code) {
    diagnostic('explicit-exit', new Error(`exit ${code}`).stack);
    return exit.call(this, code);
  };
}

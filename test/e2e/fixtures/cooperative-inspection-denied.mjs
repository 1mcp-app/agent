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
syncBuiltinESMExports();
record('loaded');

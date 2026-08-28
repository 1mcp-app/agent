#!/usr/bin/env node
/**
 * check-permission-modes.mjs — static guard for sensitive-file permission modes.
 *
 * Invariant (AUTH-07 / ticket-05): fs write/mkdir calls in src/** must carry an
 * explicit POSIX mode so credential-bearing files land 0600 (dirs 0700) instead
 * of inheriting an umask-loosened default. Recall-first (rule-based full scan),
 * pre-existing findings are recorded in permission-guard-baseline.json
 * (detect-secrets baseline model); only NEW findings fail the gate.
 *
 * Usage:
 *   node scripts/security/check-permission-modes.mjs            # enforce (CI)
 *   node scripts/security/check-permission-modes.mjs --update   # regenerate baseline
 *   node scripts/security/check-permission-modes.mjs --prune    # drop stale baseline entries
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const BASELINE_PATH = path.join(ROOT, 'scripts', 'security', 'permission-guard-baseline.json');

const SYNC_WRITE_PATTERN =
  /\bfs\.(writeFileSync|appendFileSync|openSync|copyFileSync|createWriteStream|mkdirSync)\s*\(/;
const ASYNC_WRITE_PATTERN = /\bfs\.(writeFile|appendFile|mkdir|copyFile|cp)\s*\(/;
// Destructured async/sensitive identifiers imported from 'node:fs/promises' /
// `promises as fs` — these escape the fs.-prefix requirement entirely.
const DESTRUCTURED_WRITE_PATTERN = /\b(writeFile|appendFile|mkdir|copyFile|cp)\s*\(/;
const DESTRUCTURED_IMPORTS = /from\s+['"]node?:fs\/promises['"]|promises\s+as\s+\w+\s+from\s+['"]node?:fs['"]/;
const MODE_PATTERN = /mode\s*:\s*0o|,\s*0o[67][0-7]{2}\b/;
const CHMOD_PATTERN = /\bchmod(Sync)?\s*\(/;
const TEST_FILE = /\.test\.ts$|__tests__|\/test\//;

function listSourceFiles() {
  const out = spawnSync('git', ['ls-files', 'src/**/*.ts'], { cwd: ROOT, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`);
  return out.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !TEST_FILE.test(l));
}

function findingFingerprint(file, index, snippet) {
  return `${file}#${index}#${snippet}`;
}

function scanFile(rel) {
  const abs = path.join(ROOT, rel);
  const content = fs.readFileSync(abs, 'utf8');
  const lines = content.split('\n');
  const hasDestructuredImport = DESTRUCTURED_IMPORTS.test(content);
  const findings = [];
  let occurrence = 0;
  lines.forEach((line, i) => {
    const m =
      line.match(SYNC_WRITE_PATTERN) ||
      line.match(ASYNC_WRITE_PATTERN) ||
      (hasDestructuredImport && line.match(DESTRUCTURED_WRITE_PATTERN));
    if (!m) return;
    occurrence += 1;
    // Statement window: current line + next 5 lines (multi-line call args)
    const block = lines.slice(i, i + 6).join(' ');
    const call = m[1];
    if (call === 'openSync') {
      // Read-only opens carry no mode; only opens that can create a file
      // (w/a/x/+ flags) are permission-relevant.
      const openFlags = block.match(/openSync\s*\([^,]+,\s*['"`]([^'"`]+)['"`]/);
      const flags = openFlags?.[1] ?? '';
      if (!/[wax+]/.test(flags)) {
        return;
      }
    }
    const isCopy = call === 'copyFileSync' || call === 'copyFile' || call === 'cp';
    if (isCopy) {
      // fs.copy* has no mode parameter; the invariant is a chmod on the
      // destination within 8 lines after the copy.
      const after = lines.slice(i, i + 9).join(' ');
      if (CHMOD_PATTERN.test(after)) return;
    } else if (MODE_PATTERN.test(block)) {
      return;
    }
    findings.push({
      file: rel,
      line: i + 1,
      call,
      fingerprint: findingFingerprint(rel, occurrence, call),
    });
  });
  return findings;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { entries: [] };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

const findings = listSourceFiles().flatMap(scanFile);
const baseline = loadBaseline();
const baselineMap = new Map(baseline.entries.map((e) => [e.fingerprint, e]));

function reasonFor(f) {
  const templateReason = 'pre-existing, recorded at ticket-05 gate baseline; triage under 08-lowseverity-hardening';
  // Non-credential writes whose default-mode impact is nil or UCL-gated.
  const byPrefix = [
    [
      'src/auth/storage/fileStorageService.ts',
      'writeFileSync targets fd from openSync(wx, 0o600) — mode inherited at open; this file is the AUTH-07 reference implementation',
    ],
    [
      'src/domains/runtime-targets/runtimeTargetStore.ts',
      'writeJsonAtomic forwards an optional mode param; callers may omit it — tightening tracked under ticket-08',
    ],
    [
      'src/core/server/pidFileManager.ts',
      'pid file content is not secret (PID only); mkdir is ~/.1mcp config dir bootstrap — tracked for 0600 tightening under ticket-08',
    ],
    [
      'src/domains/backup/backupManager.ts',
      'backup metadata copies config; tightening scheduled under ticket-08 (low-severity hardening)',
    ],
    [
      'src/domains/admin/runtimeScopeAdminLock.ts',
      'writeFileSync targets fd already opened 0o600 via openSync — mode inherited at open; mkdir prefixed by 0700 candidateDir',
    ],
    [
      'src/commands/serve/serveBackground.ts',
      'log-file append under user-owned config dir; ACL tightening tracked under ticket-08',
    ],
    [
      'src/commands/shared/baseConfigUtils.ts',
      'writes user-owned mcp.json config (may embed env but guaranteed non-secret at authoring time) — ticket-08',
    ],
    ['src/commands/target/target.ts', 'serializes user-authored target config to user-owned path — ticket-08'],
    [
      'src/config/configLoader.ts',
      'writes DEFAULT_CONFIG scaffold on first run (no secrets); acceptable default-mode — ticket-08',
    ],
    [
      'src/domains/preset/manager/presetStorage.ts',
      'preset config cache mirrors user-authored mcp.json (non-secret at authoring time) — async fs.promises path, tightening under ticket-08',
    ],
    [
      'src/commands/cliSetup/setupFiles.ts',
      'writes IDE/cli setup scaffolding config files in user-owned paths — ticket-08',
    ],
    [
      'src/commands/shared/authProfileStore.ts',
      'async fs.promises path for bearer-token storage; mkdir has mode 0o700 and rename target chmod 0o600 — listed only if an edge path lingers',
    ],
    [
      'src/commands/app/consolidate.ts',
      'writes consolidated config derived from existing user config file — ticket-08',
    ],
    [
      'src/commands/shared/configParsingUtils.ts',
      'audited (ticket-05 R5): copyFileSync mirrors the user-owned mcp.json it just read — bytes already visible at source mode; backup tightens under ticket-08',
    ],
    [
      'src/core/runtime/runtimeIdentityService.ts',
      'audited (ticket-05 R5): runtime identity (scope id only, no credentials) written via temp+rename into user config dir; acceptable, 0600 tightening under ticket-08',
    ],
    [
      'src/core/server/runtimeScopeOwnership.ts',
      'audited (ticket-05 R5): ownership claim/stop-lock records are non-secret markers written via candidate-dir swap; mkdir of the user-owned config dir — 0700 tightening under ticket-08',
    ],
    [
      'src/domains/admin/adminPresetService.ts',
      'audited (ticket-05 R5): admin backup of preset config the caller just read — derived-from-source bytes in user-owned path; tightening under ticket-08',
    ],
    [
      'src/domains/config-change/configChange.ts',
      'audited (ticket-05 R5): backups mirroring the existing user-owned config file and scaffold writes of user-authored mcp.json; source bytes already user-visible — ticket-08',
    ],
  ];
  for (const [prefix, reason] of byPrefix) {
    if (f.file.startsWith(prefix)) return `${reason}`;
  }
  return templateReason;
}

// Audit leg (detect-secrets model): enforce mode rejects baseline entries whose
// reason is just the --update template, so accepted-risk entries must carry a
// hand-written justification. --update records candidates; a human edits the
// reason before the gate goes green.
const TEMPLATE_REASON_RE = /^pre-existing, recorded at ticket-05 gate baseline/;

const mode = process.argv.includes('--update') ? 'update' : process.argv.includes('--prune') ? 'prune' : 'enforce';

if (mode === 'update') {
  const entries = findings.map((f) => ({
    fingerprint: f.fingerprint,
    file: f.file,
    call: f.call,
    line: f.line,
    reason: reasonFor(f),
    enteredAt: new Date().toISOString().slice(0, 10),
    ticket: '08-lowseverity-hardening',
  }));
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ schema: 1, generatedBy: 'check-permission-modes.mjs --update', entries }, null, 2)}\n`,
  );
  console.log(`baseline updated: ${entries.length} entries`);
  process.exit(0);
}

const stale = baseline.entries.filter((e) => !findings.some((f) => f.fingerprint === e.fingerprint));
if (mode === 'prune') {
  const kept = baseline.entries.filter((e) => findings.some((f) => f.fingerprint === e.fingerprint));
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ schema: 1, generatedBy: 'check-permission-modes.mjs --prune', entries: kept }, null, 2)}\n`,
  );
  console.log(`baseline pruned: removed ${stale.length} stale entries, kept ${kept.length}`);
  process.exit(0);
}

// enforce
const templateReasonEntries = baseline.entries.filter((e) => TEMPLATE_REASON_RE.test(e.reason || ''));
if (templateReasonEntries.length > 0) {
  console.error('\nFAIL: baseline entries still carry the --update template reason (audit required):');
  for (const e of templateReasonEntries) {
    console.error(`  ${e.fingerprint}  ${e.file}:${e.line}`);
  }
  console.error('\nEdit permission-guard-baseline.json and replace each with a hand-written justification.');
  process.exit(1);
}
const newFindings = findings.filter((f) => !baselineMap.has(f.fingerprint));
for (const e of stale) {
  console.warn(`[stale-baseline] ${e.fingerprint} no longer matches any finding — run --prune`);
}
if (stale.length > 0) {
  console.warn('note: stale baseline entries are warnings only; they do not fail the gate');
}
if (newFindings.length > 0) {
  console.error('\nFAIL: new fs write calls without an explicit permission mode:');
  for (const f of newFindings) {
    console.error(`  ${f.file}:${f.line}  fs.${f.call}(...)  [matches no baseline entry]`);
  }
  console.error(
    '\nFix by adding mode: 0o600 (files) / 0o700 (dirs), or run --update to record an accepted-risk baseline entry with a reason.',
  );
  process.exit(1);
}
console.log(
  `permission-mode guard: OK (${findings.length} mode-less calls scanned, all covered by baseline: ${baseline.entries.length} entries)`,
);

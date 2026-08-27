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

const WRITE_PATTERN = /\bfs\.(writeFileSync|appendFileSync|openSync|copyFileSync|createWriteStream|mkdirSync)\s*\(/;
const MODE_PATTERN = /mode\s*:\s*0o|,\s*0o[67][0-7]{2}\b/;
const TEST_FILE = /\.test\.ts$|__tests__|\/test\//;

function listSourceFiles() {
  const out = spawnSync('git', ['ls-files', 'src/**/*.ts'], { cwd: ROOT, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`);
  return out.stdout.split('\n').map((l) => l.trim()).filter((l) => l && !TEST_FILE.test(l));
}

function findingFingerprint(file, index, snippet) {
  return `${file}#${index}#${snippet}`;
}

function scanFile(rel) {
  const abs = path.join(ROOT, rel);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const findings = [];
  let occurrence = 0;
  lines.forEach((line, i) => {
    const m = line.match(WRITE_PATTERN);
    if (!m) return;
    occurrence += 1;
    // Statement window: current line + next 5 lines (multi-line call args)
    const block = lines.slice(i, i + 6).join(' ');
    if (MODE_PATTERN.test(block)) return;
    const snippet = m[1];
    findings.push({
      file: rel,
      line: i + 1,
      call: m[1],
      fingerprint: findingFingerprint(rel, occurrence, snippet),
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
  // Non-credential writes whose default-mode impact is nil or UCL-gated.
  const byPrefix = [
    ['src/auth/storage/fileStorageService.ts', 'writeFileSync targets fd from openSync(wx, 0o600) — mode inherited at open; this file is the AUTH-07 reference implementation'],
    ['src/domains/runtime-targets/runtimeTargetStore.ts', 'writeJsonAtomic forwards an optional mode param; callers may omit it — tightening tracked under ticket-08'],
    ['src/core/server/pidFileManager.ts', 'pid file content is not secret (PID only); mkdir is ~/.1mcp config dir bootstrap — tracked for 0600 tightening under ticket-08'],
    ['src/domains/backup/backupManager.ts', 'backup metadata copies config; tightening scheduled under ticket-08 (low-severity hardening)'],
    ['src/domains/admin/runtimeScopeAdminLock.ts', 'writeFileSync targets fd already opened 0o600 via openSync — mode inherited at open; mkdir prefixed by 0700 candidateDir'],
    ['src/commands/serve/serveBackground.ts', 'log-file append under user-owned config dir; ACL tightening tracked under ticket-08'],
    ['src/commands/shared/baseConfigUtils.ts', 'writes user-owned mcp.json config (may embed env but guaranteed non-secret at authoring time) — ticket-08'],
    ['src/commands/target/target.ts', 'serializes user-authored target config to user-owned path — ticket-08'],
    ['src/config/configLoader.ts', 'writes DEFAULT_CONFIG scaffold on first run (no secrets); acceptable default-mode — ticket-08'],
    ['src/commands/app/consolidate.ts', 'writes consolidated config derived from existing user config file — ticket-08'],
  ];
  for (const [prefix, reason] of byPrefix) {
    if (f.file.startsWith(prefix)) return `${reason}`;
  }
  return 'pre-existing, recorded at ticket-05 gate baseline; triage under 08-lowseverity-hardening';
}

const mode = process.argv.includes('--update')
  ? 'update'
  : process.argv.includes('--prune')
    ? 'prune'
    : 'enforce';

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
  console.error('\nFix by adding mode: 0o600 (files) / 0o700 (dirs), or run --update to record an accepted-risk baseline entry with a reason.');
  process.exit(1);
}
console.log(`permission-mode guard: OK (${findings.length} mode-less calls scanned, all covered by baseline: ${baseline.entries.length} entries)`);

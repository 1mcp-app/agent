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
 *
 * Known cost of the strict fingerprint model: fingerprints are
 * `file#occurrence#call` where `occurrence` is the ordinal of the write call in
 * that file, so inserting/removing any guarded call above an existing one shifts
 * later fingerprints — reviewed entries then resurface as "new findings" and CI
 * goes red until `--update` re-records them with a human-reviewed reason. That
 * re-review is intentional (detect-secrets audit leg), not a broken gate.
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
const TEST_FILE = /\.test\.ts$|__tests__|\/test\//;

function listSourceFiles(root) {
  const out = spawnSync('git', ['ls-files', 'src/**/*.ts'], { cwd: root, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr}`);
  return out.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !TEST_FILE.test(l));
}

function findingFingerprint(file, index, snippet) {
  return `${file}#${index}#${snippet}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scanFile(rel, root) {
  const abs = path.join(root, rel);
  return scanContent(rel, fs.readFileSync(abs, 'utf8'));
}

// Test seam: scan raw content under a synthetic relative path without touching
// the real repository tree or the baseline on disk.
function scanContent(rel, content) {
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
      // copyFile/copyFileSync land with the source's mode (their optional 3rd
      // arg is a COPYFILE behavior flag, not a permission mode); fs.cp also
      // accepts a `mode` option that is a COPYFILE behavior flag on modern Node
      // (a permission mode only on legacy versions). This text scanner doesn't
      // resolve option objects either way, so the invariant stays an explicit
      // owner-only chmod on the SAME destination within 8 lines after the copy
      // (a conservatively-flagged copy is absorbed by the baseline). A chmod on
      // any other target — or a permissive mode on the right target — silences
      // nothing (CWE-732: a false negative here is a security gate silently
      // passing).
      const after = lines.slice(i, i + 9).join(' ');
      const copyDest = block.match(/(?:copyFileSync|copyFile|cp)\s*\(\s*[^,]+,\s*([A-Za-z0-9_.'"`]+)/);
      if (copyDest) {
        const chmodOwnerOnly = new RegExp(`chmod(Sync)?\\s*\\(\\s*${escapeRegExp(copyDest[1])}\\s*,\\s*0o([0-7]{3})`);
        const m2 = after.match(chmodOwnerOnly);
        if (m2 && (parseInt(m2[2], 8) & 0o077) === 0) return;
      }
    } else if (MODE_PATTERN.test(block)) {
      // A mode argument suppresses the finding only when it is owner-only:
      // 0o644/0o666/0o777 (group/other bits set) silence nothing.
      const modeLiteral = block.match(/(?:mode\s*:\s*|,\s*)0o([0-7]{3})\b/);
      if (modeLiteral && (parseInt(modeLiteral[1], 8) & 0o077) === 0) {
        return;
      }
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

function loadBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) return { entries: [] };
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}

/**
 * Functional core of the gate (Functional Core / Imperative Shell): every
 * decision — scan, baseline load/match, template-reason audit, new/stale
 * finding classification, --update/--prune writes, exit code — is pure and
 * injectable so command-level behavior is testable without spawning the CLI.
 * Returns the process exit code; never calls process.exit.
 */
export function runGate({ root, baselinePath, mode, sourceFiles, log = console } = {}) {
  const findings = sourceFiles.flatMap((rel) => scanFile(rel, root));
  const baseline = loadBaseline(baselinePath);
  const baselineMap = new Map(baseline.entries.map((e) => [e.fingerprint, e]));

  const TEMPLATE_REASON = 'pre-existing, recorded at ticket-05 gate baseline; triage under 08-lowseverity-hardening';
  // Audit leg (detect-secrets model): enforce mode rejects baseline entries whose
  // reason is just the --update template, so accepted-risk entries must carry a
  // hand-written justification. --update records candidates; a human edits the
  // reason before the gate goes green.
  const TEMPLATE_REASON_RE = /^pre-existing, recorded at ticket-05 gate baseline/;

  function reasonFor(f) {
    // Accepted-risk reasons may only be inherited by an exact fingerprint match
    // against a previously reviewed baseline entry. Anything else (new findings,
    // moved lines, new call sites in previously listed files) gets the template
    // reason so it cannot silently inherit an unrelated justification at --update.
    const reviewed = baselineMap.get(f.fingerprint);
    if (reviewed && typeof reviewed.reason === 'string' && reviewed.reason.length > 0) {
      return reviewed.reason;
    }
    return TEMPLATE_REASON;
  }

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
      baselinePath,
      `${JSON.stringify({ schema: 1, generatedBy: 'check-permission-modes.mjs --update', entries }, null, 2)}\n`,
    );
    log.log(`baseline updated: ${entries.length} entries`);
    return 0;
  }

  const stale = baseline.entries.filter((e) => !findings.some((f) => f.fingerprint === e.fingerprint));
  if (mode === 'prune') {
    const kept = baseline.entries.filter((e) => findings.some((f) => f.fingerprint === e.fingerprint));
    fs.writeFileSync(
      baselinePath,
      `${JSON.stringify({ schema: 1, generatedBy: 'check-permission-modes.mjs --prune', entries: kept }, null, 2)}\n`,
    );
    log.log(`baseline pruned: removed ${stale.length} stale entries, kept ${kept.length}`);
    return 0;
  }

  // enforce
  const templateReasonEntries = baseline.entries.filter((e) => TEMPLATE_REASON_RE.test(e.reason || ''));
  if (templateReasonEntries.length > 0) {
    log.error('\nFAIL: baseline entries still carry the --update template reason (audit required):');
    for (const e of templateReasonEntries) {
      log.error(`  ${e.fingerprint}  ${e.file}:${e.line}`);
    }
    log.error('\nEdit permission-guard-baseline.json and replace each with a hand-written justification.');
    return 1;
  }
  const newFindings = findings.filter((f) => !baselineMap.has(f.fingerprint));
  for (const e of stale) {
    log.warn(`[stale-baseline] ${e.fingerprint} no longer matches any finding — run --prune`);
  }
  if (stale.length > 0) {
    log.warn('note: stale baseline entries are warnings only; they do not fail the gate');
  }
  if (newFindings.length > 0) {
    log.error('\nFAIL: new fs write calls without an explicit permission mode:');
    for (const f of newFindings) {
      log.error(`  ${f.file}:${f.line}  fs.${f.call}(...)  [matches no baseline entry]`);
    }
    log.error(
      '\nFix by adding mode: 0o600 (files) / 0o700 (dirs), or run --update to record an accepted-risk baseline entry with a reason.',
    );
    return 1;
  }
  log.log(
    `permission-mode guard: OK (${findings.length} mode-less calls scanned, all covered by baseline: ${baseline.entries.length} entries)`,
  );
  return 0;
}

function main() {
  const mode = process.argv.includes('--update') ? 'update' : process.argv.includes('--prune') ? 'prune' : 'enforce';
  process.exit(
    runGate({
      root: ROOT,
      baselinePath: BASELINE_PATH,
      mode,
      sourceFiles: listSourceFiles(ROOT),
    }),
  );
}

export { scanContent, scanFile, findingFingerprint };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

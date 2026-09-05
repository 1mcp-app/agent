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
 * The scanner parses each file with the TypeScript compiler (already a dev
 * dependency) and resolves node:fs bindings through the forms it models —
 * static imports, requires, and one-level const aliases:
 *
 *   import fs from 'node:fs';                 fs.writeFileSync(...)
 *   import fsSync from 'node:fs';             fsSync.writeFileSync(...)
 *   import * as fs from 'node:fs';            fs.mkdirSync(...)
 *   import { writeFileSync } from 'node:fs';  writeFileSync(...)
 *   import { promises as fsp } from 'node:fs'; fsp.writeFile(...)
 *   import { default as fs } from 'node:fs';  fs.appendFileSync(...)
 *   const fs = require('node:fs');            fs.writeFileSync(...)
 *   const { writeFileSync } = require('node:fs'); writeFileSync(...)
 *   require('node:fs').writeFileSync(...)     (inline require chains)
 *   const w = fs.writeFileSync;               w(...)
 *   const fsp = fs.promises;                  fsp.writeFile(...)
 *
 * Bindings outside that model — cross-file re-exports, dynamic import(),
 * computed member access, reflective calls (.call/.bind), property-access
 * aliases beyond one level — are not resolved (identifier-to-identifier alias
 * chains resolve transitively); an identifier that merely looks like an fs
 * binding (fs/fsSync/fsPromises/fsAsync) is still guarded conservatively.
 * Only an owner-only literal mode on the guarded call itself suppresses the
 * finding; a mode literal anywhere else in the file is irrelevant. Copy calls
 * (copyFileSync/copyFile/cp) are instead suppressed by a chmodSync/chmod with
 * the SAME destination expression and an owner-only literal mode appearing
 * later in the same file. openSync/open (both callback and promises forms)
 * are suppressed only when PROVABLY read-only: a string-flag literal without
 * a write flag, or the numeric literal O_RDONLY (0); flags that cannot be
 * statically evaluated are treated as writes. Unresolvable mode expressions
 * are treated as missing (conservative; the baseline absorbs reviewed false
 * positives). A file that fails to parse fails the scan (fail-closed): a
 * security gate must not silently skip content it cannot see.
 *
 * Usage:
 *   node scripts/security/check-permission-modes.mjs            # enforce (CI)
 *   node scripts/security/check-permission-modes.mjs --update   # regenerate baseline
 *   node scripts/security/check-permission-modes.mjs --prune    # drop stale baseline entries
 *
 * Known cost of the strict fingerprint model: fingerprints are
 * `file#occurrence#call` where `occurrence` is the ordinal of the guarded write
 * call in that file, so inserting/removing any guarded call above an existing
 * one shifts later fingerprints — reviewed entries then resurface as "new
 * findings" and CI goes red until `--update` re-records them with a
 * human-reviewed reason. That re-review is intentional (detect-secrets audit
 * leg), not a broken gate.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';

// Loaded through require so the CJS typescript bundle is never routed through
// the vitest/vite SSR transform, which cannot parse it.
const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const BASELINE_PATH = path.join(ROOT, 'scripts', 'security', 'permission-guard-baseline.json');

const TEST_FILE = /\.test\.ts$|__tests__|\/test\//;

// node:fs methods whose invocation can create or overwrite a file/dir.
const FS_WRITE_METHODS = new Set([
  'writeFileSync',
  'appendFileSync',
  'openSync',
  'open',
  'copyFileSync',
  'createWriteStream',
  'mkdirSync',
  'writeFile',
  'appendFile',
  'mkdir',
  'copyFile',
  'cp',
]);
const PROMISES_WRITE_METHODS = new Set(['writeFile', 'appendFile', 'open', 'mkdir', 'copyFile', 'cp']);
const CHMOD_METHODS = new Set(['chmodSync', 'chmod']);
const COPY_METHODS = new Set(['copyFileSync', 'copyFile', 'cp']);
// Conservative fallback for identifiers that look like an fs binding but are
// not import-resolvable (e.g. fs re-exported through a barrel).
const FS_LOOKALIKE = /^(fs|fsSync|fsPromises|fsAsync)$/;
const FS_MODULE_SPECIFIERS = new Set(['fs', 'node:fs']);
const FS_PROMISES_MODULE_SPECIFIERS = new Set(['fs/promises', 'node:fs/promises']);

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

function parseSource(rel, content) {
  const sourceFile = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // parseDiagnostics is a de-facto stable but undocumented TypeScript surface;
  // a version without it must abort loudly rather than degrade `?? []` into a
  // silent fail-open scan.
  if (!('parseDiagnostics' in sourceFile)) {
    throw new Error(
      'permission guard: this typescript version does not expose parseDiagnostics — the gate cannot fail closed',
    );
  }
  const diagnostics = sourceFile.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const d = diagnostics[0];
    const pos = sourceFile.getLineAndCharacterOfPosition(d.start ?? 0);
    throw new Error(
      `permission guard: failed to parse ${rel}:${pos.line + 1}:${pos.character + 1} — ` +
        `${ts.flattenDiagnosticMessageText(d.messageText, ' ')} (fail-closed: unparseable source cannot be scanned)`,
    );
  }
  return sourceFile;
}

function scanFile(rel, root) {
  const abs = path.join(root, rel);
  return scanContent(rel, fs.readFileSync(abs, 'utf8'));
}

/**
 * Binding model: identifier -> { module: 'fs' | 'fsPromises', name?: string }.
 * name is set for named imports / destructured requires (the bound method);
 * omitted for default/namespace imports and plain requires (the whole module).
 */
function collectBindings(sourceFile) {
  const bindings = new Map();

  function bindModule(id, module) {
    bindings.set(id.getText(sourceFile), { module });
  }
  function bindMethod(id, module, name) {
    bindings.set(id.getText(sourceFile), { module, name });
  }

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const module = FS_MODULE_SPECIFIERS.has(spec)
        ? 'fs'
        : FS_PROMISES_MODULE_SPECIFIERS.has(spec)
          ? 'fsPromises'
          : null;
      if (module && node.importClause) {
        const clause = node.importClause;
        if (clause.name) bindModule(clause.name, module);
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            bindModule(clause.namedBindings.name, module);
          } else {
            for (const el of clause.namedBindings.elements) {
              const local = el.name;
              const imported = (el.propertyName ?? el.name).text;
              // `promises` binds the sub-namespace module; `default` binds the
              // module itself (CJS interop), aliased or not.
              if (imported === 'promises') {
                bindModule(local, 'fsPromises');
              } else if (imported === 'default') {
                bindModule(local, module);
              } else {
                bindMethod(local, module, imported);
              }
            }
          }
        }
      }
      return;
    }
    if (ts.isVariableDeclaration(node) && node.name && node.initializer) {
      const init = node.initializer;
      // const { writeFileSync } = require('fs') / require('fs/promises') — the
      // binding pattern must be handled before the identifier branch below.
      if (ts.isObjectBindingPattern(node.name)) {
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'require') {
          const arg = init.arguments[0];
          if (arg && ts.isStringLiteral(arg)) {
            const module = FS_MODULE_SPECIFIERS.has(arg.text)
              ? 'fs'
              : FS_PROMISES_MODULE_SPECIFIERS.has(arg.text)
                ? 'fsPromises'
                : null;
            if (module) {
              for (const el of node.name.elements) {
                if (ts.isIdentifier(el.name)) {
                  const imported = (el.propertyName ?? el.name).text;
                  // Mirror the static-import semantics: `promises` and
                  // `default` bind modules, everything else binds a method.
                  if (imported === 'promises') bindModule(el.name, 'fsPromises');
                  else if (imported === 'default') bindModule(el.name, module);
                  else bindMethod(el.name, module, imported);
                }
              }
            }
          }
        }
        return;
      }
      // const fs = require('fs') / const fs = require('fs').promises
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'require') {
        const arg = init.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          if (FS_MODULE_SPECIFIERS.has(arg.text)) bindModule(node.name, 'fs');
          else if (FS_PROMISES_MODULE_SPECIFIERS.has(arg.text)) bindModule(node.name, 'fsPromises');
        }
        return;
      }
      // const fsp = require('fs').promises / const fsp = fs.promises —
      // `.promises` on an fs module always denotes the sub-namespace module.
      if (ts.isPropertyAccessExpression(init) && init.name.text === 'promises') {
        const base = init.expression;
        const isFsModuleBase = (node) => {
          if (ts.isIdentifier(node)) {
            const b = bindings.get(node.text);
            return Boolean(b && !b.name);
          }
          return Boolean(
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'require' &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0]) &&
            FS_MODULE_SPECIFIERS.has(node.arguments[0].text),
          );
        };
        if (isFsModuleBase(base)) bindModule(node.name, 'fsPromises');
        return;
      }
      // one-level alias: const w = fs.writeFileSync / const w = writeFileSync /
      // const w = require('node:fs').writeFileSync
      if (ts.isPropertyAccessExpression(init) || ts.isIdentifier(init)) {
        if (ts.isPropertyAccessExpression(init)) {
          const req = init.expression;
          if (
            ts.isCallExpression(req) &&
            ts.isIdentifier(req.expression) &&
            req.expression.text === 'require' &&
            req.arguments[0] &&
            ts.isStringLiteral(req.arguments[0])
          ) {
            const module = FS_MODULE_SPECIFIERS.has(req.arguments[0].text)
              ? 'fs'
              : FS_PROMISES_MODULE_SPECIFIERS.has(req.arguments[0].text)
                ? 'fsPromises'
                : null;
            if (module) bindMethod(node.name, module, init.name.text);
            return;
          }
        }
        const base = ts.isPropertyAccessExpression(init) ? init.expression : init;
        const method = ts.isPropertyAccessExpression(init) ? init.name.text : null;
        if (ts.isIdentifier(base)) {
          const b = bindings.get(base.text);
          if (b && method) {
            bindMethod(node.name, b.module, method);
          } else if (b && !method) {
            bindings.set(node.name.text, b);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

/**
 * Resolve a call expression's callee to `{ module, name }` when it denotes a
 * node:fs write, or null when it does not.
 */
function resolveCallee(callee, sourceFile, bindings) {
  if (ts.isIdentifier(callee)) {
    const b = bindings.get(callee.text);
    if (b && b.name) return { module: b.module, name: b.name };
    if (b && !b.name) return null; // module object invoked directly
    return null;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const name = callee.name.text;
    // Walk down to the root identifier, collecting property names.
    const chain = [name];
    let base = callee.expression;
    while (ts.isPropertyAccessExpression(base)) {
      chain.unshift(base.name.text);
      base = base.expression;
    }
    // Inline require chain: require('node:fs').writeFileSync(...) /
    // require('node:fs').promises.writeFile(...)
    if (ts.isCallExpression(base) && ts.isIdentifier(base.expression) && base.expression.text === 'require') {
      const arg = base.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const module = FS_MODULE_SPECIFIERS.has(arg.text)
          ? 'fs'
          : FS_PROMISES_MODULE_SPECIFIERS.has(arg.text)
            ? 'fsPromises'
            : null;
        if (module) {
          if (chain.length === 2 && chain[0] === 'promises') {
            return { module: 'fsPromises', name: chain[1] };
          }
          if (chain.length === 1) return { module, name: chain[0] };
        }
      }
      return null;
    }
    if (!ts.isIdentifier(base)) return null;
    const b = bindings.get(base.text);
    if (b && !b.name) {
      if (chain.length === 2 && chain[0] === 'promises') {
        return { module: 'fsPromises', name: chain[1] };
      }
      if (chain.length === 1) return { module: b.module, name: chain[0] };
      return null;
    }
    // Unresolved but fs-looking base: guard conservatively.
    if (!b && FS_LOOKALIKE.test(base.text)) {
      if (chain.length === 2 && chain[0] === 'promises') {
        return { module: 'fsPromises', name: chain[1] };
      }
      if (chain.length === 1) return { module: 'fs', name: chain[0] };
    }
    return null;
  }
  return null;
}

function isGuardedWrite({ module, name }) {
  if (module === 'fs') return FS_WRITE_METHODS.has(name);
  if (module === 'fsPromises') return PROMISES_WRITE_METHODS.has(name);
  return false;
}

function numericMode(node) {
  // Number() handles 0o/0x/decimal radixes; strip numeric separators first
  // (parseInt with radix 8 silently mangles hex literals, which would turn a
  // permissive 0x1B4 into a suppressed 0 — a false negative in a security gate).
  if (!node || !ts.isNumericLiteral(node)) return null;
  const value = Number(node.text.replace(/_/g, ''));
  return Number.isNaN(value) ? null : value;
}

/** Extract the literal mode of a write call's options/positional args, if statically evaluable. */
function writeCallMode(name, args) {
  const objectMode = (node) => {
    if (!node || !ts.isObjectLiteralExpression(node)) return null;
    const prop = node.properties.find(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'mode',
    );
    return prop ? numericMode(prop.initializer) : null;
  };
  if (name === 'openSync' || name === 'open') return numericMode(args[2]);
  if (name === 'mkdirSync' || name === 'mkdir') {
    return objectMode(args[1]) ?? numericMode(args[1]);
  }
  if (name === 'createWriteStream') return objectMode(args[1]);
  // writeFileSync/writeFile/appendFileSync/appendFile: options object, positional
  // number, or positional number after a string encoding argument.
  const a2 = args[2];
  if (a2 && ts.isObjectLiteralExpression(a2)) return objectMode(a2);
  if (a2 && ts.isNumericLiteral(a2)) return numericMode(a2);
  if (a2 && ts.isStringLiteral(a2)) return numericMode(args[3]);
  return null;
}

// Test seam: scan raw content under a synthetic relative path without touching
// the real repository tree or the baseline on disk.
function scanContent(rel, content) {
  const sourceFile = parseSource(rel, content);
  const bindings = collectBindings(sourceFile);

  // Pass 2 in source order: collect guarded write candidates and chmod pairings.
  const writes = [];
  const chmods = [];
  let occurrence = 0;

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const resolved = resolveCallee(node.expression, sourceFile, bindings);
      if (resolved && CHMOD_METHODS.has(resolved.name)) {
        const target = node.arguments[0];
        const mode = numericMode(node.arguments[1]);
        if (target) chmods.push({ pos: node.getStart(sourceFile), targetText: target.getText(sourceFile), mode });
      } else if (resolved && isGuardedWrite(resolved)) {
        occurrence += 1;
        const dest = node.arguments[1];
        writes.push({
          name: resolved.name,
          pos: node.getStart(sourceFile),
          destText: dest ? dest.getText(sourceFile) : null,
          args: node.arguments,
          occurrence,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const findings = [];
  for (const w of writes) {
    if (w.name === 'openSync' || w.name === 'open') {
      // Only PROVABLY read-only opens carry no mode: a string-flag literal
      // without any write flag, or the numeric literal O_RDONLY (0). Flags
      // that cannot be statically evaluated (variables, expressions,
      // credentialReadFlags() calls) are treated as writes — the same
      // conservative rule applied to modes; the baseline absorbs reviewed
      // false positives rather than the gate silently skipping a real write.
      const flagsArg = w.args[1];
      const flags = flagsArg && ts.isStringLiteral(flagsArg) ? flagsArg.text : null;
      if (flags !== null && !/[wax+]/.test(flags)) continue;
      if (flagsArg && ts.isNumericLiteral(flagsArg)) {
        const flagsNumber = Number(flagsArg.text.replace(/_/g, ''));
        if (flagsNumber === 0) continue;
      }
      const mode = numericMode(w.args[2]);
      if (mode !== null && (mode & 0o077) === 0) continue;
    } else if (COPY_METHODS.has(w.name)) {
      // copy lands with the source's mode (its option arg is a COPYFILE
      // behavior flag, not a permission mode on modern Node), so the invariant
      // is an explicit owner-only chmod on the SAME destination later in the
      // file. A chmod on any other target — or a permissive mode on the right
      // target — silences nothing (CWE-732: a false negative here is a security
      // gate silently passing).
      const paired = chmods.some(
        (c) => c.pos > w.pos && c.targetText === w.destText && c.mode !== null && (c.mode & 0o077) === 0,
      );
      if (paired) continue;
    } else {
      const mode = writeCallMode(w.name, w.args);
      if (mode !== null && (mode & 0o077) === 0) continue;
    }
    const pos = sourceFile.getLineAndCharacterOfPosition(w.pos);
    findings.push({
      file: rel,
      line: pos.line + 1,
      call: w.name,
      fingerprint: findingFingerprint(rel, w.occurrence, w.name),
    });
  }
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
    const entries = findings.map((f) => {
      const reviewed = baselineMap.get(f.fingerprint);
      return {
        fingerprint: f.fingerprint,
        file: f.file,
        call: f.call,
        line: f.line,
        reason: reasonFor(f),
        // Keep the original record date for entries that already exist, so
        // --update only refreshes reasons, not metadata, in the diff.
        enteredAt: reviewed?.enteredAt ?? new Date().toISOString().slice(0, 10),
        ticket: '08-lowseverity-hardening',
      };
    });
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

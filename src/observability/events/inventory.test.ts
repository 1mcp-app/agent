import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { EVENT_REGISTRY } from './registry.js';

const root = path.resolve(import.meta.dirname, '../../..');
function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return file.endsWith('.ts') && !file.endsWith('.test.ts') ? [file] : [];
  });
}
const files = sourceFiles(path.join(root, 'src'));

describe('instrumentation ownership inventory', () => {
  it('permits only registered source constants on runtime logger paths', () => {
    const violations: string[] = [];
    for (const file of files) {
      const relative = path.relative(root, file);
      if (['src/logger/logger.ts', 'src/transport/http/utils/unifiedLogger.ts'].includes(relative)) continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node): void {
        if (ts.isCallExpression(node)) {
          const name = node.expression.getText(source);
          const direct = /^(logger|secureLogger)\.(debug|info|warn|warning|error|log)$/.test(name);
          const conditional = /^(debugIf|infoIf|warnIf|errorIf|auditLog)$/.test(name);
          if (direct || conditional) {
            let event = node.arguments[0];
            if (event && ts.isArrowFunction(event)) {
              const body = ts.isParenthesizedExpression(event.body) ? event.body.expression : event.body;
              if (ts.isObjectLiteralExpression(body)) {
                const property = body.properties.find((item) => item.name?.getText(source) === 'message');
                if (property && ts.isPropertyAssignment(property)) event = property.initializer;
              }
            }
            if (!event || !ts.isStringLiteral(event) || !Object.hasOwn(EVENT_REGISTRY, event.text)) {
              violations.push(`${relative}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(violations).toEqual([]);
  });

  it('keeps fingerprints out of runtime/config/credentials, public errors, resources, and tracing/export seams', () => {
    const consumers = files
      .filter((file) => /\b(privateFingerprint|normalizeEvent)\s*\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file))
      .sort();
    expect(consumers).toEqual([
      'src/logger/backgroundSupervisorLogger.ts',
      'src/logger/logger.ts',
      'src/observability/events/normalize.ts',
      'src/observability/privacy/fields.ts',
    ]);
    const diagnosticConsumers = files
      .filter((file) => /\b(writeBackendDiagnostic|writeManagedStderrDiagnostic)\b/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file))
      .sort();
    expect(diagnosticConsumers).toEqual([
      'src/domains/backend-logs/backendLogProjection.ts',
      'src/logger/logger.ts',
      'src/transport/managedStdioStderr.ts',
    ]);
    const httpDiagnosticConsumers = files
      .filter((file) => /\bwriteHttpDiagnostic\b/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file))
      .sort();
    expect(httpDiagnosticConsumers).toEqual([
      'src/logger/logger.ts',
      'src/transport/http/middlewares/httpRequestLogger.ts',
    ]);
  });
});

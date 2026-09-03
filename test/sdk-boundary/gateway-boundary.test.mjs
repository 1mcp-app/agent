import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

import { test } from 'node:test';
import ts from 'typescript';

const root = process.cwd();

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : /\.(?:[cm]?ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

function relativePath(path) {
  return relative(root, path).split(sep).join('/');
}

function importSpecifiers(path) {
  return importSpecifiersForSource(readFileSync(path, 'utf8'), path);
}

function importSpecifiersForSource(sourceText, path) {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const specifiers = [];
  function add(node) {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function resolvesInside(specifier, importingFile, target) {
  if (specifier.startsWith('@src/')) return specifier === `@src/${target}` || specifier.startsWith(`@src/${target}/`);
  if (!specifier.startsWith('.')) return false;
  const resolved = normalize(join(dirname(relativePath(importingFile)), specifier))
    .split(sep)
    .join('/');
  return resolved === `src/${target}` || resolved.startsWith(`src/${target}/`);
}

test('shared gateway layers remain independent of protocol SDK implementations', () => {
  const sharedRoots = ['contracts', 'core', 'ports'].map((directory) => join(root, 'src/gateway', directory));
  const violations = sharedRoots.flatMap(filesBelow).flatMap((path) =>
    importSpecifiers(path)
      .filter(
        (specifier) => specifier.startsWith('@modelcontextprotocol/') || resolvesInside(specifier, path, 'sdk/legacy'),
      )
      .map((specifier) => `${relativePath(path)} -> ${specifier}`),
  );

  assert.deepEqual(violations, []);
});

test('gateway adapters remain disconnected from production entry points', () => {
  const violations = filesBelow(join(root, 'src'))
    .filter((path) => !path.includes('/src/gateway/'))
    .flatMap((path) =>
      importSpecifiers(path)
        .filter((specifier) => resolvesInside(specifier, path, 'gateway'))
        .map((specifier) => `${relativePath(path)} -> ${specifier}`),
    );

  assert.deepEqual(violations, []);
});

test('policy resolves relative legacy imports and gateway barrel imports', () => {
  const sharedFile = join(root, 'src/gateway/core/example.ts');
  const productionFile = join(root, 'src/core/example.ts');

  assert.equal(resolvesInside('../../sdk/legacy/types.js', sharedFile, 'sdk/legacy'), true);
  assert.equal(resolvesInside('@src/gateway/index.js', productionFile, 'gateway'), true);
  assert.deepEqual(
    importSpecifiersForSource(
      "import legacy from '../../sdk/legacy/types.js'; export * from '@src/gateway/index.js';",
      sharedFile,
    ),
    ['../../sdk/legacy/types.js', '@src/gateway/index.js'],
  );
});

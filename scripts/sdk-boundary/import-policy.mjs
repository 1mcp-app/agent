import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

const LEGACY_PACKAGE = '@modelcontextprotocol/sdk';
const LEGACY_ISLAND_ALIAS = '@src/sdk/legacy';

function isLegacySdkSpecifier(specifier) {
  return typeof specifier === 'string' &&
    (specifier === LEGACY_PACKAGE || specifier.startsWith(`${LEGACY_PACKAGE}/`));
}

function isLegacyIslandSpecifier(specifier, filePath = '') {
  if (specifier === LEGACY_ISLAND_ALIAS || specifier.startsWith(`${LEGACY_ISLAND_ALIAS}/`)) return true;
  if (!specifier?.startsWith('.')) return false;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), specifier));
  return resolved === 'src/sdk/legacy' || resolved.startsWith('src/sdk/legacy/');
}

function isTestSource(relativePath) {
  return /(?:^|\/)[^/]+\.(?:test|e2e\.test)\.tsx?$/u.test(relativePath) || relativePath.endsWith('.testSetup.ts');
}

function isAllowedPath(relativePath) {
  return relativePath === 'src/sdk/legacy' || relativePath.startsWith('src/sdk/legacy/');
}

function stringLiteralText(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function isPureCompatibilityShim(sourceFile) {
  return (
    sourceFile.statements.length > 0 &&
    sourceFile.statements.every(
      (statement) =>
        ts.isExportDeclaration(statement) &&
        isLegacyIslandSpecifier(stringLiteralText(statement.moduleSpecifier), sourceFile.fileName),
    )
  );
}

export function findLegacySdkImports(sourceText, filePath) {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations = [];
  const compatibilityShim = isPureCompatibilityShim(sourceFile);
  const literalBindings = new Map();
  const runtimeLoaderNames = new Set(['require']);

  function collectBindings(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const literal = stringLiteralText(node.initializer);
      if (literal !== undefined) literalBindings.set(node.name.text, literal);
      if (
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'createRequire'
      ) {
        runtimeLoaderNames.add(node.name.text);
      }
    }
    ts.forEachChild(node, collectBindings);
  }

  collectBindings(sourceFile);

  function resolvedString(node) {
    if (!node) return undefined;
    const literal = stringLiteralText(node);
    return literal ?? (ts.isIdentifier(node) ? literalBindings.get(node.text) : undefined);
  }

  function add(node, kind, specifier) {
    if (!isLegacySdkSpecifier(specifier) && !isLegacyIslandSpecifier(specifier, filePath)) return;
    if (compatibilityShim && isLegacyIslandSpecifier(specifier, filePath)) return;
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({ file: filePath, line: position.line + 1, column: position.character + 1, kind, specifier });
  }

  function addComputed(node, kind) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({
      file: filePath,
      line: position.line + 1,
      column: position.character + 1,
      kind,
      specifier: '<computed>',
    });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      add(
        node,
        node.importClause?.isTypeOnly ? 'type-only import' : 'static import',
        stringLiteralText(node.moduleSpecifier),
      );
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node, node.isTypeOnly ? 'type-only export' : 'export-from', stringLiteralText(node.moduleSpecifier));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, 'import-equals', stringLiteralText(node.moduleReference.expression));
    } else if (ts.isCallExpression(node)) {
      const specifier = resolvedString(node.arguments[0]);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (specifier === undefined) addComputed(node, 'computed dynamic import');
        else add(node, 'dynamic import', specifier);
      } else if (ts.isIdentifier(node.expression) && runtimeLoaderNames.has(node.expression.text)) {
        if (specifier === undefined) addComputed(node, 'computed runtime loader call');
        else add(node, node.expression.text === 'require' ? 'commonjs require' : 'runtime loader call', specifier);
      } else if (
        specifier !== undefined &&
        (isLegacySdkSpecifier(specifier) || isLegacyIslandSpecifier(specifier, filePath))
      ) {
        const kind =
          ts.isIdentifier(node.expression) && node.expression.text === 'require'
            ? 'commonjs require'
            : 'runtime loader call';
        add(node, kind, specifier);
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, 'import type expression', stringLiteralText(node.argument.literal));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(entryPath)));
    else if (/\.(?:[cm]?ts|tsx)$/u.test(entry.name)) files.push(entryPath);
  }
  return files;
}

export async function checkSdkImportBoundary(root) {
  const src = path.join(root, 'src');
  const violations = [];
  for (const file of await sourceFiles(src)) {
    const relativePath = path.relative(root, file).split(path.sep).join('/');
    if (isAllowedPath(relativePath) || isTestSource(relativePath)) continue;
    violations.push(...findLegacySdkImports(await readFile(file, 'utf8'), relativePath));
  }
  return violations;
}

export function formatImportViolations(violations) {
  return violations
    .map(
      ({ file, line, column, kind, specifier }) => {
        const resolution = isLegacyIslandSpecifier(specifier, file)
          ? 'must be replaced with a 1MCP-owned contract or isolated behind a pure export-only compatibility shim'
          : 'must move under src/sdk/legacy/ or use the v2 packages';
        return `${file}:${line}:${column} ${kind} '${specifier}' ${resolution}`;
      },
    )
    .join('\n');
}

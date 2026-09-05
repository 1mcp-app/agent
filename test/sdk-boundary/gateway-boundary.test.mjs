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

function isTestSource(path) {
  return /(?:^|\/)[^/]+\.(?:test|e2e\.test)\.tsx?$/u.test(relativePath(path));
}

function importSpecifiers(path) {
  return importSpecifiersForSource(readFileSync(path, 'utf8'), path);
}

function importSpecifiersForSource(sourceText, path) {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const specifiers = [];
  function add(node) {
    specifiers.push(node && ts.isStringLiteralLike(node) ? node.text : '<computed>');
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) add(node.moduleSpecifier);
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

test('gateway production attachment is confined to explicit inbound and outbound adapters', () => {
  const allowed = new Set([
    'src/sdk/legacy/client/runtime/legacyGatewayClientAdapter.ts -> @src/gateway/adapters/legacy/legacyOutboundEraAdapter.js',
    'src/sdk/legacy/client/runtime/legacyGatewayClientAdapter.ts -> @src/gateway/contracts/effectiveRequestAuthority.js',
    'src/sdk/legacy/client/runtime/legacyGatewayClientAdapter.ts -> @src/gateway/contracts/immutableJson.js',
    'src/sdk/legacy/client/runtime/modernSdkClientAdapter.ts -> @src/gateway/adapters/legacy/legacyOutboundEraAdapter.js',
    'src/sdk/legacy/client/runtime/modernSdkClientAdapter.ts -> @src/gateway/adapters/modern/modernOutboundEraAdapter.js',
    'src/sdk/legacy/client/runtime/modernSdkClientAdapter.ts -> @src/gateway/contracts/effectiveRequestAuthority.js',
    'src/sdk/legacy/client/runtime/modernSdkClientAdapter.ts -> @src/gateway/contracts/immutableJson.js',
    'src/sdk/legacy/client/runtime/modernSdkClientAdapter.ts -> @src/gateway/ports/outboundEraAdapter.js',
    'src/sdk/legacy/transport/http/modernInboundLegacyBridge.ts -> @src/gateway/adapters/legacy/legacyOutboundEraAdapter.js',
    'src/sdk/legacy/transport/stdioProxyTransport.ts -> @src/gateway/contracts/index.js',
    'src/transport/http/middlewares/errorHandler.ts -> @src/gateway/contracts/protocolEra.js',
    'src/transport/http/routes/modernHttpRoutes.ts -> @src/gateway/adapters/modern/modernInboundEraAdapter.js',
    'src/transport/http/routes/modernHttpRoutes.ts -> @src/gateway/contracts/effectiveRequestAuthority.js',
    'src/transport/http/routes/modernHttpRoutes.ts -> @src/gateway/contracts/index.js',
    'src/transport/http/routes/modernHttpRoutes.ts -> @src/gateway/contracts/protocolEra.js',
    'src/transport/http/routes/modernHttpRoutes.ts -> @src/gateway/core/gatewayDispatcher.js',
    'src/transport/http/routes/modernHttpRoutes.ts -> @src/gateway/core/gatewaySession.js',
  ]);
  const violations = filesBelow(join(root, 'src'))
    .filter((path) => !path.includes('/src/gateway/'))
    .filter((path) => !isTestSource(path))
    .flatMap((path) =>
      importSpecifiers(path)
        .filter((specifier) => specifier === '<computed>' || resolvesInside(specifier, path, 'gateway'))
        .map((specifier) => `${relativePath(path)} -> ${specifier}`)
        .filter((edge) => !allowed.has(edge)),
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
  assert.deepEqual(
    importSpecifiersForSource("const target = '@src/gateway/index.js'; import(target);", productionFile),
    ['<computed>'],
  );
});

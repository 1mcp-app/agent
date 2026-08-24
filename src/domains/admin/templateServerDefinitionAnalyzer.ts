import type { MCPServerParams } from '@src/core/types/index.js';

import Handlebars from 'handlebars';

export interface TemplateExpressionField {
  fieldPath: string[];
  variables: string[];
  syntax: { valid: true } | { valid: false; message: string };
}

export interface TemplateDefinitionAnalysis {
  syntax: { valid: boolean; errors: Array<{ fieldPath: string[]; code: 'invalid_handlebars'; message: string }> };
  variables: string[];
  unresolvedVariables: string[];
  fields: TemplateExpressionField[];
}

const HANDLEBARS_BUILT_INS = new Set([
  'and',
  'contains',
  'div',
  'each',
  'else',
  'endsWith',
  'eq',
  'gt',
  'if',
  'len',
  'lookup',
  'lt',
  'math',
  'ne',
  'or',
  'startsWith',
  'subtract',
  'substring',
  'unless',
  'with',
]);

export function analyzeTemplateServerDefinition(config: MCPServerParams): TemplateDefinitionAnalysis {
  const fields = renderedTemplateFields(config).map(({ fieldPath, value }) => analyzeField(fieldPath, value));
  const variables = Array.from(new Set(fields.flatMap((field) => field.variables))).sort();
  const errors = fields.flatMap((field) =>
    field.syntax.valid
      ? []
      : [{ fieldPath: field.fieldPath, code: 'invalid_handlebars' as const, message: field.syntax.message }],
  );
  return {
    syntax: { valid: errors.length === 0, errors },
    variables,
    // Preview is intentionally context-free, so every referenced variable is unresolved.
    unresolvedVariables: variables,
    fields,
  };
}

function renderedTemplateFields(config: MCPServerParams): Array<{ fieldPath: string[]; value: string }> {
  const fields: Array<{ fieldPath: string[]; value: string }> = [];
  pushStringField(fields, ['transport', 'command'], config.command);
  for (const [index, value] of (config.args ?? []).entries()) {
    pushStringField(fields, ['transport', 'args', String(index)], value);
  }
  if (config.env && !Array.isArray(config.env)) {
    for (const [key, value] of Object.entries(config.env)) {
      pushStringField(fields, ['transport', 'env', key], value);
    }
  }
  pushStringField(fields, ['transport', 'cwd'], config.cwd);
  pushStringField(fields, ['transport', 'url'], config.url);
  pushStringField(fields, ['transport', 'disabled'], config.disabled);
  return fields;
}

function pushStringField(
  fields: Array<{ fieldPath: string[]; value: string }>,
  fieldPath: string[],
  value: unknown,
): void {
  if (typeof value === 'string' && value.includes('{{')) fields.push({ fieldPath, value });
}

function analyzeField(fieldPath: string[], value: string): TemplateExpressionField {
  try {
    const ast = Handlebars.parse(value);
    const variables = new Set<string>();
    collectPathExpressions(ast, variables, new Set(), false);
    return {
      fieldPath,
      variables: Array.from(variables).filter(isContextVariable).sort(),
      syntax: { valid: true },
    };
  } catch (error) {
    return {
      fieldPath,
      variables: [],
      syntax: { valid: false, message: handlebarsSyntaxDiagnostic(error) },
    };
  }
}

function collectPathExpressions(
  value: unknown,
  variables: Set<string>,
  inheritedLocals: Set<string>,
  implicitBlockContext: boolean,
): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectPathExpressions(item, variables, inheritedLocals, implicitBlockContext);
    return;
  }
  const node = value as Record<string, unknown>;
  if (node.type === 'BlockStatement') {
    collectPathExpressions(node.path, variables, inheritedLocals, implicitBlockContext);
    collectPathExpressions(node.params, variables, inheritedLocals, implicitBlockContext);
    collectPathExpressions(node.hash, variables, inheritedLocals, implicitBlockContext);
    const blockName = readPathOriginal(node.path);
    const program = node.program as Record<string, unknown> | undefined;
    collectPathExpressions(
      program,
      variables,
      inheritedLocals,
      implicitBlockContext || blockName === 'each' || blockName === 'with',
    );
    collectPathExpressions(node.inverse, variables, inheritedLocals, implicitBlockContext);
    return;
  }
  const locals = new Set(inheritedLocals);
  if (Array.isArray(node.blockParams)) {
    for (const blockParam of node.blockParams) if (typeof blockParam === 'string') locals.add(blockParam);
  }
  if (
    node.type === 'PathExpression' &&
    typeof node.original === 'string' &&
    !isBlockLocal(node.original, locals) &&
    !(implicitBlockContext && isBarePath(node.original))
  ) {
    variables.add(node.original);
  }
  for (const nested of Object.values(node)) collectPathExpressions(nested, variables, locals, implicitBlockContext);
}

function isContextVariable(value: string): boolean {
  return (
    value.length > 0 &&
    !HANDLEBARS_BUILT_INS.has(value) &&
    !value.startsWith('@') &&
    value !== 'this' &&
    !value.startsWith('this.') &&
    value !== '.' &&
    !/^(?:true|false|null|undefined)$/u.test(value)
  );
}

function isBlockLocal(value: string, locals: Set<string>): boolean {
  const root = value.split('.')[0];
  return locals.has(root);
}

function isBarePath(value: string): boolean {
  return !value.includes('.') && !value.includes('/') && !value.startsWith('../');
}

function readPathOriginal(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const original = (value as Record<string, unknown>).original;
  return typeof original === 'string' ? original : undefined;
}

function handlebarsSyntaxDiagnostic(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Invalid Handlebars syntax.';
  const hash = (error as Record<string, unknown>).hash;
  if (!hash || typeof hash !== 'object') return 'Invalid Handlebars syntax.';
  const loc = (hash as Record<string, unknown>).loc;
  if (!loc || typeof loc !== 'object') return 'Invalid Handlebars syntax.';
  const firstLine = (loc as Record<string, unknown>).first_line;
  const firstColumn = (loc as Record<string, unknown>).first_column;
  return typeof firstLine === 'number' && typeof firstColumn === 'number'
    ? `Invalid Handlebars syntax at line ${firstLine}, column ${firstColumn}.`
    : 'Invalid Handlebars syntax.';
}

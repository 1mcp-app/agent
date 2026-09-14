import { parentPort } from 'node:worker_threads';

import Ajv from 'ajv';
import type { Ajv as AjvType, AnySchema, AnySchemaObject, ValidateFunction } from 'ajv';
import Ajv2019 from 'ajv/dist/2019.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { createRequire } from 'node:module';

const draft6 = createRequire(import.meta.url)('ajv/dist/refs/json-schema-draft-06.json') as AnySchemaObject;

interface Job {
  id: number;
  schema: Record<string, unknown>;
  dialect: string;
  instance?: unknown;
  operation: 'compile' | 'evaluate';
  limits: Record<string, number>;
}
const validators = new Map<string, ValidateFunction>();
function compile(job: Job): ValidateFunction {
  const key = JSON.stringify([job.dialect, job.schema]);
  const cached = validators.get(key);
  if (cached) return cached;
  const schema = structuredClone(job.schema);
  const limits = job.limits;
  let references = 0,
    branches = 0,
    regexes = 0;
  const resources = new Map<string, Record<string, unknown>>();
  const visited = new WeakSet<object>();
  const modern = job.dialect === '2020-12' || job.dialect === '2019-09';
  const refs: string[] = [];
  const base = 'https://schema.invalid/';
  const fail = (code: string): never => {
    throw new Error(code);
  };
  const single = [
    'additionalProperties',
    'contains',
    'not',
    'propertyNames',
    ...(job.dialect !== '2020-12' ? ['additionalItems'] : []),
    ...(job.dialect !== 'draft-06' ? ['if', 'then', 'else'] : []),
    ...(modern ? ['unevaluatedProperties', 'unevaluatedItems', 'contentSchema'] : []),
  ];
  const maps = [
    'properties',
    'patternProperties',
    ...(modern ? ['$defs', 'dependentSchemas'] : []),
    ...(job.dialect !== '2020-12' ? ['definitions'] : []),
  ];
  const anchors: string[] = [];
  const referenceKeywords = ['$ref'];
  if (modern) anchors.push('$anchor');
  if (job.dialect === '2020-12') {
    anchors.push('$dynamicAnchor');
    referenceKeywords.push('$dynamicRef');
  } else if (job.dialect === '2019-09') {
    referenceKeywords.push('$recursiveRef');
  }
  function walk(schema: unknown, parentBase: string): void {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
    if (visited.has(schema)) return;
    visited.add(schema);
    const node = schema as Record<string, unknown>;
    if (node.$schema !== undefined) {
      const declared =
        typeof node.$schema === 'string'
          ? /^https?:\/\/json-schema\.org\/(?:draft\/(2020-12|2019-09)|(draft-07|draft-06))\/schema#?$/.exec(
              node.$schema,
            )
          : null;
      if (!declared || (declared[1] ?? declared[2]) !== job.dialect) fail('schema_unsupported_dialect');
    }

    // Ajv also accepts OpenAPI extensions; unknown JSON Schema keywords are annotations here.
    delete node.nullable;
    delete node.$async;
    delete node.id;
    let scope = parentBase;
    if (typeof node.$id === 'string') {
      scope = new URL(node.$id, parentBase).href.replace(/#$/, '');
      if (resources.has(scope) && resources.get(scope) !== node) fail('schema_invalid');
      resources.set(scope, node);
    }
    for (const keyword of anchors)
      if (typeof node[keyword] === 'string') {
        const anchor = new URL('#' + node[keyword], scope).href;
        if (resources.has(anchor)) fail('schema_invalid');
        resources.set(anchor, node);
      }
    if (node.$data !== undefined || node.$async !== undefined) fail('schema_unsupported_vocabulary');
    if (modern && node.$vocabulary && typeof node.$vocabulary === 'object') {
      const supported = new Set(
        [
          'core',
          'applicator',
          'validation',
          'meta-data',
          'content',
          ...(job.dialect === '2020-12' ? ['format-annotation', 'unevaluated'] : []),
        ].map((name) => `https://json-schema.org/draft/${job.dialect}/vocab/${name}`),
      );
      for (const [uri, required] of Object.entries(node.$vocabulary))
        if (required && !supported.has(uri)) fail('schema_unsupported_vocabulary');
    }
    for (const keyword of referenceKeywords)
      if (typeof node[keyword] === 'string') {
        if (++references > limits.references) fail('schema_budget_exceeded');
        refs.push(new URL(node[keyword], scope).href.replace(/#$/, ''));
      }
    if (Array.isArray(node.required) && node.required.length > limits.required) fail('schema_budget_exceeded');
    if (Array.isArray(node.enum) && node.enum.length > limits.enumValues) fail('schema_budget_exceeded');
    const patterns = [
      ...(typeof node.pattern === 'string' ? [node.pattern] : []),
      ...Object.keys(node.patternProperties ?? {}),
    ];
    for (const pattern of patterns) {
      if (++regexes > limits.regexes || Buffer.byteLength(pattern) > limits.regexBytes) fail('schema_budget_exceeded');
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf', ...(job.dialect === '2020-12' ? ['prefixItems'] : [])])
      if (Array.isArray(node[keyword])) {
        branches += node[keyword].length;
        if (branches > limits.branches) fail('schema_budget_exceeded');
        for (const child of node[keyword]) walk(child, scope);
      }
    for (const keyword of maps)
      if (node[keyword] && typeof node[keyword] === 'object')
        for (const child of Object.values(node[keyword])) walk(child, scope);
    for (const keyword of single) walk(node[keyword], scope);
    if (Array.isArray(node.items)) for (const child of node.items) walk(child, scope);
    else walk(node.items, scope);
    if (job.dialect !== '2020-12' && node.dependencies && typeof node.dependencies === 'object')
      for (const child of Object.values(node.dependencies)) if (!Array.isArray(child)) walk(child, scope);
  }
  resources.set(base, schema);
  walk(schema, base);
  // A reference may turn an otherwise opaque annotation value into a schema position.
  // Analyze that exact target too, without interpreting unrelated enum/default payloads.
  for (const ref of refs) {
    const uri = new URL(ref);
    const fragment = uri.hash;
    uri.hash = '';
    let scope = uri.href;
    let target: unknown = resources.get(ref) ?? resources.get(scope);
    if (target === undefined) fail('schema_reference_forbidden');
    if (!resources.has(ref) && fragment) {
      if (!fragment.startsWith('#/')) fail('schema_reference_unresolved');
      for (const raw of decodeURIComponent(fragment.slice(2)).split('/')) {
        if (/~[^01]/.test(raw)) fail('schema_reference_unresolved');
        const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) fail('schema_reference_unresolved');
        target = (target as Record<string, unknown>)[key];
      }
    }
    walk(target, scope);
  }
  let dialectConstructor: typeof Ajv | typeof Ajv2020 | typeof Ajv2019 = Ajv;
  if (job.dialect === '2020-12') {
    dialectConstructor = Ajv2020;
  } else if (job.dialect === '2019-09') {
    dialectConstructor = Ajv2019;
  }
  const Constructor = dialectConstructor as unknown as new (options: object) => AjvType;
  const ajv = new Constructor({
    strict: false,
    validateSchema: true,
    validateFormats: false,
    allErrors: false,
    removeAdditional: false,
    useDefaults: false,
    coerceTypes: false,
    $data: false,
    addUsedSchema: false,
    inlineRefs: false,
  });
  if (job.dialect === 'draft-06') ajv.addMetaSchema(draft6);
  if (job.dialect === 'draft-06') for (const keyword of ['if', 'then', 'else']) ajv.removeKeyword(keyword);
  if (job.dialect === '2020-12') ajv.removeKeyword('dependencies');
  schema.$schema = job.dialect.startsWith('draft-')
    ? 'http://json-schema.org/' + job.dialect + '/schema#'
    : 'https://json-schema.org/draft/' + job.dialect + '/schema';
  let validator: ValidateFunction;
  try {
    validator = ajv.compile(schema as AnySchema);
  } catch (error) {
    fail(
      error && typeof error === 'object' && 'missingRef' in error
        ? 'schema_reference_unresolved'
        : 'schema_compile_failed',
    );
  }
  if (validators.size >= 128) validators.delete(validators.keys().next().value!);
  validators.set(key, validator!);
  return validator!;
}
parentPort!.on('message', (job: Job) => {
  try {
    const validator = compile(job);
    if (job.operation === 'evaluate') parentPort!.postMessage({ id: job.id, compiled: true });
    parentPort!.postMessage({ id: job.id, valid: job.operation === 'compile' || validator(job.instance) === true });
  } catch (error) {
    const code =
      error instanceof Error && /^schema_[a-z_]+$/.test(error.message) ? error.message : 'schema_compile_failed';
    parentPort!.postMessage({ id: job.id, error: code });
  }
});
parentPort!.postMessage({ ready: true });

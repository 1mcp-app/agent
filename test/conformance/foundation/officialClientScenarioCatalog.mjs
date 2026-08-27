export const OFFICIAL_CLIENT_SCENARIOS = {
  '2025-11-25': [
    'initialize',
    'tools_call',
    'elicitation-sep1034-client-defaults',
    'sse-retry',
    'auth/metadata-default',
    'auth/metadata-var1',
    'auth/metadata-var2',
    'auth/metadata-var3',
    'auth/basic-cimd',
    'auth/scope-from-www-authenticate',
    'auth/scope-from-scopes-supported',
    'auth/scope-omitted-when-undefined',
    'auth/scope-step-up',
    'auth/scope-retry-limit',
    'auth/token-endpoint-auth-basic',
    'auth/token-endpoint-auth-post',
    'auth/token-endpoint-auth-none',
    'auth/pre-registration',
    'auth/client-credentials-jwt',
    'auth/client-credentials-basic',
    'auth/enterprise-managed-authorization',
    'auth/dpop',
    'auth/dpop-nonce',
    'auth/wif-jwt-bearer',
    'json-schema-2020-12-preservation',
  ],
  '2026-07-28': [
    'tools_call',
    'request-metadata',
    'auth/metadata-default',
    'auth/metadata-var1',
    'auth/metadata-var2',
    'auth/metadata-var3',
    'auth/basic-cimd',
    'auth/scope-from-www-authenticate',
    'auth/scope-from-scopes-supported',
    'auth/scope-omitted-when-undefined',
    'auth/scope-step-up',
    'auth/scope-retry-limit',
    'auth/token-endpoint-auth-basic',
    'auth/token-endpoint-auth-post',
    'auth/token-endpoint-auth-none',
    'auth/pre-registration',
    'auth/resource-mismatch',
    'auth/offline-access-scope',
    'auth/offline-access-not-supported',
    'auth/authorization-server-migration',
    'auth/iss-supported',
    'auth/iss-not-advertised',
    'auth/iss-supported-missing',
    'auth/iss-wrong-issuer',
    'auth/iss-unexpected',
    'auth/iss-normalized',
    'auth/metadata-issuer-mismatch',
    'sep-2322-client-request-state',
    'http-standard-headers',
    'http-custom-headers',
    'http-invalid-tool-headers',
    'json-schema-ref-no-deref',
    'auth/client-credentials-jwt',
    'auth/client-credentials-basic',
    'auth/enterprise-managed-authorization',
    'auth/dpop',
    'auth/dpop-nonce',
    'auth/wif-jwt-bearer',
    'json-schema-2020-12-preservation',
  ],
};

export function officialClientScenarioFamily(revision, scenario) {
  if (!OFFICIAL_CLIENT_SCENARIOS[revision]?.includes(scenario)) return null;
  if (scenario.startsWith('auth/')) return 'auth';
  if (scenario === 'initialize') return 'initialize';
  if (scenario === 'tools_call') return 'tools';
  if (scenario === 'request-metadata') return 'request-metadata';
  if (scenario === 'elicitation-sep1034-client-defaults') return 'elicitation';
  if (scenario === 'sse-retry') return 'sse-retry';
  if (scenario === 'sep-2322-client-request-state') return 'request-state';
  if (scenario === 'http-standard-headers') return 'standard-headers';
  if (scenario === 'http-custom-headers') return 'custom-headers';
  if (scenario === 'http-invalid-tool-headers') return 'invalid-headers';
  if (scenario.startsWith('json-schema-')) return 'schema';
  return null;
}

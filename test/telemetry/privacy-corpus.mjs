import assert from 'node:assert/strict';

// Synthetic markers, never real credentials. Exercise each through runtime inputs.
export const privacyCorpus = Object.freeze({
  argument: 'PRIVACY_ARGUMENT_489',
  result: 'PRIVACY_RESULT_489',
  prompt: 'PRIVACY_PROMPT_489',
  schema: 'PRIVACY_SCHEMA_489',
  uri: 'https://private.example/PRIVACY_URI_489?key=PRIVACY_QUERY_489',
  authorization: 'Bearer PRIVACY_AUTH_489',
  cookie: 'PRIVACY_COOKIE_489',
  error: 'PRIVACY_ERROR_489',
  stack: 'PRIVACY_STACK_489',
  backendName: 'PRIVACY_BACKEND_489',
  toolName: 'PRIVACY_TOOL_489',
  session: 'PRIVACY_SESSION_489',
  client: 'PRIVACY_CLIENT_489',
  environment: 'PRIVACY_ENV_489',
  backendLog: 'PRIVACY_BACKEND_LOG_489',
  baggage: 'PRIVACY_BAGGAGE_489',
  metadata: 'PRIVACY_METADATA_489',
});

/** Scan decompressed wire bytes as well as decoded Collector JSON. */
export function assertPrivatePayloads(payloads) {
  assert(payloads.length > 0, 'No payloads: privacy acceptance cannot pass vacuously');
  for (const payload of payloads) {
    const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
    for (const [category, marker] of Object.entries(privacyCorpus)) {
      for (const token of marker.match(/PRIVACY_[A-Z_]+_489/g) ?? [marker]) {
        assert(!bytes.includes(Buffer.from(token)), `Forbidden ${category} in exported payload`);
      }
    }
  }
}

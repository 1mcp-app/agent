// Direct SDK diagnostic, limited to the pinned suite's loopback mock peers.
// Reference: conformance c321dd3 examples/clients/typescript/helpers/ConformanceOAuthProvider.ts
// and examples/clients/typescript/elicitation-defaults-test.ts.
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function loopbackUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('CONTROL_REQUIRES_LOOPBACK');
  }
  return url;
}

export class LoopbackOAuthProvider {
  redirectUrl = 'http://127.0.0.1:3000/callback';
  clientMetadata = {
    client_name: 'direct-client-control',
    redirect_uris: [this.redirectUrl],
    application_type: 'native',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  };
  clientInformation() {
    return this.information;
  }
  saveClientInformation(value) {
    this.information = value;
  }
  tokens() {
    return this.savedTokens;
  }
  saveTokens(value) {
    this.savedTokens = value;
  }
  saveCodeVerifier(value) {
    this.verifier = value;
  }
  codeVerifier() {
    return this.verifier;
  }
  async redirectToAuthorization(value) {
    const response = await fetch(loopbackUrl(value), { redirect: 'manual' });
    const location = loopbackUrl(response.headers.get('location'));
    if (location.origin !== new URL(this.redirectUrl).origin || location.pathname !== '/callback') {
      throw new Error('CONTROL_CALLBACK_MISMATCH');
    }
    this.code = location.searchParams.get('code');
    if (!this.code) throw new Error('CONTROL_CODE_MISSING');
  }
}

export async function runClientControl(endpoint, scenario) {
  if (scenario === 'sep-2322-client-request-state') return runRequestStateControl(endpoint);
  const auth = scenario === 'auth/metadata-default';
  if (!auth && scenario !== 'elicitation-sep1034-client-defaults') throw new Error('CONTROL_SCENARIO_UNSUPPORTED');
  const phases = [];
  const client = new Client(
    { name: 'direct-client-control', version: '1.0.0' },
    {
      capabilities: auth ? {} : { elicitation: { form: { applyDefaults: true } } },
    },
  );
  if (!auth)
    client.setRequestHandler(ElicitRequestSchema, async () => {
      phases.push('elicitation-handler');
      return { action: 'accept', content: {} };
    });
  const provider = auth ? new LoopbackOAuthProvider() : undefined;
  const createTransport = () =>
    new StreamableHTTPClientTransport(loopbackUrl(endpoint), {
      authProvider: provider,
      fetch: (value, options) =>
        fetch(loopbackUrl(value instanceof Request ? value.url : value), { ...options, redirect: 'manual' }),
    });
  let transport = createTransport();
  try {
    try {
      await client.connect(transport);
    } catch (error) {
      if (!auth || !(error instanceof UnauthorizedError) || !provider.code) throw error;
      phases.push('authorization-return');
      await transport.finishAuth(provider.code);
      await client.close();
      transport = createTransport();
      await client.connect(transport);
    }
    phases.push('connected');
    await client.listTools();
    phases.push('tools-listed');
    const result = await client.callTool({
      name: auth ? 'test-tool' : 'test_client_elicitation_defaults',
      arguments: {},
    });
    if (result.isError) throw new Error('CONTROL_TOOL_ERROR');
    phases.push('tool-completed');
    return { ok: true, phases };
  } finally {
    await client.close();
  }
}

// Mirrors the pinned suite's runMRTRClient: fulfill input_required and retry with
// a fresh JSON-RPC id while keeping requestState scoped to that logical request.
function assertCompleted(result) {
  if (result === null) throw new Error('CONTROL_RESULT_INVALID');
  if (typeof result !== 'object') throw new Error('CONTROL_RESULT_INVALID');
  if (Array.isArray(result)) throw new Error('CONTROL_RESULT_INVALID');
  if (result?.resultType === 'input_required') throw new Error('CONTROL_CONTINUATION_INCOMPLETE');
  if (result?.isError === true) throw new Error('CONTROL_CONTINUATION_TOOL_ERROR');
  if (result.resultType === undefined) return;
  if (result.resultType !== 'complete') throw new Error('CONTROL_RESULT_INVALID');
}

export async function runRequestStateControl(endpoint) {
  const url = loopbackUrl(endpoint);
  let id = 0;
  const rpc = async (method, params) => {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': method,
        ...(params?.name ? { 'Mcp-Name': params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++id,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'direct-client-control', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': { elicitation: {} },
          },
        },
      }),
    });
    if (!response.ok) throw new Error('CONTROL_RPC_REJECTED');
    const result = await response.json();
    if (result.error) throw new Error('CONTROL_RPC_REJECTED');
    return result.result;
  };
  const listed = await rpc('tools/list');
  const call = (name, extra = {}) => {
    const resolved = listed.tools.find((tool) => tool.name === name || tool.name.endsWith(`_1mcp_${name}`))?.name;
    if (!resolved) throw new Error('CONTROL_TOOL_MISSING');
    return rpc('tools/call', { name: resolved, arguments: {}, ...extra });
  };
  for (const name of ['test_mrtr_echo_state', 'test_mrtr_no_state']) {
    const result = await call(name);
    if (result?.resultType !== 'input_required') throw new Error('CONTROL_INPUT_REQUIRED_MISSING');
    const inputResponses = {};
    for (const [key, request] of Object.entries(result.inputRequests)) {
      if (request.method !== 'elicitation/create') throw new Error('CONTROL_INPUT_METHOD_UNSUPPORTED');
      inputResponses[key] = { action: 'accept', content: { confirmed: true } };
    }
    if (name === 'test_mrtr_echo_state') assertCompleted(await call('test_mrtr_unrelated'));
    const continued = await call(name, {
      inputResponses,
      ...(result.requestState !== undefined ? { requestState: result.requestState } : {}),
    });
    assertCompleted(continued);
  }
  assertCompleted(await call('test_mrtr_no_result_type'));
  return {
    ok: true,
    phases: ['input-required', 'unrelated-isolated', 'fresh-id-retry', 'no-state-omitted', 'default-complete'],
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runClientControl(process.argv[2], process.env.MCP_CONFORMANCE_SCENARIO).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    () => {
      process.stderr.write('{"ok":false,"classification":"direct-control-rejected"}\n');
      process.exitCode = 1;
    },
  );
}

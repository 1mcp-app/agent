#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { PROFILES, TOOL_INPUT_SENTINEL, TOOL_NAME } from './constants.mjs';
import { createV1Client, createV1ClientTransport, serveV1Http, serveV1Stdio } from './eras/v1.mjs';
import { createV2Client, createV2ClientTransport, serveV2Http, serveV2Stdio } from './eras/v2.mjs';
import { selfCheck } from './self-check.mjs';

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function parseCli() {
  return parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      'self-check': { type: 'boolean' },
      'sdk-era': { type: 'string' },
      'protocol-era': { type: 'string' },
      transport: { type: 'string' },
      endpoint: { type: 'string' },
      command: { type: 'string' },
      arg: { type: 'string', multiple: true },
      aggregated: { type: 'boolean' },
      'runtime-output': { type: 'boolean' },
    },
  });
}

function requireChoice(value, choices) {
  if (!choices.includes(value)) throw new Error('INVALID_ARGUMENTS');
  return value;
}

function requireLoopbackEndpoint(value) {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    !['127.0.0.1', '::1', 'localhost'].includes(endpoint.hostname)
  ) {
    throw new Error('INVALID_ARGUMENTS');
  }
  return endpoint.href;
}

async function runServer(values) {
  const sdkEra = requireChoice(values['sdk-era'], ['v1', 'v2']);
  const transport = requireChoice(values.transport, PROFILES[sdkEra]);
  const serveStdio = sdkEra === 'v1' ? serveV1Stdio : serveV2Stdio;
  const serveHttp = sdkEra === 'v1' ? serveV1Http : serveV2Http;
  const close = transport === 'stdio' ? await serveStdio() : await serveHttp(transport);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await (typeof close === 'function' ? close() : close.close());
  };
  process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  if (transport !== 'stdio') {
    writeJson(process.stdout, {
      kind: 'ready',
      fixtureId: `typescript-${sdkEra}`,
      ready: true,
      sdkEra,
      transport,
      host: '127.0.0.1',
      port: close.port,
      endpoint: `http://127.0.0.1:${close.port}/mcp`,
    });
  }
}

function structuralToolResult(result) {
  const content = Array.isArray(result.content) ? result.content : [];
  return {
    contentTypes: [...new Set(content.map((item) => item?.type).filter((type) => typeof type === 'string'))].sort(),
    isError: result.isError === true,
  };
}

async function runProbe(values) {
  const sdkEra = requireChoice(values['sdk-era'], ['v1', 'v2']);
  const protocolEra = requireChoice(values['protocol-era'], ['legacy', 'modern']);
  const transport = requireChoice(values.transport, PROFILES[sdkEra]);
  if (sdkEra === 'v1' && protocolEra !== 'legacy') throw new Error('UNSUPPORTED_PROFILE');
  if (transport === 'stdio' && typeof values.command !== 'string') throw new Error('INVALID_ARGUMENTS');
  if (transport !== 'stdio' && typeof values.endpoint !== 'string') throw new Error('INVALID_ARGUMENTS');
  const endpoint = transport === 'stdio' ? undefined : requireLoopbackEndpoint(values.endpoint);

  const client = sdkEra === 'v1' ? createV1Client() : createV2Client(protocolEra);
  const createTransport = sdkEra === 'v1' ? createV1ClientTransport : createV2ClientTransport;
  const clientTransport = createTransport(transport, {
    command: values.command,
    args: values.arg ?? [],
    endpoint,
  });

  try {
    await client.connect(clientTransport);
    const unsupported = [];
    let initialized = true;
    let ping = true;
    if (protocolEra === 'modern') {
      initialized = false;
      unsupported.push({ operation: 'initialize', reason: 'modern-uses-server-discover' });
    }
    try {
      await client.ping();
    } catch (error) {
      if (protocolEra !== 'modern' || error?.code !== 'METHOD_NOT_SUPPORTED_BY_PROTOCOL_VERSION') throw error;
      ping = false;
      unsupported.push({ operation: 'ping', reason: 'not-in-2026-07-28' });
    }
    const listed = await client.listTools();
    const toolName = values.aggregated
      ? listed.tools.find((tool) => tool.name === TOOL_NAME || tool.name.endsWith(`_1mcp_${TOOL_NAME}`))?.name
      : TOOL_NAME;
    if (!toolName) throw new Error('AGGREGATED_TOOL_NOT_FOUND');
    const called = await client.callTool({
      name: toolName,
      arguments: { marker: TOOL_INPUT_SENTINEL },
    });
    if (values['runtime-output']) {
      const negotiatedRevision = protocolEra === 'modern' ? '2026-07-28' : '2025-11-25';
      if (unsupported.length > 0) {
        writeJson(process.stdout, {
          fixtureId: `typescript-${sdkEra}`,
          transport,
          status: 'unsupported',
          unsupportedOperation: unsupported[0].operation,
          negotiatedRevision,
          operations: ['server/discover', 'tools/list', 'tools/call'],
        });
      } else {
        writeJson(process.stdout, {
          fixtureId: `typescript-${sdkEra}`,
          transport,
          initialized,
          ping,
          negotiatedRevision,
          operations: ['initialize', 'ping', 'tools/list', 'tools/call'],
          toolsCount: listed.tools.length,
          callError: called.isError === true,
        });
      }
      return;
    }
    writeJson(process.stdout, {
      kind: 'probe',
      ok: unsupported.length === 0,
      ...(unsupported.length > 0 ? { classification: 'unsupported-operation', unsupported } : {}),
      sdkEra,
      protocolEra,
      transport,
      operations: {
        initialize: initialized,
        ping,
        toolsList: {
          count: listed.tools.length,
          fixtureTool: listed.tools.some((tool) => tool.name === TOOL_NAME),
        },
        toolsCall: structuralToolResult(called),
      },
    });
  } finally {
    await client.close();
  }
}

async function runOfficialConformanceClient(endpoint) {
  const scenario = process.env.MCP_CONFORMANCE_SCENARIO;
  const protocolVersion = process.env.MCP_CONFORMANCE_PROTOCOL_VERSION;
  const supportedScenarios = ['initialize', 'request-metadata', 'tools_call'];
  const legacyVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];
  const modern = protocolVersion === '2026-07-28';
  if (!supportedScenarios.includes(scenario)) {
    writeJson(process.stderr, {
      kind: 'conformance-client',
      ok: false,
      classification: 'unsupported-scenario',
    });
    process.exitCode = 2;
    return;
  }
  if ((!modern && !legacyVersions.includes(protocolVersion)) || (scenario === 'initialize' && modern)) {
    writeJson(process.stderr, {
      kind: 'conformance-client',
      ok: false,
      classification: 'unsupported-protocol-profile',
    });
    process.exitCode = 2;
    return;
  }
  if (process.env.MCP_CONFORMANCE_CONTEXT !== undefined) {
    const context = JSON.parse(process.env.MCP_CONFORMANCE_CONTEXT);
    if (!context || typeof context !== 'object' || Array.isArray(context)) throw new Error('INVALID_CONTEXT');
  }
  const serverEndpoint = requireLoopbackEndpoint(endpoint);

  const client = modern ? createV2Client('modern', { roots: {}, sampling: {}, elicitation: {} }) : createV1Client();
  const transport = modern
    ? createV2ClientTransport('streamable-http', { endpoint: serverEndpoint })
    : createV1ClientTransport('streamable-http', { endpoint: serverEndpoint });
  try {
    await client.connect(transport);
    if (scenario === 'tools_call') {
      const listed = await client.listTools();
      if (!listed.tools.some((tool) => tool.name === 'add_numbers')) throw new Error('REQUIRED_TOOL_MISSING');
      await client.callTool({ name: 'add_numbers', arguments: { a: 20, b: 22 } });
    } else if (scenario === 'request-metadata') {
      await client.listTools();
    }
  } finally {
    await client.close();
  }
}

async function main() {
  const { values, positionals } = parseCli();
  if (values['self-check']) {
    const result = await selfCheck();
    writeJson(process.stdout, result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const command = positionals[0];
  if (command === 'server') return runServer(values);
  if (command === 'probe') {
    if (!values['runtime-output']) return runProbe(values);
    try {
      return await runProbe(values);
    } catch {
      writeJson(process.stdout, {
        fixtureId: values['sdk-era'] === 'v2' ? 'typescript-v2' : 'typescript-v1',
        errorCode: 'gateway-probe-rejected',
      });
      process.exitCode = 1;
      return;
    }
  }
  if (positionals.length === 1 && process.env.MCP_CONFORMANCE_SCENARIO !== undefined) {
    return runOfficialConformanceClient(command);
  }
  throw new Error('INVALID_ARGUMENTS');
}

main().catch((error) => {
  const code = ['INVALID_ARGUMENTS', 'UNSUPPORTED_PROFILE'].includes(error?.message)
    ? error.message
    : 'FIXTURE_RUNTIME_ERROR';
  writeJson(process.stderr, { kind: 'error', code });
  process.exitCode = 1;
});

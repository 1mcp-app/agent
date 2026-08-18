export function localRuntimePidFile(configDir: string) {
  return {
    pid: process.pid,
    url: 'http://localhost:3050/mcp',
    port: 3050,
    host: 'localhost',
    transport: 'http' as const,
    startedAt: '2026-08-18T00:00:00.000Z',
    configDir,
  };
}

export function runtimeIdentityResponse(input: {
  runtimeScopeId: string;
  externalUrl: string;
  runtimeVersion?: string;
}): Response {
  return new Response(
    JSON.stringify({
      identityProtocolVersion: '1',
      runtimeScopeId: input.runtimeScopeId,
      externalUrl: input.externalUrl,
      runtimeVersion: input.runtimeVersion ?? '0.35.0-beta.4',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

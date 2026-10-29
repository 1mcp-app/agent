export function createTestProcessEnvironment(
  overrides?: NodeJS.ProcessEnv,
  base?: NodeJS.ProcessEnv,
): Record<string, string> & {
  ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED: string;
  ONE_MCP_PROJECT_OWNER: string;
  CODEX_SESSION_ID: string;
  CODEX_THREAD_ID: string;
};
export function isolatedTestEnvironment(base?: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; cleanup: () => void };

export function getTestBrowserCachePath(base: NodeJS.ProcessEnv, platform?: NodeJS.Platform, cwd?: string): string;

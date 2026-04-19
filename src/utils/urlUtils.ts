export function stripMcpSuffix(url: string): string {
  return url.replace(/\/mcp$/, '');
}

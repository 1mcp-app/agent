import { writeFile } from 'node:fs';

export const PRODUCT_NOTICE =
  '1MCP collects aggregate product usage with a random local installation ID. No prompts, payloads, paths or credentials. Disable: 1mcp telemetry disable. Details: https://docs.1mcp.app/commands/telemetry\n';

export function writeProductNotice(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    writeFile(process.stderr.fd, PRODUCT_NOTICE, { encoding: 'utf8', mode: 0o600 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

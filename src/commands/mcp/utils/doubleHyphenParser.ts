/**
 * Utility for parsing " -- " style arguments in MCP commands
 *
 * Handles the pattern: mcp add server-name --env KEY=value -- npx -y package-name
 * Where everything after " -- " becomes the command and its arguments
 */

export interface DoubleHyphenParseResult {
  command?: string;
  args?: string[];
  type?: string;
}

/**
 * Parse command line arguments that use the " -- " pattern
 * @param rawArgs Raw command line arguments from yargs
 * @returns Parsed command, args, and inferred type
 */
export function parseDoubleHyphenArgs(rawArgs: string[]): DoubleHyphenParseResult {
  const doubleHyphenIndex = rawArgs.findIndex((arg) => arg === '--');

  if (doubleHyphenIndex === -1) {
    // No " -- " found, return empty result
    return {};
  }

  // Extract everything after " -- "
  const commandArgs = rawArgs.slice(doubleHyphenIndex + 1);

  if (commandArgs.length === 0) {
    throw new Error('No command specified after " -- "');
  }

  const [command, ...args] = commandArgs;

  // For stdio servers, we infer the type as 'stdio' since they use executable commands
  const type = 'stdio';

  return {
    command,
    args: args.length > 0 ? args : undefined,
    type,
  };
}

/**
 * Check if the command line arguments contain the " -- " pattern
 * @param rawArgs Raw command line arguments
 * @returns True if " -- " is present
 */
export function hasDoubleHyphen(rawArgs: string[]): boolean {
  return rawArgs.includes('--');
}

/**
 * Merge double hyphen parsed arguments with existing yargs arguments
 * Prioritizes explicit flags over " -- " inferred values
 * @param yargsArgs Parsed arguments from yargs
 * @param doubleHyphenResult Parsed " -- " arguments
 * @returns Merged arguments
 */
export function mergeDoubleHyphenArgs<T extends Record<string, unknown>>(
  yargsArgs: T,
  doubleHyphenResult: DoubleHyphenParseResult,
): T {
  const merged = { ...yargsArgs } as T & { type?: string; command?: string; args?: string[] };

  // Only set values if they're not already explicitly provided
  if (!merged.type && doubleHyphenResult.type) {
    merged.type = doubleHyphenResult.type;
  }

  if (!merged.command && doubleHyphenResult.command) {
    merged.command = doubleHyphenResult.command;
  }

  if (!merged.args && doubleHyphenResult.args) {
    merged.args = doubleHyphenResult.args;
  }

  return merged as T;
}

export const ORIGINAL_TOOLKIT_DIGEST: string;
export function digest(bytes: string | Buffer): string;
export function repairToolkit(source: string): { source: string; repairs: { id: string; replacements: number }[] };
export function prepareToolkitRepairs(packageRoot: string, outputDirectory: string): Promise<string>;

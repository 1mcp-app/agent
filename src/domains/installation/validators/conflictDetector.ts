/**
 * Server name conflict detection and resolution
 */

export type ConflictResolution = 'rename' | 'override' | 'cancel';

export interface ConflictResult {
  hasConflict: boolean;
  conflictingName?: string;
}

/**
 * Check if a server name conflicts with existing servers
 */
export function checkNameConflict(name: string, existingNames: string[]): ConflictResult {
  const hasConflict = existingNames.includes(name);
  return {
    hasConflict,
    conflictingName: hasConflict ? name : undefined,
  };
}

/**
 * Generate alternative name suggestions when there's a conflict
 */
export function generateAlternativeNames(baseName: string, existingNames: string[], count: number = 3): string[] {
  const alternatives: string[] = [];
  let counter = 1;

  while (alternatives.length < count) {
    const candidate = `${baseName}_${counter}`;
    if (!existingNames.includes(candidate)) {
      alternatives.push(candidate);
    }
    counter++;
  }

  return alternatives;
}

/**
 * Validate that a proposed name doesn't conflict
 */
export function validateNoConflict(name: string, existingNames: string[]): { valid: boolean; error?: string } {
  if (existingNames.includes(name)) {
    return {
      valid: false,
      error: `Server '${name}' already exists. Choose a different name or use override option.`,
    };
  }
  return { valid: true };
}

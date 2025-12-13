/**
 * Schema utility functions for internal tools
 */
import { z } from 'zod';

/**
 * Wrapper for z.toJSONSchema optimized for MCP internal tool input schemas
 *
 * Features:
 * - Uses JSON Schema Draft 7 for better Ajv compatibility
 * - Converts input schemas (what tools receive from users)
 * - Handles unrepresentable types gracefully
 * - Removes $schema property for cleaner schema output
 */
export function zodToInputSchema(zodSchema: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(zodSchema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
  });

  // Remove $schema property if present
  const { $schema: _, ...cleanSchema } = schema as Record<string, unknown>;
  return cleanSchema;
}

/**
 * Wrapper for z.toJSONSchema optimized for MCP internal tool output schemas
 *
 * Features:
 * - Uses JSON Schema Draft 7 for better Ajv compatibility
 * - Converts output schemas (what tools return to users)
 * - Handles unrepresentable types gracefully
 * - Removes $schema property for cleaner schema output
 */
export function zodToOutputSchema(zodSchema: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(zodSchema, {
    target: 'draft-7',
    io: 'output',
    unrepresentable: 'any',
  });

  // Remove $schema property if present
  const { $schema: _, ...cleanSchema } = schema as Record<string, unknown>;
  return cleanSchema;
}

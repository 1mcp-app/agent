import { z } from 'zod';

/**
 * Shared Zod schemas for meta-tool inputs and outputs
 * Used by both lazyTools.ts and metaToolProvider.ts
 */

/**
 * Input schemas
 */

export const ToolListInputSchema = z.object({
  server: z.string().optional(),
  pattern: z.string().optional(),
  tag: z.string().optional(),
  limit: z.number().optional(),
});

export const ToolSchemaInputSchema = z.object({
  server: z.string(),
  toolName: z.string(),
});

export const ToolInvokeInputSchema = z.object({
  server: z.string(),
  toolName: z.string(),
  args: z.object({}).loose(),
});

/**
 * Output schemas
 */

export const ToolMetadataSchema = z.object({
  name: z.string(),
  server: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
});

export const ToolListOutputSchema = z.object({
  tools: z.array(ToolMetadataSchema),
  totalCount: z.number(),
  servers: z.array(z.string()),
  hasMore: z.boolean(),
  nextCursor: z.string().optional(),
  error: z
    .object({
      type: z.enum(['validation', 'upstream', 'not_found', 'internal']),
      message: z.string(),
    })
    .optional(),
});

export const ToolSchemaOutputSchema = z.object({
  schema: z.object({}).loose(),
  fromCache: z.boolean().optional(),
  error: z
    .object({
      type: z.enum(['validation', 'upstream', 'not_found', 'internal']),
      message: z.string(),
    })
    .optional(),
});

export const ToolInvokeOutputSchema = z.object({
  result: z.object({}).loose(),
  server: z.string(),
  tool: z.string(),
  error: z
    .object({
      type: z.enum(['validation', 'upstream', 'not_found', 'internal']),
      message: z.string(),
    })
    .optional(),
});

/**
 * Type exports
 */

export type ToolListInput = z.infer<typeof ToolListInputSchema>;
export type ToolSchemaInput = z.infer<typeof ToolSchemaInputSchema>;
export type ToolInvokeInput = z.infer<typeof ToolInvokeInputSchema>;
export type ToolMetadata = z.infer<typeof ToolMetadataSchema>;
export type ToolListOutput = z.infer<typeof ToolListOutputSchema>;
export type ToolSchemaOutput = z.infer<typeof ToolSchemaOutputSchema>;
export type ToolInvokeOutput = z.infer<typeof ToolInvokeOutputSchema>;

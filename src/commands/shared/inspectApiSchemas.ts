import { CLIENT_SERVER_STATUSES } from '@src/types/serverStatus.js';

import { z } from 'zod';

export const clientServerStatusSchema = z.enum(CLIENT_SERVER_STATUSES);

export const inspectServerSummarySchema = z
  .object({
    server: z.string(),
    type: z.string(),
    status: clientServerStatusSchema,
    available: z.boolean(),
    loadTracked: z.boolean(),
  })
  .passthrough();

export const inspectServersResultSchema = z
  .object({
    kind: z.literal('servers'),
    servers: z.array(inspectServerSummarySchema),
  })
  .passthrough();

export const inspectServerResultSchema = z
  .object({
    kind: z.literal('server'),
    server: z.string(),
    status: clientServerStatusSchema,
    available: z.boolean(),
    authorizationUrl: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const inspectToolResultSchema = z
  .object({
    kind: z.literal('tool'),
    server: z.string(),
    tool: z.string(),
    qualifiedName: z.string(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type InspectServerSummary = z.infer<typeof inspectServerSummarySchema>;
export type ApiInspectServerResult = z.infer<typeof inspectServerResultSchema>;

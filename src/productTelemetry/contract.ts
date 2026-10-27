// Wire v1, paired with 1mcp-app/telemetry at 034b40fbf644e7a10df009c6554721b54318c9a6.
import { z } from 'zod';

export const MAX_BODY = 65_536;
export const DAY = 86_400_000;
export const labels = {
  command: [
    'serve',
    'proxy',
    'mcp',
    'template',
    'preset',
    'config',
    'auth',
    'project',
    'instructions',
    'inspect',
    'run',
    'wait',
    'doctor',
    'telemetry',
    'help',
    'version',
    'other',
  ],
  feature: [
    'admin_open',
    'server_add',
    'server_update',
    'server_remove',
    'server_enable',
    'server_disable',
    'preset_update',
    'template_update',
    'config_update',
    'runtime_start',
  ],
  operation: [
    'tools_list',
    'tools_call',
    'resources_list',
    'resources_read',
    'prompts_list',
    'prompts_get',
    'completion',
    'initialize',
    'other',
  ],
  configuration: ['servers', 'tools'],
} as const;
const counter = z
  .strictObject({
    kind: z.enum(['command', 'feature', 'operation', 'configuration']),
    name: z.string().max(32),
    outcome: z.enum(['success', 'failure', 'observation']),
    transport: z.enum(['none', 'stdio', 'http', 'sse']),
    client: z.enum(['none', 'claude', 'codex', 'cursor', 'vscode', 'other']),
    bucket: z.enum(['none', '0', '1', '2-5', '6-20', '21-100', '101+']),
    count: z.number().int().min(1).max(1_000_000),
  })
  .superRefine((c, ctx) => {
    const allowed: readonly string[] = labels[c.kind];
    if (!allowed.includes(c.name)) ctx.addIssue({ code: 'custom', message: 'Unknown label' });
    if (c.kind === 'configuration') {
      if (c.outcome !== 'observation' || c.bucket === 'none')
        ctx.addIssue({ code: 'custom', message: 'Invalid observation' });
    } else if (c.bucket !== 'none' || c.outcome === 'observation')
      ctx.addIssue({ code: 'custom', message: 'Invalid outcome' });
    if (c.kind !== 'operation' && (c.transport !== 'none' || c.client !== 'none'))
      ctx.addIssue({ code: 'custom', message: 'Invalid operation dimensions' });
  });
export const summarySchema = z.strictObject({
  installation_id: z.uuid(),
  occurred_at: z.iso.datetime({ precision: 0 }),
  version: z
    .string()
    .max(40)
    .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-(?:alpha|beta|rc)\.\d{1,4})?$/),
  os: z.enum(['linux', 'darwin', 'win32', 'freebsd', 'other']),
  arch: z.enum(['x64', 'arm64', 'arm', 'ia32', 'other']),
  node_major: z.number().int().min(18).max(99),
  ci: z.boolean(),
  counters: z.array(counter).min(1).max(16),
});
export const envelopeSchema = z.strictObject({
  schema_version: z.literal(1),
  batch_id: z.uuid(),
  summaries: z.array(summarySchema).min(1).max(100),
});
export type Summary = z.infer<typeof summarySchema>;
export type Envelope = z.infer<typeof envelopeSchema>;
export function parseEnvelope(value: unknown, now = Date.now()): Envelope {
  const parsed = envelopeSchema.parse(value);
  for (const s of parsed.summaries) {
    const age = now - Date.parse(s.occurred_at);
    if (age > 7 * DAY || age < -300_000) throw new Error('Invalid activity time');
  }
  return parsed;
}
export function dayOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

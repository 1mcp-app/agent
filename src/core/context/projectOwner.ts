import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { TemplateContextCapability } from './templateContextTrust.js';

export const projectOwnerCredentialSchema = z
  .object({
    version: z.literal(1),
    runtimeScopeId: z.string().min(1),
    ownerId: z.string().uuid(),
    role: z.enum(['owner', 'operator']),
    signature: z.string().max(128),
  })
  .strict();
export type ProjectOwnerCredential = z.infer<typeof projectOwnerCredentialSchema>;
function signature(
  credential: Omit<ProjectOwnerCredential, 'signature'>,
  capability: TemplateContextCapability,
): string {
  return createHmac('sha256', Buffer.from(capability.secret, 'base64url'))
    .update(JSON.stringify(['1mcp-project-owner-v1', credential.runtimeScopeId, credential.ownerId, credential.role]))
    .digest('base64url');
}
export function createProjectOwnerCredential(
  capability: TemplateContextCapability,
  ownerId: string = randomUUID(),
  role: ProjectOwnerCredential['role'] = 'owner',
): ProjectOwnerCredential {
  const unsigned = { version: 1 as const, runtimeScopeId: capability.runtimeScopeId, ownerId, role };
  return projectOwnerCredentialSchema.parse({ ...unsigned, signature: signature(unsigned, capability) });
}
export function verifyProjectOwnerCredential(
  value: unknown,
  capability: TemplateContextCapability,
): ProjectOwnerCredential | undefined {
  const parsed = projectOwnerCredentialSchema.safeParse(value);
  if (!parsed.success) return undefined;
  if (parsed.data.runtimeScopeId !== capability.runtimeScopeId) return undefined;
  const expected = Buffer.from(signature(parsed.data, capability));
  const actual = Buffer.from(parsed.data.signature);
  if (actual.length !== expected.length) return undefined;
  return timingSafeEqual(actual, expected) ? parsed.data : undefined;
}

import { HandlebarsTemplateRenderer } from '@src/template/handlebarsTemplateRenderer.js';
import { redactContextForAudit } from '@src/transport/http/utils/templateContextAuthority.js';

import { describe, expect, it } from 'vitest';

import { createProjectOwnerCredential, verifyProjectOwnerCredential } from './projectOwner.js';

const capability = {
  version: 1 as const,
  runtimeScopeId: 'runtime-a',
  secret: Buffer.alloc(32, 7).toString('base64url'),
};
describe('Project owner credentials', () => {
  it('redacts credentials and excludes them from backend template rendering', () => {
    const owner = createProjectOwnerCredential(capability);
    const context = { project: {}, user: {}, environment: {}, owner };
    expect(redactContextForAudit(context).owner).toBe('[REDACTED]');
    expect(
      new HandlebarsTemplateRenderer().renderTemplate({ command: 'echo', args: ['{{owner.signature}}'] }, context).args,
    ).toEqual(['']);
  });
  it('retains one independent owner across sessions and rejects forged roles and runtimes', () => {
    const owner = createProjectOwnerCredential(capability);
    expect(verifyProjectOwnerCredential(owner, capability)).toEqual(owner);
    expect(createProjectOwnerCredential(capability).ownerId).not.toBe(owner.ownerId);
    expect(verifyProjectOwnerCredential({ ...owner, role: 'operator' }, capability)).toBeUndefined();
    expect(verifyProjectOwnerCredential(owner, { ...capability, runtimeScopeId: 'runtime-b' })).toBeUndefined();
    expect(verifyProjectOwnerCredential(undefined, capability)).toBeUndefined();
  });
});

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { createCloudflareAccessTokenVerifier, parseCloudflareAccessGroupTagMap } from './cloudflareAccessJwt.js';

const issuer = 'https://lekthailtd.cloudflareaccess.com';
const audience = 'test-app-audience';

async function setupVerifier() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  const keySet = createLocalJWKSet({ keys: [jwk] });
  const verifier = createCloudflareAccessTokenVerifier(
    {
      issuer,
      audience,
      groupTagMap: { 'Offload Operators': ['agent-offload', 'engineering'], Admins: ['admin'] },
    },
    keySet,
  );
  return { privateKey, verifier };
}

async function token(
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'],
  claims: Record<string, unknown> = {},
) {
  return new SignJWT({ type: 'app', custom: { groups: ['Offload Operators'] }, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('user-123')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('Cloudflare Access JWT verification', () => {
  it('maps only configured custom group claims to 1MCP tag scopes', async () => {
    const { privateKey, verifier } = await setupVerifier();
    const assertion = await token(privateKey, { email: 'user@example.com' });

    await expect(verifier(assertion)).resolves.toMatchObject({
      subject: 'user-123',
      email: 'user@example.com',
      scopes: ['tag:agent-offload', 'tag:engineering'],
    });
  });

  it('grants no tags when group claims are absent or unmapped', async () => {
    const { privateKey, verifier } = await setupVerifier();
    const absent = await token(privateKey, { custom: {} });
    const unknown = await token(privateKey, { custom: { groups: ['Unmapped Group', 'toString', '__proto__'] } });

    await expect(verifier(absent)).resolves.toMatchObject({ scopes: [] });
    await expect(verifier(unknown)).resolves.toMatchObject({ scopes: [] });
  });

  it('rejects wrong issuer, audience, token type, expired tokens, and invalid signatures', async () => {
    const { privateKey, verifier } = await setupVerifier();
    const wrongIssuer = await new SignJWT({ type: 'app' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://attacker.cloudflareaccess.com')
      .setAudience(audience)
      .setSubject('user-123')
      .setExpirationTime('5m')
      .sign(privateKey);
    const wrongAudience = await new SignJWT({ type: 'app' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience('another-app')
      .setSubject('user-123')
      .setExpirationTime('5m')
      .sign(privateKey);
    const wrongType = await token(privateKey, { type: 'service' });
    const expired = await new SignJWT({ type: 'app' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('user-123')
      .setExpirationTime('0s')
      .sign(privateKey);
    const { privateKey: otherPrivateKey } = await generateKeyPair('RS256');
    const invalidSignature = await token(otherPrivateKey);

    for (const assertion of [wrongIssuer, wrongAudience, wrongType, expired, invalidSignature]) {
      await expect(verifier(assertion)).rejects.toThrow();
    }
  });

  it('validates team issuer shape and group-to-tag configuration', () => {
    expect(() =>
      createCloudflareAccessTokenVerifier({ issuer: 'http://example.com', audience, groupTagMap: {} }),
    ).toThrow(/issuer/iu);
    expect(() => parseCloudflareAccessGroupTagMap('{bad json')).toThrow(/valid JSON/iu);
    expect(() => parseCloudflareAccessGroupTagMap('{"Operators":["bad tag"]}')).toThrow(/invalid 1MCP tag/iu);
    expect(parseCloudflareAccessGroupTagMap('{"Operators":["agent-offload","agent-offload"]}')).toEqual({
      Operators: ['agent-offload'],
    });
  });
});

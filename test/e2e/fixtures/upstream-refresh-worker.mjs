import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [artifact, resource, era] = process.argv.slice(2);
const { createTransports } = await import(
  pathToFileURL(path.join(artifact, 'build/sdk/legacy/transport/transportFactory.js'))
);
const { authorizeUpstream } = await import(
  pathToFileURL(path.join(artifact, 'build/sdk/legacy/auth/coordinatedOAuth.js'))
);
const { ClientFactory } = await import(
  pathToFileURL(path.join(artifact, 'build/sdk/legacy/client/runtime/clientFactory.js'))
);
const legacy = era === 'legacy';
const config = {
  upstream: { type: 'http', url: resource, protocolVersion: legacy ? 'legacy' : 'auto', oauth: { scopes: ['read'] } },
};
const first = createTransports(config).upstream;
const provider = first.oauthProvider;
let second;
const clients = [];
try {
  assert.equal(await authorizeUpstream(provider, legacy, { serverUrl: resource }), 'REDIRECT');
  const redirect = new URL(provider.getAuthorizationUrl());
  const callback = new URLSearchParams({
    state: redirect.searchParams.get('state'),
    code: 'fixture-code',
    iss: new URL(resource).origin,
  });
  await provider.withAuthorizationCallback(callback, () => first.finishAuth(legacy ? callback.get('code') : callback));
  second = createTransports(config).upstream;
  await second.oauthProvider.authorize(async () => 'AUTHORIZED');
  const factory = new ClientFactory();
  clients.push(factory.createClient(first), factory.createClient(second));
  await Promise.all(clients.map((client, index) => client.connect(index === 0 ? first : second)));
  assert.equal(provider.tokens().refresh_token, 'rotated');
  assert.equal(second.oauthProvider.tokens().access_token, 'winner');
  console.log('RESULT ' + JSON.stringify({ era, refreshed: true }));
} finally {
  await Promise.allSettled([
    ...clients.map((client) => client.close()),
    first.close(),
    second?.close(),
    provider.shutdown(),
    second?.oauthProvider.shutdown(),
  ]);
}

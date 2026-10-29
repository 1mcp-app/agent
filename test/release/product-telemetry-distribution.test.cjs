const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('distribution evidence rejects changed bytes and unsupported contract versions', async () => {
  const { artifactRecord, verifyArtifacts } = await import('../../scripts/product-telemetry-artifacts.mjs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'telemetry-manifest-'));
  try {
    const file = path.join(directory, 'producer.js');
    await writeFile(file, 'packaged production bytes');
    const manifest = { schemaVersion: 1, artifacts: [await artifactRecord('installed-producer', file)] };
    await verifyArtifacts(manifest);
    await assert.rejects(verifyArtifacts({ ...manifest, schemaVersion: 2 }), /Unsupported/);
    await writeFile(file, 'changed after acceptance');
    await assert.rejects(verifyArtifacts(manifest), /Artifact changed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SEA proxy compatibility modules load in an isolated eval worker without package resolution', async () => {
  const { Worker } = require('node:worker_threads');
  const { once } = require('node:events');
  const { buildProductProxyModule } = require('../../scripts/product-telemetry-proxy.cjs');
  const asset = buildProductProxyModule();
  assert.ok(asset.startsWith('data:text/javascript;base64,'));
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData).then(({ getProxyForUrl, HttpsProxyAgent }) => {
      const agent = new HttpsProxyAgent('http://127.0.0.1:1234');
      parentPort.postMessage([typeof getProxyForUrl, typeof agent.addRequest]);
      agent.destroy();
    }).catch(error => { throw error; });
  `,
    { eval: true, workerData: asset, env: { ...process.env, DEBUG: '', NODE_DEBUG: '' } },
  );
  try {
    const [result] = await once(worker, 'message');
    assert.deepEqual(result, ['function', 'function']);
  } finally {
    await worker.terminate();
  }
});

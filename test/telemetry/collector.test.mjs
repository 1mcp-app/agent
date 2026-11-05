import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

import { test } from 'node:test';

import { createCollector } from './fake-collector.mjs';

test('Collector captures protobuf, decodes gzip, and recovers after an outage', async () => {
  const collector = await createCollector();
  try {
    collector.respond({ status: 503 });
    const body = Buffer.from([10, 3, 97, 98, 99]);
    assert.equal((await fetch(`${collector.url}/v1/traces`, { method: 'POST', body })).status, 503);
    collector.respond({ status: 200 });
    assert.equal(
      (
        await fetch(`${collector.url}/v1/metrics`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-protobuf',
            'content-encoding': 'gzip',
          },
          body: gzipSync(body),
        })
      ).status,
      200,
    );
    assert.equal(collector.requests.length, 2);
    assert.deepEqual(collector.requests[1].body, body);
  } finally {
    await collector.close();
  }
});

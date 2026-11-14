import { HTTP_REQUEST_BODY_LIMIT } from '@src/constants.js';

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createBodyParserMiddlewares } from './server.js';

function appWithLimit(limit: number | string) {
  const app = express();
  app.use(...createBodyParserMiddlewares(limit));
  app.post('/echo', (req, res) => {
    res.status(200).json({ size: JSON.stringify(req.body ?? {}).length });
  });
  app.use(
    (
      error: Error & { status?: number; type?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.status ?? 500).json({ type: error.type ?? error.name });
    },
  );
  return app;
}

const payloadOfBytes = (bytes: number) => ({ data: 'x'.repeat(bytes) });

describe('inbound HTTP body parsers', () => {
  it('accepts a JSON payload under the default limit', async () => {
    const response = await request(appWithLimit(HTTP_REQUEST_BODY_LIMIT)).post('/echo').send(payloadOfBytes(1_000));

    expect(response.status).toBe(200);
  });

  it('rejects a JSON payload over the default limit with 413', async () => {
    const response = await request(appWithLimit(HTTP_REQUEST_BODY_LIMIT)).post('/echo').send(payloadOfBytes(200_000));

    expect(response.status).toBe(413);
    expect(response.body.type).toBe('entity.too.large');
  });

  it('accepts a payload over the default limit once the limit is raised', async () => {
    const response = await request(appWithLimit('25mb')).post('/echo').send(payloadOfBytes(200_000));

    expect(response.status).toBe(200);
  });

  it('honors a byte-count limit passed as a number', async () => {
    const response = await request(appWithLimit(10)).post('/echo').send(payloadOfBytes(200));

    expect(response.status).toBe(413);
  });

  it('applies the same limit to urlencoded bodies', async () => {
    const response = await request(appWithLimit(HTTP_REQUEST_BODY_LIMIT))
      .post('/echo')
      .type('form')
      .send({ data: 'x'.repeat(200_000) });

    expect(response.status).toBe(413);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createSseWireLimitedFetch, SSE_WIRE_LIMIT_BYTES, SseWireLimitError } from './sseWireLimit.js';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

function fixture(chunks: Uint8Array[], limit = 16, contentType = 'text/event-stream') {
  const cancel = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const onerror = vi.fn();
  const delegate = vi.fn().mockImplementation(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
          cancel,
        }),
        { headers: { 'content-type': contentType, 'x-retained': 'header' }, status: 201 },
      ),
  );
  const guarded = createSseWireLimitedFetch(delegate, () => ({ close, onerror }), limit);
  return { guarded, delegate, close, onerror, cancel };
}

async function consume(guarded: typeof fetch): Promise<Uint8Array> {
  return new Uint8Array(await (await guarded('https://example.com')).arrayBuffer());
}

describe('SSE wire bounds before parsing', () => {
  it.each(['\n', '\r', '\r\n'])('preserves valid bytes and event resets with %j', async (newline) => {
    const wire = `data: abc${newline}data:def${newline}${newline}data:  xyz${newline}${newline}`;
    const chunks = Array.from(encode(wire), (byte) => Uint8Array.of(byte));
    const { guarded, close } = fixture(chunks);
    expect(await consume(guarded)).toEqual(encode(wire));
    expect(close).not.toHaveBeenCalled();
  });

  it('preserves response metadata and does not inspect JSON bodies', async () => {
    const f = fixture([encode('x'.repeat(40))], 16, 'application/json');
    const response = await f.guarded('https://example.com');
    expect(response.status).toBe(201);
    expect(response.headers.get('x-retained')).toBe('header');
    expect(await response.text()).toBe('x'.repeat(40));
    expect(f.close).not.toHaveBeenCalled();
  });

  it('preserves SSE response URL, redirect state, and type', async () => {
    const original = new Response('data:ok\n\n', { headers: { 'content-type': 'text/event-stream' } });
    Object.defineProperties(original, {
      url: { value: 'https://upstream.example/redirected' },
      redirected: { value: true },
      type: { value: 'cors' },
    });
    const guarded = createSseWireLimitedFetch(
      async () => original,
      () => ({ close: vi.fn() }),
    );
    const response = await guarded('https://upstream.example');
    expect(response.url).toBe(original.url);
    expect(response.redirected).toBe(true);
    expect(response.type).toBe('cors');
    expect(await response.text()).toBe('data:ok\n\n');
  });

  it('counts initial BOM bytes in raw line bounds without changing field recognition', async () => {
    expect(await consume(fixture([encode('\ufeffdata:12345678')]).guarded)).toEqual(encode('\ufeffdata:12345678'));
    await expect(consume(fixture([encode('\ufeffdata:123456789')]).guarded)).rejects.toBeInstanceOf(SseWireLimitError);
    await expect(consume(fixture([Uint8Array.of(0xef), Uint8Array.of(0xbb)], 1).guarded)).rejects.toBeInstanceOf(
      SseWireLimitError,
    );
  });

  it('accepts exact joined payload bytes, including synthesized LF and one optional space', async () => {
    const wire = 'data: 12345678\ndata:1234567\n\n';
    const f = fixture([encode(wire)]);
    expect(await consume(f.guarded)).toEqual(encode(wire));
  });

  it('rejects joined payload overflow while each line remains within its bound', async () => {
    const f = fixture([encode('data:12345678\ndata:12345678\n\n')]);
    await expect(consume(f.guarded)).rejects.toBeInstanceOf(SseWireLimitError);
  });

  it('counts empty data fields and colonless data fields in joined payload', async () => {
    const valid = 'data:12345678901\ndata:\ndata\ndata\ndata\ndata\n\n';
    expect(await consume(fixture([encode(valid)]).guarded)).toEqual(encode(valid));
    await expect(consume(fixture([encode(valid.replace('\n\n', '\ndata\n\n'))]).guarded)).rejects.toBeInstanceOf(
      SseWireLimitError,
    );
  });

  it.each([':', 'id:', 'other:', 'data:'])('bounds unfinished %j lines including field prefix', async (prefix) => {
    const valid = prefix + 'x'.repeat(16 - prefix.length);
    expect(await consume(fixture([encode(valid)]).guarded)).toEqual(encode(valid));
    const f = fixture([encode(valid), encode('x')]);
    await expect(consume(f.guarded)).rejects.toBeInstanceOf(SseWireLimitError);
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.onerror).toHaveBeenCalledWith(expect.any(SseWireLimitError));
    await expect(f.guarded('https://example.com')).rejects.toBeInstanceOf(SseWireLimitError);
    expect(f.delegate).toHaveBeenCalledOnce();
  });

  it('recognizes a split initial BOM and counts UTF-8 bytes rather than characters', async () => {
    const wire = encode('\ufeffdata:éééé\ndata:éééé\n\n');
    const f = fixture(Array.from(wire, (byte) => Uint8Array.of(byte)));
    await expect(consume(f.guarded)).rejects.toBeInstanceOf(SseWireLimitError);
    expect(await consume(fixture([encode('\ufeffdata:éééé\ndata:ééé\n\n')]).guarded)).toEqual(
      encode('\ufeffdata:éééé\ndata:ééé\n\n'),
    );
  });

  it('accepts an exact 8 MiB joined payload and rejects one additional byte', async () => {
    const half = SSE_WIRE_LIMIT_BYTES / 2;
    const valid = encode(`data:${'x'.repeat(half)}\ndata:${'x'.repeat(half - 1)}\n\n`);
    expect(Buffer.from(await consume(fixture([valid], SSE_WIRE_LIMIT_BYTES).guarded)).equals(Buffer.from(valid))).toBe(
      true,
    );
    const overflow = encode(`data:${'x'.repeat(half)}\ndata:${'x'.repeat(half)}\n\n`);
    await expect(consume(fixture([overflow], SSE_WIRE_LIMIT_BYTES).guarded)).rejects.toBeInstanceOf(SseWireLimitError);
  });

  it('accepts an exact 8 MiB unfinished line and rejects the next byte before forwarding it', async () => {
    const valid = encode(':' + 'x'.repeat(SSE_WIRE_LIMIT_BYTES - 1));
    const f = fixture([valid, encode('x')], SSE_WIRE_LIMIT_BYTES);
    const reader = (await f.guarded('https://example.com')).body!.getReader();
    expect((await reader.read()).value).toBe(valid);
    await expect(reader.read()).rejects.toBeInstanceOf(SseWireLimitError);
  });

  it('cancels a still-open upstream reader and reports its reason before closing', async () => {
    const cancel = vi.fn();
    const calls: string[] = [];
    const guarded = createSseWireLimitedFetch(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encode(':' + 'x'.repeat(16)));
            },
            cancel,
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      () => ({
        close: async () => {
          calls.push('close');
        },
        onerror: () => {
          calls.push('error');
        },
      }),
      16,
    );
    await expect(consume(guarded)).rejects.toBeInstanceOf(SseWireLimitError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(calls).toEqual(['error', 'close']);
  });

  it('releases the upstream reader lock after overflow', async () => {
    const cancel = vi.fn();
    const original = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encode(':' + 'x'.repeat(16)));
        },
        cancel,
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const guarded = createSseWireLimitedFetch(
      async () => original,
      () => ({ close: async () => {} }),
      16,
    );
    await expect(consume(guarded)).rejects.toBeInstanceOf(SseWireLimitError);
    await vi.waitFor(() => expect(original.body!.locked).toBe(false));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('releases the upstream reader lock after ordinary read errors', async () => {
    const failure = new Error('upstream read failed');
    const original = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(failure);
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const close = vi.fn();
    const guarded = createSseWireLimitedFetch(
      async () => original,
      () => ({ close }),
    );
    await expect(consume(guarded)).rejects.toBe(failure);
    await vi.waitFor(() => expect(original.body!.locked).toBe(false));
    expect(close).not.toHaveBeenCalled();
  });

  it('releases the upstream reader lock after consumer cancellation', async () => {
    const cancel = vi.fn();
    const original = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'content-type': 'text/event-stream' },
    });
    const guarded = createSseWireLimitedFetch(
      async () => original,
      () => ({ close: async () => {} }),
    );
    await (await guarded('https://example.com')).body!.cancel('consumer stopped');
    expect(original.body!.locked).toBe(false);
    expect(cancel).toHaveBeenCalledExactlyOnceWith('consumer stopped');
  });

  it('reports terminal overflow before slow reader cancellation completes', async () => {
    let finishCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      finishCancellation = resolve;
    });
    const original = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encode(':' + 'x'.repeat(16)));
        },
        cancel: () => cancellation,
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const close = vi.fn().mockResolvedValue(undefined);
    const onerror = vi.fn();
    const guarded = createSseWireLimitedFetch(
      async () => original,
      () => ({ close, onerror }),
      16,
    );
    await expect(consume(guarded)).rejects.toBeInstanceOf(SseWireLimitError);
    expect(close).toHaveBeenCalledOnce();
    expect(onerror).toHaveBeenCalledWith(expect.any(SseWireLimitError));
    expect(original.body!.locked).toBe(true);
    finishCancellation();
    await vi.waitFor(() => expect(original.body!.locked).toBe(false));
  });
});

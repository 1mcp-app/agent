/** Limits bytes retained by the SSE parser before JSON parsing can allocate a message. */
export const SSE_WIRE_LIMIT_BYTES = 8 * 1024 * 1024;

export class SseWireLimitError extends Error {
  constructor() {
    super(`Upstream SSE frame exceeds the ${SSE_WIRE_LIMIT_BYTES}-byte wire limit`);
    this.name = 'SseWireLimitError';
  }
}

export interface SseTransportOwner {
  start?: () => Promise<void>;
  close(): Promise<void>;
  onerror?: (error: Error) => void;
}

/** Byte-only accounting leaves decoding, fields, and emitted messages to the SDK parser. */
class SseWireCounter {
  private lineBytes = 0;
  private field = '';
  private valueStarted = false;
  private dataField = false;
  private firstValueByte = false;
  private dataBytes = 0;
  private dataFields = 0;
  private afterCR = false;
  private initialBytes: number[] = [];
  private initial = true;

  constructor(private readonly limit: number) {}

  accept(chunk: Uint8Array): void {
    for (const byte of chunk) {
      if (this.initial) {
        this.initialBytes.push(byte);
        const bom = [0xef, 0xbb, 0xbf];
        if (byte === bom[this.initialBytes.length - 1]) {
          if (this.initialBytes.length === 3) {
            this.initial = false;
            this.lineBytes = 3;
            if (this.lineBytes > this.limit) throw new SseWireLimitError();
            this.initialBytes = [];
          }
          continue;
        }
        this.initial = false;
        for (const initialByte of this.initialBytes) this.acceptByte(initialByte);
        this.initialBytes = [];
        continue;
      }
      this.acceptByte(byte);
    }
  }

  finish(): void {
    // An incomplete initial BOM is ordinary input, even when EOF splits its bytes.
    for (const byte of this.initialBytes) this.acceptByte(byte);
    this.initialBytes = [];
  }

  private acceptByte(byte: number): void {
    if (this.afterCR) {
      this.afterCR = false;
      if (byte === 10) return;
    }
    if (byte === 10 || byte === 13) {
      this.endLine();
      this.afterCR = byte === 13;
      return;
    }
    this.lineBytes++;
    if (this.lineBytes > this.limit) throw new SseWireLimitError();
    if (!this.valueStarted) {
      if (byte === 58) {
        this.valueStarted = true;
        this.dataField = this.field === 'data';
        this.firstValueByte = true;
        if (this.dataField) this.beginDataField();
        return;
      }
      // Retain only enough bytes to recognize "data"; arbitrary field names stay bounded.
      if (this.field.length < 5) this.field += String.fromCharCode(byte);
      return;
    }
    if (!this.dataField) return;
    if (this.firstValueByte) {
      this.firstValueByte = false;
      if (byte === 32) return;
    }
    this.addDataBytes(1);
  }

  private beginDataField(): void {
    if (this.dataFields > 0) this.addDataBytes(1); // Parser-inserted LF between data fields.
    this.dataFields++;
  }

  private addDataBytes(bytes: number): void {
    this.dataBytes += bytes;
    if (this.dataBytes > this.limit) throw new SseWireLimitError();
  }

  private endLine(): void {
    if (this.lineBytes === 0) {
      this.dataBytes = 0;
      this.dataFields = 0;
    } else if (!this.valueStarted && this.field === 'data') {
      this.beginDataField(); // A field without a colon has an empty value.
    }
    this.lineBytes = 0;
    this.field = '';
    this.valueStarted = false;
    this.dataField = false;
    this.firstValueByte = false;
  }
}

/** Each transport receives a fresh guard, including when the factory recreates it. */
export function createSseWireLimitedFetch(
  fetchImpl: typeof fetch | undefined,
  owner: () => SseTransportOwner,
  limit = SSE_WIRE_LIMIT_BYTES,
): typeof fetch {
  let terminalError: SseWireLimitError | undefined;
  return async (input, init) => {
    if (terminalError) throw terminalError;
    const response = await (fetchImpl ?? fetch)(input, init);
    if (
      !response.body ||
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream'
    ) {
      return response;
    }
    const reader = response.body.getReader();
    const counter = new SseWireCounter(limit);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            counter.finish();
            controller.close();
            reader.releaseLock();
            return;
          }
          counter.accept(next.value);
          controller.enqueue(next.value);
        } catch (error) {
          if (error instanceof SseWireLimitError && !terminalError) {
            terminalError = error;
            // Report the bounded reason to pending requests, then close before the
            // body error reaches SDK/EventSource reconnect handling.
            void reader.cancel(error).catch(() => {});
            const transport = owner();
            failPendingStart(transport, error);
            try {
              transport.onerror?.(error);
            } catch {
              // Consumer callbacks cannot prevent cancellation or surface unsafe data.
            }
            void transport.close().catch(() => {});
          }
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    });
    const boundedResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperties(boundedResponse, {
      url: { value: response.url },
      redirected: { value: response.redirected },
      type: { value: response.type },
    });
    return boundedResponse;
  };
}

interface SseWireLimitBinding {
  fetch: typeof fetch | undefined;
  terminalError?: SseWireLimitError;
  pendingStarts: Set<(error: Error) => void>;
}

const transportFetchDelegates = new WeakMap<SseTransportOwner, SseWireLimitBinding>();

function failPendingStart(transport: SseTransportOwner, error: SseWireLimitError): void {
  const binding = transportFetchDelegates.get(transport);
  if (!binding) return;
  binding.terminalError = error;
  for (const reject of binding.pendingStarts) reject(error);
}

/** Remember the delegate separately from SDK wrappers and settle a pending SSE handshake. */
export function registerSseWireLimitOwner(transport: SseTransportOwner, fetchImpl: typeof fetch | undefined): void {
  const binding: SseWireLimitBinding = { fetch: fetchImpl, pendingStarts: new Set() };
  transportFetchDelegates.set(transport, binding);
  if (!transport.start) return;
  const start = transport.start.bind(transport);
  transport.start = async () => {
    if (binding.terminalError) throw binding.terminalError;
    let rejectStart!: (error: Error) => void;
    const failed = new Promise<void>((_resolve, reject) => {
      rejectStart = reject;
    });
    binding.pendingStarts.add(rejectStart);
    try {
      await Promise.race([start(), failed]);
    } finally {
      binding.pendingStarts.delete(rejectStart);
    }
  };
}

/** Recreate from the trusted delegate rather than the SDK's wrapped private fetch. */
export function getSseWireLimitBinding(transport: SseTransportOwner): { fetch: typeof fetch | undefined } | undefined {
  const binding = transportFetchDelegates.get(transport);
  if (!binding) return undefined;
  return { fetch: binding.fetch };
}

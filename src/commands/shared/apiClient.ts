import { MCP_SERVER_VERSION } from '@src/constants.js';
import { CONTEXT_HEADERS, encodeContextValue } from '@src/transport/http/utils/contextExtractor.js';
import type { ContextData } from '@src/types/context.js';

export interface ApiClientOptions {
  baseUrl: string;
  bearerToken?: string;
  timeout?: number;
  sessionId?: string;
  context?: ContextData;
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  sessionId?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly bearerToken?: string;
  private readonly timeout: number;
  private readonly sessionId?: string;
  private readonly context?: ContextData;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.bearerToken = options.bearerToken;
    this.timeout = options.timeout ?? 10_000;
    this.sessionId = options.sessionId;
    this.context = options.context;
  }

  async get<T>(path: string, query?: Record<string, string>): Promise<ApiResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, value);
        }
      }
    }
    if (this.context) {
      url.searchParams.set('context', encodeContextValue(this.context));
    }
    return this.request<T>(url.toString(), 'GET');
  }

  async post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    return this.request<T>(url, 'POST', body);
  }

  private async request<T>(url: string, method: string, body?: unknown): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const headers: Record<string, string> = {
      'User-Agent': `1MCP/${MCP_SERVER_VERSION}`,
      Accept: 'application/json',
    };

    if (this.bearerToken) {
      headers.Authorization = `Bearer ${this.bearerToken}`;
    }

    if (this.sessionId) {
      headers[CONTEXT_HEADERS.SESSION_ID] = this.sessionId;
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);
      const sessionId = response.headers.get('mcp-session-id') ?? undefined;

      let data: T | undefined;
      let error: string | undefined;

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        try {
          const json = (await response.json()) as unknown;
          if (response.ok) {
            data = json as T;
          } else {
            const errObj = json as Record<string, unknown>;
            error =
              typeof errObj.error === 'string'
                ? errObj.error
                : typeof errObj.message === 'string'
                  ? errObj.message
                  : `HTTP ${response.status}`;
          }
        } catch {
          error = `HTTP ${response.status}: invalid JSON response`;
        }
      } else if (!response.ok) {
        error = `HTTP ${response.status}`;
      }

      return { ok: response.ok, status: response.status, data, error, sessionId };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, status: 0, error: `Request timed out after ${this.timeout}ms` };
      }
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

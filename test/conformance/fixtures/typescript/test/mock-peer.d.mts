import type { IncomingHttpHeaders } from 'node:http';

export function startConformanceMock(
  protocolVersion: string,
  options?: {
    tools?: { name: string; inputSchema: { type: string } }[];
    requestState?: boolean;
  },
): Promise<{
  endpoint: string;
  requests: {
    headers: IncomingHttpHeaders;
    message: {
      method: string;
      id?: string | number;
      params: { name: string; requestState?: unknown; inputResponses?: unknown };
    };
  }[];
  close(): Promise<void>;
}>;

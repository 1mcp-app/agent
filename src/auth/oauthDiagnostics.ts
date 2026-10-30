const diagnostics = {
  network_failure: { stage: 'network', guidance: 'Check provider reachability and DNS.' },
  private_destination_blocked: {
    stage: 'network',
    guidance:
      'OAuth endpoint resolves to a private address. Explicitly approve its HTTPS origin with oauth.privateNetworkOrigins if trusted.',
  },
  metadata_http_error: { stage: 'metadata', guidance: 'Check provider metadata availability and access policy.' },
  invalid_metadata: { stage: 'metadata', guidance: 'Check the provider OAuth metadata format.' },
  authority_mismatch: {
    stage: 'authority',
    guidance: 'Check the configured resource and issuer against provider metadata.',
  },
} as const;

export type OAuthDiagnosticReason = keyof typeof diagnostics;

export function oauthDiagnosticMessage(reason: OAuthDiagnosticReason, httpStatus?: number): string {
  const diagnostic = diagnostics[reason];
  const status =
    reason === 'metadata_http_error' && Number.isInteger(httpStatus) && httpStatus! >= 400 && httpStatus! <= 599
      ? ` (HTTP ${httpStatus})`
      : '';
  return `OAuth ${diagnostic.stage}: ${reason}${status}. ${diagnostic.guidance}`;
}

export function readOAuthDiagnostic(
  message: unknown,
): { stage: string; reason: OAuthDiagnosticReason; guidance: string; httpStatus?: number } | undefined {
  if (typeof message !== 'string') return undefined;
  for (const reason of Object.keys(diagnostics) as OAuthDiagnosticReason[]) {
    if (message === oauthDiagnosticMessage(reason)) return { ...diagnostics[reason], reason };
    if (reason === 'metadata_http_error') {
      const match = /^OAuth metadata: metadata_http_error \(HTTP ([45]\d{2})\)\. /.exec(message);
      const httpStatus = match ? Number(match[1]) : undefined;
      if (httpStatus && message === oauthDiagnosticMessage(reason, httpStatus))
        return { ...diagnostics[reason], reason, httpStatus };
    }
  }
  return undefined;
}

export function safeOAuthDiagnosticMessage(error: unknown): string | undefined {
  try {
    const message: unknown =
      typeof error === 'string' ? error : Object.getOwnPropertyDescriptor(error, 'message')?.value;
    if (message === 'OAuth authority or authorization attempt is no longer valid; start authorization again')
      return oauthDiagnosticMessage('authority_mismatch');
    const diagnostic = readOAuthDiagnostic(message);
    return diagnostic ? oauthDiagnosticMessage(diagnostic.reason, diagnostic.httpStatus) : undefined;
  } catch {
    return undefined;
  }
}

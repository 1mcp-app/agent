export interface RecreateHttpTransportOptions {
  /**
   * Whether to carry the existing `sessionId` over to the new transport.
   *
   * Defaults to `true`, which is correct for OAuth retries (the session itself
   * is still valid; only auth needs refreshing). Callers recovering from a
   * server-invalidated session (e.g. the backend restarted and lost its
   * in-memory session store) must pass `false` so the new transport performs
   * a full `initialize` handshake and is issued a fresh session ID, instead of
   * immediately failing again with the same stale one.
   */
  preserveSessionId?: boolean;
}

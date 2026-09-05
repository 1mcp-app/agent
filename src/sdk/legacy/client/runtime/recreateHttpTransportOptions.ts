export interface RecreateHttpTransportOptions {
  /**
   * Whether to carry the existing `sessionId` over to the new transport.
   *
   * Defaults to `true` for resuming a valid session with an initialized client.
   * Callers creating a fresh client or recovering from a server-invalidated
   * session must pass `false` so connection performs protocol negotiation
   * instead of skipping it based on an existing session ID.
   */
  preserveSessionId?: boolean;
}

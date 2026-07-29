# OAuth Refresh Tokens Use Rotating Families

1MCP issues refresh tokens only to registered clients that request the `refresh_token` grant. Each approved authorization creates an independent, client-, resource-, and scope-bound Refresh Token Family that persists in its Runtime Scope for a fixed 30 days. Every successful refresh rotates a single-use opaque token; only token digests and family lineage are stored.

Because public PKCE clients are not sender-constrained, reuse of any consumed family member revokes its family and every access token issued from it. There is no retry grace period: concurrent refreshes permit one success, and later use is replay. A normal refresh may narrow the new access token's scopes and leaves earlier access tokens valid until their own expiry; explicit access-token revocation remains local to that token.

This chooses RFC 9700 rotation and strong replay containment over retry availability. A lost response or concurrent retry can force reauthorization, but the runtime never permits two valid successors or extends the family beyond its original lifetime.

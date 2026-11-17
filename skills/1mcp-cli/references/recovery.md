# Release and recovery

Release only your selected bindings with `1mcp project release`. Workers release their own bindings when finished. Only a verified root SessionEnd permits terminal credential cleanup; Stop, SubagentStop, turn completion, age, and parent termination do not prove worker termination.

Pending calls, open proxies, and uncertain leases retain credentials. SessionEnd closes admission, and successful release is persisted before deletion. Inspect uncertain leases and stale locks rather than sweeping by age.

Retry failed terminal cleanup with `1mcp project recover --project-owner <ended-own-file>`, even after checkout removal. Recovery requires a recorded SessionEnd; live owners remain protected.

For authorized manager removal, use `1mcp project drain` and require `complete=true` before removal. A timeout leaves admission closed until explicit `1mcp project resume`.

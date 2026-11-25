---
status: accepted
---

# Upstream OAuth Refresh Ownership

Refresh coordination belongs to **Upstream OAuth Authority** within its **Runtime Scope**, because transports can share credentials and cannot coordinate safely in isolation. Stale failures must preserve newer credentials, and distinct authorities remain independent. Inbound **Refresh Token Family** policy is unchanged.

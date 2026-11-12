---
status: accepted
---

# Token issuance requires runtime authority

Local CLI token issuance requires a short-lived, purpose-separated proof derived from the Runtime Scope's owner-only capability, verified against the selected local runtime. Loopback connectivity alone is not authority because a local reverse proxy can forward remote requests. This reuses the existing secure capability lifecycle while keeping its root secret local; remote contexts continue to require explicit tokens.

Human OAuth consent requires an Admin Session and its CSRF token. The public authorization endpoint redirects into the Admin cookie scope, preserving the cookie's restricted path and existing OAuth protocol endpoints. Operators must provision an Admin Account before browser authorization; disabling Admin disables this approval path.

Unauthenticated HTTP on a non-loopback listener requires explicit operator acknowledgement. Official Compose publishes only on host loopback by default and acknowledges its container-wide listener explicitly. This preserves deliberate reverse-proxy deployments while making network exposure an intentional configuration choice.

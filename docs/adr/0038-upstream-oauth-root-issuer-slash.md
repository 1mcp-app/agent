---
status: accepted
---

# Opt-in root slash compatibility for upstream OAuth issuers

Some providers advertise an HTTPS issuer with a root slash in protected-resource metadata and omit that slash in authorization-server metadata, as reported in [issue 772](https://github.com/1mcp-app/agent/issues/772). Issuer matching is exact by default. A separate per-upstream opt-in permits a single slash immediately after an otherwise identical HTTPS authority, with no query or fragment, so operators can accommodate these providers independently of the [incomplete metadata policy](0033-explicit-upstream-oauth-compatibility.md).

The exception applies during discovery, including comparison with a configured issuer. Once discovery validates the authorization server’s published issuer, that exact string identifies the stored Upstream OAuth Authority and governs subsequent issuer checks, including the callback `iss` parameter. Enabling or disabling the option requires fresh authorization for that upstream because it changes the policy under which credentials were accepted.

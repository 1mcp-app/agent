---
status: accepted
---

# Explicit Upstream OAuth Compatibility

Incomplete authorization-server metadata can be accepted only through the explicit `oauth.insecureAllowIncompleteMetadata` setting, disabled by default. This applies equally to public and private providers: 1MCP may infer an absent issuer from the discovery context and resolve relative endpoints against it, but must still reject explicit issuer mismatches, cross-origin relative endpoints, missing required endpoints, and invalid resource authority. When protected-resource metadata is unavailable, this option permits authorization-server discovery on the configured resource origin; it does not approve another issuer implicitly.

Private network access is a separate decision. `oauth.privateNetworkOrigins` grants access only to listed HTTPS origins and never expands from provider metadata. It preserves DNS socket pinning, redirect rejection, TLS verification, and existing explicitly configured local-IP/localhost behavior. Both settings participate in credential configuration identity so changing either invalidates prior authorization. This separation lets operators accept a known provider's incomplete metadata without silently widening network access or imposing provider-specific exceptions.

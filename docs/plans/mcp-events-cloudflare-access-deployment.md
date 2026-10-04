# MCP Events through Cloudflare Access

This change enables a bounded modern MCP Events surface on the HTTP gateway. The only downstream Events provider is the configured `agent-offload` server. Requests require a valid Cloudflare Access application JWT and a mapped `agent-offload` tag.

## Server configuration

Set these values on the 1MCP service:

```dotenv
ONE_MCP_CLOUDFLARE_ACCESS_ISSUER=https://lekthailtd.cloudflareaccess.com
ONE_MCP_CLOUDFLARE_ACCESS_AUDIENCE=<the application AUD tag from Cloudflare Access>
ONE_MCP_CLOUDFLARE_ACCESS_GROUP_TAG_MAP={"<exact Access group name>":["agent-offload"]}
```

The audience is specific to the Access application and must be copied from its Cloudflare dashboard. Keep it in the deployment environment rather than committing it to this repository. The same settings can be supplied with `serve --cloudflare-access-issuer`, `--cloudflare-access-audience`, and `--cloudflare-access-group-tag-map`.

In the Cloudflare Access identity-provider configuration, add a custom claim named `groups` containing the user's group names. The verifier reads `custom.groups`; standard Access JWTs do not include provider groups automatically. Map exact group names to a small allowlist of 1MCP tags. A group should map to `agent-offload` only for identities allowed to use the delegation Events provider.

If Access omits or truncates the group claim, the identity receives no mapped tags and Events stays unavailable. The gateway does not infer permissions from email, request headers other than the signed Access assertion, or unrecognized groups. Keep any mapping short enough to fit in the Access JWT.

## Deployment checks

1. Confirm the Access issuer is the team's `https://<team>.cloudflareaccess.com` URL and copy the exact audience from the application.
2. Confirm the application JWT custom claim is named `groups` and contains the exact group strings used in the mapping.
3. Confirm the `agent-offload` MCP server is present and connected in 1MCP.
4. Test an allowed identity: discovery should include Events and `events/list`, `events/subscribe`, and `events/unsubscribe` should reach only `agent-offload`.
5. Test an identity without the mapped group, an invalid JWT, and a disconnected provider: Events should not be advertised or dispatched.

This file documents the configuration and verification steps. It does not change Cloudflare, tunnel, or production settings.

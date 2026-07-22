# Admin Console Is a Same-Origin Surface With Its Own Adapter API

The **Admin Console** is served by the **Aggregated Runtime** as a same-origin bundled SPA mounted at `/admin`, backed by a dedicated `/admin/api` surface authorized only by an **Admin Session** plus CSRF. We keep this separate from `/api/v1`: `/api/v1` is a versioned, bearer-authenticated, tag-scoped contract for CLI and MCP clients, while the console needs full-admin visibility, cookie/CSRF semantics, and write actions. The existing browser-origin rejection on `/api/v1` and CLI token routes stays intact.

`/admin/api` is an internal adapter API owned by the bundled Admin Console, not a stable public integration API. It should be typed and tested, but external automation should continue to target `/api/v1` or CLI commands. Route handlers are adapters over **Admin Operations** and existing domain workflows such as **Config Change**, **Server Installation Workflow**, presets, and backend OAuth consent; they must not write runtime configuration directly.

Admin Operations return structured domain result facts. `/admin/api` maps those facts into Admin Console response models, while the CLI-facing `/admin/cli/v1` adapter maps the same facts into CLI output, prompts, warnings, exit semantics, and script-friendly errors. This keeps browser interaction state from becoming a shipped CLI wire contract and keeps CLI compatibility constraints out of the SPA response shape.

The Admin Console exposes normalized read models rather than raw config objects. Configured-server views redact secrets and raw environment values, distinguish **Configured Server Targets** from runtime **Template Server Instances**, and preserve existing secrets through explicit sentinel fields or operation-specific inputs. Reveal/copy of existing secrets is not part of v1.

The legacy `/oauth` dashboard is merged into the console, but OAuth protocol endpoints that carry registered redirect URIs stay at their existing paths. Human-facing OAuth success/error and consent views move into `/admin` behind Admin Session authentication. The SPA is embedded into the SEA binary as precompressed assets, with source-mode fallback to `web/dist`.

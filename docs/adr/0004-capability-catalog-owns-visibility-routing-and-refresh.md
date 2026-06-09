# Capability Catalog Owns Visibility, Routing, and Refresh

Capability querying should be handled through a **Capability Catalog** that owns **Capability Visibility**, internal **Capability Routes**, and explicit **Capability Refresh** policy. We chose this over keeping refresh, tool-registry rebuilds, disabled-tool checks, clean-name/template-key resolution, and notification suppression scattered across routes, meta-tools, and orchestrators because callers need one truthful view of what a **Client Surface** can see and call for a **Request Session**.

The first slice should add `src/core/capabilities/capabilityCatalog.ts`, keep the existing aggregator, registry, and meta-tool provider as collaborators, and migrate meta-tools plus REST tool listing/invocation before broadening to protocol handlers or notification flows. Public capability output remains clean-name based; route handles stay internal.

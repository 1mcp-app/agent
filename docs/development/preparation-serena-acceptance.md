---
title: Serena configuration and language-server diagnostics
description: Investigate configuration writes, native writer races, and language-server isolation.
---

# Serena configuration and language-server diagnostics

Use this guide when evaluating Serena readiness or initialization behavior. The [native diagnostic](../../scripts/verify-native-preparation-serena.py) checks disposable project configurations and language-server sessions, separately from the runtime preparation scheduler.

## Prerequisites and execution

Use the Python interpreter from an installation of `serena-agent 2.0.0`. The script also requires Node on PATH and TypeScript `5.9.3` and `typescript-language-server 5.1.3` in the supplied Serena resources directory. These are enforced fixture prerequisites; the script never installs dependencies.

```bash
SERENA_PYTHON=/absolute/serena-virtualenv/bin/python
SERENA_HOME=/absolute/serena-home
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/serena-diagnostics.XXXXXX")"
"$SERENA_PYTHON" scripts/verify-native-preparation-serena.py \
  --fixture-root "$FIXTURE_ROOT" \
  --serena-home "$SERENA_HOME"
```

The script creates a unique run directory under the fixture root, prints JSON, and retains fixtures and `evidence.json` there. It confines project writes to those fixtures, reads language-server dependencies from the supplied home, and avoids live global configuration and project activation commands. Remove only the fixture directory after reviewing the results.

## Interpret the results

Expect checkout-specific symbols from main, linked, and independent repositories, including dirty source updates. Warm queries reuse an existing native session; their timing does not measure a new helper invocation.

The script also expects a stale-snapshot lost update: two native writers load the same configuration, and the later save overwrites the first writer's setting. Exit zero includes reproducing that failure mode. Atomic file replacement protects publication, not merging or interprocess ownership.

Use the installed-source excerpts and hashes in the report to investigate these boundaries:

- Loading incomplete project configuration can persist defaults. Global loaders can migrate or save configuration; neither is automatically a read-only readiness probe.
- Constructing a project can create directories without establishing language-backend readiness or completed onboarding.
- Health checks and activation can write files or run project-defined commands. Language-server startup can install missing dependencies unless prerequisites are checked first.
- Cache writes need coordination with native writers. The fixture deliberately avoids saving symbol caches.
- Language servers may start independent process sessions. The fixture disables that behavior and stops its own servers; runtime cancellation needs a separate test.

The script checks `ProjectConfig.autogenerate(save_to_disk=False)` as an in-memory configuration seam. This does not prove safe publication or preservation of effective user settings.

## Extending support

When changing native versions or languages, update prerequisites and inspect native behavior before changing assertions. Verify read-only readiness for the effective configuration, safe publication with concurrent native writers, cache ownership where applicable, and contained cancellation. Follow [integration verification](backend-preparation-acceptance.md) for representative performance and runtime checks. Store run-specific results with the associated PR or CI run.

---
title: Serena native preparation acceptance
description: Reproduce the verified Serena behavior and unresolved preparation gates for issue 651.
---

# Serena native preparation acceptance

Use this page to reproduce the native evidence for issue #651. It does **not** establish production Serena preparation support. No preparation helper or setup-only catalog entry is shipped by this diagnostic slice.

## Reproduce

Use the Python interpreter from the actual Serena installation. The script requires installed `serena-agent 2.0.0`, TypeScript `5.9.3`, and `typescript-language-server 5.1.3`. It checks prerequisites before creating fixtures and never installs dependencies.

```sh
mkdir -p /tmp/serena-acceptance
<SERENA_PYTHON> scripts/verify-native-preparation-serena.py \
  --fixture-root /tmp/serena-acceptance \
  --serena-home <ACTUAL_SERENA_HOME>
```

The script creates a unique run directory, prints JSON, and retains `evidence.json` and the fixtures there. Exit zero means the diagnostic assertions reproduced, including the expected lost update; it does not mean preparation acceptance passed. Keep the output for review and remove only that run directory when finished.

All project writes are confined to the new fixtures. Native language-server dependencies are read from the supplied Serena home. The script does not load or rewrite the live global configuration, fabricate onboarding, run project activation commands, or invoke the runtime preparation scheduler. Fixture Git commits disable hooks and signing.

## Observed results

One macOS run used Serena `2.0.0`, Python `3.14.0`, Node.js `26.4.0`, TypeScript `5.9.3`, and language server `5.1.3`.

| Native query target    | Dirty source bytes | Cold query | Warm query | Orderly native stop |
| ---------------------- | -----------------: | ---------: | ---------: | ------------------: |
| Main checkout          |                 35 |   1.0137 s |   0.0001 s |            0.0053 s |
| Linked checkout        |                 37 |   0.9172 s |   0.0004 s |            0.0058 s |
| Independent repository |                 42 |   0.9611 s |   0.0001 s |            0.0049 s |

The three native SolidLSP sessions ran concurrently, returned distinct checkout-specific class symbols, and detected subsequent dirty source changes. No symbol-cache files were saved. Warm timings reuse the same native session; they are not timings for a fresh helper invocation. Orderly stop is not runtime job cancellation acceptance. These tiny fixtures do not establish large-repository performance or unrelated-ready-tool responsiveness.

Two separate native Python writer processes loaded the same project configuration before either saved. Writer A saved `read_only: true`; writer B then saved its older snapshot with a changed initial prompt. B's save reverted A's `read_only` setting to false. The second writer stayed alive while A completed. This reproduces a native stale-snapshot lost update without a helper-only lock.

## Installed-source evidence and limits

References below are relative to the installed package root recorded, with SHA-256 hashes, in `evidence.json`. They describe the inspected `2.0.0` sources, not all Serena versions.

- `serena/config/serena_config.py:697–747`: `ProjectConfig.load`, even with auto-generation disabled, saves incomplete configuration with defaults. The fixture reproduces this write.
- `serena/config/serena_config.py:360, 424–480, 751–782`: project generation/save use a process-local thread lock. `serena/util/yaml.py:221–243` publishes through an atomic replacement; atomic publication does not merge stale native settings.
- `serena/config/serena_config.py:1054–1193`: the global loader can generate configuration, change permissions, load/migrate registered projects, and save migrations. It is not a general read-only settings loader. The `FileLock` at `1391` protects global registration persistence, not project configuration or symbol caches.
- `serena/project.py:35–82`: constructing a native `Project` creates its data directory, empty memory directory, and `.gitignore`. That constructor does not establish an initialized language backend or completed onboarding.
- `serena/cli.py:1028–1065` and `serena/agent.py:1481–1520`: the native health check creates files; agent activation can execute a project-defined command. Neither is used as a read-only probe here.
- `solidlsp/language_servers/typescript_language_server.py:266–319`: startup can install missing runtime dependencies. The diagnostic prechecks the installed executable and package versions instead.
- `solidlsp/ls.py:3088–3129`, `solidlsp/util/cache.py:28–30`: native cache saves write shared cache state without a project-wide interprocess lock. The diagnostic never calls cache saving.
- `solidlsp/ls_config.py:1173`, `solidlsp/ls_process.py:527–533`: native language servers default to independent process sessions. This script explicitly disables that setting and stops only its own servers. Runtime deadline/cancellation containment still needs separate verification.

The pinned native API does expose `ProjectConfig.autogenerate(save_to_disk=False)`. The script verifies that explicit TypeScript generation with default in-memory settings writes no files. Direct native queries also work without persisted warmup. These are useful building blocks, not a proof of complete supported preparation. A create-only exclusive publisher remains a candidate; the diagnostic does not establish its native race behavior or preservation of the effective configured settings. It does not prove that every alternative implementation requires upstream changes.

Still required: read-only readiness for the effective configured project/language backend; preservation of native global and local settings; safe initialization/publication with native writers; native cache coordination if any cache write is introduced; owned runtime cancellation/deadlines preserving foreign processes; bounded warm probes and responsiveness; and the supported language/version/platform matrix. Until those gates pass, Serena and full #651 remain unresolved. See [backend preparation](/guide/backend-preparation).

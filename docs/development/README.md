# Contributor handbook

Use these guides when changing, testing, or diagnosing 1MCP internals. Run commands from the repository root unless a guide says otherwise. Toolchain versions live in [`.node-version`](../../.node-version) and [`package.json`](../../package.json); general setup is in the [development guide](https://docs.1mcp.app/guide/development).

## Backend integrations

| Task                                                                  | Guide                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Write a preparation recipe and try it in disposable checkouts         | [Developing preparation recipes](backend-preparation-recipes.md)      |
| Verify setup, target isolation, and preparation behavior              | [Backend integration verification](backend-preparation-acceptance.md) |
| Investigate native graph ownership and freshness                      | [Graph backend diagnostics](preparation-native-acceptance.md)         |
| Investigate Serena configuration writes and language-server isolation | [Serena diagnostics](preparation-serena-acceptance.md)                |

## Product Usage Telemetry

| Task                                                                | Guide                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Change collection hooks, local state, or runtime lifecycle behavior | [Producer development](product-telemetry-producer.md)           |
| Diagnose send failures and report freshness                         | [Delivery and freshness testing](product-telemetry-delivery.md) |
| Verify installed packages and native distributions                  | [Distribution verification](product-telemetry-distribution.md)  |
| Add a test launcher without enabling collection                     | [Test suppression](product-telemetry-test-suppression.md)       |

## Protocol compatibility

Use [protocol regression testing](protocol-regressions.md) for SDK and protocol changes, and the [E2E guide](../../test/e2e/README.md) to choose a process, HTTP, or browser test lane.

Maintain these pages as reusable instructions. Put execution results in the associated PR, issue, or CI run; see [documentation rules](../AGENTS.md).

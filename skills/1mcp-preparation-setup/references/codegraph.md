# CodeGraph

Inspect the installed version's native initialization, synchronization, status, and locking interfaces. Define which source files and extraction versions the readiness check covers. Watcher configuration matters: a disabled watcher requires explicit freshness checks and synchronization.

## Global CLI preparation

Use `codegraph` from the runtime environment for server startup and preparation. Inspect the installed CLI's help and structured status before choosing a helper. For versions exposing the required fields, `codegraph status --json <checkout>` can replace internal SDK imports; use the public `init` and `sync` commands for actions. A helper interpreter can likewise use its executable name (for example, `node`) rather than an NVM version path. Verify both commands resolve in the runtime environment.

Validate status shape before mapping readiness: the reported project must be the selected checkout, with no worktree mismatch, a complete index, compatible extraction metadata, and valid pending-change counts. Missing or malformed fields, unsupported versions and inconclusive checks stay non-ready. Check native writer locks before probing or starting actions and preserve foreign locks. Inspect the installed status implementation's write behavior: structured output alone does not establish a read-only probe, and SQLite sidecar behavior may need an explicit limitation.

Exercise cold initialization, ready state, modification/addition/deletion synchronization, checkout isolation, lock preservation, malformed status and compatibility refusal. Test a fresh backend through 1MCP and verify checkout-specific source. Global CLI resolution avoids coupling the recipe to a particular Node installation; it still requires the global command to be available in the runtime environment. Repair that environment through the existing installation mechanism rather than introducing a second managed bundle.

## Optional worktree seeding

Use seeding only after verifying the installed version stores portable relative paths and supports a compatible snapshot. Confirm repository identity, index schema/extraction version, integrity, and native writer ownership. A matching commit alone does not establish compatibility or dirty-source freshness.

For compatible SQLite indexes, use the SQLite online backup interface to obtain a consistent snapshot. Do not copy a live database file, WAL, lock, or process state blindly. Preserve an existing destination index. Put the optimization in the recipe's helper rather than modifying 1MCP runtime code.

After seeding, always run native synchronization and the readiness probe. Verify worktree-only symbol additions, edits, and deletion through fresh 1MCP queries, and confirm the original checkout remains isolated. If portability cannot be established, use ordinary native initialization; if a writer conflict exists, report the conflict rather than bypassing it.

Earlier experiments on CodeGraph 1.6.2 demonstrated relative-path seeding but did not establish universal writer coordination or cancellation guarantees. Recheck the installed version; do not copy machine-specific executable paths or treat those experiments as current acceptance.

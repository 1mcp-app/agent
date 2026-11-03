# CodeGraph

Inspect the installed version's native initialization, synchronization, status, and locking interfaces. Define which source files and extraction versions the readiness check covers. Watcher configuration matters: a disabled watcher requires explicit freshness checks and synchronization.

## Optional worktree seeding

Use seeding only after verifying the installed version stores portable relative paths and supports a compatible snapshot. Confirm repository identity, index schema/extraction version, integrity, and native writer ownership. A matching commit alone does not establish compatibility or dirty-source freshness.

For compatible SQLite indexes, use the SQLite online backup interface to obtain a consistent snapshot. Do not copy a live database file, WAL, lock, or process state blindly. Preserve an existing destination index. Put the optimization in the recipe's helper rather than modifying 1MCP runtime code.

After seeding, always run native synchronization and the readiness probe. Verify worktree-only symbol additions, edits, and deletion through fresh 1MCP queries, and confirm the original checkout remains isolated. If portability cannot be established, use ordinary native initialization; if a writer conflict exists, report the conflict rather than bypassing it.

Earlier experiments on CodeGraph 1.6.2 demonstrated relative-path seeding but did not establish universal writer coordination or cancellation guarantees. Recheck the installed version; do not copy machine-specific executable paths or treat those experiments as current acceptance.

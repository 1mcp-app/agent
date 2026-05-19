# Config Change Owns Mutation, Backup, and Reload Observation

Config mutation should be handled as a **Config Change**: one workflow that persists the requested change, creates and prunes backups when required, validates before writing, serializes concurrent writers, and reports the observable reload outcome for the matching **Runtime Scope**. We chose this over keeping file writes, backup policy, and reload hints scattered across CLI helpers and internal-tool adapters because callers need truthful structured facts, especially when a CLI command mutates config used by a separate **Aggregated Runtime**.

The module should live in a domain area such as `src/domains/config-change/`, expose explicit high-level operations rather than a generic public DSL, and migrate callers incrementally starting with uninstall/remove. Reload failure must not automatically roll back a successful write; restore remains an explicit backup-driven action.

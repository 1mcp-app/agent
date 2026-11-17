# Project and worker ownership

Codex `CODEX_THREAD_ID` locates this agent's private hook-written owner record; `CODEX_SESSION_ID`, when present, must agree. IDs locate credentials, never grant authority. Missing hook records fall back to cwd with a warning; partial or conflicting records fail closed.

Claude and Codex hosts without trustworthy thread lookup require their own bootstrap-provided `--project-owner <own-file>` reference. Keep it private: each worker has its own owner and assignment, never its parent's credential.

Give workers this skill and an absolute checkout or project-set assignment. If startup did not establish that assignment, run `1mcp bootstrap --client codex|claude --event SubagentStart --project <absolute-checkout>` or `--project-set <absolute-definition>` before project-specific calls. Parent cwd and session identity are not assignments. Keep a host-required owner reference on subsequent calls.

With a project set, `--project <label>` selects members for one call. Select one checkout for checkout-specific tools; make separate calls for single-project tools. Keep the same explicit selection throughout discovery, instructions, inspection, and invocation. Selectors and filters never broaden visibility.

Explicit `--url`, including loopback or forwarding, stays credentialless unless `--project-owner` is explicitly supplied. Local credentials do not authorize remote lifecycle controls.

New owner records use private temporary storage scoped by OS user and config directory. Hooks and calls must share that temporary directory. Existing records remain until cleanup; do not copy them. OS cleanup or reboot can erase records without releasing runtime ownership. Resolve scoped write-permission failures without dropping ownership or widening permissions to bypass a block.

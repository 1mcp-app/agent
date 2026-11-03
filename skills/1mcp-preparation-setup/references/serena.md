# Serena

Separate project configuration creation, language-server dependencies/startup, indexing/cache warmup, and onboarding. Choose and document the requested scope. A create-only recipe may report configuration readiness, but must not claim that the language server, symbol index, or onboarding is ready.

Use the installed version's public project commands and preserve existing project settings. Verify that rerunning initialization leaves user configuration intact and identify how concurrent native configuration writers are coordinated. Keep dependency installation separate unless authorized; never mark onboarding complete on the user's behalf merely to satisfy a probe.

After configuration preparation, verify a real symbol lookup in the selected checkout through 1MCP. Missing dependencies or failed language-server startup remain native usability gaps even if the configuration probe passes. Gate only operations for which the recipe's declared scope is appropriate.

Do not copy running language-server state or caches between worktrees without native portability support. Earlier Serena 2.0.0 experiments covered create-only preparation, not general language/platform readiness or cancellation. Recheck current behavior before adopting that approach.

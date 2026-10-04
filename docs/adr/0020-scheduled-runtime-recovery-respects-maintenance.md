---
status: accepted
---

# Scheduled runtime recovery respects maintenance

Windows **Scheduled Runtime Recovery** is explicitly opt-in and leaves Task Scheduler supervising a foreground **Aggregated Runtime**. An enabled task may periodically restart after any exit, including a successful exit or manual stop. This deliberately avoids distinguishing operator intent from process exit status; operators enter **Scheduled Runtime Maintenance** by disabling the task before stopping it.

Replacement and uninstall disable automatic launches before shutdown and verify that stopping completes before proceeding. If maintenance fails after disabling the task, any retained task stays disabled, with an accurate state report and explicit recovery instructions. We prefer a visible interruption requiring operator recovery over silently restoring automatic execution during failed maintenance. A stop failure must not be reported as successful removal or replacement.

Recurrence never bypasses **Runtime Scope** ownership or replaces a live runtime based on readiness. Existing startup and immediate-retry behavior remains the default when recurrence is omitted. Issue #564's process-identity and schema-admission work remains separate.

Accepted during [issue #566](https://github.com/1mcp-app/agent/issues/566) triage; implementation and live Windows verification remain outstanding.

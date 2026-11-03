---
status: accepted
---

# Credential Files Heal-Then-Consume on Read

Credentials persisted by 1MCP — OAuth tokens, sessions, authorization codes, client registrations, auth profiles, template-context capabilities — are written with explicit owner-only modes (files `0600`, directories `0700`) and never with values derived from the process umask (AUTH-07). On POSIX, reads heal legacy permissions before consuming credentials on the same open file descriptor, and storage directories pass an owner-only gate before reads and writes. This protects against other local users without stranding installations over permissive files created by earlier 1MCP versions.

## Consequences

Credential reads reject symlinks and pin the opened inode across permission repair and consumption. Foreign ownership and access-denied repairs fail closed; existing storage directories pass the same owner-only gate before access. Creation modes alone do not secure existing paths.

Filesystems unable to represent POSIX permissions warn instead of failing, deliberately preserving availability where that control cannot exist. The protection covers other local users, not the same uid or root. A CI guard checks file-write permissions, with explicitly justified baseline exceptions and documented analysis limits.

## Considered Options

Refusing all insecure legacy credentials would break upgrades over files 1MCP itself created. Trusting creation modes would leave pre-existing paths insecure. Heal-then-consume preserves compatibility while rejecting ownership violations and denied repairs.

# Contributing to 1MCP

We welcome bug reports, fixes, feature proposals, documentation improvements, and help testing 1MCP. This guide explains how to propose a contribution and prepare it for review.

## Before You Start

Search existing issues and pull requests to avoid duplicate work. Small fixes can go straight to a PR. For significant changes, new integrations, or changes to public behavior, open an issue first to discuss the problem and proposed approach with maintainers.

Use the [issue templates](https://github.com/1mcp-app/agent/issues/new/choose) for bugs, features, and documentation requests. For questions and open-ended ideas, use [GitHub Discussions](https://github.com/1mcp-app/agent/discussions).

A useful bug report includes reproducible steps, expected and actual behavior, the version or commit tested, and relevant environment details. Share enough diagnostic context to investigate, while removing credentials and private data. Feature proposals should explain the user need, alternatives, and compatibility implications.

## Find the Current Development Instructions

Follow the instructions for the checkout you are working on. The following sources contain the details that change as the project evolves:

| What you need                                                          | Where to find it                                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Set up and run a development environment                               | [Development guide](docs/en/guide/development.md)                                            |
| Runtime version, package manager, dependencies, and available commands | [.node-version](.node-version), [package.json](package.json), and [lockfile](pnpm-lock.yaml) |
| Local development configuration                                        | [.env.example](.env.example)                                                                 |
| Repository conventions and required quality checks                     | [AGENTS.md](AGENTS.md) and any instructions in the directory you change                      |
| Formatting and lint rules                                              | [.prettierrc](.prettierrc) and [eslint.config.ts](eslint.config.ts)                          |
| Domain terminology and architecture decisions                          | [CONTEXT.md](CONTEXT.md) and [architecture decision records](docs/adr/)                      |
| End-to-end testing and fixtures                                        | [E2E testing guide](test/e2e/README.md)                                                      |
| Automated checks for a pull request                                    | [CI workflows](.github/workflows/) and the checks on your PR                                 |

Use existing implementations and nearby tests as examples. The repository configuration and CI workflows define the current commands and checks; avoid relying on version numbers or copied command lists in older discussions.

## Prepare Your Contribution

Keep changes focused on one problem, and preserve unrelated work. Follow existing module boundaries and conventions. Prefer clear control flow, validated inputs, explicit error handling, and proper resource cleanup.

Add or update tests that demonstrate the behavior being changed, including relevant failure cases. Reuse existing helpers and fixtures, and isolate tests from real user configuration and external side effects. For platform-specific work, state which operating systems and environments you actually tested.

Update user documentation when setup, behavior, compatibility, or public interfaces change. Keep examples accurate, update affected language versions and navigation, and explain limitations that matter to users. Record significant architecture decisions in the project's architecture documentation.

Before submitting, review your own diff, format changed files, and run the required repository checks plus validation appropriate to the change. Documentation changes should pass the documentation build. Keep secrets, local configuration, and unrelated generated files out of the PR.

## Submit a Pull Request

Create a branch from `main` in your fork and submit a focused PR with a clear title. Use the [default PR template](.github/pull_request_template.md), or the shorter [documentation template](.github/PULL_REQUEST_TEMPLATE/documentation.md) for documentation-only changes. To select the documentation template in GitHub, add `template=documentation.md` to the comparison URL's query parameters before opening the PR.

Explain:

- The problem and how the change improves behavior.
- Related issues and any breaking changes or compatibility implications.
- The checks you ran, their results, and any remaining verification gaps.
- Screenshots or examples when they help reviewers understand the change.

Disclose relevant product or company affiliations, and follow the policy below for provider-specific content.

Required CI checks must pass, and a maintainer must approve the contribution before it is merged. Passing tests does not guarantee acceptance: maintainers also consider project scope, user value, compatibility, and ongoing maintenance cost. Respond to review feedback and update the PR description when its scope changes.

## Third-party integrations and commercial promotion

We welcome contributions from individuals and companies that improve 1MCP. Please disclose any affiliation with a product or service featured in your contribution.

Core documentation focuses on 1MCP functionality and general configuration. Provider-specific examples may be accepted when they address a clear user need or demonstrate behavior that existing examples do not cover. Please discuss these additions with maintainers before submitting a PR.

Contributions primarily intended to advertise a product, generate referrals, or obtain promotional links may be declined, even when technically correct and passing all checks.

The project may offer paid advertising or sponsored placements in the future, subject to a separate agreement with maintainers. Any such placement will be clearly labeled and separated from general technical guidance. Payment does not guarantee PR acceptance, influence technical review, or imply a project endorsement.

For commercial inquiries, contact the maintainers before submitting promotional content. See the maintainer contact in [package.json](package.json).

## Community and Support

Follow our [Code of Conduct](CODE_OF_CONDUCT.md). Keep discussion respectful and constructive, and allow time for review. If requirements are unclear, ask before investing in a large change.

For help, start with the [documentation](https://docs.1mcp.app), existing issues, and [GitHub Discussions](https://github.com/1mcp-app/agent/discussions).

## Releases and License

Release publication is handled by maintainers through the [release runbook](docs/runbooks/releasing.md). Contributors should describe changes that affect compatibility or release notes in their PRs.

By contributing, you agree that your contributions will be licensed under the project's [Apache License 2.0](LICENSE).

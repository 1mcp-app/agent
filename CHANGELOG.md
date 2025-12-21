# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.28.0] - 2025-12-21

### 🚀 Features
- Add comprehensive MCP server management system by @xizhibei in [#187](https://github.com/1mcp-app/agent/pull/187)
- Add pre-release version detection to Docker and npm workflows by @xizhibei

### 📚 Documentation
- Update installation guide with correct binary names by @xizhibei
- Fix incorrect binary names in installation guide by @do-not-do-that in [#194](https://github.com/1mcp-app/agent/pull/194)

### ⚙️ Miscellaneous Tasks
- Update stale issue and PR settings to reduce inactivity thresholds by @xizhibei
- Update version and changelog to 0.27.4 [skip ci] by @github-actions[bot]

## New Contributors
* @do-not-do-that made their first contribution in [#194](https://github.com/1mcp-app/agent/pull/194)

## [0.27.4] - 2025-12-09

### ⚙️ Miscellaneous Tasks
- Update @modelcontextprotocol/sdk to version 1.24.3 and adjust related dependencies in pnpm-lock.yaml; refactor MCP_CLIENT_CAPABILITIES structure in mcp.ts by @xizhibei
- Update version and changelog to 0.27.3 [skip ci] by @github-actions[bot]


## [0.27.3] - 2025-11-27

### 🚀 Features
- Implement robust JSON schema validation with automatic error recovery by @xizhibei in [#175](https://github.com/1mcp-app/agent/pull/175)

### ⚙️ Miscellaneous Tasks
- Update version and changelog to 0.27.2 [skip ci] by @github-actions[bot]


## [0.27.2] - 2025-11-18

### ⚙️ Miscellaneous Tasks
- Update macOS build environment to macos-15-intel by @xizhibei
- Update version and changelog to 0.27.1 [skip ci] by @github-actions[bot]


## [0.27.1] - 2025-11-18

### 🐛 Bug Fixes
- Update conflict logging for notification capabilities by @xizhibei

### 🚜 Refactor
- Introduce CompatibleRateLimitOptions interface for express-rate-limit v8 compatibility by @xizhibei

### ⚙️ Miscellaneous Tasks
- Update .gitignore to include /specs and /openspec directories by @xizhibei
- Update version and changelog to 0.27.0 [skip ci] by @github-actions[bot]


## [0.27.0] - 2025-10-29

### 🚀 Features
- Add advanced configuration options and feature flags by @xizhibei in [#156](https://github.com/1mcp-app/agent/pull/156)

### 📚 Documentation
- Enhance documentation with meta tags and descriptions for improved SEO and clarity by @xizhibei

### ⚙️ Miscellaneous Tasks
- Update funding sources in FUNDING.yml by @xizhibei
- Add ESLint and Prettier ignore files by @xizhibei
- Update ESLint configuration and improve error handling by @xizhibei in [#159](https://github.com/1mcp-app/agent/pull/159)
- Update version and changelog to 0.26.1 [skip ci] by @github-actions[bot]


## [0.26.1] - 2025-10-24

### ⚙️ Miscellaneous Tasks
- Update @modelcontextprotocol/sdk to version 1.20.2 and add axios as a new dependency by @xizhibei
- Update .gitignore to include .serena and .specify directories by @xizhibei
- Update version and changelog to 0.26.0 [skip ci] by @github-actions[bot]


## [0.26.0] - 2025-10-23

### 🚀 Features
- Implement comprehensive MCP registry functionality by @xizhibei in [#138](https://github.com/1mcp-app/agent/pull/138)
- Session restoration for streamable HTTP transport by @xizhibei in [#152](https://github.com/1mcp-app/agent/pull/152)

### ⚙️ Miscellaneous Tasks
- Update version and changelog to 0.25.5 [skip ci] by @github-actions[bot]


## [0.25.5] - 2025-10-22

### ⚙️ Miscellaneous Tasks
- Remove .cursorindexingignore file by @xizhibei
- Optimize Dockerfile for dependency installation by @xizhibei
- Update version and changelog to 0.25.4 [skip ci] by @github-actions[bot]


## [0.25.4] - 2025-10-13

### ⚙️ Miscellaneous Tasks
- Refine Dockerfile for improved environment setup by @xizhibei
- Update version and changelog to 0.25.3 [skip ci] by @github-actions[bot]


## [0.25.3] - 2025-10-13

### ⚙️ Miscellaneous Tasks
- Update Dockerfile for improved installation process by @xizhibei
- Update version and changelog to 0.25.2 [skip ci] by @github-actions[bot]


## [0.25.2] - 2025-10-13

### 🚀 Features
- Enhance capability merging with notification handling by @xizhibei

### ⚙️ Miscellaneous Tasks
- Add version update script and workflow for automated version management by @xizhibei
- Update Dockerfile to pin versions of UV, Bun, and Python by @xizhibei


## [0.25.1] - 2025-10-12

### ⚙️ Miscellaneous Tasks
- Update build script to use pnpm exec for TypeScript compilation and path alias resolution by @xizhibei


## [0.25.0] - 2025-10-10

### 🚀 Features
- Introduce timeout utility functions for effective timeout management by @xizhibei
- Introduce buildUri function for URI construction by @xizhibei
- Add debounced notification methods to ClientManager by @xizhibei
- Update Claude Desktop integration guide for 1MCP proxy by @xizhibei
- Add Codex integration guide and sidebar links by @xizhibei
- Enhance logo display with runtime information by @xizhibei
- Enhance logging output with colorized levels by @xizhibei
- Add User-Agent header with MCP server version to HTTP transport requests by @xizhibei

### 🚜 Refactor
- Reorganize project structure and improve architecture by @xizhibei in [#146](https://github.com/1mcp-app/agent/pull/146)

### 📚 Documentation
- Enhance README and documentation structure by @xizhibei

### ⚙️ Miscellaneous Tasks
- Update build and development scripts for improved workflow by @xizhibei


## [0.24.0] - 2025-10-08

### 🚀 Features
- Enhance CI/CD with parallel E2E testing and performance optimizations by @xizhibei in [#145](https://github.com/1mcp-app/agent/pull/145)
- Connect STDIO MCP clients to 1MCP HTTP server with auto-discovery by @xizhibei in [#143](https://github.com/1mcp-app/agent/pull/143)
- Enhance OAuth flow with reconnect and capability discovery by @xizhibei in [#141](https://github.com/1mcp-app/agent/pull/141)
- Enhance command validation and error handling by @xizhibei

### 🐛 Bug Fixes
- Update template variables for connected servers by @xizhibei

### 🚜 Refactor
- Clarify timeout handling in ClientManager by @xizhibei in [#142](https://github.com/1mcp-app/agent/pull/142)

### ⚙️ Miscellaneous Tasks
- Update .gitignore to include claudedocs and exclude xnotes by @xizhibei
- Add tag trigger for documentation deployment workflow by @xizhibei


## [0.23.2] - 2025-09-22

### 🚀 Features
- Enhance instruction template variables and grammar helpers by @xizhibei
- Enhance instruction template system with empty server handling and documentation by @xizhibei in [#134](https://github.com/1mcp-app/agent/pull/134)

### 🚜 Refactor
- Improve logging infrastructure and fix test reliability by @xizhibei in [#133](https://github.com/1mcp-app/agent/pull/133)


## [0.23.1] - 2025-09-21

### 🐛 Bug Fixes
- Fallback to default template on custom template failure by @xizhibei in [#132](https://github.com/1mcp-app/agent/pull/132)

### 🚜 Refactor
- Remove last used tracking feature by @xizhibei in [#131](https://github.com/1mcp-app/agent/pull/131)


## [0.23.0] - 2025-09-18

### 🚀 Features
- Implement instruction aggregation and filtering by @xizhibei in [#130](https://github.com/1mcp-app/agent/pull/130)
- Enhance tokens command with preset support and improved output by @xizhibei in [#128](https://github.com/1mcp-app/agent/pull/128)

### 📚 Documentation
- Update index.md with new MCP server examples by @xizhibei
- Improve issue templates for 1MCP repository by @xizhibei

### ⚙️ Miscellaneous Tasks
- Add workflow to close stale issues and PRs by @xizhibei


## [0.22.3] - 2025-09-15

### 🚀 Features
- Add cross-platform binary testing and tiktoken WASM inlining for SEA by @xizhibei in [#121](https://github.com/1mcp-app/agent/pull/121)

### 🐛 Bug Fixes
- Fix config directory resolution and improve config context reliability by @xizhibei in [#122](https://github.com/1mcp-app/agent/pull/122)


## [0.22.2] - 2025-09-14

### ⚙️ Miscellaneous Tasks
- Improve commit and push process in publish-to-npm workflow by @xizhibei


## [0.22.1] - 2025-09-14

### 🚀 Features
- Enhance binary distribution with multi-platform support and compressed archives by @xizhibei in [#116](https://github.com/1mcp-app/agent/pull/116)

### 💼 Other
- Update binary naming and archive creation for Windows by @xizhibei
- Add explicit sea:build step before build binaries by @xizhibei
- Update zod to v4.1.8 by @xizhibei

### 🚜 Refactor
- Extract command configuration into separate functions by @xizhibei in [#119](https://github.com/1mcp-app/agent/pull/119)

### 📚 Documentation
- Update content and restructure documentation links by @xizhibei
- Add link for MCP tokens command by @xizhibei

### ⚙️ Miscellaneous Tasks
- Add check for changes before committing and pushing by @xizhibei
- Simplify artifact upload process by @xizhibei
- Update commit parsers in cliff-release.toml by @xizhibei
- Add manual E2E test trigger option by @xizhibei


## [0.22.0] - 2025-09-12

### 🚀 Features
- Add comprehensive preset management system with CLI commands and dynamic server filtering by @xizhibei in [#107](https://github.com/1mcp-app/agent/pull/107)

### ⚙️ Miscellaneous Tasks
- Update .gitignore for new AI agent integrations by @xizhibei


## [0.21.0] - 2025-09-05

### 🚀 Features
- Add mcp tokens command for token usage estimation by @xizhibei in [#106](https://github.com/1mcp-app/agent/pull/106)

### ⚙️ Miscellaneous Tasks
- Remove Trust Score badge from README.md for clarity by @xizhibei


## [0.20.3] - 2025-09-03

### 🚀 Features
- Enhance Dockerfile caching for improved build performance by @xizhibei
- Update caching configuration in GitHub Actions workflow by @xizhibei
- Add workflow_call trigger to GitHub Actions binary workflow by @xizhibei
- Implement binary release pipeline with GitHub Actions by @xizhibei in [#105](https://github.com/1mcp-app/agent/pull/105)

### 🚜 Refactor
- Rename GitHub Actions workflows for better clarity by @xizhibei

### ⚙️ Miscellaneous Tasks
- Update concurrency group names in GitHub Actions workflows by @xizhibei
- Update .gitignore to include .mcp.json file by @xizhibei


## [0.20.2] - 2025-08-29

### 🚀 Features
- Improve Dockerfile with version pinning and cleanup by @xizhibei
- Enhance Docker setup with multi-stage builds and new image variants by @xizhibei
- Update Docker configuration and add Dockerfile for multi-stage build by @xizhibei


## [0.20.1] - 2025-08-27

### 🐛 Bug Fixes
- Update tag filtering logic in requestHandlers by @xizhibei


## [0.20.0] - 2025-08-27

### 🚀 Features
- Add sensitive data redaction in list command output by @xizhibei
- Enhance tag extraction and validation in middleware by @xizhibei
- Introduce advanced tag filtering with new tag-filter parameter by @xizhibei
- Enhance OAuth route handling with loading manager integration by @xizhibei

### 🐛 Bug Fixes
- Improve OAuth server name sanitization for CodeQL detection by @xizhibei
- Sanitize OAuth server names in test fixture logging by @xizhibei

### 📚 Documentation
- Update list command documentation to include new flags by @xizhibei in [#104](https://github.com/1mcp-app/agent/pull/104)
- Enhance server filtering documentation with tag character handling by @xizhibei in [#101](https://github.com/1mcp-app/agent/pull/101)
- Update tag filtering documentation to reflect deprecation of --tags parameter by @xizhibei

### ⚙️ Miscellaneous Tasks
- Remove Claude workflows for code review and issue handling by @xizhibei
- Remove unnecessary whitespace in README.md options section by @xizhibei
- Update README.md badges for clarity and accuracy by @xizhibei


## [0.19.0] - 2025-08-21

### 🚀 Features
- Add restart configuration options for stdio servers by @xizhibei
- Add claude GitHub actions by @xizhibei in [#98](https://github.com/1mcp-app/agent/pull/98)
- Update Smithery configuration for container runtime by @xizhibei

### 🐛 Bug Fixes
- Improve mocking of StdioClientTransport in restartableStdioTransport tests by @xizhibei in [#97](https://github.com/1mcp-app/agent/pull/97)

### 💼 Other
- MCP Trust Score by @Matvey-Kuk in [#95](https://github.com/1mcp-app/agent/pull/95)

### ⚙️ Miscellaneous Tasks
- Remove unnecessary whitespace in README.md by @xizhibei
- Clean up whitespace and add allowed_bots to Claude code review workflow by @xizhibei

## New Contributors
* @Matvey-Kuk made their first contribution in [#95](https://github.com/1mcp-app/agent/pull/95)

## [0.18.1] - 2025-08-18

### 🚀 Features
- Enhance configuration file monitoring and modification detection by @xizhibei

### 📚 Documentation
- Update README with additional badges for project visibility by @xizhibei

### 🧪 Testing
- Improve mocking for file system interactions in McpConfigManager tests by @xizhibei


## [0.18.0] - 2025-08-15

### 🚀 Features
- Add example environment configuration and update .gitignore by @xizhibei
- Introduce ONE_MCP_LOG_LEVEL for enhanced logging configuration by @xizhibei
- Enhance secure logging and add OAuth-related tests by @xizhibei
- Add pagination support documentation in English and Chinese by @xizhibei
- Add notifications for clients after configuration reload by @xizhibei
- Implement secure logging functionality to redact sensitive information by @xizhibei
- Restructure VitePress documentation and add new guides by @xizhibei
- Add abort signal support for connection and loading operations by @xizhibei

### 🐛 Bug Fixes
- Correct broken links to app consolidation guide by @xizhibei
- Update listChanged property to true for server capabilities by @xizhibei
- Prevent default config corruption by ensuring --config has a value in CLI commands by @xizhibei

### 📚 Documentation
- Enhance feature guides and sidebar navigation for 1MCP by @xizhibei
- Enhance README with updated MCP server setup instructions for Cursor and VSCode by @xizhibei
- Update README for 1MCP setup and usage instructions by @xizhibei
- Update command syntax in server management and app consolidation guides by @xizhibei
- Update README for 1MCP Agent with multilingual support and enhanced structure by @xizhibei
- Streamline integration guide and update commands by @xizhibei
- Update MCP server addition commands to use new package references by @xizhibei
- Update MCP server addition commands to use new pattern for auto-detection by @xizhibei

### ⚙️ Miscellaneous Tasks
- Update GitHub Actions workflow to ignore specific paths for push and pull request events by @xizhibei


## [0.17.0] - 2025-08-07

### 🚀 Features
- Add async loading option to dev command by @xizhibei
- Enhance consolidation detection logic in tests by @xizhibei
- Enhance add and update commands with " -- " pattern support by @xizhibei
- Add build step to GitHub Actions workflow by @xizhibei
- Add support for 'claude-desktop' in app configuration and update app preset format by @xizhibei
- Add platform-specific contributions section and enhance app preset warnings by @xizhibei
- Implement asynchronous server loading with real-time notifications by @xizhibei
- Add Claude Desktop integration guide and update navigation by @xizhibei
- Add Fast Startup guide and update navigation by @xizhibei
- Implement dynamic generation of supported apps list for CLI help by @xizhibei
- Enhance end-to-end testing for MCP commands and error handling by @xizhibei
- Add middleware tests for MCP server tag filtering by @xizhibei
- Implement asynchronous MCP server loading and management by @xizhibei
- Enhance backup management with app-specific directories and tests by @xizhibei
- Implement MCP server configuration import and conversion utility by @xizhibei
- Add JSON5 support for VS Code settings and implement tests by @xizhibei
- Rename 'server' command to 'mcp' and add Commands section to README by @xizhibei
- Add command reference and server management documentation by @xizhibei
- Enhance command-line interface with server options and default command handling by @xizhibei
- Implement server management commands and configuration utilities by @xizhibei
- Implement command management and backup functionalities by @xizhibei

### 🐛 Bug Fixes
- Update HOST constant to use 127.0.0.1 instead of localhost by @xizhibei
- Update error scenarios and command workflows in E2E tests by @xizhibei
- Improve default command handling in CLI by @xizhibei
- Update app preset paths for MCP settings by @xizhibei
- Update health-info-level argument parsing for consistency by @xizhibei

### 💼 Other
- Merge pull request #85 from 1mcp-app/dependabot/npm_and_yarn/eslint-plugin-prettier-5.5.3 by @xizhibei in [#85](https://github.com/1mcp-app/agent/pull/85)
- Merge pull request #84 from 1mcp-app/dependabot/npm_and_yarn/eslint/js-9.32.0 by @xizhibei in [#84](https://github.com/1mcp-app/agent/pull/84)
- Merge pull request #82 from 1mcp-app/dependabot/npm_and_yarn/eslint-config-prettier-10.1.8 by @xizhibei in [#82](https://github.com/1mcp-app/agent/pull/82)
- Merge pull request #81 from 1mcp-app/dependabot/npm_and_yarn/npm_and_yarn-459f987eb5 by @xizhibei in [#81](https://github.com/1mcp-app/agent/pull/81)
- Merge pull request #83 from 1mcp-app/dependabot/npm_and_yarn/jiti-2.5.1 by @xizhibei in [#83](https://github.com/1mcp-app/agent/pull/83)
- Merge pull request #87 from 1mcp-app/feat/command by @xizhibei in [#87](https://github.com/1mcp-app/agent/pull/87)

### 🚜 Refactor
- Remove deprecated loading and global sections from configuration guide by @xizhibei
- Update server and async loading tests for improved accuracy by @xizhibei
- Update command references and improve navigation by @xizhibei
- Enhance E2E test reliability and error handling by @xizhibei
- Update application preset configurations and comment out platform-specific paths by @xizhibei

### 📚 Documentation
- Update command references to include 'npx -y @1mcp/agent' for consistency by @xizhibei
- Dynamically set version in VitePress configuration by @xizhibei
- Update architecture documentation to reflect transport protocol changes by @xizhibei

### 🧪 Testing
- Update host expectation to use 127.0.0.1 instead of localhost by @xizhibei
- Add unit tests for McpConfigManager functionality by @xizhibei


## [0.16.0] - 2025-07-30

### 🚀 Features
- Add health info level configuration and sanitization features by @xizhibei
- Implement health monitoring endpoints and service by @xizhibei

### 💼 Other
- Merge pull request #86 from 1mcp-app/docs-website by @xizhibei in [#86](https://github.com/1mcp-app/agent/pull/86)

### 📚 Documentation
- Remove outdated Prometheus monitoring examples from health check documentation by @xizhibei
- Update logo references and add new logo image by @xizhibei
- Enhance authentication guide with management dashboard visuals by @xizhibei
- Add Google Analytics tracking script to VitePress configuration by @xizhibei
- Refine getting started guide by consolidating next steps by @xizhibei
- Add VitePress documentation and deployment workflow by @xizhibei
- Update README.md with enhanced structure and new sections by @xizhibei

### ⚙️ Miscellaneous Tasks
- Streamline pnpm setup in deployment workflow by @xizhibei
- Enhance package.json scripts and clean up test files by @xizhibei


## [0.15.0] - 2025-07-22

### 🚀 Features
- Implement trust proxy configuration for Express.js by @xizhibei
- Integrate authentication middleware into SSE and streamable HTTP routes by @xizhibei
- Enhance ExpressServer with MCP configuration and scope support by @xizhibei
- Add startup logo display utility by @xizhibei

### 💼 Other
- Merge pull request #80 from 1mcp-app/dependabot/npm_and_yarn/npm_and_yarn-e04d5d616f by @xizhibei in [#80](https://github.com/1mcp-app/agent/pull/80)

### 🚜 Refactor
- Streamline HTTP trust proxy integration tests by @xizhibei

### ⚙️ Miscellaneous Tasks
- Update development script and SDK version by @xizhibei


## [0.14.0] - 2025-07-21

### 🚀 Features
- Implement centralized HTTP request logging middleware by @xizhibei
- Introduce ServerStatus enum and enhance connection management by @xizhibei
- Add external URL support for OAuth callbacks by @xizhibei

### 💼 Other
- Merge pull request #79 from 1mcp-app/feat/external-url by @xizhibei in [#79](https://github.com/1mcp-app/agent/pull/79)
- Merge pull request #77 from 1mcp-app/dependabot/npm_and_yarn/npm_and_yarn-20b018c2ea by @xizhibei in [#77](https://github.com/1mcp-app/agent/pull/77)
- Merge pull request #78 from 1mcp-app/feat/test-improve by @xizhibei in [#78](https://github.com/1mcp-app/agent/pull/78)

### 🚜 Refactor
- Implement ClientManager for client creation and management by @xizhibei
- Rename variables for clarity and consistency by @xizhibei

### 📚 Documentation
- Update available options and add external URL example by @xizhibei

### 🧪 Testing
- Add comprehensive OAuth 2.1 E2E test with MCP specification compliance by @xizhibei
- Enhance test setups with additional transport mocks by @xizhibei
- Fix TypeScript compilation errors in test files by @xizhibei
- Fix eslint errors in test files by @xizhibei
- Add comprehensive tests for security middleware and index module by @xizhibei
- Add comprehensive SSE and streamable HTTP routes testing by @xizhibei
- Expand test coverage for core components by @xizhibei
- Implement comprehensive OAuth routes testing by @xizhibei
- Improve test coverage with shared utilities and new unit tests by @xizhibei
- Add unit tests for client-server notification handling by @xizhibei


## [0.13.1] - 2025-07-16

### 🚀 Features
- Introduce client session management repository and file storage service by @xizhibei
- Enhance OAuth session management and client data handling by @xizhibei

### 🐛 Bug Fixes
- Remove FILE_PREFIX from AUTH_CONFIG session settings by @xizhibei
- Update tag filtering logic to match any tag and enhance test coverage by @xizhibei

### 💼 Other
- Merge pull request #76 from 1mcp-app/fix/oauth by @xizhibei in [#76](https://github.com/1mcp-app/agent/pull/76)

### 🚜 Refactor
- Migrate to new repository architecture for OAuth storage by @xizhibei

### 🧪 Testing
- Enhance ClientSessionRepository tests for FILE_PREFIX handling by @xizhibei


## [0.13.0] - 2025-07-15

### 🚀 Features
- Add debug logging for authorization and token management processes by @xizhibei
- Implement sanitizeHeaders utility for safe logging by @xizhibei
- Enhance E2E testing framework with new configurations and utilities by @xizhibei
- Implement grouped feature flags for auth and security features by @xizhibei
- Implement scope validation and user consent for OAuth authorization by @xizhibei
- Add dedicated parsing utilities with comprehensive tests by @xizhibei
- Enhance rate limiting configuration for OAuth endpoints by @xizhibei
- Introduce comprehensive sanitization utilities and refactor existing code by @xizhibei
- Implement rate limiting and HTML escaping in OAuth routes by @xizhibei
- Implement ClientSessionManager for file-based client session storage by @xizhibei
- Enhance transport and client management with OAuth support by @xizhibei
- Implement OAuth management routes and enhance client handling by @xizhibei
- Enhance OAuth client configuration and session management by @xizhibei
- Introduce SDKOAuthClientProvider and refactor authentication management by @xizhibei
- Implement MCPOAuthClientProvider for OAuth 2.1 authentication flow by @xizhibei
- Add Contributor Covenant Code of Conduct by @xizhibei

### 🐛 Bug Fixes
- Improve XSS detection in input validation middleware by @xizhibei
- Limit input length in hashToUuid to prevent DoS attacks by @xizhibei
- Update dev script to enable authentication flag by @xizhibei
- Correct import paths and test mocks by @xizhibei
- Refine transport type inference based on URL suffix by @xizhibei

### 💼 Other
- Merge pull request #71 from 1mcp-app/dependabot/npm_and_yarn/eslint/js-9.31.0 by @xizhibei in [#71](https://github.com/1mcp-app/agent/pull/71)
- Merge pull request #72 from 1mcp-app/dependabot/npm_and_yarn/tsc-watch-7.1.1 by @xizhibei in [#72](https://github.com/1mcp-app/agent/pull/72)
- Merge pull request #73 from 1mcp-app/dependabot/npm_and_yarn/globals-16.3.0 by @xizhibei in [#73](https://github.com/1mcp-app/agent/pull/73)
- Merge pull request #74 from 1mcp-app/dependabot/npm_and_yarn/prettier-3.6.2 by @xizhibei in [#74](https://github.com/1mcp-app/agent/pull/74)
- Merge pull request #75 from 1mcp-app/dependabot/npm_and_yarn/typescript-eslint/parser-8.37.0 by @xizhibei in [#75](https://github.com/1mcp-app/agent/pull/75)
- Merge pull request #70 from 1mcp-app/oauth by @xizhibei in [#70](https://github.com/1mcp-app/agent/pull/70)
- Merge branch 'main' into oauth by @xizhibei

### 🚜 Refactor
- Enhance input validation in hashToUuid method to prevent DoS attacks by @xizhibei
- Update mock from ConfigManager to McpConfigManager in SDKOAuthServerProvider tests by @xizhibei
- Replace ConfigManager with McpConfigManager and introduce AgentConfigManager by @xizhibei
- Rename and restructure client and server types for clarity and consistency by @xizhibei
- Transition Clients type from Record to Map for improved performance and functionality by @xizhibei
- Update rate limit configuration to use config manager by @xizhibei
- Create scope validation middleware using SDK's bearer auth by @xizhibei
- Reorganize middleware files to appropriate directories by @xizhibei
- Encapsulate client access with getClient method by @xizhibei
- Streamline route setup and remove redundant rate limiting by @xizhibei
- Migrate transport creation to transportFactory and remove deprecated config module by @xizhibei
- Update transport type in ClientInfo and enhance OAuth callback handling by @xizhibei
- Unify client session management in SDKOAuthClientProvider by @xizhibei
- Rename SessionManager to ServerSessionManager and introduce ClientSessionManager by @xizhibei
- Remove reconnectAfterOAuth function and streamline OAuth callback handling by @xizhibei
- Streamline OAuth client configuration and remove deprecated properties by @xizhibei
- Rename SDKOAuthProvider to SDKOAuthServerProvider by @xizhibei

### 📚 Documentation
- Update CONTRIBUTING.md with enhanced testing guidelines and project structure by @xizhibei
- Add CONTRIBUTING.md to guide community contributions by @xizhibei
- Update README and CLI options for authentication and transport types by @xizhibei
- Update authentication and rate limiting features by @xizhibei

### 🧪 Testing
- Mock ConfigManager in SDKOAuthServerProvider tests by @xizhibei
- Add unit tests for SDKOAuthClientProvider by @xizhibei

### ⚙️ Miscellaneous Tasks
- Update CHANGELOG.md for upcoming release by @xizhibei
- Update TypeScript configuration and improve path handling by @xizhibei
- Update package.json scripts and GitHub Actions workflow by @xizhibei


## [0.12.0] - 2025-07-08

### 🚀 Features
- Add error handling for missing streamable HTTP sessions by @xizhibei
- Implement ping handler for client health checks by @xizhibei
- Add Vitest support and type checking script by @xizhibei
- Refactor project structure and enhance authentication management by @xizhibei
- Add .cursorindexingignore and update .gitignore for improved file management by @xizhibei
- Update server info management and enhance initialization by @xizhibei
- Add unit tests for capability management and conflict resolution by @xizhibei
- Implement debounced configuration reload on file changes by @xizhibei
- Add comprehensive tests for cursor parsing and encoding utilities by @xizhibei
- Enhance connection handling and logging by @xizhibei
- Enhance URI parsing with robust validation and error handling by @xizhibei
- Enhance session and auth code validation with improved error handling by @xizhibei
- Add glama.json configuration file for maintainers by @xizhibei

### 🚜 Refactor
- Preserve original notification structure while modifying parameters by @xizhibei

### 🧪 Testing
- Add vitest framework for client filtering tests by @xizhibei


## [0.11.0] - 2025-06-26

### 🚀 Features
- Add source-map-support for improved error stack traces by @xizhibei
- Add rate limiting for OAuth endpoints and update package dependencies by @xizhibei
- Enhance session management by adding path traversal validation for session IDs and auth codes by @xizhibei
- Add helper function to dynamically build OAuth issuer URL for improved environment support by @xizhibei
- Enhance OAuth 2.1 implementation with session ID prefixes, improved token validation, and comprehensive documentation by @xizhibei
- Implement OAuth 2.1 authentication with session management and middleware integration by @xizhibei
- Enhance error handling for notifications in client-server communication by @xizhibei
- Add CORS support and implement OAuth 2.1 endpoints for authorization and token management by @xizhibei
- Include outputSchema and annotations in tool registration for enhanced tool metadata by @xizhibei
- Implement completion request handlers and enhance capability checks in client operations by @xizhibei
- Add ElicitRequest and PingRequest handlers to improve client-server interaction by @xizhibei

### 🐛 Bug Fixes
- For code scanning alert no. 4: Uncontrolled data used in path expression by @xizhibei in [#62](https://github.com/1mcp-app/agent/pull/62)

### 🚜 Refactor
- Update access token generation to use UUIDs and improve session management by @xizhibei

### 📚 Documentation
- Update README to include new options for pagination, authentication, and session management by @xizhibei
- Add section on debugging and source maps to README by @xizhibei

### ⚙️ Miscellaneous Tasks
- Remove deprecated Docker build workflow and integrate into main workflow by @xizhibei


## [0.10.3] - 2025-06-11

### 🚜 Refactor
- Replace getInstance with getOrCreateInstance in tests for singleton behavior by @xizhibei


## [0.10.2] - 2025-06-11

### 🐛 Bug Fixes
- Mcp client disconnect after reload by @xizhibei
- Restore status property in ClientInfo and update client disconnection handling by @xizhibei


## [0.10.1] - 2025-06-10

### 🐛 Bug Fixes
- Infer transport type if missing and update validation logic by @xizhibei


## [0.10.0] - 2025-06-10

### 🚀 Features
- Add support for 'streamableHttp' transport type and refactor transport creation logic by @xizhibei
- Add pagination support to transport connection and related handlers by @xizhibei

### 🐛 Bug Fixes
- Prevent duplicate listeners and increase max listeners for transport config changes by @xizhibei

### 🚜 Refactor
- Streamline resource and template listing with pagination support by @xizhibei
- Replace ERROR_CODES with ErrorCode in various files for improved error handling consistency by @xizhibei


## [0.9.0] - 2025-05-06

### 💼 Other
- Streamable http transport by @xizhibei in [#34](https://github.com/1mcp-app/agent/pull/34)

### ⚙️ Miscellaneous Tasks
- Update Docker build workflow conditions to include branch checks by @xizhibei


## [0.8.2] - 2025-05-03

### 🐛 Bug Fixes
- Update RequestHandlerExtra type to support generic parameters by @xizhibei


## [0.8.1] - 2025-05-03

### ⚙️ Miscellaneous Tasks
- Remove branch restriction from Docker build workflow for improved flexibility by @xizhibei


## [0.8.0] - 2025-04-14

### 🚀 Features
- Add Smithery.ai configuration file with command and schema definitions by @xizhibei
- Enable environment variable parsing with ONE_MCP prefix by @xizhibei
- Integrate client capabilities into createClient function and define server/client capabilities in constants by @xizhibei

### 🐛 Bug Fixes
- Enhance logging capabilities with console transport and MCP transport integration by @xizhibei

### 💼 Other
- Vitest by @xizhibei in [#19](https://github.com/1mcp-app/agent/pull/19)
- Merge pull request #14 from 1mcp-app/dependabot/npm_and_yarn/typescript-5.8.3 by @xizhibei in [#14](https://github.com/1mcp-app/agent/pull/14)
- Merge pull request #15 from 1mcp-app/dependabot/npm_and_yarn/express-5.1.0 by @xizhibei in [#15](https://github.com/1mcp-app/agent/pull/15)
- Merge pull request #16 from 1mcp-app/dependabot/npm_and_yarn/eslint-plugin-prettier-5.2.6 by @xizhibei in [#16](https://github.com/1mcp-app/agent/pull/16)
- Merge pull request #17 from 1mcp-app/dependabot/npm_and_yarn/modelcontextprotocol/sdk-1.9.0 by @xizhibei in [#17](https://github.com/1mcp-app/agent/pull/17)
- Merge pull request #18 from 1mcp-app/dependabot/npm_and_yarn/eslint/js-9.24.0 by @xizhibei in [#18](https://github.com/1mcp-app/agent/pull/18)
- Merge pull request #12 from 1mcp-app/dependabot/npm_and_yarn/types/node-22.13.14 by @xizhibei in [#12](https://github.com/1mcp-app/agent/pull/12)
- Merge pull request #13 from 1mcp-app/dependabot/npm_and_yarn/typescript-eslint/parser-8.29.0 by @xizhibei in [#13](https://github.com/1mcp-app/agent/pull/13)
- Merge pull request #11 from 1mcp-app/dependabot/npm_and_yarn/modelcontextprotocol/sdk-1.8.0 by @xizhibei in [#11](https://github.com/1mcp-app/agent/pull/11)
- Merge pull request #10 from 1mcp-app/dependabot/npm_and_yarn/ts-jest-29.3.1 by @xizhibei in [#10](https://github.com/1mcp-app/agent/pull/10)
- Merge pull request #9 from 1mcp-app/dependabot/npm_and_yarn/typescript-eslint/eslint-plugin-8.29.0 by @xizhibei in [#9](https://github.com/1mcp-app/agent/pull/9)

### 🚜 Refactor
- Enhance MCP transport integration and logging setup by @xizhibei

### 📚 Documentation
- Add badges, Docker instructions, and environment variable configuration examples by @xizhibei

### ⚙️ Miscellaneous Tasks
- Update Docker build workflow to trigger on successful completion of the "Publish Package" workflow and enhance image metadata by @xizhibei
- Add GitHub Actions workflow for building and pushing Docker images by @xizhibei
- Add Dockerfile and .dockerignore for containerization by @xizhibei
- Consolidate release process by removing old release.yml and integrating steps into main.yml by @xizhibei

## New Contributors
* @github-actions[bot] made their first contribution

## [0.7.0] - 2025-03-27

### ⚙️ Miscellaneous Tasks
- Create temporary branch for changelog and version updates before pushing to main by @xizhibei


## [0.6.0] - 2025-03-26

### ⚙️ Miscellaneous Tasks
- Update release workflows to trigger on version tags and successful completion of publish job by @xizhibei


## [0.5.0] - 2025-03-26

### 🚀 Features
- Dynamically set MCP_SERVER_VERSION from package.json, improving version management and consistency by @xizhibei
- Enhance logging setup by adding SSEServerTransport support and configuring console transport for visibility, improving logging flexibility based on server type by @xizhibei
- Add comprehensive tests for clientManager and introduce utility functions for client filtering, enhancing test coverage and maintainability by @xizhibei
- Refactor operation execution with retry logic and introduce comprehensive tests for client operations, enhancing error handling and reliability by @xizhibei
- Enhance client capability management by adding filtering functions and updating request handlers to utilize capabilities, improving client interaction and resource management by @xizhibei

### 💼 Other
- Merge pull request #3 from 1mcp-app/dependabot/npm_and_yarn/eslint/js-9.23.0 by @xizhibei in [#3](https://github.com/1mcp-app/agent/pull/3)
- Merge pull request #4 from 1mcp-app/dependabot/npm_and_yarn/ts-jest-29.3.0 by @xizhibei in [#4](https://github.com/1mcp-app/agent/pull/4)
- Merge pull request #5 from 1mcp-app/dependabot/npm_and_yarn/types/express-5.0.1 by @xizhibei in [#5](https://github.com/1mcp-app/agent/pull/5)
- Merge pull request #6 from 1mcp-app/dependabot/npm_and_yarn/eslint-9.23.0 by @xizhibei in [#6](https://github.com/1mcp-app/agent/pull/6)
- Merge pull request #7 from 1mcp-app/dependabot/npm_and_yarn/eslint-plugin-prettier-5.2.4 by @xizhibei in [#7](https://github.com/1mcp-app/agent/pull/7)

### 🚜 Refactor
- Remove log directory creation logic from logger setup, simplifying initialization process by @xizhibei

### ⚙️ Miscellaneous Tasks
- Automate version updates for MCP_SERVER_VERSION and package.json in changelog process by @xizhibei
- Add git-cliff configuration and automate changelog generation in workflows by @xizhibei
- Update inspector command in package.json for simplified usage and adjust README instructions accordingly by @xizhibei
- Automate version updates in package.json by @xizhibei
- Add author and bugs section to package.json for improved metadata and issue tracking by @xizhibei
- Add keywords for better discoverability and update homepage URL to GitHub repository by @xizhibei


## [0.4.0] - 2025-03-23

### ⚙️ Miscellaneous Tasks
- Update package and server version to 0.4.0 for consistency across project by @xizhibei


## [0.3.0] - 2025-03-23

### 🚀 Features
- Add HOST configuration for ExpressServer, allowing customizable host settings for SSE transport by @xizhibei
- Implement comprehensive Jest tests for ServerManager, covering transport connection, disconnection, and management methods to ensure robust functionality and error handling by @xizhibei
- Add Jest configuration and initial tests for ConfigManager, enhancing test coverage and ensuring proper functionality of configuration management by @xizhibei
- Add bug report issue template to streamline bug reporting process and improve user feedback collection by @xizhibei
- Add lint step by @xizhibei
- Add ESLint configuration and integrate TypeScript support, enhancing code quality and consistency across the project by @xizhibei
- Add support for client filtering by tags in transport connections, enhancing server-client interaction and flexibility by @xizhibei

### 🚜 Refactor
- Remove redundant file transport configurations from logger setup, simplifying logging structure and improving maintainability by @xizhibei
- Streamline transport handling in ServerManager and related components, enhancing type safety and maintainability by replacing ClientTransports with a more generic EnhancedTransport interface by @xizhibei
- Update configManager export and improve import structure in configReloadService for better clarity and maintainability by @xizhibei
- Consolidate transport-related types and schemas into a single file, improving organization and type safety across the application by @xizhibei
- Enhance client management with improved error handling and structured types, ensuring better resilience and maintainability in client operations by @xizhibei
- Update client management to use structured types for clients and transports, enhancing type safety and maintainability across the application by @xizhibei

### 📚 Documentation
- Update transport options and add tags section for server filtering, enhancing configuration clarity and usage examples by @xizhibei


## [0.2.0] - 2025-03-19

### 🚀 Features
- Extend transport configuration to support 'http' type, enhancing transport options for improved flexibility by @xizhibei
- Implement global configuration management with dynamic path resolution and default config creation by @xizhibei
- Add Zod schema for transport configuration validation, improving error handling and flexibility in transport creation by @xizhibei
- Refactor client creation to utilize constants for server name and version, enhancing maintainability and consistency across the application by @xizhibei
- Refactor server initialization by introducing ExpressServer class for improved structure and maintainability by @xizhibei
- Enhance ConfigManager to accept custom config file path and update server setup to utilize it by @xizhibei
- Add MCP server capabilities constant and refactor server setup to utilize it by @xizhibei
- Add request/response logging middleware and enhance server with logging capabilities by @xizhibei
- Refactor server setup and introduce ServerManager for improved transport handling and logging by @xizhibei
- Enhance connection handling and logging in MCPTransport class by @xizhibei
- Enhance configuration reload logic with improved transport handling by @xizhibei

### 🚜 Refactor
- Enhance logging middleware with Zod schemas for request and notification validation, improving type safety and error handling by @xizhibei
- Update transport configuration types from MCPTransport to MCPServerParams, enhancing flexibility for transport creation and error handling by @xizhibei
- Restructure logger imports to use dedicated logger directory and enhance logging capabilities across the application by @xizhibei
- Remove defaultMeta from logger and update loggerName in MCP transport to '1mcp' by @xizhibei

### 📚 Documentation
- Update quick start guide and configuration details, enhancing clarity on server setup and usage instructions by @xizhibei

### ⚙️ Miscellaneous Tasks
- Bump version to 0.2.0 and update README for enhanced transport options and configuration management by @xizhibei


## [0.1.0] - 2025-03-16

### 🚀 Features
- Create dependabot.yml by @xizhibei
- Integrate husky and lint-staged for improved pre-commit checks. by @xizhibei
- Add .node-version file and GitHub Actions workflow for package publishing. Introduced a version file for Node.js setup and created a CI workflow to automate package publishing to npm and GitHub Package Registry upon release events. Updated package.json to include repository information and publish configuration. by @xizhibei
- Add yargs and related types for command line argument parsing. Updated package.json and pnpm-lock.yaml to include yargs and its type definitions, enhancing the server's command line interface capabilities. Updated README with usage instructions for new transport options. by @xizhibei
- Rename project to 1MCP and update description for clarity. Changed package name and bin entry to reflect the new branding, and enhanced the project description to emphasize its unified MCP server capabilities. by @xizhibei
- Enhance logger configuration with custom formatting and improved file transport paths. Updated logger to use a custom format for console and file outputs, ensuring better log readability and structured output. Prevent logger from exiting on error to maintain stability. by @xizhibei
- Implement dynamic configuration reload service and configuration manager. Added graceful shutdown handling, integrated configuration watching, and improved transport management during configuration changes. by @xizhibei
- Introduce custom error types and centralized error handling utilities. Added new error codes to constants, implemented error handling in client operations and notification handlers, and enhanced request handlers with partial failure notifications. by @xizhibei
- Refactor server initialization and transport handling. Introduced modular client and transport management, added capability registration, and improved notification handling. Enhanced connection retry logic with configurable settings. by @xizhibei
- Integrate MCP transport for enhanced logging and connection status management. Added winston-transport dependency, updated logger to handle MCP connections, and implemented log level adjustments based on client connections. by @xizhibei
- Add application constants for server configuration and error handling by @xizhibei

### 🐛 Bug Fixes
- Ensure callback is invoked when not connected to maintain log integrity. This change prevents potential log loss by calling the callback function when the transport is not connected. by @xizhibei

### 💼 Other
- Merge pull request #1 from 1mcp-app/dependabot/npm_and_yarn/modelcontextprotocol/sdk-1.7.0 by @xizhibei in [#1](https://github.com/1mcp-app/agent/pull/1)
- Merge pull request #2 from 1mcp-app/dependabot/npm_and_yarn/types/node-22.13.10 by @xizhibei in [#2](https://github.com/1mcp-app/agent/pull/2)
- Enhance transport handling and connection logic. Introduced dynamic transport loading from mcp.json, improved retry logic with exponential backoff for client connections, and updated logging to include JSON stringification of notifications. by @xizhibei

### 🚜 Refactor
- Improve client connection logic with enhanced error handling and exponential backoff. Updated logging for connection attempts and added error handling for client creation failures. by @xizhibei

### 📚 Documentation
- Update project overview and features, enhance server configuration details, and switch to pnpm for dependency management by @xizhibei

### 🎨 Styling
- Update tab width from 4 to 2 spaces for consistency across the codebase. by @xizhibei

### ⚙️ Miscellaneous Tasks
- Add .editorconfig for consistent coding styles and update .gitignore to include additional files and directories by @xizhibei

## New Contributors
* @xizhibei made their first contribution in [#1](https://github.com/1mcp-app/agent/pull/1)
* @dependabot[bot] made their first contribution

[0.28.0]: https://github.com/1mcp-app/agent/compare/v0.27.4..v0.28.0
[0.27.4]: https://github.com/1mcp-app/agent/compare/v0.27.3..v0.27.4
[0.27.3]: https://github.com/1mcp-app/agent/compare/v0.27.2..v0.27.3
[0.27.2]: https://github.com/1mcp-app/agent/compare/v0.27.1..v0.27.2
[0.27.1]: https://github.com/1mcp-app/agent/compare/v0.27.0..v0.27.1
[0.27.0]: https://github.com/1mcp-app/agent/compare/v0.26.1..v0.27.0
[0.26.1]: https://github.com/1mcp-app/agent/compare/v0.26.0..v0.26.1
[0.26.0]: https://github.com/1mcp-app/agent/compare/v0.25.5..v0.26.0
[0.25.5]: https://github.com/1mcp-app/agent/compare/v0.25.4..v0.25.5
[0.25.4]: https://github.com/1mcp-app/agent/compare/v0.25.3..v0.25.4
[0.25.3]: https://github.com/1mcp-app/agent/compare/v0.25.2..v0.25.3
[0.25.2]: https://github.com/1mcp-app/agent/compare/v0.25.1..v0.25.2
[0.25.1]: https://github.com/1mcp-app/agent/compare/v0.25.0..v0.25.1
[0.25.0]: https://github.com/1mcp-app/agent/compare/v0.24.0..v0.25.0
[0.24.0]: https://github.com/1mcp-app/agent/compare/v0.23.2..v0.24.0
[0.23.2]: https://github.com/1mcp-app/agent/compare/v0.23.1..v0.23.2
[0.23.1]: https://github.com/1mcp-app/agent/compare/v0.23.0..v0.23.1
[0.23.0]: https://github.com/1mcp-app/agent/compare/v0.22.3..v0.23.0
[0.22.3]: https://github.com/1mcp-app/agent/compare/v0.22.2..v0.22.3
[0.22.2]: https://github.com/1mcp-app/agent/compare/v0.22.1..v0.22.2
[0.22.1]: https://github.com/1mcp-app/agent/compare/v0.22.0..v0.22.1
[0.22.0]: https://github.com/1mcp-app/agent/compare/v0.21.0..v0.22.0
[0.21.0]: https://github.com/1mcp-app/agent/compare/v0.20.3..v0.21.0
[0.20.3]: https://github.com/1mcp-app/agent/compare/v0.20.2..v0.20.3
[0.20.2]: https://github.com/1mcp-app/agent/compare/v0.20.1..v0.20.2
[0.20.1]: https://github.com/1mcp-app/agent/compare/v0.20.0..v0.20.1
[0.20.0]: https://github.com/1mcp-app/agent/compare/v0.19.0..v0.20.0
[0.19.0]: https://github.com/1mcp-app/agent/compare/v0.18.1..v0.19.0
[0.18.1]: https://github.com/1mcp-app/agent/compare/v0.18.0..v0.18.1
[0.18.0]: https://github.com/1mcp-app/agent/compare/v0.17.0..v0.18.0
[0.17.0]: https://github.com/1mcp-app/agent/compare/v0.16.0..v0.17.0
[0.16.0]: https://github.com/1mcp-app/agent/compare/v0.15.0..v0.16.0
[0.15.0]: https://github.com/1mcp-app/agent/compare/v0.14.0..v0.15.0
[0.14.0]: https://github.com/1mcp-app/agent/compare/v0.13.1..v0.14.0
[0.13.1]: https://github.com/1mcp-app/agent/compare/v0.13.0..v0.13.1
[0.13.0]: https://github.com/1mcp-app/agent/compare/v0.12.0..v0.13.0
[0.12.0]: https://github.com/1mcp-app/agent/compare/v0.11.0..v0.12.0
[0.11.0]: https://github.com/1mcp-app/agent/compare/v0.10.3..v0.11.0
[0.10.3]: https://github.com/1mcp-app/agent/compare/v0.10.2..v0.10.3
[0.10.2]: https://github.com/1mcp-app/agent/compare/v0.10.1..v0.10.2
[0.10.1]: https://github.com/1mcp-app/agent/compare/v0.10.0..v0.10.1
[0.10.0]: https://github.com/1mcp-app/agent/compare/v0.9.0..v0.10.0
[0.9.0]: https://github.com/1mcp-app/agent/compare/v0.8.2..v0.9.0
[0.8.2]: https://github.com/1mcp-app/agent/compare/v0.8.1..v0.8.2
[0.8.1]: https://github.com/1mcp-app/agent/compare/v0.8.0..v0.8.1
[0.8.0]: https://github.com/1mcp-app/agent/compare/v0.7.0..v0.8.0
[0.7.0]: https://github.com/1mcp-app/agent/compare/v0.6.0..v0.7.0
[0.6.0]: https://github.com/1mcp-app/agent/compare/v0.5.0..v0.6.0
[0.5.0]: https://github.com/1mcp-app/agent/compare/v0.4.0..v0.5.0
[0.4.0]: https://github.com/1mcp-app/agent/compare/v0.3.0..v0.4.0
[0.3.0]: https://github.com/1mcp-app/agent/compare/v0.2.0..v0.3.0
[0.2.0]: https://github.com/1mcp-app/agent/compare/v0.1.0..v0.2.0

<!-- generated by git-cliff -->

# Contributing to 1MCP

We love your input! We want to make contributing to 1MCP as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Table of Contents

- [Development Process](#development-process)
- [Getting Started](#getting-started)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Platform-Specific Contributions](#platform-specific-contributions)
- [Documentation Guidelines](#documentation-guidelines)
- [Community Guidelines](#community-guidelines)

## Development Process

We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## Getting Started

### Prerequisites

- Node.js 18+ or 20+
- pnpm (recommended) or npm
- TypeScript 5.3+
- Git
- @modelcontextprotocol/sdk ^1.15.0 (automatically installed)

### Setting Up Your Development Environment

1. **Fork and Clone**

   ```bash
   # Fork the repository on GitHub, then clone your fork
   git clone https://github.com/1mcp-app/agent.git
   cd agent
   ```

2. **Install Dependencies**

   ```bash
   pnpm install
   ```

3. **Build the Project**

   ```bash
   pnpm build
   ```

4. **Run Tests**

   ```bash
   # Run unit tests
   pnpm test:unit

   # Run E2E tests
   pnpm test:e2e

   # Run all tests
   pnpm test:unit && pnpm test:e2e
   ```

5. **Start Development Server**
   ```bash
   pnpm dev
   ```

### Project Structure

Understanding the codebase structure will help you contribute effectively:

```
agent/
├── src/
│   ├── auth/                  # Authentication & OAuth 2.1 system
│   │   ├── clientSessionManager.ts
│   │   ├── serverSessionManager.ts
│   │   ├── sdkOAuthClientProvider.ts
│   │   ├── sdkOAuthServerProvider.ts
│   │   ├── sessionTypes.ts
│   │   └── authMiddleware.ts
│   ├── capabilities/          # Server capability management
│   ├── config/               # Configuration management (McpConfigManager)
│   ├── core/                 # Core business logic & domain models
│   │   ├── server/           # Server management (ServerManager, AgentConfigManager)
│   │   ├── client/           # Client management (ClientManager, ClientFactory)
│   │   └── types/            # Domain-specific type definitions
│   ├── handlers/             # MCP request/notification handlers
│   ├── logger/               # Structured logging system
│   ├── services/             # Background services (config reload, etc.)
│   ├── transport/            # Transport layer implementations
│   │   ├── http/             # HTTP/Express transport
│   │   │   ├── server.ts     # Express server implementation
│   │   │   ├── routes/       # HTTP endpoint handlers
│   │   │   │   ├── oauthRoutes.ts      # OAuth endpoint handlers
│   │   │   │   ├── sseRoutes.ts        # Server-sent events routes
│   │   │   │   └── streamableHttpRoutes.ts # HTTP streaming routes
│   │   │   └── middlewares/  # HTTP middleware functions
│   │   │       ├── errorHandler.ts     # Error handling middleware
│   │   │       ├── scopeAuthMiddleware.ts # Scope-based authentication
│   │   │       ├── securityMiddleware.ts # Security middleware
│   │   │       └── tagsExtractor.ts    # Tag extraction middleware
│   │   └── transportFactory.ts # Transport factory pattern
│   ├── utils/                # Shared utility functions
│   │   ├── clientFiltering.ts # Client filtering utilities
│   │   ├── errorHandling.ts   # Error handling utilities
│   │   ├── errorTypes.ts      # Error type definitions
│   │   ├── pagination.ts      # Result pagination utilities
│   │   ├── parsing.ts         # Input parsing utilities
│   │   ├── sanitization.ts    # Security input sanitization
│   └── e2e/                  # End-to-end tests
│       ├── demo/             # Infrastructure demonstration tests
│       ├── fixtures/         # Test server implementations
│       ├── http/             # HTTP transport integration tests
│       ├── integration/      # Multi-transport and performance tests
│       ├── setup/            # Global test setup/teardown
│       ├── stdio/            # STDIO transport tests
│       └── utils/            # Test utilities and helpers
├── docs/                     # Documentation
│   ├── ARCHITECTURE.md       # Technical architecture documentation
│   ├── SECURITY.md          # Security guidelines and practices
│   ├── asserts/             # Documentation assets
│   └── plans/               # Development planning documents
│   │   └── scopeValidation.ts # OAuth scope validation
│   └── types.ts              # Global type definitions
├── docs/                     # Documentation
├── test/                     # Test files
└── build/                    # Compiled output
```

## Pull Request Process

### Before You Submit

1. **Check for existing issues/PRs** - Search for existing issues or pull requests related to your change
2. **Create an issue first** - For significant changes, please create an issue to discuss the proposed changes
3. **Follow the coding standards** - Ensure your code follows the project's coding standards
4. **Write tests** - Add tests for any new functionality
5. **Update documentation** - Update relevant documentation for your changes

### Pull Request Guidelines

1. **Use a clear and descriptive title**

   ```
   Good: Add retry logic for MCP server connections
   Bad: Fix bug
   ```

2. **Provide a detailed description**
   - What changes were made and why
   - Link to related issues
   - Include screenshots for UI changes
   - List any breaking changes

3. **Follow the PR template**

   ```markdown
   ## Description

   Brief description of changes

   ## Type of Change

   - [ ] Bug fix (non-breaking change which fixes an issue)
   - [ ] New feature (non-breaking change which adds functionality)
   - [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
   - [ ] Documentation update

   ## Testing

   - [ ] Tests pass locally
   - [ ] Added tests for new functionality
   - [ ] Manual testing completed

   ## Checklist

   - [ ] Code follows the style guidelines
   - [ ] Self-review completed
   - [ ] Documentation updated
   - [ ] No console.log statements left
   ```

4. **Keep PRs focused** - One feature/fix per PR when possible

5. **Ensure CI passes** - All automated checks must pass

### Review Process

1. **Automated Checks** - CI must pass (tests, linting, build)
2. **Code Review** - At least one maintainer must approve
3. **Testing** - Manual testing may be required for complex changes
4. **Documentation Review** - Documentation changes are reviewed for clarity and accuracy

## Issue Guidelines

### Reporting Bugs

Before creating a bug report, please check the existing issues to avoid duplicates.

**Use this template for bug reports:**

```markdown
## Bug Description

A clear and concise description of the bug.

## Steps to Reproduce

1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

## Expected Behavior

A clear description of what you expected to happen.

## Actual Behavior

A clear description of what actually happened.

## Environment

- OS: [e.g. macOS 14.0]
- Node.js version: [e.g. 20.10.0]
- 1MCP version: [e.g. 0.12.0]
- AI Client: [e.g. Claude Desktop, Cursor]

## Additional Context

Add any other context about the problem here.
```

### Feature Requests

**Use this template for feature requests:**

```markdown
## Feature Description

A clear and concise description of the feature you'd like to see.

## Problem Statement

What problem does this feature solve?

## Proposed Solution

Describe your proposed solution.

## Alternatives Considered

Describe any alternative solutions you've considered.

## Additional Context

Add any other context or screenshots about the feature request here.
```

## Coding Standards

### TypeScript Guidelines

1. **Use TypeScript strict mode** - All code must pass strict type checking
2. **Explicit types** - Use explicit types for function parameters and return values
3. **Interfaces over types** - Prefer interfaces for object types
4. **No `any` types** - Avoid using `any`; use proper typing

```typescript
// Good
interface ServerConfig {
  name: string;
  port: number;
  enabled: boolean;
}

function createServer(config: ServerConfig): Promise<Server> {
  // implementation
}

// Avoid
function createServer(config: any): any {
  // implementation
}
```

### Code Style

1. **ESLint configuration** - Follow the project's ESLint rules
2. **Prettier formatting** - Use Prettier for consistent formatting
3. **Naming conventions**:
   - `camelCase` for variables and functions
   - `PascalCase` for classes and interfaces
   - `UPPER_SNAKE_CASE` for constants

4. **File organization**:
   - One class/interface per file
   - Group related functionality
   - Clear import organization

### Error Handling

1. **Use specific error types** - Create custom error classes when appropriate
2. **Proper error propagation** - Don't swallow errors silently
3. **Logging** - Use the project's logging system

```typescript
// Good
import { MCPError, ErrorType } from './utils/errorTypes';

try {
  await connectToServer();
} catch (error) {
  logger.error('Failed to connect to server:', error);
  throw new MCPError(ErrorType.CONNECTION_ERROR, 'Server connection failed', error);
}

// Avoid
try {
  await connectToServer();
} catch (error) {
  // Silent failure
}
```

### Performance Considerations

1. **Async/await** - Use async/await over promises where possible
2. **Resource cleanup** - Properly clean up resources (connections, timers, etc.)
3. **Memory management** - Avoid memory leaks in long-running processes

## Testing Guidelines

### Test Structure

1. **Test files** - Place tests next to the code they test with `.test.ts` extension
2. **Test organization** - Group related tests using `describe` blocks
3. **Test naming** - Use descriptive test names

```typescript
describe('ServerManager', () => {
  describe('connectToServer', () => {
    it('should successfully connect to a valid MCP server', async () => {
      // Test implementation
    });

    it('should throw error when connection fails', async () => {
      // Test implementation
    });
  });
});
```

5. **Co-located unit tests** - Place unit tests next to source files with `.test.ts` extension
6. **E2E test fixtures** - Use dedicated test servers in `/test/e2e/fixtures/`

### Test Types

1. **Unit Tests** - Test individual functions/methods (co-located with source files)
2. **Integration Tests** - Test component interactions (included in E2E suite)
3. **End-to-End Tests** - Test complete workflows (separate test directory with fixtures)

### Test Framework

We use **Vitest** as our testing framework:

- **Unit Tests:** Fast, parallel execution with coverage
- **E2E Tests:** Sequential execution with longer timeouts
- **Coverage:** V8 provider with HTML/JSON/text reporting
- **Global Setup:** E2E tests have dedicated setup/teardown infrastructure

### Testing Best Practices

1. **Arrange, Act, Assert** - Structure tests clearly
2. **Mock external dependencies** - Use mocks for external services
3. **Test edge cases** - Include error conditions and boundary cases
4. **Cleanup** - Clean up resources after tests

### Running Tests

```bash
# Unit tests (fast, parallel)
pnpm test:unit
pnpm test:unit:watch
pnpm test:unit:coverage

# E2E tests (sequential, with fixtures)
pnpm test:e2e
pnpm test:e2e:watch
pnpm test:e2e:coverage

# Debug with MCP Inspector
pnpm inspector
```

## Platform-Specific Contributions

### Current Platform Support Status

**1MCP currently has different levels of support across platforms:**

- **🟢 macOS (darwin):** Fully tested and verified - primary development platform
- **🟡 Windows (win32):** Paths researched but untested - **community help needed**
- **🟡 Linux:** Paths researched but untested - **community help needed**

### How You Can Help

**We urgently need contributors on Windows and Linux to help verify and improve platform support!**

#### For Windows Users

1. **Test App Integration Paths**
   - Uncomment Windows sections in `src/utils/appPresets.ts`
   - Test with apps like Claude Desktop, VS Code, Cursor
   - Verify configuration file locations are correct

2. **Common Windows Paths to Verify:**
   ```
   Claude Desktop: %APPDATA%\Claude\claude_desktop_config.json
   VS Code: %APPDATA%\Code\User\settings.json
   Cursor: %APPDATA%\Cursor\User\settings.json
   ```

#### For Linux Users

1. **Test App Integration Paths**
   - Uncomment Linux sections in `src/utils/appPresets.ts`
   - Test with apps that follow XDG Base Directory specification
   - Verify paths match your distribution's conventions

2. **Common Linux Paths to Verify:**
   ```
   Claude Desktop: ~/.config/claude/claude_desktop_config.json
   VS Code: ~/.config/Code/User/settings.json
   Cursor: ~/.cursor/mcp.json
   ```

#### Testing Process

1. **Fork and Setup**

   ```bash
   git clone https://github.com/YOUR-USERNAME/agent.git
   cd agent
   pnpm install
   ```

2. **Enable Platform Paths**
   - Edit `src/utils/appPresets.ts`
   - Uncomment your platform's path configurations
   - Build: `pnpm build`

3. **Test App Discovery**

   ```bash
   # Test app discovery
   npx @1mcp/agent app discover

   # Test app listing
   npx @1mcp/agent app list

   # Test consolidation (if you have the apps installed)
   npx @1mcp/agent app consolidate claude-desktop
   ```

4. **Report Results**
   - Create an issue with your findings
   - Include your OS version, app versions, and test results
   - Submit a PR with working path corrections

#### Contribution Priority

**High Priority Apps (please test first):**

- Claude Desktop
- VS Code
- Cursor

**Medium Priority Apps:**

- Cline (VS Code extension)
- Continue (VS Code extension)
- Roo Code

#### Issue Template for Platform Testing

When reporting platform-specific issues, please use:

```markdown
## Platform Testing Report

**Platform:** Windows 11 / Ubuntu 22.04 / etc.
**App:** Claude Desktop / VS Code / etc.
**1MCP Version:** [version number]

### Test Results

- [ ] App discovery works
- [ ] Configuration path is correct
- [ ] App consolidation works
- [ ] MCP servers integrate properly

### Issues Found

[Describe any problems encountered]

### Suggested Fixes

[Propose corrections if you found working paths]

### Additional Notes

[Any other relevant information]
```

### Platform-Specific Development

#### Path Resolution Testing

Add tests for your platform in the test suite:

```typescript
describe('Platform-specific paths', () => {
  it('should resolve Windows paths correctly', () => {
    // Test Windows path resolution
  });

  it('should resolve Linux paths correctly', () => {
    // Test Linux path resolution
  });
});
```

#### Environment-Specific Configuration

Consider platform differences:

- File system case sensitivity
- Path separators
- Environment variable conventions
- Default application installation locations

### Recognition

**Platform contributors will be specifically recognized in:**

- Release notes
- Platform support documentation
- Contributor acknowledgments

Your help makes 1MCP work for everyone! 🌍

```typescript
import { vi } from 'vitest';

describe('ClientManager', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should retry failed connections with exponential backoff', async () => {
    // Arrange
    const mockTransport = vi.fn().mockRejectedValueOnce(new Error('Connection failed'));

    // Act
    const result = await clientManager.connect(mockTransport);

    // Assert
    expect(mockTransport).toHaveBeenCalledTimes(3);
  });
});
```

## Documentation Guidelines

### Code Documentation

1. **JSDoc comments** - Document public APIs
2. **Inline comments** - Explain complex logic
3. **README updates** - Update README for user-facing changes

```typescript
/**
 * Connects to an MCP server with retry logic and exponential backoff.
 *
 * @param transport - The transport configuration for the server
 * @param options - Connection options including retry settings
 * @returns Promise that resolves to the connected server instance
 * @throws {MCPError} When connection fails after all retries
 */
async connectToServer(
  transport: Transport,
  options: ConnectionOptions = {}
): Promise<Server> {
  // Implementation
}
```

### Architecture Documentation

1. **Design decisions** - Document significant architectural choices
2. **Patterns used** - Explain design patterns and their benefits
3. **Data flow** - Document how data flows through the system

### User Documentation

1. **Clear examples** - Provide working code examples
2. **Step-by-step guides** - Break down complex procedures
3. **Troubleshooting** - Include common issues and solutions

## Community Guidelines

### Communication

1. **Be respectful** - Treat everyone with respect and kindness
2. **Be constructive** - Provide helpful feedback and suggestions
3. **Be patient** - Remember that maintainers are volunteers
4. **Ask questions** - Don't hesitate to ask for clarification

### Getting Help

1. **Check documentation** - Review existing docs first
2. **Search issues** - Look for existing discussions
3. **Create detailed issues** - Provide context and examples
4. **Join discussions** - Participate in community discussions

### Recognition

**Current Version:** 0.12.0

### Development Workflow

1. **Pre-commit hooks** - Husky ensures code quality before commits
2. **Lint-staged** - Only lint changed files for faster feedback
3. **Hot-reload** - Development server with automatic rebuild
4. **Configuration hot-reload** - MCP server configuration updates without restart

We value all contributions, including:

- Code contributions
- Documentation improvements
- Bug reports
- Feature suggestions
- Community support
- Testing and feedback

Contributors will be recognized in our release notes and contributor lists.

## Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **Major** (1.0.0) - Breaking changes
- **Minor** (0.1.0) - New features, backwards compatible
- **Patch** (0.0.1) - Bug fixes, backwards compatible

### Changelog

All notable changes are documented in [CHANGELOG.md](CHANGELOG.md) following [Keep a Changelog](https://keepachangelog.com/) format.

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (Apache License 2.0).

## Questions?

If you have questions about contributing, please:

1. Check the existing documentation
2. Search through past issues
3. Create a new issue with the question label
4. Reach out to maintainers

Thank you for contributing to 1MCP! 🚀

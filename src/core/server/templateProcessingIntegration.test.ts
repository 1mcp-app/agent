import type { MCPServerParams } from '@src/core/types/transport.js';
import { TemplateParser } from '@src/template/templateParser.js';
import { TemplateVariableExtractor } from '@src/template/templateVariableExtractor.js';
import { extractContextFromHeadersOrQuery } from '@src/transport/http/utils/contextExtractor.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Template Processing Integration', () => {
  let extractor: TemplateVariableExtractor;
  let mockContext: ContextData;

  beforeEach(() => {
    extractor = new TemplateVariableExtractor();
    mockContext = {
      project: {
        path: '/test/project',
        name: '1mcp-agent',
        git: {
          branch: 'feat/proxy-agent-context',
          commit: 'abc123def456',
        },
        custom: {
          projectId: 'proj-123',
          environment: 'dev',
        },
      },
      user: {
        name: 'Developer',
        email: 'dev@example.com',
        username: 'devuser',
      },
      environment: {
        variables: {
          NODE_ENV: 'development',
          API_KEY: 'secret-key',
        },
      },
      sessionId: 'test-session-123',
      timestamp: '2024-12-16T23:12:00Z',
      version: 'v0.27.4',
    };
  });

  afterEach(() => {
    extractor.clearCache();
    vi.clearAllMocks();
  });

  describe('Complete Template Processing Flow', () => {
    it('should process serena template with project.path variable', () => {
      const templateConfig: MCPServerParams = {
        type: 'stdio',
        command: 'uv',
        args: [
          'run',
          '--directory',
          '/test/serena',
          'serena',
          'start-mcp-server',
          '--context',
          'ide-assistant',
          '--project',
          '{project.path}',
        ],
        tags: ['serena'],
        env: {
          SERENA_ENV: '{environment.variables.NODE_ENV}',
          SESSION_ID: '{sessionId}',
        },
      };

      // FIXED: Extract variables including undefined values
      const templateVariables = extractor.getUsedVariables(templateConfig, mockContext);

      expect(templateVariables).toEqual({
        'project.path': '/test/project', // From context
        'environment.variables.NODE_ENV': 'development', // From context
        // NOTE: sessionId is not extracted because it's not in the template config
      });

      // Verify template variable extraction
      const extractedVars = extractor.extractTemplateVariables(templateConfig);
      expect(extractedVars).toHaveLength(2);

      const paths = extractedVars.map((v) => v.path);
      expect(paths).toContain('project.path');
      expect(paths).toContain('environment.variables.NODE_ENV');
    });

    it('should extract context from individual X-Context-* headers', () => {
      const mockRequest = {
        query: {},
        headers: {
          'x-context-project-name': '1mcp-agent',
          'x-context-project-path': '/test/project',
          'x-context-user-name': 'Developer',
          'x-context-user-email': 'dev@example.com',
          'x-context-environment-name': 'development',
          'x-context-session-id': 'test-session-123',
          'x-context-timestamp': '2024-12-16T23:12:00Z',
          'x-context-version': 'v0.27.4',
        },
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as any);

      expect(context).toEqual({
        project: {
          path: '/test/project',
          name: '1mcp-agent',
        },
        user: {
          name: 'Developer',
          email: 'dev@example.com',
        },
        environment: {
          variables: {
            name: 'development',
          },
        },
        sessionId: 'test-session-123',
        timestamp: '2024-12-16T23:12:00Z',
        version: 'v0.27.4',
      });
    });

    it('should handle the complete flow from headers to template variables', () => {
      // Step 1: Extract context from headers
      const mockRequest = {
        query: {},
        headers: {
          'x-context-project-path': '/test/project',
          'x-context-session-id': 'test-complete-flow',
        },
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as any);
      expect(context).toBeDefined();
      expect(context?.sessionId).toBe('test-complete-flow');
      expect(context?.project?.path).toBe('/test/project');

      // Step 2: Process template with extracted context
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.path}', '{session.sessionId}'],
        env: {
          PROJECT_CONTEXT: '{project.name}: {user.name}',
        },
      };

      const templateVariables = extractor.getUsedVariables(templateConfig, context as ContextData);

      // Should include all variables even with undefined values
      expect(templateVariables).toEqual({
        'project.path': '/test/project', // From context
        'session.sessionId': 'test-complete-flow', // From context
        'project.name': undefined, // Not in context but still included
        'user.name': undefined, // Not in context but still included
      });

      // Verify the actual template variable extraction
      const extractedVars = extractor.extractTemplateVariables(templateConfig);
      expect(extractedVars).toHaveLength(4);
    });

    it('should demonstrate the fix for undefined variable handling', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}', '{user.email}', '{missing.field:default-value}'],
      };

      // Context where some fields are undefined
      const partialContext: ContextData = {
        ...mockContext,
        project: {
          ...mockContext.project,
          name: undefined, // This field is undefined - should still be included
        },
        user: {
          ...mockContext.user,
          email: undefined, // This field is undefined - should still be included
        },
      };

      const templateVariables = extractor.getUsedVariables(templateConfig, partialContext);

      // FIXED: All variables should be included even when values are undefined
      expect(templateVariables).toEqual({
        'project.name': undefined, // Undefined value included
        'user.email': undefined, // Undefined value included
        'missing.field': 'default-value', // Default value for non-existent variable
      });
    });

    it('should create variable hash for consistent instance pooling', () => {
      const templateConfig: MCPServerParams = {
        command: 'serena',
        args: ['--project', '{project.path}'],
      };

      // Create hash with the context data
      const templateVariables = extractor.getUsedVariables(templateConfig, mockContext);
      const hash1 = extractor.createVariableHash(templateVariables);

      // Same context should produce same hash
      const hash2 = extractor.createVariableHash(templateVariables);
      expect(hash1).toBe(hash2);

      // Different context should produce different hash (change project.path which is actually used)
      const differentContext = { ...mockContext, project: { ...mockContext.project, path: '/different/path' } };
      const differentVariables = extractor.getUsedVariables(templateConfig, differentContext);
      const hash3 = extractor.createVariableHash(differentVariables);
      expect(hash3).not.toBe(hash1);
    });

    it('should support the complete template processing workflow for MCP servers', () => {
      // This test simulates the complete workflow that was fixed

      // 1. HTTP request with X-Context-* headers
      const mockHttpRequest = {
        query: { preset: 'dev-backend' },
        headers: {
          'x-context-project-name': 'integration-test',
          'x-context-project-path': '/test/integration',
          'x-context-user-name': 'Integration User',
          'x-context-environment-name': 'test',
          'x-context-session-id': 'integration-session-123',
        },
      };

      // 2. Extract context from headers
      const extractedContext = extractContextFromHeadersOrQuery(mockHttpRequest as any);
      expect(extractedContext).toBeDefined();
      expect(extractedContext?.project?.path).toBe('/test/integration');
      expect(extractedContext?.sessionId).toBe('integration-session-123');

      // 3. Load template configuration (simulating .tmp/mcp.json serena template)
      const serenaTemplate: MCPServerParams = {
        type: 'stdio',
        command: 'uv',
        args: [
          'run',
          '--directory',
          '/test/serena',
          'serena',
          'start-mcp-server',
          '--context',
          'ide-assistant',
          '--project',
          '{project.path}', // This should be substituted with the context
        ],
        tags: ['serena'],
      };

      // 4. Extract template variables
      const serenaVariables = extractor.getUsedVariables(serenaTemplate, extractedContext as ContextData);
      expect(serenaVariables).toEqual({
        'project.path': '/test/integration',
      });

      // 5. Verify variable extraction and hash creation for server pooling
      const serenaExtractedVars = extractor.extractTemplateVariables(serenaTemplate);
      expect(serenaExtractedVars).toHaveLength(1);
      expect(serenaExtractedVars[0].path).toBe('project.path');

      const serenaHash = extractor.createVariableHash(serenaVariables);
      expect(serenaHash).toMatch(/^[a-f0-9]+$/); // hex string (length varies with SHA implementation)

      // This demonstrates the complete flow working end-to-end
      expect(serenaExtractedVars[0].namespace).toBe('project');
      expect(serenaExtractedVars[0].key).toBe('path');
    });
  });

  describe('Template Processing Edge Cases', () => {
    it('should handle mixed header and query parameter contexts', () => {
      const mockRequest = {
        query: {
          project_path: '/query/path',
          project_name: 'query-project',
          context_session_id: 'test-mixed-session', // Required for query context to be valid
        },
        headers: {
          'x-context-project-path': '/header/path',
          'x-context-project-name': 'header-project',
          'x-context-session-id': 'test-mixed-session',
        },
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as any);

      // Query parameters should take priority when present (with required session_id)
      expect(context?.project?.path).toBe('/query/path');
      expect(context?.project?.name).toBe('query-project');
      expect(context?.sessionId).toBe('test-mixed-session');
    });

    it('should handle complex nested template variables', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.custom.projectId}', '{environment.variables.NODE_ENV}', '{context.timestamp}'],
      };

      const templateVariables = extractor.getUsedVariables(templateConfig, mockContext);

      expect(templateVariables).toEqual({
        'project.custom.projectId': 'proj-123',
        'environment.variables.NODE_ENV': 'development',
        'context.timestamp': '2024-12-16T23:12:00Z', // timestamp from context
      });
    });

    it('should handle empty or minimal contexts gracefully', () => {
      const minimalContext: ContextData = {
        project: { path: '/minimal' },
        user: {},
        environment: { variables: {} },
        sessionId: 'minimal-session',
      };

      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.path}'],
      };

      const templateVariables = extractor.getUsedVariables(templateConfig, minimalContext);
      expect(templateVariables).toEqual({
        'project.path': '/minimal',
      });
    });
  });

  describe('Template Function Execution Tests', () => {
    let templateParser: TemplateParser;

    beforeEach(() => {
      templateParser = new TemplateParser({ strictMode: false, defaultValue: '[ERROR]' });
    });

    it('should execute uppercase function on project name', () => {
      const template = 'echo "{project.name | upper}"';
      const result = templateParser.parse(template, mockContext);

      expect(result.processed).toBe('echo "1MCP-AGENT"');
      expect(result.errors).toHaveLength(0);
    });

    it('should execute multiple functions in sequence', () => {
      const template = '{project.path | basename | upper}';
      const result = templateParser.parse(template, mockContext);

      expect(result.processed).toBe('PROJECT');
      expect(result.errors).toHaveLength(0);
    });

    it('should execute truncate function with arguments', () => {
      const template = '{project.name | truncate(5)}';
      const result = templateParser.parse(template, mockContext);

      expect(result.processed).toBe('1mcp-...');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle function execution errors gracefully', () => {
      const template = '{project.name | nonexistent_function}';
      const result = templateParser.parse(template, mockContext);

      expect(result.processed).toBe('[ERROR]');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Template function 'nonexistent_function' failed");
    });
  });

  describe('Rich Context Integration Tests', () => {
    it('should use project custom variables from context', () => {
      const richContext: ContextData = {
        ...mockContext,
        project: {
          ...mockContext.project,
          custom: {
            projectId: 'my-awesome-app',
            team: 'platform',
            apiEndpoint: 'https://api.dev.local',
            debugMode: true,
          },
        },
      };

      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.custom.projectId}', '{project.custom.apiEndpoint}'],
      };

      const templateVariables = extractor.getUsedVariables(templateConfig, richContext);

      expect(templateVariables).toEqual({
        'project.custom.projectId': 'my-awesome-app',
        'project.custom.apiEndpoint': 'https://api.dev.local',
      });
    });

    it('should include environment variables with prefixes', () => {
      const richContext: ContextData = {
        ...mockContext,
        environment: {
          variables: {
            NODE_VERSION: 'v20.0.0',
            PLATFORM: 'darwin',
            MY_APP_API_KEY: 'secret-key',
            MY_APP_FEATURE_FLAG: 'beta',
            API_BASE_URL: 'https://api.example.com',
            SOME_OTHER_VAR: 'value',
          },
        },
      };

      const templateConfig: MCPServerParams = {
        command: 'echo',
        env: {
          APP_KEY: '{environment.variables.MY_APP_API_KEY}',
          BASE_URL: '{environment.variables.API_BASE_URL}',
        },
      };

      const templateVariables = extractor.getUsedVariables(templateConfig, richContext);

      expect(templateVariables).toEqual({
        'environment.variables.MY_APP_API_KEY': 'secret-key',
        'environment.variables.API_BASE_URL': 'https://api.example.com',
      });
    });

    it('should demonstrate complete template processing with functions and rich context', () => {
      const richContext: ContextData = {
        ...mockContext,
        project: {
          ...mockContext.project,
          name: 'my-awesome-app',
          custom: {
            environment: 'production',
            version: '2.1.0',
          },
        },
        environment: {
          variables: {
            MY_APP_FEATURES: 'new-ui,beta-api',
          },
        },
      };

      const templateParser = new TemplateParser();
      const complexTemplate =
        '{project.name | upper}-v{project.custom.version} [{environment.variables.MY_APP_FEATURES}]';
      const result = templateParser.parse(complexTemplate, richContext);

      expect(result.processed).toBe('MY-AWESOME-APP-v2.1.0 [new-ui,beta-api]');
      expect(result.errors).toHaveLength(0);
    });
  });
});

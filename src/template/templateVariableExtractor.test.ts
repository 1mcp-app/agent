import type { MCPServerParams } from '@src/core/types/transport.js';
import { TemplateVariableExtractor } from '@src/template/templateVariableExtractor.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('TemplateVariableExtractor', () => {
  let extractor: TemplateVariableExtractor;
  let mockContext: ContextData;

  beforeEach(() => {
    extractor = new TemplateVariableExtractor();
    mockContext = {
      project: {
        path: '/test/project',
        name: 'test-project',
        git: {
          branch: 'main',
          commit: 'abc123',
        },
        custom: {
          projectId: 'proj-123',
          environment: 'dev',
        },
      },
      user: {
        name: 'Test User',
        email: 'test@example.com',
        username: 'testuser',
      },
      environment: {
        variables: {
          NODE_ENV: 'development',
          API_KEY: 'secret-key',
        },
      },
      sessionId: 'session-123',
      timestamp: '2024-01-01T00:00:00Z',
      version: 'v1',
    };
  });

  afterEach(() => {
    extractor.clearCache();
  });

  describe('Template Variable Extraction', () => {
    it('should extract variables from command', () => {
      const config: MCPServerParams = {
        command: 'echo "{project.name}"',
      };

      const variables = extractor.extractTemplateVariables(config);

      expect(variables).toHaveLength(1);
      expect(variables[0]).toEqual({
        path: 'project.name',
        namespace: 'project',
        key: 'name',
        optional: false,
      });
    });

    it('should extract variables from args array', () => {
      const config: MCPServerParams = {
        command: 'echo',
        args: ['--path', '{project.path}', '--user', '{user.username}'],
      };

      const variables = extractor.extractTemplateVariables(config);

      expect(variables).toHaveLength(2);
      expect(variables[0]).toEqual({
        path: 'project.path',
        namespace: 'project',
        key: 'path',
        optional: false,
      });
      expect(variables[1]).toEqual({
        path: 'user.username',
        namespace: 'user',
        key: 'username',
        optional: false,
      });
    });

    it('should extract variables from environment variables', () => {
      const config: MCPServerParams = {
        command: 'node',
        env: {
          PROJECT_NAME: '{project.name}',
          USER_EMAIL: '{user.email:default@example.com}',
        },
      };

      const variables = extractor.extractTemplateVariables(config);

      expect(variables).toHaveLength(2);
      expect(variables[0]).toEqual({
        path: 'project.name',
        namespace: 'project',
        key: 'name',
        optional: false,
      });
      expect(variables[1]).toEqual({
        path: 'user.email',
        namespace: 'user',
        key: 'email',
        optional: true,
        defaultValue: 'default@example.com',
      });
    });

    it('should extract variables from headers', () => {
      const config: MCPServerParams = {
        type: 'http',
        url: 'https://api.example.com',
        headers: {
          'X-Project': '{project.name}',
          'X-User': '{user.username}',
          'X-Session': '{context.sessionId}',
        },
      };

      const variables = extractor.extractTemplateVariables(config);

      expect(variables).toHaveLength(3);
      expect(variables.map((v) => v.path)).toEqual(['project.name', 'user.username', 'context.sessionId']);
    });

    it('should extract variables from cwd', () => {
      const config: MCPServerParams = {
        command: 'npm',
        cwd: '{project.path}',
      };

      const variables = extractor.extractTemplateVariables(config);

      expect(variables).toHaveLength(1);
      expect(variables[0]).toEqual({
        path: 'project.path',
        namespace: 'project',
        key: 'path',
        optional: false,
      });
    });

    it('should handle empty configuration', () => {
      const config: MCPServerParams = {
        command: 'echo',
        args: ['static', 'args'],
      };

      const variables = extractor.extractTemplateVariables(config);

      expect(variables).toHaveLength(0);
    });

    it('should handle duplicate variables', () => {
      const config: MCPServerParams = {
        command: 'echo "{project.name}" and {project.name}',
      };

      const variables = extractor.extractTemplateVariables(config);

      expect(variables).toHaveLength(1);
      expect(variables[0].path).toBe('project.name');
    });
  });

  describe('Used Variables Extraction', () => {
    it('should extract only variables used by template', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}', '{user.username}'],
      };

      const usedVariables = extractor.getUsedVariables(templateConfig, mockContext);

      expect(usedVariables).toEqual({
        'project.name': 'test-project',
        'user.username': 'testuser',
      });
    });

    it('should include default values for optional variables', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{user.email:default@example.com}', '{nonexistent:value}'],
      };

      const usedVariables = extractor.getUsedVariables(templateConfig, mockContext);

      expect(usedVariables).toEqual({
        'user.email': 'test@example.com',
        'nonexistent:value': 'value',
      });
    });

    it('should handle custom context namespace', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.custom.projectId}'],
      };

      const usedVariables = extractor.getUsedVariables(templateConfig, mockContext);

      expect(usedVariables).toEqual({
        'project.custom.projectId': 'proj-123',
      });
    });

    it('should handle environment variables', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        env: {
          NODE_ENV: '{environment.variables.NODE_ENV}',
        },
      };

      const usedVariables = extractor.getUsedVariables(templateConfig, mockContext);

      expect(usedVariables).toEqual({
        'environment.variables.NODE_ENV': 'development',
      });
    });

    it('should respect includeOptional option', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{user.email:default@example.com}'],
      };

      // With includeOptional = false
      const withoutOptional = extractor.getUsedVariables(templateConfig, mockContext, {
        includeOptional: false,
      });
      expect(withoutOptional).toEqual({});

      // With includeOptional = true (default)
      const withOptional = extractor.getUsedVariables(templateConfig, mockContext);
      expect(withOptional).toEqual({
        'user.email': 'test@example.com',
      });
    });

    it('should respect includeEnvironment option', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}', '{environment.variables.NODE_ENV}'],
      };

      // With includeEnvironment = false
      const withoutEnv = extractor.getUsedVariables(templateConfig, mockContext, {
        includeEnvironment: false,
      });
      expect(withoutEnv).toEqual({
        'project.name': 'test-project',
      });

      // With includeEnvironment = true (default)
      const withEnv = extractor.getUsedVariables(templateConfig, mockContext);
      expect(withEnv).toEqual({
        'project.name': 'test-project',
        'environment.variables.NODE_ENV': 'development',
      });
    });
  });

  describe('Variable Hash Creation', () => {
    it('should create consistent hash for same variables', () => {
      const variables1 = { 'project.name': 'test', 'user.username': 'user1' };
      const variables2 = { 'user.username': 'user1', 'project.name': 'test' };

      const hash1 = extractor.createVariableHash(variables1);
      const hash2 = extractor.createVariableHash(variables2);

      expect(hash1).toBe(hash2);
    });

    it('should create different hashes for different variables', () => {
      const variables1 = { 'project.name': 'test1' };
      const variables2 = { 'project.name': 'test2' };

      const hash1 = extractor.createVariableHash(variables1);
      const hash2 = extractor.createVariableHash(variables2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty variables', () => {
      const hash = extractor.createVariableHash({});
      expect(hash).toBeDefined();
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe('Template Key Creation', () => {
    it('should create consistent key for same template', () => {
      const config1: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
      };
      const config2: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
      };

      const key1 = extractor.createTemplateKey(config1);
      const key2 = extractor.createTemplateKey(config2);

      expect(key1).toBe(key2);
    });

    it('should create different keys for different templates', () => {
      const config1: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
      };
      const config2: MCPServerParams = {
        command: 'echo',
        args: ['{user.username}'],
      };

      const key1 = extractor.createTemplateKey(config1);
      const key2 = extractor.createTemplateKey(config2);

      expect(key1).not.toBe(key2);
    });
  });

  describe('Caching', () => {
    it('should cache extraction results', () => {
      const config: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
      };

      const spy = vi.spyOn(extractor as any, 'extractFromValue');

      // First extraction
      const variables1 = extractor.extractTemplateVariables(config);
      expect(spy).toHaveBeenCalledTimes(2); // command, args[0]

      // Second extraction (should use cache)
      const variables2 = extractor.extractTemplateVariables(config);
      expect(spy).toHaveBeenCalledTimes(2); // No additional calls

      expect(variables1).toEqual(variables2);
    });

    it('should clear cache', () => {
      const config: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
      };

      extractor.extractTemplateVariables(config);
      expect(extractor.getCacheStats().size).toBe(1);

      extractor.clearCache();
      expect(extractor.getCacheStats().size).toBe(0);
    });

    it('should respect cache enabled flag', () => {
      extractor.setCacheEnabled(false);

      const spy = vi.spyOn(extractor as any, 'extractFromValue');

      const config: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}'],
      };

      extractor.extractTemplateVariables(config);
      extractor.extractTemplateVariables(config);

      expect(spy).toHaveBeenCalledTimes(4); // No caching, called twice (2 calls each time)

      extractor.setCacheEnabled(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed templates gracefully', () => {
      const config: MCPServerParams = {
        command: 'echo',
        args: ['{invalid}', '{project.}', '{project.name}'], // Valid and invalid
      };

      const variables = extractor.extractTemplateVariables(config);

      expect(variables).toHaveLength(1);
      expect(variables[0].path).toBe('project.name');
    });

    it('should handle extraction errors gracefully', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{user.email}'],
      };

      // Context without user.email
      const contextWithoutEmail: ContextData = {
        ...mockContext,
        user: { ...mockContext.user, email: undefined },
      };

      const usedVariables = extractor.getUsedVariables(templateConfig, contextWithoutEmail);

      // FIXED: Should include the variable even when value is undefined
      // This ensures template processing can handle undefined values and apply default values if available
      expect(usedVariables).toEqual({
        'user.email': undefined,
      });
    });

    it('should include variables with undefined values for template processing', () => {
      const templateConfig: MCPServerParams = {
        command: 'echo',
        args: ['{project.name}', '{user.email:default@example.com}', '{missing.field:default}'],
      };

      // Context with missing fields
      const contextWithMissing: ContextData = {
        ...mockContext,
        project: {
          ...mockContext.project,
          name: undefined, // This field is undefined
        },
        user: {
          ...mockContext.user,
          email: undefined, // This field is undefined
        },
      };

      const usedVariables = extractor.getUsedVariables(templateConfig, contextWithMissing);

      // FIXED: All variables should be included even when values are undefined
      // This ensures template substitution can handle them properly
      expect(usedVariables).toEqual({
        'project.name': undefined,
        'user.email': 'default@example.com', // Uses default value since optional and value is undefined
        'missing.field': 'default', // Uses default value for non-existent variable
      });
    });
  });
});

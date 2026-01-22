import type { MCPServerParams } from '@src/core/types/transport.js';
import type { ContextData } from '@src/types/context.js';

import { HandlebarsTemplateRenderer } from './handlebarsTemplateRenderer.js';

describe('HandlebarsTemplateRenderer', () => {
  let renderer: HandlebarsTemplateRenderer;
  let mockContext: ContextData;

  beforeEach(() => {
    renderer = new HandlebarsTemplateRenderer();
    mockContext = {
      project: {
        path: '/Users/test/workplace/test-project',
        name: 'test-project',
      },
      user: {
        username: 'testuser',
      },
      environment: {},
      sessionId: 'test-session-123',
      timestamp: '2024-01-01T00:00:00Z',
      version: 'v1',
    };
  });

  describe('renderTemplate', () => {
    it('should render serena template with project.path variable', () => {
      const serenaTemplate: MCPServerParams = {
        type: 'stdio',
        command: 'uv',
        args: [
          'run',
          '--directory',
          '/Users/test/workplace/serena',
          'serena',
          'start-mcp-server',
          '--log-level',
          'ERROR',
          '--context',
          'ide-assistant',
          '--project',
          '{{project.path}}', // This should be rendered
        ],
        tags: ['serena'],
      };

      const rendered = renderer.renderTemplate(serenaTemplate, mockContext);

      expect(rendered.args).toContain('/Users/test/workplace/test-project');
      expect(rendered.args).not.toContain('{{project.path}}');
    });

    it('should render nested object paths', () => {
      const template: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
        args: ['{{project.path}}'],
        env: {
          PROJECT_NAME: '{{project.name}}',
          USER: '{{user.username}}',
        },
      };

      const rendered = renderer.renderTemplate(template, mockContext);

      expect(rendered.args).toEqual(['/Users/test/workplace/test-project']);

      // Check that env was rendered (it's now a Record<string, string>)
      const envRecord = rendered.env as Record<string, string>;
      expect(envRecord.PROJECT_NAME).toBe('test-project');
      expect(envRecord.USER).toBe('testuser');
    });

    it('should not modify templates without variables', () => {
      const template: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
        args: ['hello', 'world'],
      };

      const rendered = renderer.renderTemplate(template, mockContext);

      expect(rendered).toEqual(template);
    });

    it('should handle empty context gracefully', () => {
      const template: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
        args: ['{{project.path}}'],
      };

      const rendered = renderer.renderTemplate(template, {} as ContextData);

      // Handlebars renders missing variables as empty strings
      expect(rendered.args).toEqual(['']);
    });

    it('should handle missing variables gracefully', () => {
      const template: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
        args: ['{{project.nonexistent}}'],
      };

      const rendered = renderer.renderTemplate(template, mockContext);

      // Handlebars renders missing variables as empty strings
      expect(rendered.args).toEqual(['']);
    });

    it('should render disabled field from template string to boolean', () => {
      const template: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
        args: ['test'],
        disabled: 'true',
      };

      const rendered = renderer.renderTemplate(template, mockContext);

      expect(rendered.disabled).toBe(true);
      expect(typeof rendered.disabled).toBe('boolean');
    });

    it('should convert disabled template string "false" to boolean false', () => {
      const template: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
        args: ['test'],
        disabled: 'false',
      };

      const rendered = renderer.renderTemplate(template, mockContext);

      expect(rendered.disabled).toBe(false);
      expect(typeof rendered.disabled).toBe('boolean');
    });

    it('should handle disabled field with conditional template expression', () => {
      const contextWithEnv = {
        ...mockContext,
        project: {
          ...mockContext.project,
          environment: 'production',
        },
      };

      const template: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
        args: ['test'],
        disabled: '{{#if (eq project.environment "production")}}true{{else}}false{{/if}}',
      };

      const rendered = renderer.renderTemplate(template, contextWithEnv);

      expect(rendered.disabled).toBe(true);
      expect(typeof rendered.disabled).toBe('boolean');
    });

    it('should preserve boolean disabled field without conversion', () => {
      const template: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
        args: ['test'],
        disabled: true,
      };

      const rendered = renderer.renderTemplate(template, mockContext);

      expect(rendered.disabled).toBe(true);
      expect(typeof rendered.disabled).toBe('boolean');
    });

    it('should handle disabled field with various truthy string values', () => {
      const truthyValues = ['true', 'TRUE', '1', 'yes', 'YES'];

      truthyValues.forEach((value) => {
        const template: MCPServerParams = {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
          disabled: value,
        };

        const rendered = renderer.renderTemplate(template, mockContext);

        expect(rendered.disabled).toBe(true);
      });
    });

    it('should handle disabled field with various falsy string values', () => {
      const falsyValues = ['false', 'FALSE', '0', 'no', 'NO', ''];

      falsyValues.forEach((value) => {
        const template: MCPServerParams = {
          type: 'stdio',
          command: 'echo',
          args: ['test'],
          disabled: value,
        };

        const rendered = renderer.renderTemplate(template, mockContext);

        expect(rendered.disabled).toBe(false);
      });
    });

    it('should handle undefined disabled field', () => {
      const template: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
        args: ['test'],
      };

      const rendered = renderer.renderTemplate(template, mockContext);

      expect(rendered.disabled).toBeUndefined();
    });
  });
});

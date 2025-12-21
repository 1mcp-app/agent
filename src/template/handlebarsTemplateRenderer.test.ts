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
        path: '/Users/x/workplace/iot-light-control',
        name: 'iot-light-control',
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
          '/Users/x/workplace/serena',
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

      expect(rendered.args).toContain('/Users/x/workplace/iot-light-control');
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

      expect(rendered.args).toEqual(['/Users/x/workplace/iot-light-control']);

      // Check that env was rendered (it's now a Record<string, string>)
      const envRecord = rendered.env as Record<string, string>;
      expect(envRecord.PROJECT_NAME).toBe('iot-light-control');
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
  });
});

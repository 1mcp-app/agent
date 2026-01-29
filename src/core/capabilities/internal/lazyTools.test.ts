import { describe, expect, it } from 'vitest';

import { createToolInvokeTool, createToolListTool, createToolSchemaTool, LAZY_TOOLS } from './lazyTools.js';

describe('lazyTools', () => {
  describe('createToolListTool', () => {
    it('should create tool_list tool with correct structure', () => {
      const tool = createToolListTool();

      expect(tool).toBeDefined();
      expect(tool.name).toBe('tool_list');
      expect(tool.description).toBe(
        'List all available MCP tools with names and descriptions. Use for tool discovery.',
      );
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    });

    it('should have correct input schema structure', () => {
      const tool = createToolListTool();

      expect(tool.inputSchema).toHaveProperty('type', 'object');
      expect(tool.inputSchema).toHaveProperty('properties');

      const props = tool.inputSchema.properties as Record<string, unknown>;
      expect(props).toHaveProperty('server');
      expect(props).toHaveProperty('pattern');
      expect(props).toHaveProperty('tag');
      expect(props).toHaveProperty('limit');
    });

    it('should have optional filter parameters', () => {
      const tool = createToolListTool();

      const required = tool.inputSchema.required || [];

      expect(required).not.toContain('server');
      expect(required).not.toContain('pattern');
      expect(required).not.toContain('tag');
      expect(required).not.toContain('limit');
    });

    it('should have output schema with tools array', () => {
      const tool = createToolListTool();

      expect(tool.outputSchema).toBeDefined();
      expect((tool.outputSchema as { properties: Record<string, unknown> }).properties).toHaveProperty('tools');
      expect((tool.outputSchema as { properties: Record<string, unknown> }).properties).toHaveProperty('totalCount');
      expect((tool.outputSchema as { properties: Record<string, unknown> }).properties).toHaveProperty('servers');
      expect((tool.outputSchema as { properties: Record<string, unknown> }).properties).toHaveProperty('hasMore');
    });
  });

  describe('createToolSchemaTool', () => {
    it('should create tool_schema tool with correct structure', () => {
      const tool = createToolSchemaTool();

      expect(tool).toBeDefined();
      expect(tool.name).toBe('tool_schema');
      expect(tool.description).toBe('Get the full schema for a specific tool including input validation rules');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    });

    it('should require server and toolName parameters', () => {
      const tool = createToolSchemaTool();

      expect(tool.inputSchema.required).toContain('server');
      expect(tool.inputSchema.required).toContain('toolName');
    });

    it('should have correct parameter definitions', () => {
      const tool = createToolSchemaTool();

      const props = tool.inputSchema.properties as Record<string, unknown>;
      expect(props).toHaveProperty('server');
      expect(props).toHaveProperty('toolName');
    });

    it('should have output schema with schema and fromCache fields', () => {
      const tool = createToolSchemaTool();

      expect(tool.outputSchema).toBeDefined();
      const outputProps = (tool.outputSchema as { properties: Record<string, unknown> }).properties;
      expect(outputProps).toHaveProperty('schema');
      expect(outputProps).toHaveProperty('fromCache');
    });
  });

  describe('createToolInvokeTool', () => {
    it('should create tool_invoke tool with correct structure', () => {
      const tool = createToolInvokeTool();

      expect(tool).toBeDefined();
      expect(tool.name).toBe('tool_invoke');
      expect(tool.description).toBe('Execute any tool on any MCP server with proper argument validation');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    });

    it('should require server, toolName, and args parameters', () => {
      const tool = createToolInvokeTool();

      expect(tool.inputSchema.required).toContain('server');
      expect(tool.inputSchema.required).toContain('toolName');
      expect(tool.inputSchema.required).toContain('args');
    });

    it('should have args as object type', () => {
      const tool = createToolInvokeTool();

      const props = tool.inputSchema.properties as Record<string, unknown>;
      expect(props).toHaveProperty('args');
      expect((props.args as { type: string }).type).toBe('object');
    });

    it('should have output schema with result, server, and tool fields', () => {
      const tool = createToolInvokeTool();

      expect(tool.outputSchema).toBeDefined();
      const outputProps = (tool.outputSchema as { properties: Record<string, unknown> }).properties;
      expect(outputProps).toHaveProperty('result');
      expect(outputProps).toHaveProperty('server');
      expect(outputProps).toHaveProperty('tool');
    });
  });

  describe('LAZY_TOOLS constant', () => {
    it('should contain all three lazy tool names', () => {
      expect(LAZY_TOOLS).toBeDefined();
      expect(LAZY_TOOLS).toHaveLength(3);
      expect(LAZY_TOOLS).toContain('tool_list');
      expect(LAZY_TOOLS).toContain('tool_schema');
      expect(LAZY_TOOLS).toContain('tool_invoke');
    });

    it('should be a readonly tuple', () => {
      // LAZY_TOOLS is declared as const, which makes it readonly
      // Verify it's an array
      expect(Array.isArray(LAZY_TOOLS)).toBe(true);

      // Verify const assertion creates readonly-like behavior
      // (in TypeScript, const assertions create readonly tuples)
      expect(LAZY_TOOLS[0]).toBe('tool_list');
      expect(LAZY_TOOLS[1]).toBe('tool_schema');
      expect(LAZY_TOOLS[2]).toBe('tool_invoke');
    });
  });

  describe('tool export consistency', () => {
    it('should create tools that match Tool interface', () => {
      const toolList = createToolListTool();
      const toolSchema = createToolSchemaTool();
      const toolInvoke = createToolInvokeTool();

      // Verify each tool matches the Tool interface
      expect(toolList).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        inputSchema: expect.any(Object),
      });
      expect(toolSchema).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        inputSchema: expect.any(Object),
      });
      expect(toolInvoke).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        inputSchema: expect.any(Object),
      });
    });

    it('should have unique tool names', () => {
      const toolList = createToolListTool();
      const toolSchema = createToolSchemaTool();
      const toolInvoke = createToolInvokeTool();

      const names = [toolList.name, toolSchema.name, toolInvoke.name];
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBe(3);
    });
  });

  describe('input schema completeness', () => {
    it('should provide complete input schema for tool_list', () => {
      const tool = createToolListTool();
      const schema = tool.inputSchema;

      expect(schema).toHaveProperty('type');
      expect(schema).toHaveProperty('properties');

      // Check server property exists
      const props = schema.properties as Record<string, unknown>;
      expect(props).toHaveProperty('server');
      expect(props).toHaveProperty('pattern');
      expect(props).toHaveProperty('tag');
      expect(props).toHaveProperty('limit');

      // Check property types
      const serverProp = props.server as { type: string };
      expect(serverProp.type).toBe('string');

      const limitProp = props.limit as { type: string };
      expect(limitProp.type).toBe('number');
    });

    it('should provide complete input schema for tool_schema', () => {
      const tool = createToolSchemaTool();
      const schema = tool.inputSchema;

      expect(schema).toHaveProperty('type');
      expect(schema).toHaveProperty('required');

      const props = schema.properties as Record<string, unknown>;
      expect(props).toHaveProperty('server');
      expect(props).toHaveProperty('toolName');

      // Check required parameters
      expect(schema.required).toContain('server');
      expect(schema.required).toContain('toolName');

      // Check property types
      const serverProp = props.server as { type: string };
      expect(serverProp.type).toBe('string');

      const toolNameProp = props.toolName as { type: string };
      expect(toolNameProp.type).toBe('string');
    });

    it('should provide complete input schema for tool_invoke', () => {
      const tool = createToolInvokeTool();
      const schema = tool.inputSchema;

      expect(schema).toHaveProperty('type');
      expect(schema).toHaveProperty('required');

      const props = schema.properties as Record<string, unknown>;
      expect(props).toHaveProperty('server');
      expect(props).toHaveProperty('toolName');
      expect(props).toHaveProperty('args');

      // Check required parameters
      expect(schema.required).toContain('server');
      expect(schema.required).toContain('toolName');
      expect(schema.required).toContain('args');

      // Check args is object type
      const argsProp = props.args as { type: string };
      expect(argsProp.type).toBe('object');
    });
  });

  describe('output schema completeness', () => {
    it('should provide structured output for tool_list', () => {
      const tool = createToolListTool();
      const schema = tool.outputSchema as { properties: Record<string, unknown> };

      expect(schema.properties).toBeDefined();
      expect(schema.properties.tools).toBeDefined();
      expect(schema.properties.totalCount).toBeDefined();
      expect(schema.properties.servers).toBeDefined();
      expect(schema.properties.hasMore).toBeDefined();
    });

    it('should provide structured output for tool_schema', () => {
      const tool = createToolSchemaTool();
      const schema = tool.outputSchema as { properties: Record<string, unknown> };

      expect(schema.properties).toBeDefined();
      expect(schema.properties.schema).toBeDefined();
      expect(schema.properties.fromCache).toBeDefined();
    });

    it('should provide structured output for tool_invoke', () => {
      const tool = createToolInvokeTool();
      const schema = tool.outputSchema as { properties: Record<string, unknown> };

      expect(schema.properties).toBeDefined();
      expect(schema.properties.result).toBeDefined();
      expect(schema.properties.server).toBeDefined();
      expect(schema.properties.tool).toBeDefined();
    });
  });
});

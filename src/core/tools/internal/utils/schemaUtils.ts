/**
 * Utilities for converting Zod schemas to JSON Schema
 *
 * This module provides utilities to convert Zod schemas to JSON Schema format,
 * enabling automatic generation of input/output schemas for MCP tools from Zod schemas.
 */

// import { z } from 'zod'; // Not used directly but kept for future reference

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */

/**
 * Convert a Zod schema to JSON Schema format
 *
 * @param schema The Zod schema to convert
 * @returns JSON Schema representation
 */
export function zodToJsonSchema(schema: any): Record<string, unknown> {
  const def = schema._def;

  if (!def) {
    return { type: 'object' };
  }

  // Handle object schemas
  if (def.type === 'object') {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const shape = def.shape;

    for (const [key, value] of Object.entries(shape)) {
      const fieldSchema = convertFieldToSchema(value as any);

      // Extract description from the field
      const fieldValue = value as any;
      if (fieldValue.description) {
        fieldSchema.description = fieldValue.description;
      } else if (def?.description) {
        fieldSchema.description = def.description;
      }

      properties[key] = fieldSchema;

      // Check if the field is required (not optional)
      if (fieldValue._def?.typeName !== 'ZodOptional' && fieldValue._def?.typeName !== 'ZodNullable') {
        required.push(key);
      }
    }

    const result: Record<string, unknown> = {
      type: 'object',
      properties,
    };

    if (required.length > 0) {
      result.required = required;
    }

    return result;
  }

  // Handle other schema types
  const typeName = def.typeName || def.type;

  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };

    case 'ZodNumber':
      return { type: 'number' };

    case 'ZodBoolean':
      return { type: 'boolean' };

    case 'ZodArray':
      return {
        type: 'array',
        items: def.element ? convertFieldToSchema(def.element) : { type: 'object' },
      };

    case 'ZodEnum':
      return {
        type: 'string',
        enum: Array.isArray(def.entries || def.values) ? def.entries || def.values : [],
      };

    case 'ZodLiteral':
      return {
        type: typeof def.value,
        enum: [def.value],
      };

    case 'ZodOptional':
    case 'ZodDefault':
      return convertFieldToSchema(def.innerType);

    default:
      return { type: 'object' };
  }
}

/**
 * Convert a Zod field to JSON Schema
 */
function convertFieldToSchema(field: any): Record<string, unknown> {
  if (!field || !field._def) {
    return { type: 'object' };
  }

  const def = field._def;
  const schema: Record<string, unknown> = {};

  // Handle field descriptions
  if (field.description) {
    schema.description = field.description;
  }

  // Handle field types
  switch (def.typeName || def.type) {
    case 'ZodString':
      schema.type = 'string';
      break;
    case 'ZodNumber':
      schema.type = 'number';
      if (def.minValue !== null && def.minValue !== undefined) {
        schema.minimum = def.minValue;
      }
      if (def.maxValue !== null && def.maxValue !== undefined) {
        schema.maximum = def.maxValue;
      }
      break;
    case 'ZodBoolean':
      schema.type = 'boolean';
      break;
    case 'ZodArray':
      schema.type = 'array';
      schema.items = def.element ? convertFieldToSchema(def.element) : { type: 'object' };
      break;
    case 'ZodEnum':
      schema.type = 'string';
      schema.enum = Array.isArray(def.values) ? def.values : [];
      break;
    case 'ZodLiteral':
      schema.type = typeof def.value;
      schema.enum = [def.value];
      break;
    case 'ZodDefault': {
      const innerSchema = convertFieldToSchema(def.innerType);
      innerSchema.default = def.defaultValue;
      return innerSchema;
    }
    case 'ZodOptional':
      return convertFieldToSchema(def.innerType);
    default:
      schema.type = 'object';
      break;
  }

  return schema;
}

/**
 * Create input and output schemas for MCP tools from Zod schemas
 *
 * @param inputSchema Zod schema for input validation
 * @param outputSchema Optional Zod schema for output validation
 * @returns MCP tool input and output properties
 */
export function createToolSchemas<TInput extends any, TOutput extends any = any>(
  inputSchema: TInput,
  outputSchema?: TOutput,
): {
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
} {
  return {
    inputSchema: zodToJsonSchema(inputSchema),
    ...(outputSchema && { outputSchema: zodToJsonSchema(outputSchema) }),
  };
}

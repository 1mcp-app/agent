import { type SchemaBinding, schemaBoundary, SchemaBoundaryError, type SchemaContract } from './schemaBoundary.js';
import { captureJson, SCHEMA_LIMITS } from './schemaPolicy.js';

export interface ToolSchemaContracts {
  input: SchemaContract;
  output?: SchemaContract;
}
export async function admitToolSchemas(
  tool: Record<string, unknown>,
  binding: SchemaBinding & { sourceRevision?: string },
): Promise<ToolSchemaContracts> {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new SchemaBoundaryError('schema_invalid');
  const input = await schemaBoundary.admit(tool.inputSchema, { ...binding, profile: 'tool-input' });
  const output =
    tool.outputSchema === undefined
      ? undefined
      : await schemaBoundary.admit(tool.outputSchema, { ...binding, profile: 'tool-output' });
  if (
    Buffer.byteLength(JSON.stringify(input.source)) + (output ? Buffer.byteLength(JSON.stringify(output.source)) : 0) >
    SCHEMA_LIMITS.toolSchemaBytes
  )
    throw new SchemaBoundaryError('schema_budget_exceeded');
  return { input, output };
}
export async function prepareToolValidation(
  contracts: ToolSchemaContracts,
  args: unknown,
  binding: SchemaBinding,
): Promise<(result: unknown) => Promise<void>> {
  await schemaBoundary.evaluate(contracts.input, args === undefined ? {} : args, binding);
  return async (result: unknown) => {
    try {
      captureJson(result, false, true);
    } catch (error) {
      throw new SchemaBoundaryError(
        error instanceof SchemaBoundaryError ? error.code : 'schema_invalid',
        false,
        'output',
      );
    }
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new SchemaBoundaryError('schema_output_invalid');
    const value = result as Record<string, unknown>;
    if (value.isError === true || !contracts.output) return;
    if (!Object.hasOwn(value, 'structuredContent')) throw new SchemaBoundaryError('schema_output_invalid');
    await schemaBoundary.evaluate(contracts.output, value.structuredContent, binding);
  };
}

/** Explicit dialect metadata preserves implicit source-era semantics in every destination view. */
export function projectToolSchemas(
  tool: Record<string, unknown>,
  contracts: ToolSchemaContracts,
): Record<string, unknown> {
  const project = (contract: SchemaContract) => ({
    ...contract.source,
    $schema: contract.dialect.startsWith('draft-')
      ? `http://json-schema.org/${contract.dialect}/schema#`
      : `https://json-schema.org/draft/${contract.dialect}/schema`,
  });
  return {
    ...tool,
    inputSchema: project(contracts.input),
    ...(contracts.output ? { outputSchema: project(contracts.output) } : {}),
  };
}

export function schemaInputErrorResult() {
  return { isError: true as const, content: [{ type: 'text' as const, text: 'schema_input_invalid' }] };
}

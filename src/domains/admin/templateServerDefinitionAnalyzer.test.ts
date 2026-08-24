import { describe, expect, it } from 'vitest';

import { analyzeTemplateServerDefinition } from './templateServerDefinitionAnalyzer.js';

describe('analyzeTemplateServerDefinition', () => {
  it('reports Request Context variables only from runtime-rendered fields', () => {
    const result = analyzeTemplateServerDefinition({
      command: '{{workspace.command}}',
      args: ['--root', '{{project.path}}', '{{#if client.name}}{{client.name}}{{/if}}'],
      env: { TOKEN: '{{environment.variables.API_TOKEN}}' },
      cwd: '{{project.path}}',
      disabled: '{{project.disabled}}',
      headers: { ignored: '{{secret.value}}' },
      instructionOverride: '{{also.ignored}}',
    });

    expect(result.syntax.valid).toBe(true);
    expect(result.variables).toEqual([
      'client.name',
      'environment.variables.API_TOKEN',
      'project.disabled',
      'project.path',
      'workspace.command',
    ]);
    expect(result.unresolvedVariables).toEqual(result.variables);
    expect(result.fields.map((field) => field.fieldPath)).not.toContainEqual(['transport', 'headers', 'ignored']);
  });

  it('maps syntax errors to the normalized field path without rendering', () => {
    const secret = 'do-not-return-this-secret';
    const result = analyzeTemplateServerDefinition({
      command: 'node',
      args: ['{{#if project.path}}'],
      env: { TOKEN: `{{#if ${secret}}}` },
      url: `https://example.com/{{#if ${secret}}}`,
    });

    expect(result.syntax.valid).toBe(false);
    expect(result.syntax.errors[0]).toMatchObject({
      fieldPath: ['transport', 'args', '0'],
      code: 'invalid_handlebars',
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('recognizes runtime helpers and excludes block-local aliases from root variables', () => {
    const result = analyzeTemplateServerDefinition({
      command: '{{#if (gt project.count 1)}}node{{/if}}',
      args: ['{{#each project.items as |item|}}{{item.name}}:{{name}}{{/each}}'],
    });

    expect(result.variables).toEqual(['project.count', 'project.items']);
  });

  it('excludes bare paths resolved against implicit each and with block contexts', () => {
    const result = analyzeTemplateServerDefinition({
      command: '{{#each project.items}}{{name}}:{{project.root}}{{/each}}',
      args: ['{{#with project.owner}}{{name}}@{{organization.name}}{{/with}}'],
    });

    expect(result.variables).toEqual(['organization.name', 'project.items', 'project.owner', 'project.root']);
  });
});

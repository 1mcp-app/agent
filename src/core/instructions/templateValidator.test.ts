import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  validateTemplateContent,
  formatValidationError,
  isTemplateSizeAcceptable,
  isTemplateContentSafe,
  DANGEROUS_TEMPLATE_PATTERNS,
  DEFAULT_TEMPLATE_VALIDATION_CONFIG,
  TemplateErrorType,
  categorizeTemplateError,
  getErrorSuggestions,
} from './templateValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Template Validator', () => {
  const tempDir = path.join(__dirname, 'temp-test-templates');

  beforeEach(() => {
    // Create temp directory for test files
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  describe('validateTemplateContent', () => {
    describe('Size Validation', () => {
      it('should reject templates larger than 1MB by default', () => {
        const largeContent = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte

        const result = validateTemplateContent(largeContent, 'test-template.md');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('Template file too large');
        expect(result.suggestions).toContain('Consider splitting the template into smaller files');
      });

      it('should accept templates under size limit', () => {
        const normalContent = '# Normal Template\\n{{serverCount}} servers available';

        const result = validateTemplateContent(normalContent, 'test-template.md');

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should respect custom size limits', () => {
        const content = 'x'.repeat(100);

        const result = validateTemplateContent(content, 'test-template.md', { maxSizeBytes: 50 });

        expect(result.valid).toBe(false);
        expect(result.error).toContain('Template file too large');
      });
    });

    describe('Safety Validation', () => {
      it('should reject templates with script tags', () => {
        const unsafeContent = `
          # Template with script
          {{serverCount}} servers
          <script>alert('xss')</script>
        `;

        const result = validateTemplateContent(unsafeContent, 'unsafe-template.md');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('potentially unsafe content');
        expect(result.suggestions).toContain('Remove script tags and event handlers');
      });

      it('should reject templates with javascript: URLs', () => {
        const unsafeContent = `
          # Template with javascript URL
          [Click here](javascript:alert('xss'))
          {{serverCount}} servers
        `;

        const result = validateTemplateContent(unsafeContent, 'unsafe-template.md');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('potentially unsafe content');
      });

      it('should reject templates with event handlers', () => {
        const unsafeContent = `
          # Template with event handlers
          <div onclick="alert('xss')">{{serverCount}} servers</div>
        `;

        const result = validateTemplateContent(unsafeContent, 'unsafe-template.md');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('potentially unsafe content');
      });

      it('should accept safe templates', () => {
        const safeContent = `
          # Safe Template

          Available servers: {{serverCount}}

          {{#each serverNames}}
          - {{this}}
          {{/each}}

          {{#if hasServers}}
          Instructions available
          {{else}}
          No servers found
          {{/if}}
        `;

        const result = validateTemplateContent(safeContent, 'safe-template.md');

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should allow unsafe content when explicitly configured', () => {
        const unsafeContent = '<script>console.log("test")</script>';

        const result = validateTemplateContent(unsafeContent, 'test.md', { allowUnsafeContent: true });

        expect(result.valid).toBe(true);
      });
    });

    describe('Handlebars Syntax Validation', () => {
      it('should handle templates with potentially confusing syntax', () => {
        // Missing closing braces should fail validation
        const confusingContent = `# Confusing Template
{{serverCount`; // Missing closing braces

        const result = validateTemplateContent(confusingContent, 'confusing-template.md');

        expect(result.valid).toBe(false); // Should fail due to missing closing brace
        expect(result.errorType).toBe(TemplateErrorType.SYNTAX);
      });

      it('should handle templates with mismatched helper tags', () => {
        // Mismatched tags should fail validation
        const mismatchedContent = `# Mismatched Helper Template
{{#if serverCount}}
Content here
{{/unless}}`; // Mismatched helper tags

        const result = validateTemplateContent(mismatchedContent, 'mismatched-template.md');

        expect(result.valid).toBe(false); // Should fail due to mismatched tags
        expect(result.errorType).toBe(TemplateErrorType.SYNTAX);
      });

      it('should accept valid Handlebars syntax', () => {
        const validContent = `
          # Valid Handlebars Template

          Server Count: {{serverCount}}

          {{#if hasServers}}
          {{#each serverNames}}
          - Server: {{this}}
          {{/each}}
          {{else}}
          No servers available
          {{/if}}

          {{#each examples}}
          Example: {{name}} - {{description}}
          {{/each}}
        `;

        const result = validateTemplateContent(validContent, 'valid-template.md');

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should handle templates with undefined variables gracefully', () => {
        const templateContent = 'Server: {{nonexistentVariable}}';

        const result = validateTemplateContent(templateContent, 'test-template.md');

        expect(result.valid).toBe(true); // Undefined variables don't cause compilation errors
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty templates', () => {
        const result = validateTemplateContent('', 'empty-template.md');

        expect(result.valid).toBe(true);
      });

      it('should handle whitespace-only templates', () => {
        const result = validateTemplateContent('   \\n\\t\\n   ', 'whitespace-template.md');

        expect(result.valid).toBe(true);
      });

      it('should handle complex real-world templates', () => {
        const complexContent = `# {{title}}

You are interacting with {{serverCount}} MCP {{pluralServers}}.

## Currently Connected Servers

{{#if hasServers}}
The following {{serverCount}} MCP {{pluralServers}} {{isAre}} currently available:

{{#each servers}}
### {{name}}

{{#if hasInstructions}}
{{instructions}}
{{else}}
*No specific instructions provided*
{{/if}}

{{/each}}

## Tool Usage

All tools from connected servers are accessible using the format: \`{server}_1mcp_{tool}\`

Examples:
{{#each examples}}
- \`{{name}}\` - {{description}}
{{/each}}

{{filterContext}}

{{else}}
No MCP servers are currently connected.
{{/if}}

---
*Generated by 1MCP*`;

        const result = validateTemplateContent(complexContent, 'complex-template.md');

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });
  });

  describe('File-based Template Testing', () => {
    describe('Template Size Validation', () => {
      it('should handle large template files', () => {
        const largeTempPath = path.join(tempDir, 'large-template.md');
        const largeContent = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte

        fs.writeFileSync(largeTempPath, largeContent);
        const result = validateTemplateContent(largeContent, largeTempPath);

        expect(result.valid).toBe(false);
        expect(result.error).toContain('Template file too large');
        expect(result.suggestions).toContain('Consider splitting the template into smaller files');
      });

      it('should accept normal sized template files', () => {
        const normalTempPath = path.join(tempDir, 'normal-template.md');
        const normalContent = '# Normal Template\n{{serverCount}} servers available';

        fs.writeFileSync(normalTempPath, normalContent);
        const result = validateTemplateContent(normalContent, normalTempPath);

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    describe('Template Error Handling', () => {
      it('should handle empty template files', () => {
        const emptyPath = path.join(tempDir, 'empty-template.md');
        const emptyContent = '';
        fs.writeFileSync(emptyPath, emptyContent);

        const result = validateTemplateContent(emptyContent, emptyPath);
        expect(result.valid).toBe(true); // Empty template is valid
      });

      it('should handle templates with only whitespace', () => {
        const whitespacePath = path.join(tempDir, 'whitespace-template.md');
        const whitespaceContent = '   \n\t\n   ';
        fs.writeFileSync(whitespacePath, whitespaceContent);

        const result = validateTemplateContent(whitespaceContent, whitespacePath);
        expect(result.valid).toBe(true); // Whitespace-only template is valid
      });

      it('should handle permission issues gracefully', () => {
        const restrictedPath = path.join(tempDir, 'restricted-template.md');
        fs.writeFileSync(restrictedPath, '# Test template');

        // Change permissions to be unreadable (skip on Windows)
        if (process.platform !== 'win32') {
          fs.chmodSync(restrictedPath, 0o000);

          expect(() => fs.readFileSync(restrictedPath)).toThrow();

          // Restore permissions for cleanup
          fs.chmodSync(restrictedPath, 0o644);
        }
      });
    });

    describe('Real-world Template Scenarios', () => {
      it('should handle complex production-like templates', () => {
        const complexPath = path.join(tempDir, 'complex-template.md');
        const complexContent = `# {{title}}

You are interacting with {{serverCount}} MCP {{pluralServers}}.

## Currently Connected Servers

{{#if hasServers}}
The following {{serverCount}} MCP {{pluralServers}} {{isAre}} currently available:

{{#each servers}}
### {{name}}

{{#if hasInstructions}}
{{instructions}}
{{else}}
*No specific instructions provided*
{{/if}}

{{/each}}

## Tool Usage

All tools from connected servers are accessible using the format: \`{server}_1mcp_{tool}\`

Examples:
{{#each examples}}
- \`{{name}}\` - {{description}}
{{/each}}

{{filterContext}}

{{else}}
No MCP servers are currently connected.
{{/if}}

---
*Generated by 1MCP*`;

        fs.writeFileSync(complexPath, complexContent);
        const result = validateTemplateContent(complexContent, complexPath);

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should handle templates with mixed content types', () => {
        const mixedPath = path.join(tempDir, 'mixed-template.md');
        const mixedContent = `# Mixed Content Template

## Markdown Features
- Lists
- **Bold text**
- [Links](https://example.com)
- \`code blocks\`

## Handlebars Features
{{#if hasServers}}
{{#each serverNames}}
- Server: {{this}}
{{/each}}
{{/if}}

## Safe HTML
<div class="info">
  <strong>Server Count:</strong> {{serverCount}}
</div>

{{#unless hasServers}}
<em>No servers available</em>
{{/unless}}`;

        fs.writeFileSync(mixedPath, mixedContent);
        const result = validateTemplateContent(mixedContent, mixedPath);

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    describe('Memory Pressure Scenarios', () => {
      it('should handle rapid template validations', () => {
        // Simulate validating many templates quickly
        for (let i = 0; i < 100; i++) {
          const templateContent = `# Template ${i}\n{{serverCount}} servers available`;
          const result = validateTemplateContent(templateContent, `template-${i}.md`);
          expect(result.valid).toBe(true);
        }
      });

      it('should handle templates with large variable content', () => {
        const largeVariableTemplate = `# Large Variable Template

Server list:
{{#each serverNames}}
- {{this}}: ${'x'.repeat(1000)} // Large content per iteration
{{/each}}

Instructions:
{{{instructions}}}

End of template`;

        const result = validateTemplateContent(largeVariableTemplate, 'large-var-template.md');
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('Utility Functions', () => {
    describe('formatValidationError', () => {
      it('should format validation errors properly', () => {
        const result = {
          valid: false,
          error: 'Test error message',
          suggestions: ['Suggestion 1', 'Suggestion 2'],
        };

        const formatted = formatValidationError(result);

        expect(formatted).toContain('Test error message');
        expect(formatted).toContain('Suggestions:');
        expect(formatted).toContain('1. Suggestion 1');
        expect(formatted).toContain('2. Suggestion 2');
      });

      it('should return empty string for valid templates', () => {
        const result = { valid: true };
        const formatted = formatValidationError(result);

        expect(formatted).toBe('');
      });

      it('should handle missing suggestions', () => {
        const result = {
          valid: false,
          error: 'Test error without suggestions',
        };

        const formatted = formatValidationError(result);

        expect(formatted).toBe('Test error without suggestions');
      });
    });

    describe('isTemplateSizeAcceptable', () => {
      it('should return false for non-existent files', () => {
        expect(isTemplateSizeAcceptable('/non/existent/file.md')).toBe(false);
      });

      it('should use default size limit when not specified', () => {
        // This test verifies the function works with defaults, actual file testing in integration tests
        expect(typeof isTemplateSizeAcceptable('/any/path')).toBe('boolean');
      });
    });

    describe('isTemplateContentSafe', () => {
      it('should detect safe content', () => {
        expect(isTemplateContentSafe('Safe template {{serverCount}}')).toBe(true);
        expect(isTemplateContentSafe('# Title\\n{{#if hasServers}}content{{/if}}')).toBe(true);
      });

      it('should detect unsafe content', () => {
        expect(isTemplateContentSafe('<script>alert("xss")</script>')).toBe(false);
        expect(isTemplateContentSafe('<div onclick="hack()">content</div>')).toBe(false);
        expect(isTemplateContentSafe('[link](javascript:alert("xss"))')).toBe(false);
      });

      it('should allow unsafe content when configured', () => {
        const unsafeContent = '<script>console.log("test")</script>';

        expect(isTemplateContentSafe(unsafeContent)).toBe(false);
        expect(isTemplateContentSafe(unsafeContent, { allowUnsafeContent: true })).toBe(true);
      });

      it('should handle custom dangerous patterns', () => {
        const customPattern = /custom-dangerous-pattern/i;
        const content = 'This contains custom-dangerous-pattern';

        expect(isTemplateContentSafe(content)).toBe(true);
        expect(isTemplateContentSafe(content, { customDangerousPatterns: [customPattern] })).toBe(false);
      });
    });

    describe('Constants', () => {
      it('should have properly defined dangerous patterns', () => {
        expect(DANGEROUS_TEMPLATE_PATTERNS).toHaveLength(3);
        expect(DANGEROUS_TEMPLATE_PATTERNS[0].test('<script></script>')).toBe(true);
        expect(DANGEROUS_TEMPLATE_PATTERNS[1].test('javascript:alert(1)')).toBe(true);
        expect(DANGEROUS_TEMPLATE_PATTERNS[2].test('onclick="test()"')).toBe(true);
      });

      it('should have sensible default configuration', () => {
        expect(DEFAULT_TEMPLATE_VALIDATION_CONFIG.maxSizeBytes).toBe(1024 * 1024);
        expect(DEFAULT_TEMPLATE_VALIDATION_CONFIG.allowUnsafeContent).toBe(false);
        expect(DEFAULT_TEMPLATE_VALIDATION_CONFIG.customDangerousPatterns).toEqual([]);
      });
    });

    describe('Error Categorization', () => {
      describe('categorizeTemplateError', () => {
        it('should categorize syntax errors correctly', () => {
          const syntaxErrors = [
            'Parse error on line 1',
            'Expecting token CLOSE',
            'Unexpected token',
            'Unterminated string',
            'Unmatched brace',
          ];

          syntaxErrors.forEach((errorMessage) => {
            expect(categorizeTemplateError(errorMessage)).toBe(TemplateErrorType.SYNTAX);
          });
        });

        it('should categorize compilation errors correctly', () => {
          const compilationErrors = [
            'Missing helper: invalidHelper',
            'Must pass iterator to #each',
            'Helper not found: customHelper',
            'Invalid helper usage',
          ];

          compilationErrors.forEach((errorMessage) => {
            expect(categorizeTemplateError(errorMessage)).toBe(TemplateErrorType.COMPILATION);
          });
        });

        it('should default to compilation error for unknown errors', () => {
          expect(categorizeTemplateError('Unknown error message')).toBe(TemplateErrorType.COMPILATION);
        });
      });

      describe('getErrorSuggestions', () => {
        it('should provide specific suggestions for syntax errors', () => {
          const suggestions = getErrorSuggestions(TemplateErrorType.SYNTAX, 'Parse error');
          expect(suggestions).toContain('Check for unmatched braces {{ }}');
          expect(suggestions).toContain('Ensure all Handlebars expressions are properly closed');
        });

        it('should provide specific suggestions for compilation errors', () => {
          const suggestions = getErrorSuggestions(TemplateErrorType.COMPILATION, 'Must pass iterator');
          expect(suggestions).toContain('Use {{#each serverNames}} instead of {{#each}}');
          expect(suggestions).toContain('Ensure iterator variable is provided for #each helpers');
        });

        it('should provide size limit suggestions', () => {
          const suggestions = getErrorSuggestions(TemplateErrorType.SIZE_LIMIT, '');
          expect(suggestions).toContain('Consider splitting the template into smaller files');
          expect(suggestions).toContain('Increase template size limit if necessary');
        });

        it('should provide unsafe content suggestions', () => {
          const suggestions = getErrorSuggestions(TemplateErrorType.UNSAFE_CONTENT, '');
          expect(suggestions).toContain('Remove script tags and event handlers');
          expect(suggestions).toContain('Use safe template variables only');
        });

        it('should provide runtime error suggestions', () => {
          const suggestions = getErrorSuggestions(TemplateErrorType.RUNTIME, '');
          expect(suggestions).toContain('Check template variables are correctly defined');
          expect(suggestions).toContain('Verify data passed to template matches expected structure');
        });
      });

      describe('validateTemplateContent with error categorization', () => {
        it('should include error type in validation result for size limit', () => {
          const largeContent = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte
          const result = validateTemplateContent(largeContent);

          expect(result.valid).toBe(false);
          expect(result.errorType).toBe(TemplateErrorType.SIZE_LIMIT);
          expect(result.error).toContain('Template file too large');
        });

        it('should include error type in validation result for unsafe content', () => {
          const unsafeContent = '<script>alert("xss")</script>{{serverCount}}';
          const result = validateTemplateContent(unsafeContent);

          expect(result.valid).toBe(false);
          expect(result.errorType).toBe(TemplateErrorType.UNSAFE_CONTENT);
          expect(result.error).toContain('potentially unsafe content');
        });

        it('should include error type in validation result for syntax errors', () => {
          const syntaxError = '{{#each items}}{{name}}{{/if}}'; // Mismatched tags
          const result = validateTemplateContent(syntaxError);

          expect(result.valid).toBe(false);
          expect(result.errorType).toBe(TemplateErrorType.SYNTAX);
          expect(result.error).toContain('Template syntax error');
        });

        it('should include error type in validation result for compilation errors', () => {
          const compilationError = '{{#each}}content{{/each}}'; // Missing iterator

          // This actually fails at compile time due to missing iterator
          // Let's test during template rendering by creating a custom test
          const result = validateTemplateContent(compilationError);

          expect(result.valid).toBe(false);
          expect(result.errorType).toBe(TemplateErrorType.COMPILATION);
          expect(result.error).toContain('Template syntax error');
        });
      });
    });
  });
});

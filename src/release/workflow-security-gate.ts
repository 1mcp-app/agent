import YAML from 'yaml';

export interface WorkflowViolation {
  file: string;
  line: number;
  rule: 'NO_SECRETS_INHERIT' | 'NO_RUN_INJECTION';
  message: string;
  snippet: string;
}

function getNearestEnclosingPairKey(path: readonly unknown[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (YAML.isPair(node) && node.key && typeof (node.key as { value?: unknown }).value === 'string') {
      return (node.key as { value: string }).value.toLowerCase();
    }
  }
  return null;
}

/**
 * Scans a GitHub Actions workflow or composite action file for 'secrets: inherit' and script expression injections in 'run:' steps.
 * Uses standard YAML AST/CST parsing (supporting anchors, aliases, flow mappings, and block scalars).
 */
export function scanWorkflowSecurity(content: string, filename = 'workflow.yml'): WorkflowViolation[] {
  const violations: WorkflowViolation[] = [];
  const expressionPattern = /\$\{\{/;

  const lineCounter = new YAML.LineCounter();
  let doc: YAML.Document;
  try {
    doc = YAML.parseDocument(content, { lineCounter });
  } catch (e) {
    violations.push({
      file: filename,
      line: 1,
      rule: 'NO_RUN_INJECTION',
      message: 'YAML Parse Error: ' + (e instanceof Error ? e.message : String(e)),
      snippet: content.split('\n')[0] || '',
    });
    return violations;
  }

  if (doc.errors && doc.errors.length > 0) {
    for (const err of doc.errors) {
      violations.push({
        file: filename,
        line: err.linePos ? err.linePos[0].line : 1,
        rule: 'NO_RUN_INJECTION',
        message: 'YAML Syntax Error: ' + err.message,
        snippet: err.message,
      });
    }
    return violations;
  }

  function resolveNodeValue(node: unknown): string {
    if (!node) return '';
    if (YAML.isAlias(node)) {
      const resolved = node.resolve(doc) as { value?: unknown } | null;
      if (!resolved) return '';
      return typeof resolved.value === 'string' ? resolved.value : String(resolved.value ?? resolved);
    }
    const valNode = node as { value?: unknown };
    return typeof valNode.value === 'string' ? valNode.value : String(valNode.value ?? node);
  }

  YAML.visit(doc, {
    Pair(key, node, path) {
      if (!node.key) return;

      const keyNode = node.key as { value?: unknown };
      const keyVal = keyNode.value;
      const valNode = node.value as { range?: [number, number, number]; value?: unknown } | null;
      const nearestEnclosingPair = getNearestEnclosingPairKey(path);

      // 1. Guard against secrets: inherit
      // Only flag when secrets is inside a caller job (under 'jobs') and NOT under 'on' or 'with'
      if (typeof keyVal === 'string' && keyVal.toLowerCase() === 'secrets' && valNode) {
        const isUnderJobs = path.some(
          (p) => YAML.isPair(p) && ((p.key as { value?: unknown })?.value as string)?.toLowerCase?.() === 'jobs',
        );
        const isUnderOnOrWith = path.some((p) => {
          if (YAML.isPair(p) && p.key && typeof (p.key as { value?: unknown }).value === 'string') {
            const k = (p.key as { value: string }).value.toLowerCase();
            return k === 'on' || k === 'with';
          }
          return false;
        });

        if (isUnderJobs && !isUnderOnOrWith) {
          const valStr = resolveNodeValue(valNode);
          if (valStr.toLowerCase().trim() === 'inherit') {
            const pos = valNode.range ? lineCounter.linePos(valNode.range[0]) : { line: 1, col: 1 };
            violations.push({
              file: filename,
              line: pos.line,
              rule: 'NO_SECRETS_INHERIT',
              message: "Forbidden 'secrets: inherit' detected. Secrets must be explicitly mapped by name or use OIDC.",
              snippet: 'secrets: ' + valStr,
            });
          }
        }
      }

      // 2. Guard against run injections
      // Ensure the 'run' key is an execution step command (directly enclosing under 'steps')
      if (typeof keyVal === 'string' && keyVal.toLowerCase() === 'run' && valNode) {
        if (nearestEnclosingPair === 'steps') {
          const scriptVal = resolveNodeValue(valNode);
          if (expressionPattern.test(scriptVal)) {
            const pos = valNode.range ? lineCounter.linePos(valNode.range[0]) : { line: 1, col: 1 };
            violations.push({
              file: filename,
              line: pos.line,
              rule: 'NO_RUN_INJECTION',
              message:
                'Direct interpolation of expressions in run: step detected. Pass dynamic values via env: variables instead.',
              snippet: scriptVal.split('\n')[0].trim(),
            });
          }
        }
      }
    },
  });

  return violations;
}

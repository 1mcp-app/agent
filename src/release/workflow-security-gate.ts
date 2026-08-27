import YAML from 'yaml';

export interface WorkflowViolation {
  file: string;
  line: number;
  rule: 'NO_SECRETS_INHERIT' | 'NO_RUN_INJECTION';
  message: string;
  snippet: string;
}

/**
 * Scans a GitHub Actions workflow or composite action file for 'secrets: inherit' and script expression injections in 'run:' steps.
 * Uses standard YAML structural evaluation (natively resolving all aliases, anchors, flow mappings, and block scalars).
 */
export function scanWorkflowSecurity(content: string, filename = 'workflow.yml'): WorkflowViolation[] {
  const violations: WorkflowViolation[] = [];
  const expressionPattern = /\$\{\{/;

  const lines = content.replace(/\r\n/g, '\n').split('\n');

  function findLineNumber(snippet: string): number {
    if (!snippet) return 1;
    const firstLine = snippet.split('\n')[0].trim();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(firstLine)) {
        return i + 1;
      }
    }
    return 1;
  }

  let doc: YAML.Document;
  try {
    doc = YAML.parseDocument(content);
  } catch (e) {
    violations.push({
      file: filename,
      line: 1,
      rule: 'NO_RUN_INJECTION',
      message: 'YAML Parse Error: ' + (e instanceof Error ? e.message : String(e)),
      snippet: lines[0] || '',
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

  let jsObj: Record<string, unknown>;
  try {
    jsObj = doc.toJS() as Record<string, unknown>;
  } catch (e) {
    violations.push({
      file: filename,
      line: 1,
      rule: 'NO_RUN_INJECTION',
      message: 'YAML Evaluation Error: ' + (e instanceof Error ? e.message : String(e)),
      snippet: lines[0] || '',
    });
    return violations;
  }

  if (!jsObj || typeof jsObj !== 'object') {
    return violations;
  }

  function checkSteps(steps: unknown[]): void {
    if (!Array.isArray(steps)) return;
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;

      const stepRecord = step as Record<string, unknown>;

      // Check run injection
      if (typeof stepRecord.run === 'string' && expressionPattern.test(stepRecord.run)) {
        const snippet = stepRecord.run.split('\n')[0].trim();
        violations.push({
          file: filename,
          line: findLineNumber(snippet),
          rule: 'NO_RUN_INJECTION',
          message:
            'Direct interpolation of expressions in run: step detected. Pass dynamic values via env: variables instead.',
          snippet,
        });
      }

      // Check step-level secrets: inherit
      if (typeof stepRecord.secrets === 'string' && stepRecord.secrets.toLowerCase().trim() === 'inherit') {
        violations.push({
          file: filename,
          line: findLineNumber('secrets'),
          rule: 'NO_SECRETS_INHERIT',
          message: "Forbidden 'secrets: inherit' detected. Secrets must be explicitly mapped by name or use OIDC.",
          snippet: 'secrets: inherit',
        });
      }
    }
  }

  // 1. Check jobs in workflows (caller workflows passing secrets or executing steps)
  if (jsObj.jobs && typeof jsObj.jobs === 'object') {
    for (const job of Object.values(jsObj.jobs as Record<string, unknown>)) {
      if (!job || typeof job !== 'object') continue;

      const jobRecord = job as Record<string, unknown>;

      // Check job-level secrets: inherit
      if (typeof jobRecord.secrets === 'string' && jobRecord.secrets.toLowerCase().trim() === 'inherit') {
        violations.push({
          file: filename,
          line: findLineNumber('secrets'),
          rule: 'NO_SECRETS_INHERIT',
          message: "Forbidden 'secrets: inherit' detected. Secrets must be explicitly mapped by name or use OIDC.",
          snippet: 'secrets: inherit',
        });
      }

      // Check job steps
      if (Array.isArray(jobRecord.steps)) {
        checkSteps(jobRecord.steps);
      }
    }
  }

  // 2. Check composite actions (runs.steps)
  if (jsObj.runs && typeof jsObj.runs === 'object') {
    const runsRecord = jsObj.runs as Record<string, unknown>;
    if (Array.isArray(runsRecord.steps)) {
      checkSteps(runsRecord.steps);
    }
  }

  return violations;
}

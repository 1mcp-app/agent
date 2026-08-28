import YAML from 'yaml';

/**
 * Represents a security policy violation found in a GitHub Actions workflow or action file.
 */
export interface WorkflowViolation {
  /** The path or filename of the workflow being scanned. */
  file: string;
  /** The 1-indexed line number in the source file where the violation occurred. */
  line: number;
  /** The security rule identifier that was violated. */
  rule: 'NO_SECRETS_INHERIT' | 'NO_RUN_INJECTION';
  /** A human-readable description of the violation and remediation guidance. */
  message: string;
  /** A code snippet illustrating the violating line or construct. */
  snippet: string;
}

/**
 * Scans a GitHub Actions workflow or composite action file for 'secrets: inherit' and script expression injections in 'run:' steps.
 * Uses standard YAML structural evaluation with merge key support (natively resolving all aliases, anchors, merge keys, flow mappings, and block scalars).
 *
 * @param content - The raw YAML string content of the workflow or action file.
 * @param filename - Optional filename or relative path for reporting diagnostic violations.
 * @returns An array of detected workflow security violations.
 */
export function scanWorkflowSecurity(content: string, filename = 'workflow.yml'): WorkflowViolation[] {
  const violations: WorkflowViolation[] = [];
  const expressionPattern = /\$\{\{/;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const lineCounter = new YAML.LineCounter();

  let doc: YAML.Document;
  try {
    doc = YAML.parseDocument(content, { merge: true, lineCounter });
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

  // Collect AST line locations for run: and secrets: pairs from CST ranges
  const runLines: number[] = [];
  const secretsLines: number[] = [];

  YAML.visit(doc, {
    Pair(_, pair) {
      if (!YAML.isNode(pair.key) || !pair.key.range) return;
      const keyVal = (pair.key as { value?: unknown }).value;
      if (keyVal === 'run') {
        const line = lineCounter.linePos(pair.key.range[0]).line;
        runLines.push(line);
      } else if (keyVal === 'secrets') {
        const line = lineCounter.linePos(pair.key.range[0]).line;
        secretsLines.push(line);
      }
    },
  });

  let runLineIdx = 0;
  let secretsLineIdx = 0;

  /**
   * Retrieves the accurate AST line number for the next encountered run: step.
   *
   * @param snippet - The snippet of code to look up as fallback.
   * @returns The line number in the source file.
   */
  function getNextRunLine(snippet: string): number {
    if (runLineIdx < runLines.length) {
      return runLines[runLineIdx++];
    }
    const firstLine = snippet.split('\n')[0].trim();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(firstLine)) return i + 1;
    }
    return 1;
  }

  /**
   * Retrieves the accurate AST line number for the next encountered secrets: step or job.
   *
   * @returns The line number in the source file.
   */
  function getNextSecretsLine(): number {
    if (secretsLineIdx < secretsLines.length) {
      return secretsLines[secretsLineIdx++];
    }
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('secrets') && lines[i].includes('inherit')) return i + 1;
    }
    return 1;
  }

  /**
   * Evaluates an array of step objects for script injections and unsafe secrets inheritance.
   *
   * @param steps - The array of step definitions from a job or composite action.
   */
  function checkSteps(steps: unknown[]): void {
    if (!Array.isArray(steps)) return;
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;

      const stepRecord = step as Record<string, unknown>;

      // Check run injection
      if (typeof stepRecord.run === 'string') {
        const snippet = stepRecord.run.split('\n')[0].trim();
        const line = getNextRunLine(snippet);
        if (expressionPattern.test(stepRecord.run)) {
          violations.push({
            file: filename,
            line,
            rule: 'NO_RUN_INJECTION',
            message:
              'Direct interpolation of expressions in run: step detected. Pass dynamic values via env: variables instead.',
            snippet,
          });
        }
      }

      // Check step-level secrets: inherit
      if (typeof stepRecord.secrets === 'string') {
        const line = getNextSecretsLine();
        if (stepRecord.secrets.toLowerCase().trim() === 'inherit') {
          violations.push({
            file: filename,
            line,
            rule: 'NO_SECRETS_INHERIT',
            message: "Forbidden 'secrets: inherit' detected. Secrets must be explicitly mapped by name or use OIDC.",
            snippet: 'secrets: inherit',
          });
        }
      }
    }
  }

  // 1. Check jobs in workflows (caller workflows passing secrets or executing steps)
  if (jsObj.jobs && typeof jsObj.jobs === 'object') {
    for (const job of Object.values(jsObj.jobs as Record<string, unknown>)) {
      if (!job || typeof job !== 'object') continue;

      const jobRecord = job as Record<string, unknown>;

      // Check job-level secrets: inherit
      if (typeof jobRecord.secrets === 'string') {
        const line = getNextSecretsLine();
        if (jobRecord.secrets.toLowerCase().trim() === 'inherit') {
          violations.push({
            file: filename,
            line,
            rule: 'NO_SECRETS_INHERIT',
            message: "Forbidden 'secrets: inherit' detected. Secrets must be explicitly mapped by name or use OIDC.",
            snippet: 'secrets: inherit',
          });
        }
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

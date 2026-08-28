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
 * Recursively resolves a YAML node or alias to its underlying string value.
 *
 * @param node - The AST node or alias to resolve.
 * @param doc - The parsed YAML document.
 * @returns The resolved string representation.
 */
function resolveStringValue(node: unknown, doc: YAML.Document): string {
  if (!node) return '';
  if (YAML.isScalar(node)) return String(node.value ?? '');
  if (YAML.isAlias(node)) {
    const resolved = node.resolve(doc);
    return resolveStringValue(resolved, doc);
  }
  return '';
}

/**
 * Checks whether an AST scalar node represents a YAML merge key (<<:).
 *
 * @param keyNode - The AST node of the pair key.
 * @returns True if the key represents a merge key.
 */
function isMergeKey(keyNode: unknown): boolean {
  if (!keyNode) return false;
  const scalar = keyNode as { source?: string; value?: unknown };
  if (scalar.source === '<<') return true;
  if (typeof scalar.value === 'symbol' && String(scalar.value).includes('<<')) return true;
  if (String(scalar.value) === '<<') return true;
  return false;
}

/**
 * Scans a GitHub Actions workflow or composite action file for 'secrets: inherit' and script expression injections in 'run:' steps.
 * Uses path-aware AST traversal and CST node range tracking for accurate diagnostic line attribution.
 *
 * @param content - The raw YAML string content of the workflow or action file.
 * @param filename - Optional filename or relative path for reporting diagnostic violations.
 * @returns An array of detected workflow security violations.
 */
export function scanWorkflowSecurity(content: string, filename = 'workflow.yml'): WorkflowViolation[] {
  const violations: WorkflowViolation[] = [];
  const expressionPattern = /\$\{\{/;
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
      snippet: '',
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

  /**
   * Inspects a step mapping node for run: expression injections and secrets: inherit violations.
   *
   * @param stepMap - The YAML mapping node for an individual step.
   * @param fallbackLine - Fallback line number if CST range is unavailable.
   * @param isMerged - Whether the step properties originated from a merged key.
   */
  function checkStepMap(stepMap: unknown, fallbackLine = 1, isMerged = false): void {
    if (!YAML.isMap(stepMap)) {
      if (YAML.isAlias(stepMap)) {
        const resolved = stepMap.resolve(doc);
        if (YAML.isMap(resolved)) checkStepMap(resolved, fallbackLine, isMerged);
      }
      return;
    }

    for (const pair of stepMap.items) {
      if (!YAML.isPair(pair)) continue;

      // Handle step-level merge keys (<<:)
      if (isMergeKey(pair.key)) {
        const mergeLine =
          pair.key && YAML.isNode(pair.key) && pair.key.range
            ? lineCounter.linePos(pair.key.range[0]).line
            : fallbackLine;
        if (YAML.isAlias(pair.value)) {
          const resolved = pair.value.resolve(doc);
          if (YAML.isMap(resolved)) checkStepMap(resolved, mergeLine, true);
        } else if (YAML.isSeq(pair.value)) {
          for (const it of pair.value.items) {
            if (YAML.isAlias(it)) {
              const res = it.resolve(doc);
              if (YAML.isMap(res)) checkStepMap(res, mergeLine, true);
            } else if (YAML.isMap(it)) {
              checkStepMap(it, mergeLine, true);
            }
          }
        }
        continue;
      }

      if (!YAML.isScalar(pair.key)) continue;
      const key = String(pair.key.value);

      if (key === 'run') {
        const strVal = resolveStringValue(pair.value, doc);
        if (expressionPattern.test(strVal)) {
          const line =
            !isMerged && YAML.isNode(pair.key) && pair.key.range
              ? lineCounter.linePos(pair.key.range[0]).line
              : fallbackLine;
          const snippet = strVal.split('\n')[0].trim();
          violations.push({
            file: filename,
            line,
            rule: 'NO_RUN_INJECTION',
            message:
              'Direct interpolation of expressions in run: step detected. Pass dynamic values via env: variables instead.',
            snippet,
          });
        }
      } else if (key === 'secrets') {
        const strVal = resolveStringValue(pair.value, doc);
        if (strVal.toLowerCase().trim() === 'inherit') {
          const line =
            !isMerged && YAML.isNode(pair.key) && pair.key.range
              ? lineCounter.linePos(pair.key.range[0]).line
              : fallbackLine;
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

  /**
   * Inspects a steps sequence node across all contained steps.
   *
   * @param stepsSeq - The YAML sequence node containing step mappings.
   */
  function checkStepsSeq(stepsSeq: unknown): void {
    if (!YAML.isSeq(stepsSeq)) {
      if (YAML.isAlias(stepsSeq)) {
        const resolved = stepsSeq.resolve(doc);
        if (YAML.isSeq(resolved)) checkStepsSeq(resolved);
      }
      return;
    }
    for (const item of stepsSeq.items) {
      if (YAML.isMap(item) && item.range) {
        const stepLine = lineCounter.linePos(item.range[0]).line;
        checkStepMap(item, stepLine, false);
      } else {
        checkStepMap(item, 1, false);
      }
    }
  }

  // Traverse top-level mapping (jobs / runs)
  if (YAML.isMap(doc.contents)) {
    for (const rootPair of doc.contents.items) {
      if (!YAML.isPair(rootPair) || !YAML.isScalar(rootPair.key)) continue;
      const rootKey = String(rootPair.key.value);

      if (rootKey === 'jobs') {
        let jobsVal = rootPair.value;
        if (YAML.isAlias(jobsVal)) jobsVal = jobsVal.resolve(doc);

        if (YAML.isMap(jobsVal)) {
          for (const jobPair of jobsVal.items) {
            if (!YAML.isPair(jobPair)) continue;
            let jobVal = jobPair.value;
            if (YAML.isAlias(jobVal)) jobVal = jobVal.resolve(doc);
            if (!YAML.isMap(jobVal)) continue;

            for (const jobProp of jobVal.items) {
              if (!YAML.isPair(jobProp)) continue;

              // Handle job-level merge keys
              if (isMergeKey(jobProp.key)) {
                const mergeLine =
                  jobProp.key && YAML.isNode(jobProp.key) && jobProp.key.range
                    ? lineCounter.linePos(jobProp.key.range[0]).line
                    : 1;
                if (YAML.isAlias(jobProp.value)) {
                  const resolved = jobProp.value.resolve(doc);
                  if (YAML.isMap(resolved)) {
                    for (const mProp of resolved.items) {
                      if (YAML.isPair(mProp) && YAML.isScalar(mProp.key) && String(mProp.key.value) === 'secrets') {
                        const strVal = resolveStringValue(mProp.value, doc);
                        if (strVal.toLowerCase().trim() === 'inherit') {
                          violations.push({
                            file: filename,
                            line: mergeLine,
                            rule: 'NO_SECRETS_INHERIT',
                            message:
                              "Forbidden 'secrets: inherit' detected. Secrets must be explicitly mapped by name or use OIDC.",
                            snippet: 'secrets: inherit',
                          });
                        }
                      }
                    }
                  }
                }
                continue;
              }

              if (!YAML.isScalar(jobProp.key)) continue;
              const propKey = String(jobProp.key.value);

              if (propKey === 'secrets') {
                const strVal = resolveStringValue(jobProp.value, doc);
                if (strVal.toLowerCase().trim() === 'inherit') {
                  const line =
                    YAML.isNode(jobProp.key) && jobProp.key.range ? lineCounter.linePos(jobProp.key.range[0]).line : 1;
                  violations.push({
                    file: filename,
                    line,
                    rule: 'NO_SECRETS_INHERIT',
                    message:
                      "Forbidden 'secrets: inherit' detected. Secrets must be explicitly mapped by name or use OIDC.",
                    snippet: 'secrets: inherit',
                  });
                }
              } else if (propKey === 'steps') {
                checkStepsSeq(jobProp.value);
              }
            }
          }
        }
      } else if (rootKey === 'runs') {
        let runsVal = rootPair.value;
        if (YAML.isAlias(runsVal)) runsVal = runsVal.resolve(doc);

        if (YAML.isMap(runsVal)) {
          for (const runProp of runsVal.items) {
            if (!YAML.isPair(runProp) || !YAML.isScalar(runProp.key)) continue;
            if (String(runProp.key.value) === 'steps') {
              checkStepsSeq(runProp.value);
            }
          }
        }
      }
    }
  }

  return violations;
}

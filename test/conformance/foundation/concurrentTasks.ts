/** Keep process-heavy conformance work bounded and results in evidence-plan order. */
export async function runConformanceTasks<Input, Result>(
  inputs: readonly Input[],
  execute: (input: Input) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(inputs.length);
  let nextIndex = 0;
  let failure: { error: unknown } | undefined;

  async function worker(): Promise<void> {
    while (nextIndex < inputs.length) {
      if (failure) return;
      const index = nextIndex++;
      try {
        results[index] = await execute(inputs[index]);
      } catch (error) {
        failure ??= { error };
        return;
      }
    }
  }

  // Each task owns subprocesses and cleanup. Drain started work before throwing.
  await Promise.all(Array.from({ length: Math.min(2, inputs.length) }, () => worker()));
  if (failure) throw failure.error;
  return results;
}

import { useCallback, useRef } from 'react';

interface ApplyAttempt {
  previewFingerprint: string;
  idempotencyKey: string;
}

export function useConfiguredServerMutationLifecycle(onReset: () => void) {
  const onResetRef = useRef(onReset);
  const loadRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const applyRequestRef = useRef(0);
  const applyInteractionRef = useRef(false);
  const applyAttemptRef = useRef<ApplyAttempt>();
  onResetRef.current = onReset;

  const invalidatePreview = useCallback(() => {
    previewRequestRef.current += 1;
    applyAttemptRef.current = undefined;
  }, []);

  const invalidateApply = useCallback(() => {
    applyRequestRef.current += 1;
    applyAttemptRef.current = undefined;
  }, []);

  const reset = useCallback(() => {
    loadRequestRef.current += 1;
    previewRequestRef.current += 1;
    applyRequestRef.current += 1;
    applyInteractionRef.current = false;
    applyAttemptRef.current = undefined;
    onResetRef.current();
  }, []);

  return {
    loadRequestRef,
    previewRequestRef,
    applyRequestRef,
    applyInteractionRef,
    applyAttemptRef,
    invalidatePreview,
    invalidateApply,
    reset,
  };
}

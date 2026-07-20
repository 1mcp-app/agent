import { Button, FocusTrap, Group, List, Paper, Stack, Text, Title } from '@mantine/core';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';

export interface ConfirmationDetail {
  label: string;
  value: string;
}

export interface ConfirmationRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  details?: ConfirmationDetail[];
}

type Confirm = (request: ConfirmationRequest) => Promise<boolean>;

interface PendingConfirmation extends ConfirmationRequest {
  resolve(result: boolean): void;
}

const ConfirmationContext = createContext<Confirm | null>(null);

export function ConfirmationDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const pendingRef = useRef<PendingConfirmation | null>(null);
  const queueRef = useRef<PendingConfirmation[]>([]);
  const settledRef = useRef(new WeakSet<PendingConfirmation>());
  const activationLockedRef = useRef(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback<Confirm>(
    (request) =>
      new Promise<boolean>((resolve) => {
        const next = { ...request, resolve };
        if (pendingRef.current) {
          queueRef.current.push(next);
          return;
        }
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        pendingRef.current = next;
        flushSync(() => setPending(next));
      }),
    [],
  );

  const settle = useCallback((result: boolean) => {
    const current = pendingRef.current;
    if (!current || activationLockedRef.current || settledRef.current.has(current)) return;
    activationLockedRef.current = true;
    settledRef.current.add(current);
    current.resolve(result);
    const next = queueRef.current.shift() ?? null;
    pendingRef.current = next;
    flushSync(() => setPending(next));
    window.setTimeout(() => {
      activationLockedRef.current = false;
      if (next) cancelButtonRef.current?.focus();
      else returnFocusRef.current?.focus();
    }, 0);
  }, []);

  const contextValue = useMemo(() => confirm, [confirm]);

  useEffect(() => {
    if (pending) cancelButtonRef.current?.focus();
  }, [pending]);

  return (
    <ConfirmationContext.Provider value={contextValue}>
      {children}
      {pending ? (
        <div className="confirmation-overlay" role="presentation">
          <FocusTrap active>
            <Paper
              className="confirmation-dialog"
              withBorder
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-confirmation-title"
              aria-describedby="admin-confirmation-message"
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                settle(false);
              }}
            >
              <Stack gap="md">
                <Title id="admin-confirmation-title" order={3}>
                  {pending.title}
                </Title>
                <Text id="admin-confirmation-message">{pending.message}</Text>
                {pending.details?.length ? (
                  <List spacing="xs" size="sm">
                    {pending.details.map((detail) => (
                      <List.Item key={`${detail.label}:${detail.value}`}>
                        <Text span fw={700}>
                          {detail.label}:{' '}
                        </Text>
                        <Text span>{detail.value}</Text>
                      </List.Item>
                    ))}
                  </List>
                ) : null}
                <Group justify="flex-end">
                  <Button ref={cancelButtonRef} variant="default" onClick={() => settle(false)}>
                    {pending.cancelLabel ?? 'Cancel'}
                  </Button>
                  <Button color={pending.tone === 'danger' ? 'red' : undefined} onClick={() => settle(true)}>
                    {pending.confirmLabel ?? 'Confirm'}
                  </Button>
                </Group>
              </Stack>
            </Paper>
          </FocusTrap>
        </div>
      ) : null}
    </ConfirmationContext.Provider>
  );
}

export function useConfirmationDialog(): Confirm {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error('useConfirmationDialog must be used within ConfirmationDialogProvider');
  return confirm;
}

import { Stack } from '@mantine/core';

import { AlertTriangle } from 'lucide-react';

import type { AdminAuditFact } from '../api/adminApi';
import { DetailRow, EmptyState, Panel } from './AdminConsoleShared';

export function AuditPanel({
  facts,
  onCopyText,
}: {
  facts: AdminAuditFact[];
  onCopyText?: (label: string, value: string) => Promise<void>;
}) {
  return (
    <Panel title="Recent audit facts" utility="redacted" icon={<AlertTriangle size={17} />}>
      {facts.length === 0 ? (
        <EmptyState message="No recent admin audit facts." />
      ) : (
        <Stack gap="xs">
          {facts.map((fact) => (
            <DetailRow
              key={fact.operationId ?? `${fact.operationName}-${fact.timestamp}`}
              label={fact.operationName}
              value={fact.result}
              meta={fact.target?.id ?? fact.operationId ?? '-'}
              description={fact.timestamp}
              copyLabel={fact.request?.requestId ? 'requestId' : undefined}
              copyValue={fact.request?.requestId}
              onCopyText={onCopyText}
            />
          ))}
        </Stack>
      )}
    </Panel>
  );
}

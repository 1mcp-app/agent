import { Paper, Stack, Text } from '@mantine/core';

import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';

import type { AdminAuditFact, OAuthServiceStatus, RuntimeIdentity } from '../api/adminApi';
import { DetailRow, EmptyState, Panel } from './AdminConsoleShared';

export function RuntimePanel({
  runtime,
  onCopyText,
}: {
  runtime?: RuntimeIdentity;
  onCopyText?: (label: string, value: string) => Promise<void>;
}) {
  return (
    <Panel title="Runtime identity" utility="Runtime health · support details" icon={<Activity size={17} />}>
      {runtime ? (
        <Stack gap="xs">
          <DetailRow label="Version" value={runtime.runtimeVersion} />
          <DetailRow
            label="External URL"
            value={runtime.externalUrl ?? '-'}
            copyLabel="externalUrl"
            onCopyText={onCopyText}
          />
          <Paper className="identity-details" withBorder>
            <Stack gap={4}>
              <Text className="eyebrow" size="xs">
                Identity details
              </Text>
              <Text size="sm" c="dimmed">
                Full runtime scope ID is support metadata. Prefer version and external URL in the main scan path.
              </Text>
              <DetailRow
                label="Runtime scope"
                value={runtime.runtimeScopeId}
                copyLabel="runtimeScopeId"
                onCopyText={onCopyText}
              />
            </Stack>
          </Paper>
        </Stack>
      ) : (
        <EmptyState message="Runtime status has not loaded." />
      )}
    </Panel>
  );
}

export function OAuthPanel({ services }: { services: OAuthServiceStatus[] }) {
  return (
    <Panel title="OAuth status" utility={`${services.length} services`} icon={<CheckCircle2 size={17} />}>
      {services.length === 0 ? (
        <EmptyState message="No OAuth services reported." />
      ) : (
        <Stack gap="xs">
          {services.map((service) => (
            <DetailRow
              key={service.name}
              label={service.name}
              value={service.status}
              meta={service.requiresOAuth ? 'OAuth required' : 'No OAuth'}
              description={service.lastError}
            />
          ))}
        </Stack>
      )}
    </Panel>
  );
}

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

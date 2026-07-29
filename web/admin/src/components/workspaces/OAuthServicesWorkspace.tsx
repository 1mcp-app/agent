import { Alert, Badge, Button, Code, Group, Paper, Stack, Text } from '@mantine/core';

import { Clipboard, KeyRound, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import type { OAuthServiceStatus } from '../../api/adminApi';
import type {
  AdminConsoleSessionModel,
  OAuthAdminAction,
  OperatorWorkspaceModel,
} from '../../session/AdminConsoleSessionModel';
import { WorkspaceHeading } from './RuntimeOperationsWorkspace';

export function OAuthServicesWorkspace({
  model,
  oauth,
}: {
  model: OperatorWorkspaceModel;
  oauth: AdminConsoleSessionModel['oauth'];
}) {
  const { state, configuredServers } = model;
  const services = state.status?.oauth.services ?? [];
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  async function copyServiceId(service: OAuthServiceStatus): Promise<void> {
    try {
      await configuredServers.copy('serviceId', service.id);
      setCopyFeedback('Service id copied.');
    } catch {
      setCopyFeedback('Could not copy service id. Select the value manually.');
    }
  }

  return (
    <section aria-label="OAuth services" className="operations-workspace">
      <WorkspaceHeading
        title="OAuth services"
        description={`${services.length} reported services · runtime status ${state.status?.oauth.status ?? 'unavailable'}`}
        model={model}
      />
      {oauth.callbackFeedback ? <FeedbackAlert feedback={oauth.callbackFeedback} /> : null}
      {oauth.operationFeedback ? <FeedbackAlert feedback={oauth.operationFeedback} /> : null}
      {services.length === 0 ? (
        <Paper className="operations-panel" withBorder>
          <Text c="dimmed">No OAuth services reported.</Text>
        </Paper>
      ) : (
        <Stack gap="sm">
          {services.map((service) => (
            <OAuthServiceRow
              key={service.id}
              service={service}
              busy={oauth.busy?.serviceId === service.id ? oauth.busy.action : null}
              operationBlocked={oauth.busy !== null}
              onCopy={() => void copyServiceId(service)}
              onOperate={(action) => void oauth.operate(service.id, action)}
            />
          ))}
        </Stack>
      )}
      {copyFeedback ? (
        <Alert aria-live="polite" color={copyFeedback.startsWith('Could not') ? 'red' : 'teal'} mt="sm">
          {copyFeedback}
        </Alert>
      ) : null}
    </section>
  );
}

function OAuthServiceRow({
  service,
  busy,
  operationBlocked,
  onCopy,
  onOperate,
}: {
  service: OAuthServiceStatus;
  busy: OAuthAdminAction | null;
  operationBlocked: boolean;
  onCopy(): void;
  onOperate(action: OAuthAdminAction): void;
}) {
  const action = oauthAction(service);
  const actionLabel = action === 'authorize' ? 'Authorize' : 'Restart';

  return (
    <Paper component="article" className="oauth-service-row" withBorder>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div className="oauth-service-main">
          <Group gap="xs">
            <Text fw={800}>{service.displayName}</Text>
            <Badge color={service.status === 'connected' ? 'teal' : 'yellow'} variant="light">
              {service.status}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            {service.requiresOAuth ? 'OAuth required' : 'No OAuth action required'}
          </Text>
          {service.lastError ? (
            <Text size="sm" c="red">
              {service.lastError}
            </Text>
          ) : null}
          <details className="oauth-service-identity">
            <summary>Full service ID</summary>
            <Group gap="xs" wrap="nowrap">
              <Code className="oauth-service-id">{service.id}</Code>
              <Button
                aria-label={`Copy full service ID for ${service.displayName}`}
                size="compact-xs"
                variant="subtle"
                onClick={onCopy}
              >
                <Clipboard size={14} aria-hidden="true" />
              </Button>
            </Group>
          </details>
        </div>
        {action ? (
          <Stack gap={4} align="flex-end" className="oauth-service-action">
            <Button
              aria-label={`${actionLabel} ${service.displayName}`}
              leftSection={action === 'authorize' ? <KeyRound size={15} /> : <RotateCcw size={15} />}
              loading={busy === action}
              disabled={operationBlocked}
              onClick={() => onOperate(action)}
            >
              {actionLabel}
            </Button>
            <Text size="xs" c="dimmed" aria-live="polite">
              {busy ? (busy === 'authorize' ? 'Starting authorization...' : 'Restarting authorization...') : ''}
            </Text>
          </Stack>
        ) : null}
      </Group>
    </Paper>
  );
}

function oauthAction(service: OAuthServiceStatus): OAuthAdminAction | null {
  if (!service.requiresOAuth) return null;
  return service.status === 'awaiting_oauth' ? 'authorize' : 'restart';
}

function FeedbackAlert({ feedback }: { feedback: { kind: 'success' | 'error'; message: string } }) {
  return (
    <Alert
      color={feedback.kind === 'success' ? 'teal' : 'red'}
      role={feedback.kind === 'success' ? 'status' : 'alert'}
      mb="sm"
    >
      {feedback.message}
    </Alert>
  );
}

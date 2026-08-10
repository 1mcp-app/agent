import { Alert, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';

import { ArrowRight, LogOut, RefreshCw } from 'lucide-react';
import { type MouseEvent, useState } from 'react';

import type { AdminConsoleRoute, OperatorWorkspaceModel } from '../../session/AdminConsoleSessionModel';
import { DetailRow, Panel } from '../AdminConsoleShared';
import { disabledServers, enabledServers, humanize, isOAuthAttention } from '../adminConsoleUtils';
import { ConfiguredServerCreator } from '../configuredServerCreator';
import { ConfiguredServerEditor } from '../configuredServerEditor';
import { ConfiguredServersPanel } from '../ConfiguredServersPanel';
import { AuditPanel } from '../OperationsStatusPanels';

export function DashboardWorkspace({
  model,
  navigate,
}: {
  model: OperatorWorkspaceModel;
  navigate(route: AdminConsoleRoute): void | Promise<void>;
}) {
  const { state, configuredServers } = model;
  const failedAudits = (state.status?.audit.facts ?? []).filter((fact) => fact.result === 'failed').length;
  const oauthAttention = (state.status?.oauth.services ?? []).filter(isOAuthAttention).length;
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const runtime = state.status?.runtime;

  async function copyText(label: string, value: string): Promise<void> {
    try {
      await configuredServers.copy(label, value);
      setCopyFeedback(`${humanize(label)} copied.`);
    } catch {
      setCopyFeedback(`Could not copy ${humanize(label)}. Select the value manually.`);
    }
  }

  return (
    <section aria-labelledby="runtime-operations-title" className="operations-workspace">
      <Title id="runtime-operations-title" order={2} className="sr-only">
        Runtime operations
      </Title>
      <WorkspaceHeading
        title="Operations dashboard"
        description={`Runtime summaries for ${state.session?.account.username ?? 'operator'} · updated ${state.lastUpdatedAt ?? 'never'}`}
        model={model}
      />
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" className="summary-grid">
        <SummaryLink
          label="Enabled servers"
          value={enabledServers(state.configuredServers)}
          tone="good"
          icon="01"
          href="/admin/servers"
          onNavigate={() => navigate('servers')}
        />
        <SummaryLink
          label="Disabled servers"
          value={disabledServers(state.configuredServers)}
          tone="warn"
          icon="02"
          href="/admin/servers"
          onNavigate={() => navigate('servers')}
        />
        <SummaryLink
          label="OAuth attention"
          value={oauthAttention}
          tone={oauthAttention > 0 ? 'warn' : 'good'}
          icon="03"
          href="/admin/oauth"
          onNavigate={() => navigate('oauth')}
        />
        <SummaryLink
          label="Failed audits"
          value={failedAudits}
          tone={failedAudits > 0 ? 'bad' : 'good'}
          icon="04"
          href="/admin/audit"
          onNavigate={() => navigate('audit')}
        />
      </SimpleGrid>
      <div className="dashboard-runtime-panel">
        <Panel title="Runtime identity" utility="current target" icon={<span className="runtime-live-dot" />}>
          {runtime ? (
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <DetailRow label="Version" value={runtime.runtimeVersion} />
              <DetailRow label="External URL" value={runtime.externalUrl ?? '-'} />
              <DetailRow
                label="Runtime scope"
                value={runtime.runtimeScopeId}
                copyLabel="runtimeScopeId"
                onCopyText={copyText}
              />
            </SimpleGrid>
          ) : (
            <Text c="dimmed">Runtime status has not loaded.</Text>
          )}
        </Panel>
      </div>
      <CopyFeedback message={copyFeedback} />
    </section>
  );
}

export function ServersWorkspace({ model }: { model: OperatorWorkspaceModel }) {
  const { state, configuredServers } = model;

  return (
    <section aria-labelledby="servers-workspace-title" className="operations-workspace">
      <WorkspaceHeading
        title="Configured servers"
        titleId="servers-workspace-title"
        description={`${state.configuredServers.length} configured targets · updated ${state.lastUpdatedAt ?? 'never'}`}
        model={model}
      />
      <div className="workspace-grid">
        <div className="inventory-column">
          <ConfiguredServersPanel
            state={state}
            onServerAction={configuredServers.mutate}
            onOpenServerDetail={configuredServers.edit.open}
            onConfigureCustomServer={configuredServers.create.open}
          />
        </div>
        <div className="inspector-column">
          {configuredServers.create.state.status === 'idle' ? (
            <ConfiguredServerEditor model={configuredServers.edit} />
          ) : (
            <ConfiguredServerCreator model={configuredServers.create} />
          )}
        </div>
      </div>
    </section>
  );
}

export function AuditTrailWorkspace({ model }: { model: OperatorWorkspaceModel }) {
  const { state, configuredServers } = model;
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  async function copyText(label: string, value: string): Promise<void> {
    try {
      await configuredServers.copy(label, value);
      setCopyFeedback(`${humanize(label)} copied.`);
    } catch {
      setCopyFeedback(`Could not copy ${humanize(label)}. Select the value manually.`);
    }
  }

  return (
    <section aria-labelledby="audit-workspace-title" className="operations-workspace">
      <WorkspaceHeading
        title="Audit trail"
        titleId="audit-workspace-title"
        description={`Recent redacted Admin Operations · updated ${state.lastUpdatedAt ?? 'never'}`}
        model={model}
      />
      <AuditPanel facts={state.status?.audit.facts ?? []} onCopyText={copyText} />
      <CopyFeedback message={copyFeedback} />
    </section>
  );
}

export function WorkspaceHeading({
  title,
  titleId,
  description,
  model,
}: {
  title: string;
  titleId?: string;
  description: string;
  model: Pick<OperatorWorkspaceModel, 'refresh' | 'logout'>;
}) {
  return (
    <Group justify="space-between" align="flex-start" className="workspace-heading">
      <div>
        <Text className="eyebrow" size="xs">
          Operator workspace / live
        </Text>
        <Title id={titleId} order={2}>
          {title}
        </Title>
        <Text c="dimmed" size="sm">
          {description}
        </Text>
      </div>
      <Group gap="xs">
        <Button variant="default" leftSection={<RefreshCw size={16} />} onClick={() => void model.refresh()}>
          Refresh
        </Button>
        <Button color="red" variant="light" leftSection={<LogOut size={16} />} onClick={() => void model.logout()}>
          Log out
        </Button>
      </Group>
    </Group>
  );
}

function SummaryLink({
  label,
  value,
  tone,
  icon,
  href,
  onNavigate,
}: {
  label: string;
  value: number;
  tone: 'good' | 'warn' | 'bad';
  icon: string;
  href: string;
  onNavigate(): void;
}) {
  return (
    <Paper
      component="a"
      href={href}
      className={`summary-counter summary-link summary-${tone}`}
      withBorder
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (!isSamePageNavigation(event)) return;
        event.preventDefault();
        onNavigate();
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed" fw={800} tt="uppercase">
            {label}
          </Text>
          <Text className="summary-value">{value}</Text>
        </div>
        <Stack gap={4} align="flex-end">
          <Text className="summary-index">{icon}</Text>
          <ArrowRight size={15} aria-hidden="true" />
        </Stack>
      </Group>
    </Paper>
  );
}

function CopyFeedback({ message }: { message: string | null }) {
  return (
    <div aria-live="polite">
      {message ? (
        <Alert color={message.startsWith('Could not') ? 'red' : 'teal'} mt="sm">
          {message}
        </Alert>
      ) : null}
    </div>
  );
}

function isSamePageNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

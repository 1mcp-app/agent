import { Alert, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';

import { AlertTriangle, ArrowRight, CircleCheck, KeyRound, Plus, ServerOff } from 'lucide-react';
import { type MouseEvent, type ReactNode, useState } from 'react';

import { ConfiguredServerDeletionNotice } from '../../configuredServerDelete/ConfiguredServerDeletionNotice';
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
  const disabled = disabledServers(state.configuredServers);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const runtime = state.status?.runtime;

  async function configureServer() {
    await configuredServers.create.open();
  }

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
        title="Overview"
        description={`Runtime summaries for ${state.session?.account.username ?? 'operator'} · updated ${state.lastUpdatedAt ?? 'never'}`}
      />
      <div className="runtime-status-strip" role="status" aria-label="Runtime status and freshness">
        <Group gap="xs" wrap="nowrap" className="runtime-status-main">
          <span className="runtime-live-dot" />
          <Text fw={800} size="sm">
            Runtime online
          </Text>
          <Text c="dimmed" size="sm" className="truncate">
            {runtime?.externalUrl ?? 'Local runtime'}
          </Text>
        </Group>
        <Group gap="lg" wrap="nowrap" className="runtime-status-facts">
          <Text size="xs" c="dimmed">
            Version <strong>{runtime?.runtimeVersion ?? 'unavailable'}</strong>
          </Text>
          <Text size="xs" c="dimmed">
            Updated <strong>{state.lastUpdatedAt ?? 'never'}</strong>
          </Text>
        </Group>
      </div>
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
          value={disabled}
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
      <div className="dashboard-grid">
        <section className="attention-panel" aria-labelledby="attention-title">
          <Group justify="space-between" align="flex-start" mb="sm">
            <div>
              <Text className="eyebrow" size="xs">
                Triage
              </Text>
              <Title id="attention-title" order={3}>
                Needs attention
              </Title>
            </div>
            <Button leftSection={<Plus size={16} />} onClick={() => void configureServer()}>
              Configure server
            </Button>
          </Group>
          <Stack gap={0} className="attention-list">
            {disabled > 0 ? (
              <AttentionLink
                icon={<ServerOff size={17} />}
                label={`${disabled} disabled ${disabled === 1 ? 'server' : 'servers'}`}
                detail="Review availability before enabling a target."
                href="/admin/servers"
                onNavigate={() => navigate('servers')}
              />
            ) : null}
            {oauthAttention > 0 ? (
              <AttentionLink
                icon={<KeyRound size={17} />}
                label={`${oauthAttention} OAuth ${oauthAttention === 1 ? 'service needs' : 'services need'} action`}
                detail="Authorization or restart is required."
                href="/admin/oauth"
                onNavigate={() => navigate('oauth')}
              />
            ) : null}
            {failedAudits > 0 ? (
              <AttentionLink
                icon={<AlertTriangle size={17} />}
                label={`${failedAudits} failed ${failedAudits === 1 ? 'operation' : 'operations'}`}
                detail="Inspect recent redacted audit facts."
                href="/admin/audit"
                onNavigate={() => navigate('audit')}
              />
            ) : null}
            {disabled === 0 && oauthAttention === 0 && failedAudits === 0 ? (
              <div className="attention-clear">
                <CircleCheck size={18} />
                <div>
                  <Text fw={800}>No action required</Text>
                  <Text c="dimmed" size="sm">
                    Configured servers and runtime services report a clear state.
                  </Text>
                </div>
              </div>
            ) : null}
          </Stack>
        </section>
        <Panel title="Runtime identity" utility="current target" icon={<span className="runtime-live-dot" />}>
          {runtime ? (
            <SimpleGrid cols={1} spacing="sm" className="runtime-identity-grid">
              <DetailRow label="Version" value={runtime.runtimeVersion} />
              <DetailRow
                label="External URL"
                value={runtime.externalUrl ?? '-'}
                copyLabel="externalUrl"
                onCopyText={copyText}
                wrapValue
              />
              <DetailRow
                label="Runtime scope"
                value={runtime.runtimeScopeId}
                copyLabel="runtimeScopeId"
                onCopyText={copyText}
                wrapValue
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
  const creating = configuredServers.create.state.status !== 'idle';
  const editing = configuredServers.edit.state.status !== 'list';

  return (
    <section aria-labelledby="servers-workspace-title" className="operations-workspace">
      <WorkspaceHeading
        title="Configured servers"
        titleId="servers-workspace-title"
        description={`${state.configuredServers.length} configured targets · updated ${state.lastUpdatedAt ?? 'never'}`}
      />
      {!creating && !editing && configuredServers.deletionNotice ? (
        <ConfiguredServerDeletionNotice
          result={configuredServers.deletionNotice}
          dismiss={configuredServers.dismissDeletionNotice}
        />
      ) : null}
      <div className="inventory-column server-browse-workspace" hidden={creating || editing}>
        <ConfiguredServersPanel
          state={state}
          onServerAction={configuredServers.mutate}
          onOpenServerDetail={configuredServers.edit.open}
          onConfigureCustomServer={configuredServers.create.open}
        />
      </div>
      {creating || editing ? (
        <div className="server-task-workspace">
          {creating ? (
            <ConfiguredServerCreator model={configuredServers.create} />
          ) : (
            <ConfiguredServerEditor model={configuredServers.edit} deleteModel={configuredServers.delete} />
          )}
        </div>
      ) : null}
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
}: {
  title: string;
  titleId?: string;
  description: string;
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
    </Group>
  );
}

function AttentionLink({
  icon,
  label,
  detail,
  href,
  onNavigate,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  href: string;
  onNavigate(): void | Promise<void>;
}) {
  return (
    <a
      className="attention-row"
      href={href}
      onClick={(event) => {
        if (!isSamePageNavigation(event)) return;
        event.preventDefault();
        void onNavigate();
      }}
    >
      <span className="attention-icon">{icon}</span>
      <span className="attention-copy">
        <Text component="span" fw={800} size="sm">
          {label}
        </Text>
        <Text component="span" c="dimmed" size="xs">
          {detail}
        </Text>
      </span>
      <ArrowRight size={16} />
    </a>
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

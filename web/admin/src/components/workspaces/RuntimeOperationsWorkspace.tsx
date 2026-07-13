import { Alert, Button, Group, Paper, SimpleGrid, Text, Title } from '@mantine/core';

import { LogOut, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import type { RuntimeOperationsModel } from '../../session/AdminConsoleSessionModel';
import { disabledServers, enabledServers, humanize, isOAuthAttention } from '../adminConsoleUtils';
import { ConfiguredServerEditor } from '../configuredServerEditor';
import { ConfiguredServersPanel } from '../ConfiguredServersPanel';
import { AuditPanel, OAuthPanel, RuntimePanel } from '../OperationsStatusPanels';

export function RuntimeOperationsWorkspace({ model }: { model: RuntimeOperationsModel }) {
  const { state, logout, refresh, configuredServers } = model;
  const failedAudits = (state.status?.audit.facts ?? []).filter((fact) => fact.result === 'failed').length;
  const oauthAttention = (state.status?.oauth.services ?? []).filter(isOAuthAttention).length;
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
    <section aria-labelledby="runtime-operations-title" className="operations-workspace">
      <Title id="runtime-operations-title" order={2} className="sr-only">
        Runtime operations
      </Title>
      <Group justify="space-between" align="flex-start" className="workspace-heading">
        <div>
          <Text className="eyebrow" size="xs">
            Operator workspace / live
          </Text>
          <Title order={2}>Operations overview</Title>
          <Text c="dimmed" size="sm">
            Runtime operations for {state.session?.account.username ?? 'operator'} · {state.configuredServers.length}{' '}
            configured targets · updated {state.lastUpdatedAt ?? 'never'}
          </Text>
        </div>
        <Group gap="xs">
          <Button variant="default" leftSection={<RefreshCw size={16} />} onClick={() => void refresh()}>
            Refresh
          </Button>
          <Button color="red" variant="light" leftSection={<LogOut size={16} />} onClick={() => void logout()}>
            Log out
          </Button>
        </Group>
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" className="summary-grid">
        <SummaryCounter label="Enabled servers" value={enabledServers(state.configuredServers)} tone="good" icon="01" />
        <SummaryCounter
          label="Disabled servers"
          value={disabledServers(state.configuredServers)}
          tone="warn"
          icon="02"
        />
        <SummaryCounter
          label="OAuth attention"
          value={oauthAttention}
          tone={oauthAttention > 0 ? 'warn' : 'good'}
          icon="03"
        />
        <SummaryCounter label="Failed audits" value={failedAudits} tone={failedAudits > 0 ? 'bad' : 'good'} icon="04" />
      </SimpleGrid>
      <div className="workspace-grid">
        <div className="inventory-column">
          <ConfiguredServersPanel
            state={state}
            onServerAction={configuredServers.mutate}
            onOpenServerDetail={configuredServers.open}
          />
          <AuditPanel facts={state.status?.audit.facts ?? []} onCopyText={copyText} />
        </div>
        <div className="inspector-column">
          <ConfiguredServerEditor
            state={configuredServers.editor}
            onClose={configuredServers.close}
            onDirtyChange={configuredServers.setDirty}
            onPreviewServerEdit={configuredServers.preview}
          />
          <RuntimePanel runtime={state.status?.runtime} onCopyText={copyText} />
          <OAuthPanel services={state.status?.oauth.services ?? []} />
        </div>
      </div>
      {copyFeedback ? (
        <Alert aria-live="polite" color={copyFeedback.startsWith('Could not') ? 'red' : 'teal'} mt="sm">
          {copyFeedback}
        </Alert>
      ) : null}
    </section>
  );
}

function SummaryCounter({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'good' | 'warn' | 'bad';
  icon: string;
}) {
  return (
    <Paper className={`summary-counter summary-${tone}`} withBorder>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed" fw={800} tt="uppercase">
            {label}
          </Text>
          <Text className="summary-value">{value}</Text>
        </div>
        <Text className="summary-index">{icon}</Text>
      </Group>
    </Paper>
  );
}

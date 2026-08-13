import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

import { Pencil, Plus, Search, ServerCog } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ConfiguredServerReadModel, ConfiguredServerTargetIdentity } from '../api/adminApi';
import type { AdminConsoleState, ServerMutation } from '../state/adminConsoleState';
import { EmptyState, Panel } from './AdminConsoleShared';
import {
  filterServers,
  secretSummary,
  serverActionState,
  serverMutationsAvailable,
  serverTags,
  transportSummaryLabel,
} from './adminConsoleUtils';

type ServerFilter = 'all' | 'enabled' | 'disabled';

export function ConfiguredServersPanel({
  state,
  onServerAction,
  onOpenServerDetail,
  onConfigureCustomServer,
}: {
  state: AdminConsoleState;
  onServerAction?: (serverId: string, action: 'enable' | 'disable') => void | Promise<void>;
  onOpenServerDetail?: (server: ConfiguredServerTargetIdentity) => void | Promise<void>;
  onConfigureCustomServer?: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ServerFilter>('all');
  const compactLayout = useMediaQuery('(max-width: 620px)', false);
  const servers = useMemo(
    () => filterServers(state.configuredServers, query, filter),
    [filter, query, state.configuredServers],
  );
  const inventoryEmpty = state.configuredServers.length === 0;

  return (
    <Panel
      title="Server inventory"
      utility={`${servers.length} of ${state.configuredServers.length} targets`}
      icon={<ServerCog size={17} />}
    >
      {!inventoryEmpty ? (
        <Group align="flex-end" gap="sm" className="server-filter-row">
          <TextInput
            className="server-search"
            leftSection={<Search size={16} />}
            label="Search servers"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <SegmentedControl
            aria-label="Server status filter"
            value={filter}
            onChange={(value) => setFilter(value as ServerFilter)}
            data={[
              { label: 'All', value: 'all' },
              { label: 'Enabled', value: 'enabled' },
              { label: 'Disabled', value: 'disabled' },
            ]}
          />
          <Button leftSection={<Plus size={16} />} onClick={() => void onConfigureCustomServer?.()}>
            Configure Custom Server
          </Button>
        </Group>
      ) : null}
      {inventoryEmpty ? (
        <Stack gap="sm" className="actionable-empty-state">
          <div>
            <Text fw={800}>No servers configured</Text>
            <Text c="dimmed" size="sm">
              Configure a target to start routing MCP capabilities and observing runtime activity.
            </Text>
          </div>
          <Button leftSection={<Plus size={16} />} onClick={() => void onConfigureCustomServer?.()}>
            Configure server
          </Button>
        </Stack>
      ) : servers.length === 0 ? (
        <Stack gap="sm" className="actionable-empty-state">
          <EmptyState message="No servers match the current search and status filter." />
          <Button
            variant="default"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            Clear filters
          </Button>
        </Stack>
      ) : compactLayout ? (
        <div className="server-mobile-list">
          {servers.map((server) => (
            <ServerCard
              key={`${server.source}:${server.id}`}
              server={server}
              mutation={state.serverMutations[server.id]}
              onServerAction={onServerAction}
              onOpenServerDetail={onOpenServerDetail}
            />
          ))}
        </div>
      ) : (
        <div className="server-table-view">
          <Table.ScrollContainer minWidth={720}>
            <Table className="admin-table" verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Server</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Transport</Table.Th>
                  <Table.Th>Secrets</Table.Th>
                  <Table.Th>Action</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {servers.map((server) => (
                  <ServerRow
                    key={`${server.source}:${server.id}`}
                    server={server}
                    mutation={state.serverMutations[server.id]}
                    onServerAction={onServerAction}
                    onOpenServerDetail={onOpenServerDetail}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </div>
      )}
    </Panel>
  );
}

function ServerCard({
  server,
  mutation,
  onServerAction,
  onOpenServerDetail,
}: {
  server: ConfiguredServerReadModel;
  mutation?: ServerMutation;
  onServerAction?: (serverId: string, action: 'enable' | 'disable') => void | Promise<void>;
  onOpenServerDetail?: (server: ConfiguredServerTargetIdentity) => void | Promise<void>;
}) {
  const action = server.enabled ? 'disable' : 'enable';
  const busy = mutation?.state === 'busy';
  const tags = serverTags(server);
  const actionState = serverActionState(server, action);
  const actionUnavailable = !serverMutationsAvailable(server) || !actionState.available;

  return (
    <article className={`server-mobile-card${mutation ? ` server-action-${mutation.state}` : ''}`}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div className="server-mobile-identity">
          <Group gap="xs">
            <Text fw={700}>{server.id}</Text>
            <Badge size="xs" variant="outline">
              {server.source === 'mcpTemplates' ? 'Template' : 'Static'}
            </Badge>
          </Group>
          {tags.length > 0 ? (
            <Text size="xs" c="dimmed">
              {tags.join(' / ')}
            </Text>
          ) : null}
        </div>
        <Badge color={server.enabled ? 'teal' : 'yellow'} variant="light">
          {server.enabled ? 'enabled' : 'disabled'}
        </Badge>
      </Group>
      <dl className="server-mobile-facts">
        <div>
          <dt>Transport</dt>
          <dd>{transportSummaryLabel(server)}</dd>
        </div>
        <div>
          <dt>Secrets</dt>
          <dd>{secretSummary(server)}</dd>
        </div>
      </dl>
      {mutation?.message ? (
        <Text size="xs" c={mutation.state === 'failed' ? 'red' : 'dimmed'}>
          {mutation.message}
        </Text>
      ) : null}
      <Group gap="sm" justify="space-between" wrap="nowrap" className="server-mobile-actions">
        <Tooltip label={`Edit ${server.id}`}>
          <ActionIcon
            aria-label={`Edit ${server.source === 'mcpTemplates' ? 'template' : 'static'} ${server.id} server`}
            size="lg"
            variant="default"
            onClick={() => void onOpenServerDetail?.({ source: server.source, id: server.id })}
          >
            <Pencil size={16} />
          </ActionIcon>
        </Tooltip>
        {server.source === 'mcpServers' ? (
          <ServerStateControl
            server={server}
            busy={busy}
            action={action}
            actionLabel={actionState.label}
            disabled={busy || actionUnavailable}
            onChange={() => void onServerAction?.(server.id, action)}
          />
        ) : null}
      </Group>
    </article>
  );
}

function ServerRow({
  server,
  mutation,
  onServerAction,
  onOpenServerDetail,
}: {
  server: ConfiguredServerReadModel;
  mutation?: ServerMutation;
  onServerAction?: (serverId: string, action: 'enable' | 'disable') => void | Promise<void>;
  onOpenServerDetail?: (server: ConfiguredServerTargetIdentity) => void | Promise<void>;
}) {
  const action = server.enabled ? 'disable' : 'enable';
  const busy = mutation?.state === 'busy';
  const tags = serverTags(server);
  const actionState = serverActionState(server, action);
  const actionUnavailable = !serverMutationsAvailable(server) || !actionState.available;

  return (
    <Table.Tr className={mutation ? `server-action-${mutation.state}` : undefined}>
      <Table.Td>
        <Group gap="xs">
          <Text fw={700}>{server.id}</Text>
          <Badge size="xs" variant="outline">
            {server.source === 'mcpTemplates' ? 'Template' : 'Static'}
          </Badge>
        </Group>
        {tags.length > 0 ? (
          <Text size="xs" c="dimmed">
            {tags.join(' / ')}
          </Text>
        ) : null}
        {mutation?.message ? (
          <Text size="xs" c={mutation.state === 'failed' ? 'red' : 'dimmed'}>
            {mutation.message}
          </Text>
        ) : null}
      </Table.Td>
      <Table.Td>
        <Badge color={server.enabled ? 'teal' : 'yellow'} variant="light">
          {server.enabled ? 'enabled' : 'disabled'}
        </Badge>
      </Table.Td>
      <Table.Td>{transportSummaryLabel(server)}</Table.Td>
      <Table.Td>{secretSummary(server)}</Table.Td>
      <Table.Td>
        <Group gap="sm" wrap="nowrap" justify="flex-end">
          <Tooltip label={`Edit ${server.id}`}>
            <ActionIcon
              aria-label={`Edit ${server.source === 'mcpTemplates' ? 'template' : 'static'} ${server.id} server`}
              size="lg"
              variant="default"
              onClick={() => void onOpenServerDetail?.({ source: server.source, id: server.id })}
            >
              <Pencil size={16} />
            </ActionIcon>
          </Tooltip>
          {server.source === 'mcpServers' ? (
            <ServerStateControl
              server={server}
              busy={busy}
              action={action}
              actionLabel={actionState.label}
              disabled={busy || actionUnavailable}
              onChange={() => void onServerAction?.(server.id, action)}
            />
          ) : null}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

function ServerStateControl({
  server,
  busy,
  action,
  actionLabel,
  disabled,
  onChange,
}: {
  server: ConfiguredServerReadModel;
  busy: boolean;
  action: 'enable' | 'disable';
  actionLabel: string;
  disabled: boolean;
  onChange(): void;
}) {
  return (
    <Group gap={7} wrap="nowrap" className="server-state-control">
      {busy ? <Loader aria-label={`Updating ${server.id}`} size={14} /> : null}
      <Switch
        aria-label={actionLabel}
        checked={server.enabled}
        color="teal"
        disabled={disabled}
        onChange={onChange}
        styles={{ input: { cursor: 'pointer', zIndex: 1 } }}
      />
      <Text className="server-state-label" size="xs" fw={700}>
        {action === 'disable' ? 'Enabled' : 'Disabled'}
      </Text>
    </Group>
  );
}

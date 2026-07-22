import { Badge, Button, Group, SegmentedControl, Table, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

import { Pencil, Search, ServerCog } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ConfiguredServerReadModel } from '../api/adminApi';
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
}: {
  state: AdminConsoleState;
  onServerAction?: (serverId: string, action: 'enable' | 'disable') => void | Promise<void>;
  onOpenServerDetail?: (serverId: string) => void | Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ServerFilter>('all');
  const compactLayout = useMediaQuery('(max-width: 620px)', false);
  const servers = useMemo(
    () => filterServers(state.configuredServers, query, filter),
    [filter, query, state.configuredServers],
  );

  return (
    <Panel
      title="Server inventory"
      utility={`${servers.length} of ${state.configuredServers.length} targets`}
      icon={<ServerCog size={17} />}
    >
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
      </Group>
      {servers.length === 0 ? (
        <EmptyState message="No servers match the current filter." />
      ) : compactLayout ? (
        <div className="server-mobile-list">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
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
                    key={server.id}
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
  onOpenServerDetail?: (serverId: string) => void | Promise<void>;
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
          <Text fw={700}>{server.id}</Text>
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
      <Group gap="xs" grow>
        <Button
          aria-label={`Edit ${server.id} server`}
          leftSection={<Pencil size={14} />}
          size="xs"
          variant="default"
          onClick={() => void onOpenServerDetail?.(server.id)}
        >
          Edit server
        </Button>
        <Button
          aria-label={actionState.label}
          size="xs"
          color={action === 'disable' ? 'red' : 'teal'}
          variant={action === 'disable' ? 'light' : 'filled'}
          loading={busy}
          disabled={busy || actionUnavailable}
          onClick={() => void onServerAction?.(server.id, action)}
        >
          {action === 'enable' ? 'Enable' : 'Disable'}
        </Button>
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
  onOpenServerDetail?: (serverId: string) => void | Promise<void>;
}) {
  const action = server.enabled ? 'disable' : 'enable';
  const busy = mutation?.state === 'busy';
  const tags = serverTags(server);
  const actionState = serverActionState(server, action);
  const actionUnavailable = !serverMutationsAvailable(server) || !actionState.available;

  return (
    <Table.Tr className={mutation ? `server-action-${mutation.state}` : undefined}>
      <Table.Td>
        <Text fw={700}>{server.id}</Text>
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
        <Group gap="xs" wrap="wrap">
          <Button
            aria-label={`Edit ${server.id} server`}
            leftSection={<Pencil size={14} />}
            size="xs"
            variant="default"
            onClick={() => void onOpenServerDetail?.(server.id)}
          >
            Edit server
          </Button>
          <Button
            size="xs"
            color={action === 'disable' ? 'red' : 'teal'}
            variant={action === 'disable' ? 'light' : 'filled'}
            loading={busy}
            disabled={busy || actionUnavailable}
            onClick={() => void onServerAction?.(server.id, action)}
          >
            {actionState.label}
          </Button>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

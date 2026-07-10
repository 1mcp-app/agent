import { Badge, Button, Group, SegmentedControl, Table, Text, TextInput } from '@mantine/core';

import { Pencil, Search, ServerCog } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ConfiguredServerReadModel } from '../api/adminApi';
import type { AdminConsoleState, ServerMutation } from '../state/adminConsoleState';
import type { AdminConsoleAppProps } from './AdminConsoleApp';
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
  onServerAction?: AdminConsoleAppProps['onServerAction'];
  onOpenServerDetail?: AdminConsoleAppProps['onOpenServerDetail'];
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ServerFilter>('all');
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
      ) : (
        <Table.ScrollContainer minWidth={820}>
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
      )}
    </Panel>
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
  onServerAction?: AdminConsoleAppProps['onServerAction'];
  onOpenServerDetail?: AdminConsoleAppProps['onOpenServerDetail'];
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

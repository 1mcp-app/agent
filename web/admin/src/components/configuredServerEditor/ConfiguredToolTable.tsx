import {
  ActionIcon,
  Badge,
  Button,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';

import { RotateCcw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ConfiguredToolInventory } from '../../api/adminApi';

type ToolDraft = Record<string, { enabled: boolean; descriptionOverride: string }>;
type ToolFilter = 'all' | 'enabled' | 'disabled' | 'unresolved';

export function ConfiguredToolTable({
  inventory,
  draft,
  disabled,
  onToolChange,
  onBulkChange,
  onModelChange,
}: {
  inventory: ConfiguredToolInventory;
  draft: ToolDraft;
  disabled: boolean;
  onToolChange(name: string, change: { enabled?: boolean; descriptionOverride?: string }): void;
  onBulkChange(names: string[], enabled: boolean): void;
  onModelChange(model: string): void | Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ToolFilter>('all');
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return inventory.rows.filter((row) => {
      const rowDraft = draft[row.name] ?? { enabled: row.enabled, descriptionOverride: row.descriptionOverride ?? '' };
      const matchesQuery =
        !normalizedQuery ||
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.effectiveDescription?.toLowerCase().includes(normalizedQuery) ||
        row.upstreamDescription?.toLowerCase().includes(normalizedQuery);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'enabled' && rowDraft.enabled) ||
        (filter === 'disabled' && !rowDraft.enabled) ||
        (filter === 'unresolved' && row.unresolved);
      return matchesQuery && matchesFilter;
    });
  }, [draft, filter, inventory.rows, query]);
  const visibleNames = visibleRows.map((row) => row.name);

  return (
    <Stack className="configured-tool-table" gap="sm">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text fw={800}>Configured Tool Selection</Text>
          <Text c="dimmed" size="xs">
            {inventory.counts.observed} observed, {inventory.counts.disabled} disabled, {inventory.counts.unresolved}{' '}
            unresolved
          </Text>
          {inventory.freshness === 'unavailable' ? (
            <Text c="yellow" size="xs">
              Live inventory is unavailable. Rows may come from the last complete snapshot or stored configuration.
            </Text>
          ) : null}
        </div>
        <Select
          label="Estimate model"
          aria-label="Token estimate model"
          value={inventory.model}
          data={['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']}
          allowDeselect={false}
          disabled={disabled}
          onChange={(value) => {
            if (value) void onModelChange(value);
          }}
        />
      </Group>
      <Group align="flex-end" grow>
        <TextInput
          label="Search tools"
          leftSection={<Search size={15} />}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <SegmentedControl
          aria-label="Tool status filter"
          value={filter}
          onChange={(value) => setFilter(value as ToolFilter)}
          data={[
            { label: 'All', value: 'all' },
            { label: 'Enabled', value: 'enabled' },
            { label: 'Disabled', value: 'disabled' },
            { label: 'Unresolved', value: 'unresolved' },
          ]}
        />
      </Group>
      <Group justify="space-between">
        <Text c="dimmed" size="xs">
          {visibleRows.length} visible tools, approximately {inventory.approximateTokens.enabled} enabled tokens
        </Text>
        <Group gap="xs">
          <Button
            size="compact-xs"
            variant="default"
            disabled={disabled || visibleNames.length === 0}
            onClick={() => onBulkChange(visibleNames, true)}
          >
            Enable visible ({visibleNames.length})
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            disabled={disabled || visibleNames.length === 0}
            onClick={() => onBulkChange(visibleNames, false)}
          >
            Disable visible ({visibleNames.length})
          </Button>
        </Group>
      </Group>
      <div className="configured-tool-rows">
        {visibleRows.map((row) => {
          const rowDraft = draft[row.name] ?? {
            enabled: row.enabled,
            descriptionOverride: row.descriptionOverride ?? '',
          };
          return (
            <div className="configured-tool-row" key={row.name}>
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div className="configured-tool-identity">
                  <Group gap="xs">
                    <Text fw={700}>{row.name}</Text>
                    {row.stale ? <Badge color="orange">last observed</Badge> : null}
                    {row.unresolved ? <Badge color="yellow">unresolved</Badge> : null}
                    {row.observedInSomeInstances ? (
                      <Badge variant="outline">
                        {row.observedInstanceCount}/{row.activeInstanceCount} instances
                      </Badge>
                    ) : null}
                    <Badge variant="outline">~{row.approximateTokens} tokens</Badge>
                  </Group>
                  <Text c="dimmed" size="xs">
                    {row.effectiveDescription ?? 'No upstream description'}
                  </Text>
                  {row.descriptionOverridden && row.upstreamDescription ? (
                    <Text c="dimmed" size="xs">
                      Upstream: {row.upstreamDescription}
                    </Text>
                  ) : null}
                </div>
                <Switch
                  aria-label={`Enable ${row.name}`}
                  checked={rowDraft.enabled}
                  disabled={disabled}
                  onChange={(event) => onToolChange(row.name, { enabled: event.currentTarget.checked })}
                />
              </Group>
              <Group mt="xs" align="flex-end" wrap="nowrap">
                <TextInput
                  className="configured-tool-description-input"
                  label="Description override"
                  placeholder={row.upstreamDescription ?? 'Add a description'}
                  value={rowDraft.descriptionOverride}
                  disabled={disabled}
                  onChange={(event) => onToolChange(row.name, { descriptionOverride: event.currentTarget.value })}
                />
                <Tooltip label="Reset to upstream description">
                  <ActionIcon
                    aria-label={`Reset ${row.name} description`}
                    variant="default"
                    disabled={disabled || !rowDraft.descriptionOverride}
                    onClick={() => onToolChange(row.name, { descriptionOverride: '' })}
                  >
                    <RotateCcw size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </div>
          );
        })}
      </div>
      {inventory.targetEnabled ? null : (
        <Text c="yellow" size="xs">
          This target is disabled. Tool changes will take effect when the target is enabled.
        </Text>
      )}
      <Text c="dimmed" size="xs">
        Selection uses a denylist. Tools discovered later are enabled unless explicitly disabled.
      </Text>
    </Stack>
  );
}

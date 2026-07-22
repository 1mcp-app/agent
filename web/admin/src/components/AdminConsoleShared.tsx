import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';

import { Clipboard } from 'lucide-react';
import type { ReactNode } from 'react';

import { humanize } from './adminConsoleUtils';

export function DetailRow({
  label,
  value,
  meta,
  description,
  copyLabel,
  copyValue,
  onCopyText,
}: {
  label: string;
  value: string;
  meta?: string;
  description?: string;
  copyLabel?: string;
  copyValue?: string;
  onCopyText?: (label: string, value: string) => Promise<void>;
}) {
  const valueToCopy = copyValue ?? value;

  return (
    <Group className="detail-row" justify="space-between" wrap="nowrap">
      <div className="detail-row-main">
        <Text fw={700}>{label}</Text>
        <Text className="truncate" size="sm">
          {value}
        </Text>
        {meta ? (
          <Text c="dimmed" size="xs">
            {meta}
          </Text>
        ) : null}
        {description ? (
          <Text c="dimmed" size="xs">
            {description}
          </Text>
        ) : null}
      </div>
      {copyLabel && valueToCopy !== '-' ? (
        <Button
          aria-label={`Copy ${humanize(copyLabel)}`}
          size="compact-xs"
          variant="subtle"
          leftSection={<Clipboard size={14} />}
          onClick={() => void onCopyText?.(copyLabel, valueToCopy)}
        >
          Copy
        </Button>
      ) : null}
    </Group>
  );
}

export function Panel({
  title,
  utility,
  icon,
  children,
}: {
  title: string;
  utility: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper component="section" className="operations-panel" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            {icon}
            <Title order={3}>{title}</Title>
          </Group>
          <Text c="dimmed" size="xs">
            {utility}
          </Text>
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <Text c="dimmed">{message}</Text>;
}

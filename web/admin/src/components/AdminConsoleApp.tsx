import { AppShell, Badge, Code, Group, Paper, Stack, Text, Title } from '@mantine/core';

import type { AdminConsoleState } from '../state/adminConsoleState';

interface AdminConsoleAppProps {
  state: AdminConsoleState;
}

export function AdminConsoleApp({ state }: AdminConsoleAppProps) {
  return (
    <AppShell className="admin-app-shell" header={{ height: 64 }} padding="md">
      <AppShell.Header aria-label="Admin Console" className="admin-app-header">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <div>
            <Text className="eyebrow" size="xs">
              1MCP
            </Text>
            <Title order={1} size="h3">
              Admin Console
            </Title>
          </div>
          <Badge variant="light" color={state.view === 'setupRequired' ? 'yellow' : 'teal'}>
            {state.view === 'setupRequired' ? 'Setup required' : state.view}
          </Badge>
        </Group>
      </AppShell.Header>
      <AppShell.Main>{state.view === 'setupRequired' ? <SetupRequiredView /> : null}</AppShell.Main>
    </AppShell>
  );
}

function SetupRequiredView() {
  return (
    <Paper component="section" className="operations-panel" aria-labelledby="setup-required-title" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text className="eyebrow" size="xs">
              Runtime gate
            </Text>
            <Title id="setup-required-title" order={2}>
              Setup required
            </Title>
          </div>
          <Badge color="yellow" variant="filled">
            No Admin Account
          </Badge>
        </Group>
        <Text c="dimmed">
          Run CLI bootstrap from the runtime host, then refresh this page. The browser setup page does not create admin
          accounts.
        </Text>
        <Code block>1mcp admin bootstrap</Code>
      </Stack>
    </Paper>
  );
}

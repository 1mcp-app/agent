import { Alert, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';

import type { AdminConsoleState } from '../../state/adminConsoleState';

export function AboutRuntimeWorkspace({ state }: { state: AdminConsoleState }) {
  const about = state.status?.about;
  if (!about) return <Alert>About metadata is unavailable.</Alert>;
  return (
    <section aria-labelledby="about-title" className="operations-workspace">
      <Text className="eyebrow" size="xs">
        Product and protocol metadata
      </Text>
      <Title id="about-title" order={2}>
        About {about.productName}
      </Title>
      {!about.protocolCompatible ? (
        <Alert color="red" title="Admin UI protocol incompatibility">
          This Admin UI build expects protocol {about.adminUiProtocolVersion ?? 'Unavailable'}, but the runtime exposes{' '}
          {about.adminApiProtocolVersion}.
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 1, md: 2 }} mt="md">
        <AboutPanel
          title="Versions"
          values={[
            ['Runtime Version', about.runtimeVersion],
            ['Admin UI Build Version', about.adminUiBuildVersion ?? 'Unavailable'],
            ['Admin API Protocol Version', about.adminApiProtocolVersion],
            ['Admin UI Protocol Version', about.adminUiProtocolVersion ?? 'Unavailable'],
          ]}
        />
        <AboutPanel
          title="Runtime Scope"
          values={[
            ['Runtime Scope ID', about.runtime.runtimeScopeId],
            ['External URL', about.runtime.externalUrl ?? 'Unavailable'],
          ]}
        />
        <AboutPanel
          title="Build"
          values={[
            ['Commit', about.build.commit ?? 'Unavailable'],
            ['Build timestamp', about.build.timestamp ?? 'Unavailable'],
          ]}
        />
        <Paper withBorder p="md">
          <Title order={3}>Project</Title>
          <Stack gap="xs" mt="sm">
            {about.project.repository ? (
              <SafeExternalLink label="Repository" href={about.project.repository} />
            ) : (
              <Text>Repository · Unavailable</Text>
            )}
            {about.project.documentation ? (
              <SafeExternalLink label="Documentation" href={about.project.documentation} />
            ) : (
              <Text>Documentation · Unavailable</Text>
            )}
            {about.project.issues ? (
              <SafeExternalLink label="Report an issue" href={about.project.issues} />
            ) : (
              <Text>Issue reporting · Unavailable</Text>
            )}
            <Text>License · {about.project.license ?? 'Unavailable'}</Text>
          </Stack>
        </Paper>
      </SimpleGrid>
    </section>
  );
}

function AboutPanel({ title, values }: { title: string; values: Array<[string, string]> }) {
  return (
    <Paper withBorder p="md">
      <Title order={3}>{title}</Title>
      <Stack gap="xs" mt="sm">
        {values.map(([label, value]) => (
          <div key={label}>
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text>{value}</Text>
          </div>
        ))}
      </Stack>
    </Paper>
  );
}

function SafeExternalLink({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`}>
      {label}
    </a>
  );
}

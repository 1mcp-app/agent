import { Alert, Text } from '@mantine/core';

import { CircleCheck } from 'lucide-react';

import type { ConfiguredServerDeleteResponse } from '../api/adminApi';

export function ConfiguredServerDeletionNotice({
  result,
  dismiss,
}: {
  result: ConfiguredServerDeleteResponse['result'];
  dismiss(): void;
}) {
  const templateImpact = result.target.source === 'mcpTemplates' ? result.runtimeImpact : undefined;

  return (
    <Alert
      color="teal"
      icon={<CircleCheck size={16} />}
      title={`${result.qualifiedId} deleted`}
      withCloseButton
      closeButtonLabel="Dismiss deletion notice"
      onClose={dismiss}
      role="status"
    >
      <Text size="sm">Runtime reload observed.</Text>
      {templateImpact ? (
        <Text size="sm">
          Instances: {templateImpact.activeInstancesBefore} before, {templateImpact.retiredInstances} retired,{' '}
          {templateImpact.activeInstancesAfter} active after. Retirement observed:{' '}
          {templateImpact.retirementObserved ? 'yes' : 'no'}.
        </Text>
      ) : (
        <Text size="sm">Configured backend removal observed after reload.</Text>
      )}
    </Alert>
  );
}

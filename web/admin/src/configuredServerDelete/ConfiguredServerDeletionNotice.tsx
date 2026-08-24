import { Alert, Text } from '@mantine/core';

import { CircleCheck, TriangleAlert } from 'lucide-react';

import type { ConfiguredServerDeleteResponse } from '../api/adminApi';
import { configuredServerDeleteRecoveryRequired } from './configuredServerDeleteState';

export function ConfiguredServerDeletionNotice({
  result,
  dismiss,
}: {
  result: ConfiguredServerDeleteResponse['result'];
  dismiss(): void;
}) {
  const templateImpact = result.target.source === 'mcpTemplates' ? result.runtimeImpact : undefined;
  const recoveryRequired = configuredServerDeleteRecoveryRequired(result);

  return (
    <Alert
      color={recoveryRequired ? 'yellow' : 'teal'}
      icon={recoveryRequired ? <TriangleAlert size={16} /> : <CircleCheck size={16} />}
      title={`${result.qualifiedId} deleted${recoveryRequired ? '; recovery required' : ''}`}
      withCloseButton
      closeButtonLabel="Dismiss deletion notice"
      onClose={dismiss}
      role="status"
    >
      <Text size="sm">
        {recoveryRequired
          ? `Configuration write completed. Runtime reload status: ${result.configChange.reload.status}. Runtime reconciliation is incomplete and the runtime may still serve this target.`
          : 'Runtime reload observed.'}
      </Text>
      {recoveryRequired ? (
        <Text size="sm">
          {result.configChange.backup.created
            ? 'A recovery backup exists. Restore it if the deletion must be reversed.'
            : 'No recovery backup was reported; inspect runtime and configuration state before continuing.'}
        </Text>
      ) : null}
      {templateImpact ? (
        <Text size="sm">
          Instances: {templateImpact.activeInstancesBefore} before, {templateImpact.retiredInstances} retired,{' '}
          {templateImpact.activeInstancesAfter} active after. Retirement observed:{' '}
          {templateImpact.retirementObserved ? 'yes' : 'no'}.
        </Text>
      ) : !recoveryRequired ? (
        <Text size="sm">Configured backend removal observed after reload.</Text>
      ) : null}
    </Alert>
  );
}

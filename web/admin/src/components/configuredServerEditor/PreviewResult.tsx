import { Alert, Badge, Code, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';

import type { ConfiguredServerPreviewResponse } from '../../api/adminApi';
import { fieldKey, formatPreviewValue } from '../../configuredServerEdit/configuredServerEditDraft';
import { DetailRow } from '../AdminConsoleShared';
import { connectivityMeta, connectivitySummary, riskFlagColor, riskFlagLabel } from '../adminConsoleUtils';

export function PreviewResult({ preview }: { preview: ConfiguredServerPreviewResponse['preview'] }) {
  const connectivity = preview.connectivityCheck;
  const validationTone = preview.validation.status === 'valid' ? 'teal' : 'red';
  const connectivityTone =
    connectivity.status === 'passed' ? 'teal' : connectivity.status === 'failed' ? 'red' : 'yellow';

  return (
    <Paper className="preview-result" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={800}>Preview result</Text>
            <Text c="dimmed" size="xs">
              Domain facts only. No config has been written.
            </Text>
          </div>
          <Code className="preview-fingerprint">{preview.previewFingerprint}</Code>
        </Group>
        <Alert color="blue" variant="light">
          Preview only - no config has been written.
        </Alert>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <DetailRow label="Target" value={preview.targetName} meta={`Proposed: ${preview.proposedTargetName}`} />
          <DetailRow
            label="Validation"
            value={preview.validation.status}
            meta={
              preview.validation.errors.length > 0
                ? `${preview.validation.errors.length} field issue${preview.validation.errors.length === 1 ? '' : 's'}`
                : 'Ready to apply after confirmation'
            }
          />
          <DetailRow
            label="Config change"
            value={preview.configChange.status}
            meta={`${preview.configChange.operation} / ${preview.configChange.changed ? 'changed' : 'unchanged'}`}
          />
          <DetailRow
            label="Reload"
            value={preview.configChange.reload.status}
            meta={preview.configChange.reload.error}
          />
          <DetailRow
            label="Backup"
            value={preview.configChange.backup.created ? 'created' : 'not created'}
            meta={preview.configChange.backup.path}
          />
          <Paper className={`connectivity-card connectivity-${connectivity.status}`} withBorder>
            <Stack gap={4}>
              <Group justify="space-between" gap="xs">
                <Text fw={700}>Connectivity</Text>
                <Badge color={connectivityTone} variant="light">
                  {connectivity.status}
                </Badge>
              </Group>
              <Text size="sm">{connectivitySummary(connectivity)}</Text>
              {connectivityMeta(preview) ? (
                <Text c="dimmed" size="xs">
                  {connectivityMeta(preview)}
                </Text>
              ) : null}
            </Stack>
          </Paper>
        </SimpleGrid>
        {preview.configChange.warnings?.map((warning) => (
          <DetailRow key={`warning:${warning}`} label="Warning" value={warning} />
        ))}
        {preview.configChange.retentionCleanup.warnings.map((warning) => (
          <DetailRow key={`retention:${warning}`} label="Retention warning" value={warning} />
        ))}
        {preview.validation.errors.length > 0 ? (
          <Stack gap="xs">
            <Group gap="xs">
              <Text fw={800}>Validation issues</Text>
              <Badge color={validationTone} variant="light">
                {preview.validation.errors.length}
              </Badge>
            </Group>
            {preview.validation.errors.map((error) => (
              <DetailRow
                key={`${fieldKey(error.fieldPath)}:${error.code}`}
                label={error.fieldPath.join('.') || 'form'}
                value={error.code}
                meta={error.message}
              />
            ))}
          </Stack>
        ) : null}
        {preview.diff.length > 0 ? (
          <Stack gap="xs">
            <Group gap="xs">
              <Text fw={800}>Redacted diff</Text>
              <Badge variant="outline">
                {preview.diff.length} change{preview.diff.length === 1 ? '' : 's'}
              </Badge>
            </Group>
            {preview.diff.map((entry) => (
              <Paper key={fieldKey(entry.fieldPath)} className="preview-diff-entry" withBorder>
                <Stack gap={6}>
                  <Group justify="space-between" align="flex-start" gap="xs">
                    <Text fw={700}>{entry.fieldPath.join('.')}</Text>
                    <Group gap={4}>
                      {entry.secretAction ? (
                        <Badge color="grape" variant="light">
                          secret: {entry.secretAction}
                        </Badge>
                      ) : null}
                      {entry.riskFlags.map((flag) => (
                        <Badge key={flag} color={riskFlagColor(flag)} variant="light">
                          {riskFlagLabel(flag)}
                        </Badge>
                      ))}
                    </Group>
                  </Group>
                  <Text size="sm">
                    <Text span c="dimmed">
                      from{' '}
                    </Text>
                    {formatPreviewValue(entry.oldValue)}
                    <Text span c="dimmed">
                      {' '}
                      to{' '}
                    </Text>
                    {formatPreviewValue(entry.newValue)}
                  </Text>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Text c="dimmed" size="sm">
            No field-level changes were reported by preview.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

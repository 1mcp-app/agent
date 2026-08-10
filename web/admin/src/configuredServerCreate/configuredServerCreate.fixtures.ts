import type { ConfiguredServerCreateContractResponse } from '../api/adminApi';

export function configuredServerCreateContract(): ConfiguredServerCreateContractResponse {
  return {
    ok: true,
    operationId: 'contract-op',
    createContract: {
      schemaVersion: 1,
      capabilities: {
        create: { supported: true },
        forceReplacement: { supported: false },
        rawJson: { supported: false },
        preview: { supported: true },
        apply: { supported: true },
      },
      fieldGroups: [
        {
          id: 'identity',
          label: 'Target',
          fields: [
            { fieldPath: ['name'], label: 'Name', control: 'text', value: '', editable: true },
            { fieldPath: ['enabled'], label: 'Enabled', control: 'switch', value: true, editable: true },
            { fieldPath: ['tags'], label: 'Tags', control: 'tag-list', value: [], editable: true },
          ],
        },
        {
          id: 'transport',
          label: 'Transport',
          fields: [
            {
              fieldPath: ['transport', 'type'],
              label: 'Transport Type',
              control: 'select',
              value: 'stdio',
              options: ['stdio', 'http', 'sse'],
              editable: true,
            },
            {
              fieldPath: ['transport', 'command'],
              label: 'Command',
              control: 'text',
              value: '',
              editable: true,
              applicableTransportTypes: ['stdio'],
            },
            {
              fieldPath: ['transport', 'args'],
              label: 'Args',
              control: 'string-list',
              value: [],
              editable: true,
              applicableTransportTypes: ['stdio'],
            },
            {
              fieldPath: ['transport', 'env'],
              label: 'Environment',
              control: 'record',
              value: {},
              editable: true,
              applicableTransportTypes: ['stdio'],
            },
            {
              fieldPath: ['transport', 'url'],
              label: 'URL',
              control: 'text',
              value: '',
              editable: true,
              applicableTransportTypes: ['http', 'sse'],
            },
            {
              fieldPath: ['transport', 'headers'],
              label: 'Headers',
              control: 'record',
              value: {},
              editable: true,
              applicableTransportTypes: ['http', 'sse'],
            },
          ],
        },
      ],
      secretPolicy: {
        allowedActions: ['replace'],
        environmentReference: {
          recommended: true,
          storesSecretMaterial: false,
          guidance: 'Keep secret material in the runtime environment.',
        },
        inlineReplacement: {
          emphasis: 'secondary',
          guidance: 'Use inline replacement only when an environment reference is unsuitable.',
        },
      },
    },
  };
}

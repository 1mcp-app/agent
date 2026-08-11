import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useReducer } from 'react';

import type { ConfiguredServerCreatePreviewResponse } from '../../api/adminApi';
import { configuredServerCreateContract } from '../../configuredServerCreate/configuredServerCreate.fixtures';
import {
  createConfiguredServerCreateState,
  reduceConfiguredServerCreateState,
} from '../../configuredServerCreate/configuredServerCreateState';
import type { ConfiguredServerCreateModel } from '../../configuredServerCreate/useConfiguredServerCreate';
import { ConfiguredServerCreator } from './ConfiguredServerCreator';

function CreatorHarness({ preview }: { preview?: ConfiguredServerCreatePreviewResponse['preview'] }) {
  const [state, dispatch] = useReducer(
    reduceConfiguredServerCreateState,
    createConfiguredServerCreateState(),
    (initial) => {
      const loaded = reduceConfiguredServerCreateState(initial, {
        type: 'contractLoaded',
        contract: configuredServerCreateContract(),
      });
      return preview ? reduceConfiguredServerCreateState(loaded, { type: 'previewSucceeded', preview }) : loaded;
    },
  );
  const model: ConfiguredServerCreateModel = {
    state,
    open: () => undefined,
    close: async () => true,
    editExisting: () => undefined,
    changeField: (fieldPath, value) => dispatch({ type: 'fieldChanged', fieldPath, value }),
    addSecret: (secret) => dispatch({ type: 'secretAdded', secret }),
    changeSecret: (secret) => dispatch({ type: 'secretChanged', secret }),
    removeSecret: (id) => dispatch({ type: 'secretRemoved', id }),
    preview: () => undefined,
    apply: () => undefined,
  };
  return <ConfiguredServerCreator model={model} />;
}

describe('ConfiguredServerCreator', () => {
  it('switches structured controls across stdio, HTTP, and legacy SSE', async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <CreatorHarness />
      </MantineProvider>,
    );

    expect(screen.getByLabelText('Command')).toBeInTheDocument();
    expect(screen.getByText('Advanced settings')).toBeInTheDocument();
    expect(screen.getByLabelText('New Environment key')).not.toBeVisible();
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Transport Type'), 'http');
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
    expect(screen.queryByLabelText('Command')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Transport Type'), 'sse');
    expect(screen.getByText(/SSE is deprecated/i)).toBeInTheDocument();
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
  });

  it('places creation readiness before detail and describes reload as post-create observation', () => {
    render(
      <MantineProvider>
        <CreatorHarness
          preview={{
            targetName: 'qa-echo',
            previewFingerprint: 'preview_123',
            validation: { status: 'valid', errors: [] },
            diff: [{ fieldPath: ['name'], oldValue: undefined, newValue: 'qa-echo', riskFlags: [] }],
            configChange: {
              status: 'changed',
              operation: 'set_static',
              target: { name: 'qa-echo', source: 'mcpServers' },
              changed: true,
              backup: { created: false },
              retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
              reload: { status: 'skipped' },
              warnings: [],
            },
            connectivityCheck: { status: 'skipped', reason: 'local_stdio_transport' },
            expectedReload: {
              policy: 'observe_after_write',
              possibleStatuses: ['observed', 'runtime_not_running', 'reload_disabled', 'failed'],
            },
          }}
        />
      </MantineProvider>,
    );

    const action = screen.getByRole('button', { name: 'Create server' });
    const detail = screen.getByText('Preview result');
    expect(action.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Checked after creation')).toBeInTheDocument();
    expect(screen.getByText(/reports the reload outcome after configuration is written/i)).toBeInTheDocument();
    expect(screen.queryByText(/observed, runtime_not_running/i)).not.toBeInTheDocument();
  });

  it('defaults dynamic secrets to environment references and keeps inline entry secondary', async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <CreatorHarness />
      </MantineProvider>,
    );

    expect(screen.getByRole('button', { name: 'Add secret', hidden: true })).not.toBeVisible();
    await user.click(screen.getByText('Advanced settings'));
    await user.click(screen.getByRole('button', { name: 'Add secret' }));
    expect(screen.getByLabelText('Secret source')).toHaveValue('environmentReference');
    await user.type(screen.getByLabelText('Environment variable'), 'API_TOKEN');
    expect(screen.getByLabelText(/Environment reference for API_TOKEN/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Secret source'), 'inlineSecret');
    expect(screen.getByText(/stores secret material in configuration/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Inline secret for API_TOKEN/i)).toHaveAttribute('type', 'password');
  });

  it('opens advanced settings when preview errors target a secret input', () => {
    render(
      <MantineProvider>
        <CreatorHarness
          preview={{
            targetName: 'qa-echo',
            previewFingerprint: 'preview_secret_error',
            validation: {
              status: 'invalid',
              errors: [
                {
                  fieldPath: ['secrets', '0', 'replacementValue'],
                  code: 'invalid_secret_reference',
                  message: 'Secret reference is invalid.',
                },
              ],
            },
            diff: [],
            configChange: {
              status: 'unchanged',
              operation: 'set_static',
              target: { name: 'qa-echo', source: 'mcpServers' },
              changed: false,
              backup: { created: false },
              retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
              reload: { status: 'skipped' },
              warnings: [],
            },
            connectivityCheck: { status: 'skipped', reason: 'validation_failed' },
            expectedReload: {
              policy: 'observe_after_write',
              possibleStatuses: ['observed', 'runtime_not_running', 'reload_disabled', 'failed'],
            },
          }}
        />
      </MantineProvider>,
    );

    expect(screen.getByText('Advanced settings').closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Add secret' })).toBeVisible();
  });
});

import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useReducer } from 'react';

import { configuredServerCreateContract } from '../../configuredServerCreate/configuredServerCreate.fixtures';
import {
  createConfiguredServerCreateState,
  reduceConfiguredServerCreateState,
} from '../../configuredServerCreate/configuredServerCreateState';
import type { ConfiguredServerCreateModel } from '../../configuredServerCreate/useConfiguredServerCreate';
import { ConfiguredServerCreator } from './ConfiguredServerCreator';

function CreatorHarness() {
  const [state, dispatch] = useReducer(
    reduceConfiguredServerCreateState,
    createConfiguredServerCreateState(),
    (initial) =>
      reduceConfiguredServerCreateState(initial, {
        type: 'contractLoaded',
        contract: configuredServerCreateContract(),
      }),
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
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Transport Type'), 'http');
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
    expect(screen.queryByLabelText('Command')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Transport Type'), 'sse');
    expect(screen.getByText(/SSE is deprecated/i)).toBeInTheDocument();
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
  });

  it('defaults dynamic secrets to environment references and keeps inline entry secondary', async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <CreatorHarness />
      </MantineProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Add secret' }));
    expect(screen.getByLabelText('Secret source')).toHaveValue('environmentReference');
    await user.type(screen.getByLabelText('Environment variable'), 'API_TOKEN');
    expect(screen.getByLabelText(/Environment reference for API_TOKEN/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Secret source'), 'inlineSecret');
    expect(screen.getByText(/stores secret material in configuration/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Inline secret for API_TOKEN/i)).toHaveAttribute('type', 'password');
  });
});

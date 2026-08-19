import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { vi } from 'vitest';

import type { ConfiguredToolInventory } from '../../api/adminApi';
import { ConfiguredToolTable } from './ConfiguredToolTable';

const inventory: ConfiguredToolInventory = {
  targetName: 'project',
  source: 'mcpTemplates',
  targetEnabled: true,
  freshness: 'live',
  model: 'gpt-4o',
  generation: 'generation-1',
  activeInstanceCount: 2,
  rows: [
    {
      name: 'common',
      upstreamDescription: 'Common upstream',
      effectiveDescription: 'Common upstream',
      descriptionOverridden: false,
      enabled: true,
      observed: true,
      unresolved: false,
      observedInstanceCount: 2,
      activeInstanceCount: 2,
      observedInSomeInstances: false,
      approximateTokens: 21,
    },
    {
      name: 'missing',
      effectiveDescription: 'Retained override',
      descriptionOverride: 'Retained override',
      descriptionOverridden: true,
      enabled: false,
      observed: false,
      unresolved: true,
      observedInstanceCount: 0,
      activeInstanceCount: 2,
      observedInSomeInstances: false,
      approximateTokens: 0,
    },
  ],
  counts: { observed: 1, enabled: 1, disabled: 1, unresolved: 1 },
  approximateTokens: { enabled: 21, allObserved: 21, savings: 0 },
};

describe('ConfiguredToolTable', () => {
  it('filters rows and scopes bulk selection to visible tools', async () => {
    const user = userEvent.setup();
    const onBulkChange = vi.fn();
    render(
      <MantineProvider>
        <ConfiguredToolTable
          inventory={inventory}
          draft={{
            common: { enabled: true, descriptionOverride: '' },
            missing: { enabled: false, descriptionOverride: 'Retained override' },
          }}
          disabled={false}
          refreshBusy={false}
          onToolChange={vi.fn()}
          onBulkChange={onBulkChange}
          onModelChange={vi.fn()}
          onRefresh={vi.fn()}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole('radio', { name: 'Unresolved' }));
    expect(screen.queryByText('common')).not.toBeInTheDocument();
    expect(screen.getByText('missing')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enable visible (1)' }));
    expect(onBulkChange).toHaveBeenCalledWith(['missing'], true);
  });

  it('edits selection and resets a description override', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const user = userEvent.setup();
    const onToolChange = vi.fn();
    const onModelChange = vi.fn();
    render(
      <MantineProvider>
        <ConfiguredToolTable
          inventory={inventory}
          draft={{
            common: { enabled: true, descriptionOverride: '' },
            missing: { enabled: false, descriptionOverride: 'Retained override' },
          }}
          disabled={false}
          refreshBusy={false}
          onToolChange={onToolChange}
          onBulkChange={vi.fn()}
          onModelChange={onModelChange}
          onRefresh={vi.fn()}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole('switch', { name: 'Enable common' }));
    expect(onToolChange).toHaveBeenCalledWith('common', { enabled: false });
    await user.click(screen.getByRole('button', { name: 'Reset missing description' }));
    expect(onToolChange).toHaveBeenCalledWith('missing', { descriptionOverride: '' });
    await user.click(screen.getByLabelText('Token estimate model'));
    await user.click(screen.getByRole('option', { name: 'gpt-4o-mini', hidden: true }));
    expect(onModelChange).toHaveBeenCalledWith('gpt-4o-mini');
  });

  it('summarizes the current draft selection', () => {
    render(
      <MantineProvider>
        <ConfiguredToolTable
          inventory={inventory}
          draft={{
            common: { enabled: false, descriptionOverride: '' },
            missing: { enabled: true, descriptionOverride: 'Retained override' },
          }}
          disabled={false}
          refreshBusy={false}
          onToolChange={vi.fn()}
          onBulkChange={vi.fn()}
          onModelChange={vi.fn()}
          onRefresh={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(screen.getByText(/1 observed, 1 disabled, 1 unresolved/)).toBeInTheDocument();
    expect(screen.getByText(/approximately 0 enabled tokens/)).toBeInTheDocument();
  });

  it('shows a precise refresh reason and offers retry without disabling drafts', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(
      <MantineProvider>
        <ConfiguredToolTable
          inventory={{
            ...inventory,
            freshness: 'unavailable',
            inspection: {
              status: 'unavailable',
              reason: 'target_disconnected',
              retryable: true,
              instances: [],
            },
          }}
          draft={{ common: { enabled: true, descriptionOverride: '' } }}
          disabled={false}
          refreshBusy={false}
          onToolChange={vi.fn()}
          onBulkChange={vi.fn()}
          onModelChange={vi.fn()}
          onRefresh={onRefresh}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/configured server is disconnected/i);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('switch', { name: 'Enable common' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('announces dynamically arriving refresh failures as alerts', () => {
    render(
      <MantineProvider>
        <ConfiguredToolTable
          inventory={inventory}
          draft={{ common: { enabled: true, descriptionOverride: '' } }}
          disabled={false}
          refreshBusy={false}
          refreshError="Tool refresh failed: runtime unavailable."
          onToolChange={vi.fn()}
          onBulkChange={vi.fn()}
          onModelChange={vi.fn()}
          onRefresh={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Tool refresh failed: runtime unavailable.');
    expect(screen.getByRole('alert')).not.toHaveAttribute('aria-live');
  });

  it('disables refresh and model selection while a refresh runs', () => {
    render(
      <MantineProvider>
        <ConfiguredToolTable
          inventory={inventory}
          draft={{ common: { enabled: true, descriptionOverride: '' } }}
          disabled={false}
          refreshBusy={true}
          onToolChange={vi.fn()}
          onBulkChange={vi.fn()}
          onModelChange={vi.fn()}
          onRefresh={vi.fn()}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Token estimate model' })).toBeDisabled();
  });

  it('announces concrete failed instance facts without empty or successful facts', () => {
    render(
      <MantineProvider>
        <ConfiguredToolTable
          inventory={{
            ...inventory,
            freshness: 'unavailable',
            inspection: {
              status: 'failed',
              reason: 'inspection_failed',
              retryable: true,
              instances: [
                { instanceId: 'worker-a', status: 'failed', error: 'connection reset by peer' },
                { instanceId: 'worker-b', status: 'unavailable' },
                { instanceId: 'worker-c', status: 'complete' },
              ],
            },
          }}
          draft={{ common: { enabled: true, descriptionOverride: '' } }}
          disabled={false}
          refreshBusy={false}
          onToolChange={vi.fn()}
          onBulkChange={vi.fn()}
          onModelChange={vi.fn()}
          onRefresh={vi.fn()}
        />
      </MantineProvider>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('worker-a: connection reset by peer');
    expect(alert).not.toHaveTextContent('worker-b');
    expect(alert).not.toHaveTextContent('worker-c');
  });
});

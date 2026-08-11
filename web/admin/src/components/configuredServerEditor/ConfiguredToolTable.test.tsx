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
          onToolChange={vi.fn()}
          onBulkChange={onBulkChange}
          onModelChange={vi.fn()}
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
          onToolChange={onToolChange}
          onBulkChange={vi.fn()}
          onModelChange={onModelChange}
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
});

import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useState } from 'react';

import { ConfirmationDialogProvider, useConfirmationDialog } from './ConfirmationDialogProvider';

describe('ConfirmationDialogProvider', () => {
  it('settles a double-activated request once without skipping the queued dialog', async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider>
        <ConfirmationDialogProvider>
          <ConfirmationHarness />
        </ConfirmationDialogProvider>
      </MantineProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Queue confirmations' }));
    const firstConfirm = await screen.findByRole('button', { name: 'Confirm first' });
    fireEvent.click(firstConfirm);
    fireEvent.click(firstConfirm);

    expect(await screen.findByRole('dialog', { name: 'Second request' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm second' }));
    expect(await screen.findByText('true,true')).toBeInTheDocument();
  });
});

function ConfirmationHarness() {
  const confirm = useConfirmationDialog();
  const [result, setResult] = useState('pending');

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void Promise.all([
            confirm({ title: 'First request', message: 'First', confirmLabel: 'Confirm first' }),
            confirm({ title: 'Second request', message: 'Second', confirmLabel: 'Confirm second' }),
          ]).then((values) => setResult(values.join(',')));
        }}
      >
        Queue confirmations
      </button>
      <span>{result}</span>
    </>
  );
}

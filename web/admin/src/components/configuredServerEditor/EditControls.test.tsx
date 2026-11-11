import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useState } from 'react';
import { vi } from 'vitest';

import type { ConfiguredServerEditField } from '../../api/adminApi';
import { buildPreviewEdit, fieldKey } from '../../configuredServerEdit/configuredServerEditDraft';
import { ConfiguredServerFieldDraft } from './EditControls';

it('builds typed OAuth edits from the controls and preserves unrelated options', async () => {
  const user = userEvent.setup();
  const initial = { autoRegister: false, scopes: ['read'] };
  const field: ConfiguredServerEditField = {
    fieldPath: ['transport', 'oauth'],
    label: 'OAuth',
    control: 'record',
    editable: true,
    value: initial,
  };
  const submit = vi.fn();
  function Form() {
    const [value, setValue] = useState<unknown>(initial);
    return (
      <MantineProvider>
        <ConfiguredServerFieldDraft field={field} value={value} onChange={setValue} />
        <button
          onClick={() =>
            submit(
              buildPreviewEdit(
                [{ id: 'transport', label: 'Transport', fields: [field] }],
                { [fieldKey(field.fieldPath)]: value },
                { [fieldKey(field.fieldPath)]: initial },
                {},
                'http',
              ),
            )
          }
        >
          Preview
        </button>
      </MantineProvider>
    );
  }
  render(<Form />);
  await user.click(screen.getByRole('switch', { name: /Allow incomplete OAuth metadata/ }));
  await user.type(
    screen.getByRole('textbox', { name: 'Private-network HTTPS origins' }),
    'https://private.example{Enter}https://login.example{Enter}',
  );
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  expect(submit).toHaveBeenLastCalledWith({
    transport: {
      oauth: {
        insecureAllowIncompleteMetadata: true,
        privateNetworkOrigins: ['https://private.example', 'https://login.example'],
      },
    },
  });
  await user.click(screen.getByRole('switch', { name: /Allow incomplete OAuth metadata/ }));
  await user.click(screen.getByLabelText('Clear private-network origins'));
  await user.click(screen.getByRole('button', { name: 'Remove OAuth autoRegister' }));
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  expect(submit).toHaveBeenLastCalledWith({
    transport: {
      oauth: {
        autoRegister: null,
        insecureAllowIncompleteMetadata: false,
        privateNetworkOrigins: [],
      },
    },
  });
});

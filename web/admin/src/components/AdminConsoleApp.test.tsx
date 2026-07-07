import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';

import { createInitialState } from '../state/adminConsoleState';
import { AdminConsoleApp } from './AdminConsoleApp';

describe('AdminConsoleApp', () => {
  it('renders setup-required guidance inside the operations shell', () => {
    render(
      <MantineProvider>
        <AdminConsoleApp state={{ ...createInitialState(), view: 'setupRequired' }} />
      </MantineProvider>,
    );

    expect(screen.getByRole('banner', { name: /admin console/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /setup required/i })).toBeInTheDocument();
    expect(screen.getByText('1mcp admin bootstrap')).toBeInTheDocument();
  });
});

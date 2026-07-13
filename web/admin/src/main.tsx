import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';

import { createRoot } from 'react-dom/client';

import { createAdminApi } from './api/adminApi';
import { AdminConsoleRoot } from './session/AdminConsoleSession';
import './styles.css';
import { adminConsoleTheme } from './theme';

const root = document.querySelector<HTMLDivElement>('#admin-root');

if (!root) {
  throw new Error('Admin Console root element was not found');
}

createRoot(root).render(
  <MantineProvider theme={adminConsoleTheme}>
    <AdminConsoleRoot api={createAdminApi()} />
  </MantineProvider>,
);

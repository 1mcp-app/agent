import { localStorageColorSchemeManager, MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';

import { createRoot } from 'react-dom/client';

import { createAdminApi } from './api/adminApi';
import { AdminConsoleRoot } from './session/AdminConsoleSession';
import './styles.css';
import { adminConsoleTheme } from './theme';

const root = document.querySelector<HTMLDivElement>('#admin-root');
const colorSchemeManager = localStorageColorSchemeManager({ key: '1mcp-admin-color-scheme' });

if (!root) {
  throw new Error('Admin Console root element was not found');
}

createRoot(root).render(
  <MantineProvider theme={adminConsoleTheme} defaultColorScheme="auto" colorSchemeManager={colorSchemeManager}>
    <AdminConsoleRoot api={createAdminApi()} />
  </MantineProvider>,
);

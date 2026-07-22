import { createTheme } from '@mantine/core';

export const adminConsoleTheme = createTheme({
  primaryColor: 'conduit',
  defaultRadius: 'sm',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: '760',
  },
  defaultGradient: { from: 'conduit.7', to: 'conduit.5', deg: 90 },
  colors: {
    conduit: [
      '#eef7f4',
      '#d7eee7',
      '#acdccc',
      '#7fc8ae',
      '#59b393',
      '#3a9d7b',
      '#2c7f65',
      '#246653',
      '#1d5244',
      '#123229',
    ],
  },
});

// DepLens host app: React with a heavy, realistic baseline (router + state + UI kit + date lib).
// Deterministic render from mocked data (doc 07 §5): MemoryRouter, so no URL or history dependence.

/* @deplens-inject */
globalThis.__DL_SINK__ = [];
/* @deplens-end */

import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import Container from '@mui/material/Container';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import OrdersPage from './OrdersPage.jsx';

const theme = createTheme({ palette: { mode: 'light' } });

createRoot(document.getElementById('app')).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <MemoryRouter initialEntries={['/']}>
      <Container maxWidth="md" sx={{ py: 2 }}>
        <Routes>
          <Route path="/" element={<OrdersPage />} />
        </Routes>
      </Container>
    </MemoryRouter>
  </ThemeProvider>,
);
requestAnimationFrame(() => performance.mark('app-ready'));

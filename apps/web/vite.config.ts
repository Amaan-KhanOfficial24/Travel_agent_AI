// Vite: serves the React app in development (with instant reload) and builds the static
// files (HTML, JS, CSS) for production.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Codespaces opens the app on https://<name>-5173.app.github.dev; allow that host.
    allowedHosts: ['.app.github.dev'],
    // Development proxy: the browser calls /api/... on the SAME origin as the page, and
    // Vite forwards it to the API on port 3000. Same origin means no CORS in development
    // and the session cookie behaves exactly like a normal first-party cookie.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
    },
  },
  optimizeDeps: {
    // Vite 5.1+: use noDiscovery instead of removed `disabled` flag.
    // Pre-bundle the explicit list so the optimizer runs once on cold start
    // and never re-triggers on first browser request (which caused the
    // "TCP connects but no HTTP response" hang on macOS).
    noDiscovery: true,
    include: [
      'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
      'react-router-dom', '@tanstack/react-query',
      'axios', 'clsx', 'recharts',
    ],
  },
  server: {
    port: 8080,
    host: '127.0.0.1',
    strictPort: true,
  },
});

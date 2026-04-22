/*
 * @CLAUDE_CONTEXT
 * package: @lynkbot/dashboard
 * file: vite.config.ts
 * role: Vite build configuration with React plugin and path alias
 * exports: default Vite config
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});

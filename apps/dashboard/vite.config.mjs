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
    disabled: true,
  },
});

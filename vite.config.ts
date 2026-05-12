import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@sampling': path.resolve(__dirname, 'src/sampling'),
      '@statistics': path.resolve(__dirname, 'src/statistics'),
      '@types': path.resolve(__dirname, 'src/types'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@export': path.resolve(__dirname, 'src/export')
    }
  },
  base: './', // CRITICAL: Forces Vite to use relative paths for assets (assets/script.js instead of /assets/script.js)
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
  }
});
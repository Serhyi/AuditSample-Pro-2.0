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
    // exceljs and the import worker are single, unsplittable libraries that
    // are lazy-loaded (on export / on import), so they don't bloat startup.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('exceljs')) return 'vendor-exceljs';
          if (id.includes('apache-arrow')) return 'vendor-arrow';
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'vendor-charts';
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 3000,
  }
});
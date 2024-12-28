import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@scenes': path.resolve(__dirname, './src/scenes'),
      '@controllers': path.resolve(__dirname, './src/controllers'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@helpers': path.resolve(__dirname, './src/helpers'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  assetsInclude: ['**/*.exr'],
  optimizeDeps: {
    exclude: ['cannon']
  }
}); 
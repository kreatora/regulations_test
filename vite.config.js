import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // Output directory can be configured via env (default 'docs')
    outDir: process.env.BUILD_OUT_DIR || 'docs',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ontology: resolve(__dirname, 'ontology.html'),
        data: resolve(__dirname, 'data.html'),
        aboutUs: resolve(__dirname, 'about-us.html'),
        worldMap: resolve(__dirname, 'world-map.html'),
        imprint: resolve(__dirname, 'imprint.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        accessibility: resolve(__dirname, 'accessibility.html'),
      },
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    },
  },
  server: {
    // Optional: configure a dev server port if needed
    // port: 3000,
    watch: {
      ignored: ['**/scripts/_cache/**'],
    },
  },
});

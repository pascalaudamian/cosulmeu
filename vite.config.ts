import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ command }) => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // `pg` is server-only; always replace it in the browser bundle.
        pg: path.resolve(__dirname, 'src/db/pg-browser-stub.ts'),
      },
    },
    // Prevent Vite from pre-bundling `pg` before the browser alias is applied.
    // The client must use the lightweight stub instead of Node's Buffer-dependent build.
    optimizeDeps: {
      exclude: ['pg'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

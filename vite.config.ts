import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ command }) => {
  return {
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.NEXT_PUBLIC_cosulmeuSUPABASE_URL || process.env.SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.NEXT_PUBLIC_cosulmeuSUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY),
      'import.meta.env.VITE_SUPABASE_REDIRECT_URL': JSON.stringify(process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL || ''),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      dedupe: ['react', 'react-dom'],
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
      allowedHosts: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

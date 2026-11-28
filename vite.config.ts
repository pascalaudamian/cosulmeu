import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl =
    env.VITE_SUPABASE_URL ||
    env.NEXT_PUBLIC_cosulmeuSUPABASE_URL ||
    env.SUPABASE_URL ||
    '';
  const supabaseAnonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_cosulmeuSUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY ||
    '';
  const supabaseRedirectUrl =
    env.VITE_SUPABASE_REDIRECT_URL ||
    env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ||
    '';

  return {
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
      'import.meta.env.VITE_SUPABASE_REDIRECT_URL': JSON.stringify(supabaseRedirectUrl),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
        // `pg` is server-only; always replace it in the browser bundle.
        pg: path.resolve(import.meta.dirname, 'src/db/pg-browser-stub.ts'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
            if (id.includes('@supabase/')) return 'vendor-supabase';
            if (id.includes('lucide-react')) return 'vendor-icons';
            return 'vendor-misc';
          },
        },
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

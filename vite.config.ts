import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const shared = fileURLToPath(new URL('./shared', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: env.VITE_BASE || '/',
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': shared,
      },
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': 'http://127.0.0.1:8790',
        '/media': 'http://127.0.0.1:8790',
        '/ws': {
          target: 'ws://127.0.0.1:8790',
          ws: true,
        },
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});

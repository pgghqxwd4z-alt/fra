import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: Number(env.PORT || process.env.PORT || 3000),
      host: '0.0.0.0',
      hmr: env.DISABLE_HMR === 'false',
      allowedHosts: process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',') : undefined,
      proxy: {
        '/api': {
          target: env.BACKEND_URL || `http://localhost:${env.BACKEND_PORT || 8000}`,
        },
      },
    },
  };
});

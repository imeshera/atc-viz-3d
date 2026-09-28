import { defineConfig, loadEnv } from 'vite';
import { trafficPlugin } from './server/traffic.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: {
          chicago: 'index.html',
          lax: 'lax.html',
          nyc: 'nyc.html',
          dc: 'dc.html',
        },
      },
    },
    plugins: [trafficPlugin(env)],
  };
});

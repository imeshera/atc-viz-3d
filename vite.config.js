import { defineConfig, loadEnv } from 'vite';
import { trafficPlugin } from './server/traffic.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: {
      port: 5173,
      strictPort: true,
      allowedHosts: ['.trycloudflare.com'],
    },
    build: {
      rollupOptions: {
        input: {
          chicago: 'index.html',
          lax: 'lax.html',
          nyc: 'nyc.html',
          phl: 'phl.html',
          sf: 'sf.html',
          bos: 'bos.html',
          atl: 'atl.html',
          mia: 'mia.html',
          dal: 'dal.html',
          sea: 'sea.html',
          dc: 'dc.html',
        },
      },
    },
    plugins: [trafficPlugin(env)],
  };
});

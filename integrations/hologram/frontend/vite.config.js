import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/routes/')) {
            const parts = id.split('/src/routes/')[1]?.split('/');
            const name = parts?.[0]?.replace('.svelte', '');
            return name ? `route-${name}` : 'routes';
          }
          if (id.includes('/src/lib/components/studio/')) {
            return 'studio';
          }
          if (id.includes('/src/lib/components/')) {
            return 'components';
          }
          if (id.includes('wailsjs')) {
            return 'wails';
          }
          if (id.includes('node_modules')) {
            const parts = id.split('node_modules/')[1]?.split('/');
            if (!parts) return 'vendor';
            const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
            return `vendor-${pkg}`;
          }
          return undefined;
        },
      },
    },
  },
  server: {
    strictPort: true,
  },
});


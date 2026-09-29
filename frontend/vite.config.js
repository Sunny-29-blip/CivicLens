import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    // Boundary GeoJSON chunks are ~1 MB by nature and load on demand; don't warn on them.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: they change far less often than app code, so browsers keep
        // them cached across deploys, and Recharts only loads with the officials dashboard.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('firebase')) return 'vendor-firebase';
          if (/recharts|d3-|victory-vendor|redux|reselect|immer|es-toolkit|decimal\.js/.test(id)) return 'vendor-charts';
          if (id.includes('react-simple-maps') || id.includes('topojson')) return 'vendor-maps';
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The client never reads server env: envPrefix is set to something no key uses,
// so nothing from .env.server can leak into the bundle.
export default defineConfig({
  plugins: [react()],
  envPrefix: 'EVEE_PUBLIC_',
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3001' },
  },
})

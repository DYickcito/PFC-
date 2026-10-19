import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo, /api se reenvía al backend FastAPI. Así el frontend puede
    // usar su mismo origen (VITE_API_BASE_URL=http://localhost:5173) y no
    // depende de que el navegador permita llamadas a otro puerto.
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})

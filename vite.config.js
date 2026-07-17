import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Allow access through Cloudflare quick tunnels.
    allowedHosts: ['.trycloudflare.com'],
  },
})

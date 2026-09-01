import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Sidequest',
        short_name: 'Sidequest',
        description: 'A friendly real-time video chat app',
        theme_color: '#111827',
        background_color: '#050816',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_PORT || 4173),
    strictPort: false,
    allowedHosts: [
      '.ngrok-free.dev',
      '.ngrok.app',
      '.trycloudflare.com',
    ],
    hmr: {
      overlay: false,
    },
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8788',
        ws: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_PORT || 4173),
  },
})

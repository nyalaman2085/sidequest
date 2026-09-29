import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const certPath = process.env.SIDEQUEST_DEV_CERT
const keyPath = process.env.SIDEQUEST_DEV_KEY
const certFile = certPath ? resolve(certPath) : undefined
const keyFile = keyPath ? resolve(keyPath) : undefined
const https = certFile && keyFile && existsSync(certFile) && existsSync(keyFile)
  ? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
  : undefined

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: ['.ngrok-free.dev', '.ngrok.app'],
    ...(https ? { https } : {}),
    proxy: {
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})

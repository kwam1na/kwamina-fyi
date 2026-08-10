import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { observabilityBuildSettings } from './vite-observability.js'
import { securityHeaders } from './vite-security-headers.js'

const WORKER_PORT = 8787

const isPortInUse = (port) =>
  new Promise((resolve) => {
    const probe = connect({ port, host: '127.0.0.1' })
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })

// Runs `wrangler dev` alongside the Vite dev server, so `bun run dev` is the
// whole loop: Vite serves the SPA with HMR, the Worker answers /api through
// the proxy below, and both die together. Dev-only by construction —
// `apply: 'serve'` keeps it out of builds entirely.
//
// An instance already listening on the port is reused rather than raced:
// config reloads re-run this hook in the same process, and someone running
// wrangler by hand should not have a second copy spawned under them. Without
// the check, the loser of the port race would drift to a random port and the
// proxy would quietly point at nothing.
function workerDevServer() {
  return {
    name: 'worker-dev-server',
    apply: 'serve',
    async configureServer() {
      if (globalThis.__workerDevChild || (await isPortInUse(WORKER_PORT))) return

      const child = spawn('npx', ['wrangler', 'dev', '--port', String(WORKER_PORT)], {
        stdio: 'inherit',
      })
      globalThis.__workerDevChild = child

      const stop = () => {
        globalThis.__workerDevChild = undefined
        if (child.exitCode === null) child.kill()
      }
      child.on('exit', () => {
        globalThis.__workerDevChild = undefined
      })
      process.once('exit', stop)
      process.once('SIGINT', () => {
        stop()
        process.exit(130)
      })
      process.once('SIGTERM', () => {
        stop()
        process.exit(143)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const observability = observabilityBuildSettings(env)
  const sentryPlugin = observability.sentryPluginOptions
    ? sentryVitePlugin(observability.sentryPluginOptions)
    : null

  return {
  plugins: [
    react(),
    tailwindcss(),
    workerDevServer(),
    securityHeaders({ browserDsn: observability.browserDsn }),
    ...(sentryPlugin ? [sentryPlugin] : []),
  ],
  define: {
    __APP_RELEASE__: JSON.stringify(observability.release),
    __OBSERVABILITY_PROVIDER_READY__: JSON.stringify(observability.enabled),
    __SENTRY_BROWSER_DSN__: JSON.stringify(observability.browserDsn),
  },
  build: {
    sourcemap: observability.sourcemap,
    // Keep stable framework code out of the content-heavy entry chunk. The
    // site embeds its authored HTML at build time, so relying on the default
    // single-entry grouping pushed the entry just past Vite's 500 kB advisory.
    // Explicit Rolldown groups improve cache reuse and keep every initial chunk
    // comfortably below that boundary without hiding it behind a larger limit.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-runtime',
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: 'router',
              test: /node_modules[\\/]@tanstack[\\/]react-router/,
              priority: 20,
            },
            {
              name: 'motion',
              test: /node_modules[\\/]animejs[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    // Allow access through Cloudflare quick tunnels.
    allowedHosts: ['.trycloudflare.com'],
    // The assistant's backend is the Worker, which Vite knows nothing about.
    // In dev the two run side by side — Vite here, the wrangler instance the
    // plugin above spawns — and this hands /api/* across so the widget works
    // from the Vite origin. Production has no equivalent seam: the Worker
    // serves both.
    proxy: {
      '/api': `http://localhost:${WORKER_PORT}`,
    },
  },
  }
})

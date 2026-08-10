import { describe, expect, it } from 'bun:test'
import { observabilityBuildSettings } from './vite-observability.js'

const readyEnvironment = {
  OBSERVABILITY_PROVIDER_READY: 'true',
  SENTRY_AUTH_TOKEN: 'ci-only-token',
  SENTRY_ORG: 'example-org',
  SENTRY_PROJECT: 'kwamina-fyi-browser',
  SENTRY_RELEASE: 'kwamina-fyi@0123456789abcdef',
  VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
}

describe('observability build settings', () => {
  it('keeps provider collection and source maps disabled by default', () => {
    expect(observabilityBuildSettings({})).toEqual({
      enabled: false,
      release: 'unreleased',
      browserDsn: '',
      sourcemap: false,
      sentryPluginOptions: null,
    })
  })

  it('fails closed when provider-ready configuration is incomplete or mutable', () => {
    expect(() => observabilityBuildSettings({ OBSERVABILITY_PROVIDER_READY: 'true' }))
      .toThrow('Observability release configuration is incomplete')
    expect(() => observabilityBuildSettings({
      ...readyEnvironment,
      SENTRY_RELEASE: 'latest',
    })).toThrow('SENTRY_RELEASE must be an immutable')
  })

  it('uploads hidden maps for one immutable release and deletes deployable maps', () => {
    const settings = observabilityBuildSettings(readyEnvironment)

    expect(settings).toMatchObject({
      enabled: true,
      release: readyEnvironment.SENTRY_RELEASE,
      browserDsn: readyEnvironment.VITE_SENTRY_DSN,
      sourcemap: 'hidden',
      sentryPluginOptions: {
        authToken: readyEnvironment.SENTRY_AUTH_TOKEN,
        org: readyEnvironment.SENTRY_ORG,
        project: readyEnvironment.SENTRY_PROJECT,
        release: { name: readyEnvironment.SENTRY_RELEASE },
        sourcemaps: {
          assets: './dist/assets/**',
          filesToDeleteAfterUpload: './dist/**/*.map',
        },
        telemetry: false,
      },
    })
  })
})

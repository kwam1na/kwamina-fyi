const RELEASE_PATTERN = /^kwamina-fyi@[a-f0-9]{12,64}$/

export function observabilityBuildSettings(env) {
  if (env.OBSERVABILITY_PROVIDER_READY !== 'true') {
    return {
      enabled: false,
      release: 'unreleased',
      browserDsn: '',
      sourcemap: false,
      sentryPluginOptions: null,
    }
  }

  const required = [
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
    'SENTRY_RELEASE',
    'VITE_SENTRY_DSN',
  ]
  const missing = required.filter((name) => !env[name])
  if (missing.length > 0) {
    throw new Error(`Observability release configuration is incomplete: ${missing.join(', ')}`)
  }
  if (!RELEASE_PATTERN.test(env.SENTRY_RELEASE)) {
    throw new Error('SENTRY_RELEASE must be an immutable kwamina-fyi@<git-sha> value.')
  }

  return {
    enabled: true,
    release: env.SENTRY_RELEASE,
    browserDsn: env.VITE_SENTRY_DSN,
    sourcemap: 'hidden',
    sentryPluginOptions: {
      authToken: env.SENTRY_AUTH_TOKEN,
      org: env.SENTRY_ORG,
      project: env.SENTRY_PROJECT,
      release: { name: env.SENTRY_RELEASE },
      sourcemaps: {
        assets: './dist/assets/**',
        filesToDeleteAfterUpload: './dist/**/*.map',
      },
      telemetry: false,
    },
  }
}

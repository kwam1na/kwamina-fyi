const RELEASE_PATTERN = /^kwamina-fyi@[a-f0-9]{12,64}$/
const COMMIT_SHA_PATTERN = /^[a-f0-9]{12,64}$/

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

  const commitSha = env.WORKERS_CI_COMMIT_SHA
  const release = env.SENTRY_RELEASE || (
    COMMIT_SHA_PATTERN.test(commitSha ?? '') ? `kwamina-fyi@${commitSha}` : ''
  )
  const required = [
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
    'VITE_SENTRY_DSN',
  ]
  const missing = required.filter((name) => !env[name])
  if (!release) missing.push('SENTRY_RELEASE or WORKERS_CI_COMMIT_SHA')
  if (missing.length > 0) {
    throw new Error(`Observability release configuration is incomplete: ${missing.join(', ')}`)
  }
  if (!RELEASE_PATTERN.test(release)) {
    throw new Error('SENTRY_RELEASE must be an immutable kwamina-fyi@<git-sha> value.')
  }

  return {
    enabled: true,
    release,
    browserDsn: env.VITE_SENTRY_DSN,
    sourcemap: 'hidden',
    sentryPluginOptions: {
      authToken: env.SENTRY_AUTH_TOKEN,
      org: env.SENTRY_ORG,
      project: env.SENTRY_PROJECT,
      release: { name: release },
      sourcemaps: {
        assets: './dist/assets/**',
        filesToDeleteAfterUpload: './dist/**/*.map',
      },
      telemetry: false,
    },
  }
}

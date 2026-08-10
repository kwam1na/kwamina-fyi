import * as Sentry from '@sentry/react'
import { sanitizeBrowserEvent, sanitizeSentryIssue } from './contract.js'

const disabledBrowserObservability = Object.freeze({
  enabled: false,
  captureActionableIssue() {},
})

function ready(config) {
  return config?.environment === 'production'
    && config.providerReady === true
    && typeof config.dsn === 'string'
    && config.dsn.length > 0
    && /^kwamina-fyi@[a-f0-9]{12,64}$/.test(config.release ?? '')
}

export function initializeBrowserObservability(config, sdk = Sentry) {
  if (!ready(config)) return disabledBrowserObservability

  try {
    sdk.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      defaultIntegrations: false,
      integrations: [sdk.inboundFiltersIntegration(), sdk.dedupeIntegration()],
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        genAI: { inputs: false, outputs: false },
        stackFrameVariables: false,
        frameContextLines: 0,
      },
      enableLogs: false,
      tracesSampleRate: 0,
      maxBreadcrumbs: 0,
      sendClientReports: false,
      beforeBreadcrumb: () => null,
      beforeSend: sanitizeSentryIssue,
    })
  } catch {
    return disabledBrowserObservability
  }

  return Object.freeze({
    enabled: true,
    captureActionableIssue(details) {
      const event = sanitizeBrowserEvent(details)
      if (!event.outcomeCode || !event.fingerprint) return
      try {
        sdk.captureException(new Error(event.outcomeCode), {
          fingerprint: [event.fingerprint],
          tags: event,
        })
      } catch {
        // Telemetry must never alter the browser recovery path or report itself.
      }
    },
  })
}

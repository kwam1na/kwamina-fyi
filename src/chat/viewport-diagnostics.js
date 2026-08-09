const FLUSH_DELAY_MS = 400
const SETTLED_DELAY_MS = 1_000

function box(element) {
  const bounds = element?.getBoundingClientRect()
  return bounds
    ? { top: bounds.top, bottom: bounds.bottom, height: bounds.height }
    : { top: null, bottom: null, height: null }
}

export function readViewportGeometry({
  panel,
  composer,
  viewport = window.visualViewport,
  windowObject = window,
  documentObject = document,
}) {
  const panelBox = box(panel)
  const composerBox = box(composer)

  return {
    innerHeight: windowObject.innerHeight,
    layoutHeight: documentObject.documentElement.clientHeight,
    viewportHeight: viewport?.height ?? null,
    viewportOffsetTop: viewport?.offsetTop ?? null,
    viewportPageTop: viewport?.pageTop ?? null,
    viewportScale: viewport?.scale ?? null,
    panelTop: panelBox.top,
    panelBottom: panelBox.bottom,
    panelHeight: panelBox.height,
    composerTop: composerBox.top,
    composerBottom: composerBox.bottom,
    composerHeight: composerBox.height,
    windowScrollY: windowObject.scrollY,
    rootScrollTop: documentObject.documentElement.scrollTop,
    bodyScrollTop: documentObject.body.scrollTop,
    composerFocused: documentObject.activeElement?.tagName === 'TEXTAREA',
  }
}

export function observeViewportDiagnostics({
  threadId,
  pagePath,
  panel,
  composer,
  input,
  viewport = window.visualViewport,
  windowObject = window,
  documentObject = document,
}) {
  if (!viewport || !windowObject.matchMedia('(max-width: 620px)').matches) return () => {}

  let events = []
  let flushTimer = null
  let settledTimer = null

  const flush = () => {
    flushTimer = null
    if (!events.length) return
    const pending = events
    events = []
    void fetch('/api/chat/diagnostics', {
      method: 'POST',
      body: JSON.stringify({ threadId, pagePath, events: pending }),
      keepalive: true,
    }).catch(() => {})
  }

  const record = (type) => {
    events.push({
      type,
      capturedAt: Date.now(),
      metrics: readViewportGeometry({ panel, composer, viewport, windowObject, documentObject }),
    })
    windowObject.clearTimeout(flushTimer)
    flushTimer = windowObject.setTimeout(flush, FLUSH_DELAY_MS)
  }

  const onFocus = () => record('composer_focus')
  const onBlur = () => {
    record('composer_blur')
    windowObject.clearTimeout(settledTimer)
    settledTimer = windowObject.setTimeout(() => record('settled'), SETTLED_DELAY_MS)
  }
  const onViewportResize = () => record('visual_viewport_resize')
  const onViewportScroll = () => record('visual_viewport_scroll')
  const onWindowResize = () => record('window_resize')

  input.addEventListener('focus', onFocus)
  input.addEventListener('blur', onBlur)
  viewport.addEventListener('resize', onViewportResize)
  viewport.addEventListener('scroll', onViewportScroll)
  windowObject.addEventListener('resize', onWindowResize)
  record('open')

  return () => {
    input.removeEventListener('focus', onFocus)
    input.removeEventListener('blur', onBlur)
    viewport.removeEventListener('resize', onViewportResize)
    viewport.removeEventListener('scroll', onViewportScroll)
    windowObject.removeEventListener('resize', onWindowResize)
    windowObject.clearTimeout(flushTimer)
    windowObject.clearTimeout(settledTimer)
    record('close')
    windowObject.clearTimeout(flushTimer)
    flush()
  }
}

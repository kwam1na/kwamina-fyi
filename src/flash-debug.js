// TEMPORARY diagnostic for the navigation flash. Off unless switched on:
//
//   localStorage.flashdebug = '1'    (then navigate normally)
//
// Capture starts on the click that begins a navigation, not on the next
// page's mount, so the samples span the old page, the commit, and the new
// page. The previous version started too late and missed the transition.
//
// The key field is `topAt*`: what document.elementFromPoint reports at three
// heights in the viewport. The pinned footer is supposed to sit *behind*
// `main`, so seeing `site-footer` there means the inverted footer is the
// element actually being painted — which is the flash.
//
// Remove this file and its import once the cause is confirmed.

const FRAMES = 40

export function isFlashDebugEnabled() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage?.getItem('flashdebug') === '1'
  } catch {
    return false
  }
}

function describe(el) {
  if (!el) return null
  const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 2).join('.') : ''
  const inFooter = !!el.closest?.('.site-footer')
  return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${inFooter ? ' [FOOTER]' : ''}`
}

export function startFlashCapture(label) {
  if (!isFlashDebugEnabled()) return

  const started = performance.now()
  const samples = []
  let frame = 0

  const sample = (schedule = true) => {
    const page = document.querySelector('.routed-page')
    const footer = document.querySelector('.site-footer')
    const main = document.querySelector('main')
    const vh = window.innerHeight
    const vw = window.innerWidth
    const footerStyle = footer ? getComputedStyle(footer) : null
    const mainStyle = main ? getComputedStyle(main) : null

    samples.push({
      f: frame,
      ms: +(performance.now() - started).toFixed(1),
      path: window.location.pathname,
      scrollY: Math.round(window.scrollY),
      docH: document.documentElement.scrollHeight,
      // If both page trees are mounted at once, the incoming page's fixed
      // footer can paint over the outgoing page, whose main is unpositioned.
      pages: document.querySelectorAll('.routed-page').length,
      footers: document.querySelectorAll('.site-footer').length,
      // What is actually painted on top at three heights of the viewport.
      topAtQuarter: describe(document.elementFromPoint(vw / 2, vh * 0.25)),
      topAtMiddle: describe(document.elementFromPoint(vw / 2, vh * 0.5)),
      topAtBottom: describe(document.elementFromPoint(vw / 2, vh - 8)),
      mainBg: mainStyle?.backgroundColor ?? null,
      mainZ: mainStyle?.zIndex ?? null,
      mainBottom: main ? Math.round(main.getBoundingClientRect().bottom) : null,
      footerPos: footerStyle?.position ?? null,
      footerBg: footerStyle?.backgroundColor ?? null,
      footerZ: footerStyle?.zIndex ?? null,
      footerTop: footer ? Math.round(footer.getBoundingClientRect().top) : null,
      cls: page ? page.className.replace('routed-page', '').trim() || '(none)' : '(no page)',
    })

    window.__flashFrames = samples

    if (!schedule) return
    frame += 1
    if (frame < FRAMES) requestAnimationFrame(sample)
    else {
      const exposed = samples.filter((s) => /FOOTER/.test(`${s.topAtQuarter}${s.topAtMiddle}`))
      // eslint-disable-next-line no-console
      console.log(
        `[flash-debug] ${label}: ${exposed.length} of ${samples.length} frames paint the footer above the fold`,
      )
      // eslint-disable-next-line no-console
      console.table(samples)
    }
  }

  // A synchronous baseline at click time, before navigate() runs. It must not
  // schedule, or it would start a second sampling chain alongside the one below.
  frame = -1
  sample(false)
  frame = 0
  requestAnimationFrame(sample)
}

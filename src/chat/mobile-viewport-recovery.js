const restoredHeightTolerance = 1
const maxRecoveryFrames = 2

export function watchMobileViewportRecovery({
  root,
  isMobile = false,
  viewport,
  getScrollTarget,
  requestFrame,
  cancelFrame,
} = {}) {
  const resolvedViewport = viewport === undefined ? globalThis.window?.visualViewport : viewport
  if (!isMobile || !resolvedViewport) return () => {}

  const resolvedRoot = root ?? globalThis.document?.documentElement
  if (!resolvedRoot) return () => {}
  const scheduleFrame = requestFrame ?? ((callback) => window.requestAnimationFrame(callback))
  const cancelScheduledFrame = cancelFrame ?? ((scheduledFrame) => window.cancelAnimationFrame(scheduledFrame))

  let frame = null
  let remainingFrames = 0
  const recoverHitTesting = () => {
    frame = null
    const rootHeight = resolvedRoot.clientHeight
    if (Math.abs(resolvedViewport.height - rootHeight) > restoredHeightTolerance) {
      remainingFrames -= 1
      if (remainingFrames > 0) frame = scheduleFrame(recoverHitTesting)
      return
    }

    // WebKit can visually restore a fixed takeover after keyboard dismissal
    // while retaining the keyboard-era touch coordinates. Reassert the root
    // position, then transact against the takeover's real scroll layer: the
    // locked root is already at zero, so that assignment alone can be a no-op.
    resolvedRoot.scrollTop = 0
    const scrollTarget = getScrollTarget?.()
    if (!scrollTarget) return

    let temporarySpacer = null
    let maxScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight)
    if (maxScrollTop === 0) {
      temporarySpacer = scrollTarget.ownerDocument?.createElement('span')
      if (!temporarySpacer) return

      temporarySpacer.setAttribute('aria-hidden', 'true')
      Object.assign(temporarySpacer.style, {
        display: 'block',
        height: `${scrollTarget.clientHeight + 1}px`,
        pointerEvents: 'none',
      })
      scrollTarget.append(temporarySpacer)
      maxScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight)
    }

    const originalScrollTop = scrollTarget.scrollTop
    const originalScrollBehavior = scrollTarget.style.scrollBehavior
    scrollTarget.style.scrollBehavior = 'auto'
    try {
      scrollTarget.scrollTop = originalScrollTop < maxScrollTop
        ? Math.min(originalScrollTop + 1, maxScrollTop)
        : Math.max(originalScrollTop - 1, 0)
      scrollTarget.scrollTop = originalScrollTop
    } finally {
      scrollTarget.style.scrollBehavior = originalScrollBehavior
      temporarySpacer?.remove()
    }
  }
  const scheduleRecovery = () => {
    remainingFrames = maxRecoveryFrames
    if (frame !== null) return
    frame = scheduleFrame(recoverHitTesting)
  }

  resolvedViewport.addEventListener('resize', scheduleRecovery)

  return () => {
    resolvedViewport.removeEventListener('resize', scheduleRecovery)
    if (frame !== null) {
      cancelScheduledFrame(frame)
      frame = null
    }
  }
}

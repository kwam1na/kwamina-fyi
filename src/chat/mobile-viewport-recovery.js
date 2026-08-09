const restoredHeightTolerance = 1
const maxRecoveryFrames = 2

export function watchMobileViewportRecovery({
  root,
  isMobile = false,
  viewport,
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
    // while retaining the keyboard-era touch coordinates. Reasserting the
    // root position after its viewport returns forces that hit-test refresh.
    resolvedRoot.scrollTop = 0
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

export const MOBILE_TAKEOVER_QUERY = '(max-width: 620px)'

const viewportHeightProperty = '--mobile-chat-viewport-height'

export function shouldAutoFocusChatComposer({ isMobileTakeover }) {
  return !isMobileTakeover
}

export function watchMobileChatViewport(
  panel,
  {
    isMobile = window.matchMedia(MOBILE_TAKEOVER_QUERY).matches,
    viewport = window.visualViewport,
  } = {},
) {
  if (!panel || !isMobile || !viewport) return () => {}

  let lastHeight
  const update = () => {
    const height = `${viewport.height}px`
    if (height === lastHeight) return
    lastHeight = height
    panel.style.setProperty(viewportHeightProperty, height)
  }

  update()
  viewport.addEventListener('resize', update)

  return () => {
    viewport.removeEventListener('resize', update)
    panel.style.removeProperty(viewportHeightProperty)
  }
}

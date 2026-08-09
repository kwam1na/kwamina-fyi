export const MOBILE_TAKEOVER_QUERY = '(max-width: 620px)'

const viewportHeightProperty = '--mobile-chat-viewport-height'

export function watchMobileChatViewport(
  panel,
  {
    isMobile = window.matchMedia(MOBILE_TAKEOVER_QUERY).matches,
    viewport = window.visualViewport,
  } = {},
) {
  if (!panel || !isMobile || !viewport) return () => {}

  let lastHeight
  const updateHeight = () => {
    const height = `${viewport.height}px`
    if (height === lastHeight) return

    lastHeight = height
    panel.style.setProperty(viewportHeightProperty, height)
  }

  updateHeight()
  viewport.addEventListener('resize', updateHeight)

  return () => {
    viewport.removeEventListener('resize', updateHeight)
    panel.style.removeProperty(viewportHeightProperty)
  }
}

export const MOBILE_TAKEOVER_QUERY = '(max-width: 620px)'

const viewportProperties = [
  '--mobile-chat-viewport-height',
  '--mobile-chat-viewport-top',
]

export function watchMobileChatViewport(
  panel,
  {
    isMobile = window.matchMedia(MOBILE_TAKEOVER_QUERY).matches,
    viewport = window.visualViewport,
  } = {},
) {
  if (!panel || !isMobile || !viewport) return () => {}

  const update = () => {
    panel.style.setProperty(viewportProperties[0], `${viewport.height}px`)
    panel.style.setProperty(viewportProperties[1], `${viewport.offsetTop}px`)
  }

  update()
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)

  return () => {
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
    viewportProperties.forEach((property) => panel.style.removeProperty(property))
  }
}

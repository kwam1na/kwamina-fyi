import { useEffect, useState } from 'react'

/**
 * Whether a fixed floating control is currently sitting over the inverted
 * footer, so it can swap to the footer's palette instead of disappearing into
 * it. Shared by every fixed control on the page — the rule for "over the
 * footer" is subtle enough (the footer is pinned beneath the page on some
 * routes and in normal flow on others) that it should exist once.
 *
 * Takes a ref to the control's element and returns a boolean.
 */
export function useFooterOverlap(controlRef) {
  const [isOnFooter, setIsOnFooter] = useState(false)

  useEffect(() => {
    let frame = 0

    const update = () => {
      frame = 0
      const footer = document.querySelector('.site-footer')
      const control = controlRef.current
      if (!footer || !control) {
        setIsOnFooter(false)
        return
      }

      const routedPage = footer.closest('.routed-page')
      const main = routedPage?.querySelector('main')
      const footerBounds = footer.getBoundingClientRect()
      const controlBounds = control.getBoundingClientRect()
      const controlCenter = controlBounds.top + controlBounds.height / 2
      const hasInvertedFooter = routedPage?.classList.contains('has-revealed-footer')
      // Pinned: the footer is fixed beneath the page, so its own bounds cover
      // the viewport the whole way down. What decides overlap there is where
      // the page above it has slid to, not where the footer is.
      const hasPinnedFooter = hasInvertedFooter
        && !routedPage.classList.contains('has-inline-footer')

      setIsOnFooter(
        hasInvertedFooter && (
          hasPinnedFooter && main
            ? main.getBoundingClientRect().bottom <= controlCenter
            : controlCenter >= footerBounds.top && controlCenter <= footerBounds.bottom
        ),
      )
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    // Route swaps replace the page under the control without a scroll event.
    const pageObserver = new MutationObserver(schedule)
    pageObserver.observe(document.getElementById('root'), { childList: true, subtree: true })
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()

    return () => {
      window.cancelAnimationFrame(frame)
      pageObserver.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [controlRef])

  return isOnFooter
}

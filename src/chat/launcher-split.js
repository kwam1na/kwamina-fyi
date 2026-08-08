import { createTimeline, cubicBezier, utils } from 'animejs'

// Eased at both ends and never past its mark. The site's --ease-portfolio is an
// expo-out that leaves the instant it is asked to: right for something entering
// the page, too abrupt for a control rearranging itself under a reader who was
// only scrolling. This starts and stops gently, so the split registers as the
// corner settling rather than as something being triggered.
const ease = cubicBezier(0.4, 0, 0.2, 1)

/**
 * The launcher and the scroll-to-top control share one corner and one
 * threshold. The scroll-to-top keeps the corner; the launcher rests on top of
 * it while labelled, then sheds its text, contracts to a disc, and slides clear
 * — uncovering the control that was underneath it the whole time. One shape
 * becoming two, without either needing to know about the other: the reveal is
 * the scroll-to-top's own, and nothing here touches it.
 *
 * Distances come from CSS rather than being repeated here, so the motion
 * follows the layout instead of having to be re-tuned alongside it. The
 * collapsed width is just the control's own height, because a disc is as wide
 * as it is tall.
 *
 * The slide rides `--split-x` composed through `translate`, not `transform`:
 * `transform` already carries the hover lift and the active press, and an
 * inline value would silently outrank both. Opacity is left to CSS for the same
 * reason — the `:hover` rule that brings the control to full strength would
 * lose to an inline value.
 *
 * The label's width collapses alongside its opacity. Fading it alone leaves it
 * holding its full width in the flex row, which pushes the icon off-centre in
 * the disc by half the space the invisible text still occupies.
 */
export function animateSplit({ launcher, label, isCollapsed, immediate }) {
  if (!launcher || !label) return null

  const styles = getComputedStyle(launcher)
  const token = (name, fallback) =>
    Number.parseFloat(styles.getPropertyValue(name)) || fallback

  // Read every time rather than measured once and cached: these change at the
  // mobile breakpoint, and a cached figure would survive a rotation and animate
  // the pill to the wrong width.
  const expandedWidth = token('--launcher-expanded', 79)
  const gap = token('--launcher-gap', 7)
  const travel = token('--split-travel', 50)
  const collapsedWidth = launcher.offsetHeight
  // Reports the text's full width even while the element is clamped to zero.
  const labelWidth = label.scrollWidth

  const width = isCollapsed ? collapsedWidth : expandedWidth
  const offset = isCollapsed ? -travel : 0

  const apply = () => {
    utils.set(launcher, { width: `${width}px`, gap: `${isCollapsed ? 0 : gap}px`, '--split-x': `${offset}px` })
    utils.set(label, { width: `${isCollapsed ? 0 : labelWidth}px`, opacity: isCollapsed ? 0 : 1 })
  }

  // First paint, and readers who have asked for less motion, get the end state
  // with no travel at all.
  if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply()
    return null
  }

  const timeline = createTimeline({ defaults: { ease } })

  // The offsets below are small on purpose. A wide stagger turns one gesture
  // into a sequence of separate events, which is most of what made this read as
  // abrupt; overlapping the parts lets them settle together.
  if (isCollapsed) {
    // Splitting: the text goes first so it is never squeezed by the closing
    // pill, then the pill closes and slides clear of what it was covering.
    timeline
      .add(label, { opacity: 0, duration: 150 }, 0)
      .add(label, { width: '0px', duration: 300 }, 40)
      .add(launcher, { width: `${collapsedWidth}px`, gap: '0px', duration: 340 }, 40)
      .add(launcher, { '--split-x': `${-travel}px`, duration: 380 }, 60)
  } else {
    // Merging: the reverse order, so the pill is back over the control before
    // it opens, and the label only returns once there is room for it.
    timeline
      .add(launcher, { '--split-x': '0px', duration: 340 }, 0)
      .add(launcher, { width: `${expandedWidth}px`, gap: `${gap}px`, duration: 340 }, 60)
      .add(label, { width: `${labelWidth}px`, duration: 300 }, 80)
      .add(label, { opacity: 1, duration: 220 }, 200)
  }

  return timeline
}

import { createTimeline, cubicBezier, utils } from 'animejs'

// Eased at both ends and never past its mark. The site's --ease-portfolio is an
// expo-out that leaves the instant it is asked to: right for something entering
// the page, too abrupt for a control rearranging itself under a reader who was
// only scrolling. This starts and stops gently, so the split registers as the
// corner settling rather than as something being triggered.
const ease = cubicBezier(0.4, 0, 0.2, 1)

/**
 * The last frame either direction can land on: splitting ends at 60 + 380,
 * merging at 200 + 220. Published so a caller can tell when a motion has
 * missed its moment — see settleSplit.
 */
export const SPLIT_DURATION_MS = 440

/**
 * The launcher and the scroll-to-top control share one corner and one
 * threshold. The scroll-to-top keeps the corner; the launcher rests on top of
 * it while labelled, then sheds its text, contracts to a disc, and slides clear
 * — uncovering the control that was underneath it the whole time. One shape
 * becoming two, without either needing to know about the other: the reveal is
 * the scroll-to-top's own, and nothing here touches it.
 *
 * Every value tweened below is a transform or an opacity. That is the whole
 * design constraint: this motion runs while the reader is scrolling, and
 * profiling an earlier version that tweened `width` and `gap` found it
 * invalidating layout for the entire document on every frame, repainting the
 * scrolling layer underneath the reader. Geometry still changes — it is simply
 * committed once, as the `is-split` class, at the moment in the motion where
 * nothing visible is resting on it.
 *
 * Distances come from CSS rather than being repeated here, so the motion
 * follows the layout instead of having to be re-tuned alongside it.
 *
 * The slide rides `--split-x` composed through `translate`, not `transform`:
 * `transform` already carries the hover lift and the active press, and an
 * inline value would silently outrank both. Opacity is left to CSS for the same
 * reason — the `:hover` rule that brings the control to full strength would
 * lose to an inline value.
 */
/**
 * The corner's resting state for a given side of the threshold, written
 * straight to the element with no travel at all.
 *
 * This is the whole end state in one place on purpose. Every value the
 * timeline tweens is a compensation for geometry React has already committed —
 * the icon in particular is set back to where the reader last saw it and only
 * returned to its new place by the motion — so a split that starts and never
 * finishes leaves the control holding an offset with nothing left to undo it:
 * the icon parked clear of its own pill. Anything that can stop the motion
 * short calls this instead of hoping the frames arrive.
 */
export function settleSplit({ launcher, label, isCollapsed }) {
  if (!launcher || !label) return

  const { travel, openShadowScale, labelRight } = splitGeometry(launcher, label)

  placeLabel(label, isCollapsed, labelRight)
  utils.set(launcher, {
    '--split-x': `${isCollapsed ? -travel : 0}px`,
    '--pill-open': isCollapsed ? 0 : 1,
    '--pill-shadow-scale': isCollapsed ? 1 : openShadowScale,
    '--icon-x': '0px',
  })
  utils.set(label, { opacity: isCollapsed ? 0 : 1 })
}

/**
 * Every distance the split needs, read from CSS rather than repeated here, so
 * the motion follows the layout instead of having to be re-tuned alongside it.
 *
 * Read every time rather than measured once and cached: these change at the
 * mobile breakpoint, and a cached figure would survive a rotation and animate
 * the pill to the wrong width.
 */
function splitGeometry(launcher, label) {
  const styles = getComputedStyle(launcher)
  const token = (name, fallback) =>
    Number.parseFloat(styles.getPropertyValue(name)) || fallback

  const expandedWidth = token('--launcher-expanded', 79)
  const collapsedWidth = token('--launcher-size', launcher.offsetHeight || 42)
  const gap = token('--launcher-gap', 7)
  // Reports the text's full width even while the element is clamped to zero.
  const iconWidth = launcher.querySelector('.site-chat-launcher-icon')?.offsetWidth || 17

  // Both layouts centre their contents, so each element's position is fixed by
  // the pill's right edge — which never moves, since the pill is right-anchored
  // and the slide is applied to the whole control afterwards. Measuring from
  // that edge is what lets the icon be placed without reading the DOM back.
  const contentWidth = iconWidth + gap + label.scrollWidth

  return {
    travel: token('--split-travel', 50),
    iconShift: (expandedWidth + contentWidth) / 2 - (collapsedWidth + iconWidth) / 2,
    // Where the label sits while it fades, once it has left the flex row.
    labelRight: (expandedWidth - contentWidth) / 2,
    // The shadow is a disc scaled out to the pill's current width, so collapsed
    // is scale 1 and stays a true circle. Its scale is linear in --pill-open, so
    // animating the two together with the same easing keeps them in step without
    // CSS having to divide one length by another.
    openShadowScale: expandedWidth / collapsedWidth,
  }
}

// The `is-split` class itself belongs to React (see ChatWidget) so a re-render
// cannot drop it. All that is left here is the placement the flex row stops
// providing once the label is out of flow. Set in both states: harmless while
// the label is transparent, and it means expanding never has to work out where
// the label came from.
function placeLabel(label, isCollapsed, labelRight) {
  // Only while it is out of flow. In the row the label is positioned but not
  // offset, so leaving an inline `right` behind would drag it back over the
  // icon — the flex gap is not what holds them apart, its static position is.
  label.style.right = isCollapsed ? `${labelRight}px` : ''
}

export function animateSplit({ launcher, label, isCollapsed, immediate }) {
  if (!launcher || !label) return null

  // First paint, and readers who have asked for less motion, get the end state
  // with no travel at all — the same end state a stopped motion settles to.
  if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    settleSplit({ launcher, label, isCollapsed })
    return null
  }

  const { travel, iconShift, labelRight, openShadowScale } = splitGeometry(launcher, label)

  const timeline = createTimeline({ defaults: { ease } })

  // The offsets below are small on purpose. A wide stagger turns one gesture
  // into a sequence of separate events, which is most of what made this read as
  // abrupt; overlapping the parts lets them settle together.
  if (isCollapsed) {
    // Splitting: the text goes first so it is never squeezed by the closing
    // pill, then the pill closes and slides clear of what it was covering.
    //
    // The geometry is already committed by the time this runs; the pill's own
    // shape is drawn by the surface and never depended on it, and the icon's
    // jump is absorbed by starting it back where the reader last saw it.
    placeLabel(label, isCollapsed, labelRight)
    utils.set(launcher, { '--icon-x': `${-iconShift}px` })
    timeline
      .add(label, { opacity: 0, duration: 150 }, 0)
      .add(launcher, { '--pill-open': 0, duration: 340 }, 40)
      .add(launcher, { '--pill-shadow-scale': 1, duration: 340 }, 40)
      .add(launcher, { '--icon-x': '0px', duration: 340 }, 40)
      .add(launcher, { '--split-x': `${-travel}px`, duration: 380 }, 60)
  } else {
    // Merging: the reverse order, so the pill is back over the control before
    // it opens, and the label only returns once there is room for it.
    placeLabel(label, isCollapsed, labelRight)
    utils.set(launcher, { '--icon-x': `${iconShift}px` })
    timeline
      .add(launcher, { '--split-x': '0px', duration: 340 }, 0)
      .add(launcher, { '--pill-open': 1, duration: 340 }, 60)
      .add(launcher, { '--pill-shadow-scale': openShadowScale, duration: 340 }, 60)
      .add(launcher, { '--icon-x': '0px', duration: 340 }, 60)
      .add(label, { opacity: 1, duration: 220 }, 200)
  }

  return timeline
}

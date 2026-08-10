// Pointer-proximity focus: as the reader reaches for one node, the section
// around it recedes and the node itself can draw something in. Generalised
// out of the homepage headline, where reaching for "craft" dims the rest of
// the line and inks a rule under the word.
//
// The section is the *scope* — it owns the pointer listeners. The nodes being
// reached for are its *foci*; a scope may name more than one. The two values
// that fall out of the distance live in different places, because they answer
// different questions:
//
//   --proximity-focus  on the scope, for it to recede against. The nearness of
//                      whichever focus is closest — the section pulls back for
//                      the one thing the reader is reaching for, not for each
//                      in turn.
//   --proximity-rule   on each focus node itself, held back until the reader
//                      commits. Per-node on purpose: with two foci in a scope,
//                      a shared rule would ink in both at once.
//
// Neither is set at rest, or on touch, so untouched markup is untouched.

export const PROXIMITY_DEFAULTS = {
  // Scaled off the focus so the falloff holds at any type size, and wide
  // enough to cover its neighbours: at twice the node's width the reach died
  // inside the very next word, so resting on it barely dimmed it.
  radiusScale: 3.2,
  minRadius: 420,
  // The rule holds off until the reader is clearly reaching for the node —
  // otherwise a pointer drifting past leaves a stray nub of ink.
  ruleThreshold: 0.18,
}

const clamp01 = (value) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/** Eases in at the far edge and climbs through the middle. */
export function smoothstep(value) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

/**
 * How near the pointer is to a rect, 0 (outside the reach) to 1 (on it).
 * Distance is measured to the nearest edge rather than to the centre, so the
 * whole node reads as "here" instead of just the middle of it.
 */
export function proximityNearness(rect, pointerX, pointerY, options = {}) {
  const { radiusScale, minRadius } = { ...PROXIMITY_DEFAULTS, ...options }
  const dx = Math.max(rect.left - pointerX, 0, pointerX - rect.right)
  const dy = Math.max(rect.top - pointerY, 0, pointerY - rect.bottom)
  const distance = Math.hypot(dx, dy)
  const radius = Math.max(rect.width * radiusScale, minRadius)
  if (!Number.isFinite(distance) || !(radius > 0)) return 0
  return clamp01(1 - distance / radius)
}

/**
 * The two responses to the same approach, shaped differently on purpose.
 *
 * The dimming runs straight off the nearness: a pointer resting either side
 * of the focus is unmistakably in its orbit, so its neighbours should read as
 * clearly recessed rather than faintly tinted. The rule waits for commitment
 * and then draws quickly, easing in and settling out like a nib.
 */
export function proximityValues(rect, pointerX, pointerY, options = {}) {
  const { ruleThreshold } = { ...PROXIMITY_DEFAULTS, ...options }
  const nearness = proximityNearness(rect, pointerX, pointerY, options)
  const threshold = clamp01(ruleThreshold)
  const span = 1 - threshold
  const reach = span > 0 ? (nearness - threshold) / span : nearness
  return { focus: smoothstep(nearness), rule: smoothstep(reach) }
}

const readNumber = (value, fallback) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Per-scope overrides, so a section can tune its own reach from the markup. */
export function proximityOptionsFrom(dataset = {}) {
  return {
    radiusScale: readNumber(dataset.proximityRadiusScale, PROXIMITY_DEFAULTS.radiusScale),
    minRadius: readNumber(dataset.proximityMinRadius, PROXIMITY_DEFAULTS.minRadius),
    ruleThreshold: readNumber(dataset.proximityRuleThreshold, PROXIMITY_DEFAULTS.ruleThreshold),
  }
}

/**
 * Track the pointer over `scope` and publish the nearness of its foci: the
 * closest one's onto the scope, each one's own rule onto itself. Takes a
 * single node or a list. Returns a teardown; a no-op teardown when there is
 * nothing to bind or the device has no fine pointer to track.
 */
export function bindProximityFocus(scope, focusNodes, options = {}) {
  const noop = () => {}
  const foci = [focusNodes].flat().filter(Boolean)
  if (!scope || !foci.length) return noop
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return noop

  const settings = { ...PROXIMITY_DEFAULTS, ...options }
  let frame = 0
  let pointerX = 0
  let pointerY = 0

  const apply = () => {
    frame = 0
    let nearest = 0
    foci.forEach((node) => {
      const { focus, rule } = proximityValues(
        node.getBoundingClientRect(),
        pointerX,
        pointerY,
        settings,
      )
      node.style.setProperty('--proximity-rule', rule.toFixed(3))
      nearest = Math.max(nearest, focus)
    })
    scope.style.setProperty('--proximity-focus', nearest.toFixed(3))
  }

  const onPointerMove = (event) => {
    pointerX = event.clientX
    pointerY = event.clientY
    if (!frame) frame = window.requestAnimationFrame(apply)
  }

  const release = () => {
    window.cancelAnimationFrame(frame)
    frame = 0
    scope.style.removeProperty('--proximity-focus')
    foci.forEach((node) => node.style.removeProperty('--proximity-rule'))
  }

  scope.addEventListener('pointermove', onPointerMove)
  scope.addEventListener('pointerleave', release)

  return () => {
    scope.removeEventListener('pointermove', onPointerMove)
    scope.removeEventListener('pointerleave', release)
    release()
  }
}

/**
 * Bind one declared scope to the `[data-proximity-focus]` nodes it owns. A
 * focus inside a nested scope belongs to that scope, not to this one, so the
 * inner section keeps its own reach. A scope naming no foci binds nothing
 * rather than guessing at one.
 */
export function bindProximityScope(scope) {
  if (!scope) return () => {}

  const foci = [...scope.querySelectorAll('[data-proximity-focus]')]
    .filter((node) => node.closest('[data-proximity-scope]') === scope)

  return bindProximityFocus(scope, foci, proximityOptionsFrom(scope.dataset))
}

/**
 * Bind every scope under `root` that is ready on sight. A scope carrying
 * `data-proximity-when` is waiting on something the page knows about and this
 * pass cannot — the introduction's, for one, only starts answering the
 * pointer once its words have finished inking in — so whoever owns that
 * moment calls bindProximityScope itself. Returns one teardown for the lot.
 */
export function bindProximityScopes(root) {
  if (!root) return () => {}

  const teardowns = [...root.querySelectorAll('[data-proximity-scope]')]
    .filter((scope) => !('proximityWhen' in scope.dataset))
    .map(bindProximityScope)

  return () => teardowns.forEach((teardown) => teardown())
}

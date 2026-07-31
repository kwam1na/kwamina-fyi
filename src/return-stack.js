// Navigation memory for the article heroes' return link, which adapts to how
// the reader arrived: entering from the homepage points it back home, from the
// Athena story back there, and so on. Sources are kept as a stack so chains
// unwind in order — home → Athena → article returns to Athena, and Athena
// still returns home. Direct loads keep the page's authored default.
// Deliberately in-memory, like the saved scroll positions.

export const returnLabels = new Map([
  ['/', 'Homepage'],
  ['/about', 'About'],
  ['/work/athena', 'Athena'],
  ['/work/athena/local-first-pos', 'Local-first point of sale'],
  ['/work/athena/agent-ready-repository', 'Agent-ready repository'],
  ['/work/athena/read-optimized-reporting', 'Read-optimized reporting'],
])

export const returnStack = []

// Records one intercepted navigation, mutating the stack in place.
//
// A return-link click is never a departure. It is either a genuine return, in
// which case the destination is the recorded source and the stack unwinds, or
// it is the page's authored fallback — a destination the reader never actually
// arrived from. Recording that fallback would make the destination's own
// return link point back here, and the pair would then cycle forever without
// ever reaching the homepage. That is what happens to every reader who lands
// on an article from an external link, where the stack starts empty.
export function recordNavigation(stack, { from, to, viaReturnLink }) {
  if (stack[stack.length - 1] === to) stack.pop()
  else if (!viaReturnLink) stack.push(from)
  return stack
}

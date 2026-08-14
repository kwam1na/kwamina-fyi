import { normalisePath, ROUTE_PATHS } from "../routes.js";

const CHAT_PAGE_LABELS = new Map([
  [ROUTE_PATHS.home, "Kwamina"],
  [ROUTE_PATHS.about, "Kwamina"],
  [ROUTE_PATHS.athena, "Athena"],
  [ROUTE_PATHS.localFirstPos, "Local-first point of sale"],
  [ROUTE_PATHS.agentReadyRepository, "Agent-ready repository"],
  [ROUTE_PATHS.readOptimizedReporting, "Read-optimized reporting"],
  [ROUTE_PATHS.proseNotPolicy, "Prose, not policy"],
  [ROUTE_PATHS.validButNotThisTicket, "Valid, but not this ticket"],
]);

export function chatPageLabelForPath(path) {
  return CHAT_PAGE_LABELS.get(normalisePath(path)) ?? "Kwamina";
}

export function chatTitleForPath(path) {
  return `Ask about ${chatPageLabelForPath(path)}`;
}

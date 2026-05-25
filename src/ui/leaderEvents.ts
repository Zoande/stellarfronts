import type { LeaderAssignmentKind, LeaderClass } from "../data/Leaders";

export const OPEN_LEADERS_PANEL_EVENT = "stellarfronts:open-leaders-panel";

export interface LeaderAssignmentTarget {
  kind: LeaderAssignmentKind;
  targetId: string;
  label: string;
  requiredClass: LeaderClass;
}

export interface OpenLeadersPanelEventDetail {
  assignmentTarget?: LeaderAssignmentTarget;
}

export function requestOpenLeadersPanel(detail: OpenLeadersPanelEventDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenLeadersPanelEventDetail>(OPEN_LEADERS_PANEL_EVENT, { detail }));
}

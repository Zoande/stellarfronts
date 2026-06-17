import type { GameEffect, IndicatorSeverity } from "./GameEffects";
import { SHORTAGE_CRISIS_EVENT_ID } from "./Events";

export type SituationCategory = "economic" | "stability" | "anomaly" | "military";

export interface SituationThreshold {
  at: number; // progress 0-100 at which `effects` fire once (crossed upward)
  label?: string;
  effects: GameEffect[];
}

export interface SituationDefinition {
  id: string;
  title: string;
  /** Short glyph/initials shown on the notification strip icon. */
  icon: string;
  description: string;
  category: SituationCategory;
  severity: IndicatorSeverity;
  max: number;
  thresholds: SituationThreshold[];
}

/**
 * A live, escalating situation for one faction. `progress` ramps 0..max over
 * time based on server-computed factors; thresholds fire effects as it climbs.
 * Per-subject instances (e.g. one per shortage resource) share a `defId`.
 */
export interface ActiveSituation {
  id: string;
  defId: string;
  factionId: number;
  subject?: string;
  progress: number;
  startedAtYear: number;
  lastThreshold: number;
}

export const SHORTAGE_SITUATION_ID = "resourceShortage";

export const SITUATION_DEFINITIONS: Record<string, SituationDefinition> = {
  [SHORTAGE_SITUATION_ID]: {
    id: SHORTAGE_SITUATION_ID,
    title: "Resource Shortage",
    icon: "!",
    description: "A resource stockpile is exhausted while demand outstrips supply. Escalates while the deficit persists and recedes once production recovers.",
    category: "economic",
    severity: "warn",
    max: 100,
    thresholds: [
      { at: 100, label: "Crisis", effects: [{ type: "triggerEvent", eventId: SHORTAGE_CRISIS_EVENT_ID }] },
    ],
  },
};

export function getSituationDefinition(id: string): SituationDefinition | undefined {
  return SITUATION_DEFINITIONS[id];
}

/** Stable instance id for a per-subject situation (e.g. shortage of "food"). */
export function situationInstanceId(defId: string, factionId: number, subject?: string): string {
  return subject ? `${defId}:${subject}:${factionId}` : `${defId}:${factionId}`;
}

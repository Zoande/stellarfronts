import type { GameEffect } from "./GameEffects";

export type EventCategory =
  | "economic"
  | "military"
  | "diplomatic"
  | "anomaly"
  | "leader"
  | "crisis";

export interface EventChoice {
  id: string;
  label: string;
  tooltip?: string;
  effects: GameEffect[];
}

export interface EventDefinition {
  id: string;
  category: EventCategory;
  title: string;
  /** Body text; may contain {token} placeholders resolved from event context. */
  body: string;
  imageUrl?: string;
  /**
   * Relative weight for the rare random-event roll. 0 = never rolled randomly
   * (only fired explicitly by code or a situation threshold).
   */
  weight: number;
  /** Game-days before the event auto-resolves with `defaultChoiceId`. */
  timeoutDays: number;
  defaultChoiceId: string;
  choices: EventChoice[];
}

/**
 * A live event awaiting a decision (or auto-resolution) for one faction.
 * Held per-faction in game state and delivered to that faction's client.
 */
export interface ActiveEvent {
  id: string;
  defId: string;
  factionId: number;
  createdAtYear: number;
  expiresAtYear: number;
  /** Resolved title/body with context tokens substituted, for display. */
  title: string;
  body: string;
  category: EventCategory;
  imageUrl?: string;
  choices: EventChoice[];
  defaultChoiceId: string;
  /** Free-form context (e.g. fleetId, generated leader) used when resolving. */
  context?: Record<string, unknown>;
}

export const LEADER_OFFER_EVENT_ID = "leaderRecruitmentOffer";
export const LOST_IN_TRANSIT_EVENT_ID = "lostInTransit";
export const SHORTAGE_CRISIS_EVENT_ID = "resourceShortageCrisis";

export const EVENT_DEFINITIONS: Record<string, EventDefinition> = {
  [LEADER_OFFER_EVENT_ID]: {
    id: LEADER_OFFER_EVENT_ID,
    category: "leader",
    title: "An Offer of Service",
    body: "A renowned {leaderClass} leader, {leaderName}, has heard of your ascendant nation and offers to serve your cause. Talent of this caliber rarely comes unbidden.",
    weight: 1.4,
    timeoutDays: 200,
    defaultChoiceId: "decline",
    choices: [
      {
        id: "accept",
        label: "Welcome them aboard",
        tooltip: "Recruit this powerful leader for free.",
        effects: [{ type: "spawnLeader" }],
      },
      {
        id: "decline",
        label: "Politely decline",
        effects: [],
      },
    ],
  },
  [LOST_IN_TRANSIT_EVENT_ID]: {
    id: LOST_IN_TRANSIT_EVENT_ID,
    category: "anomaly",
    title: "Lost in Transit",
    body: "Fleet {fleetName} failed to emerge from its hyperlane jump on schedule. Navigation reports a subspace anomaly; the fleet is missing and presumed adrift. It may yet re-emerge.",
    weight: 0,
    timeoutDays: 60,
    defaultChoiceId: "acknowledge",
    choices: [
      { id: "acknowledge", label: "Maintain the search", effects: [] },
    ],
  },
  [SHORTAGE_CRISIS_EVENT_ID]: {
    id: SHORTAGE_CRISIS_EVENT_ID,
    category: "crisis",
    title: "Shortage Crisis",
    body: "The chronic lack of {resource} has reached a breaking point. Unrest spreads across your worlds as basic needs go unmet.",
    weight: 0,
    timeoutDays: 120,
    defaultChoiceId: "endure",
    choices: [
      { id: "endure", label: "Endure the hardship", effects: [] },
    ],
  },
};

export function getEventDefinition(id: string): EventDefinition | undefined {
  return EVENT_DEFINITIONS[id];
}

/** Event definitions eligible for the rare random roll (weight > 0). */
export const RANDOM_EVENT_DEFINITIONS: EventDefinition[] = Object.values(EVENT_DEFINITIONS)
  .filter((definition) => definition.weight > 0);

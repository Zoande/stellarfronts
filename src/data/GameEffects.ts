import type { PlanetModifier, ResourceKind } from "./Economy";
import type { LeaderClass } from "./Leaders";

/**
 * The typed consequence backbone shared by events and situations.
 *
 * Both event choices and situation thresholds emit `GameEffect[]`, and the
 * server applies them through a single `applyGameEffects` function. Adding new
 * kinds of consequence is the main extension point for future content — add a
 * member here and a case in the server applier.
 */
export type GameEffect =
  | { type: "addResource"; resource: ResourceKind; amount: number }
  | { type: "factionModifier"; id: string; label: string; modifiers: PlanetModifier[]; durationDays?: number }
  | { type: "clearFactionModifier"; id: string }
  | { type: "triggerEvent"; eventId: string }
  | { type: "spawnLeader"; leaderClass?: LeaderClass; bonusLevel?: number }
  | { type: "fleetMissing"; fleetId: string; days: number }
  | { type: "adjustSituation"; situationId: string; delta: number }
  | { type: "notify"; message: string; severity?: IndicatorSeverity }
  /** Randomly removes `fraction` (0–1) of the faction's ships and cleans up fleet rosters. */
  | { type: "disbandShipsFraction"; fraction: number }
  /** Removes the situation that fired this effect, identified via event context.situationId. */
  | { type: "clearContextSituation" };

export type IndicatorSeverity = "info" | "warn" | "crisis";

/** A time-limited, faction-wide modifier package added by events/situations. */
export interface FactionModifierState {
  id: string;
  factionId: number;
  label: string;
  source: string;
  modifiers: PlanetModifier[];
  /** Game-year at which this expires; null = persists until cleared. */
  expiresAtYear: number | null;
}

import type { GameSnapshot, FleetManagerDetailPayload, PlanetManagerDetailPayload, MarketDetailPayload, SocietyDetailPayload, DiplomacyDetailPayload } from "../../src/game/GameProtocol";
import type { RuntimeContext } from "./types";
import { createSnapshot } from "./snapshot";
import { createDetailPayload } from "./detail-payloads";
import { getFleetLeaderEffects, getGovernmentFleetEffects } from "./state-queries";

export interface AiObservation {
  readonly factionId: number;
  readonly snapshot: GameSnapshot;
  readonly planets: PlanetManagerDetailPayload;
  readonly fleets: FleetManagerDetailPayload;
  readonly market: MarketDetailPayload;
  readonly society: SocietyDetailPayload;
  readonly diplomacy: DiplomacyDetailPayload;
  /** Owner accounting, derived from the country's government and fleet leaders. */
  readonly fleetUpkeepMultipliers: Readonly<Record<string, number>>;
  readonly newShipUpkeepMultiplier: number;
}

export function freezeObservation<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeObservation(child);
    Object.freeze(value);
  }
  return value;
}

/** Uses exactly the faction views and detail access available to a human client. */
export function createAiObservation(ctx: RuntimeContext, factionId: number): AiObservation {
  if (!ctx.state.factions.some((f) => f.id === factionId)) throw new Error("Country not found.");
  const perspective = { mode: "faction" as const, factionId };
  function detail<T>(scope: "planetManager" | "fleetManager" | "market" | "society" | "diplomacy"): T {
    const result = createDetailPayload(ctx, perspective, scope, null);
    if ("error" in result) throw new Error(result.error);
    return result.payload as T;
  }
  const fleets = detail<FleetManagerDetailPayload>("fleetManager");
  const fleetUpkeepMultipliers: Record<string, number> = {};
  const newShipUpkeepMultiplier = getGovernmentFleetEffects(ctx.state, factionId).upkeepMultiplier;
  for (const fleet of fleets.fleets) {
    if (fleet.ownerId === factionId) fleetUpkeepMultipliers[fleet.id] = newShipUpkeepMultiplier * getFleetLeaderEffects(ctx.state, fleet.id).upkeepMultiplier;
  }
  return freezeObservation(structuredClone({
    factionId, snapshot: createSnapshot(ctx, perspective), fleetUpkeepMultipliers, newShipUpkeepMultiplier,
    planets: detail<PlanetManagerDetailPayload>("planetManager"), fleets,
    market: detail<MarketDetailPayload>("market"), society: detail<SocietyDetailPayload>("society"),
    diplomacy: detail<DiplomacyDetailPayload>("diplomacy"),
  }));
}

import type { GameSnapshot, FleetManagerDetailPayload, PlanetManagerDetailPayload, MarketDetailPayload, SocietyDetailPayload, DiplomacyDetailPayload } from "../../src/game/GameProtocol";
import type { RuntimeContext } from "./types";
import { createSnapshot } from "./snapshot";
import { createDetailPayload } from "./detail-payloads";
import { hasCommandLink } from "./intelligence";

export interface AiObservation {
  readonly factionId: number;
  readonly snapshot: GameSnapshot;
  readonly planets: PlanetManagerDetailPayload;
  readonly fleets: FleetManagerDetailPayload;
  readonly market: MarketDetailPayload;
  readonly society: SocietyDetailPayload;
  readonly diplomacy: DiplomacyDetailPayload;
  readonly commandLinks: Readonly<Record<string, boolean>>;
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
  const commandLinks: Record<string, boolean> = {};
  for (const fleet of fleets.fleets) {
    if (fleet.ownerId === factionId) commandLinks[fleet.id] = hasCommandLink(ctx.state, factionId, fleet.currentStarId);
  }
  return freezeObservation(structuredClone({
    factionId, snapshot: createSnapshot(ctx, perspective), commandLinks,
    planets: detail<PlanetManagerDetailPayload>("planetManager"), fleets,
    market: detail<MarketDetailPayload>("market"), society: detail<SocietyDetailPayload>("society"),
    diplomacy: detail<DiplomacyDetailPayload>("diplomacy"),
  }));
}

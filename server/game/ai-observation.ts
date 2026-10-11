import type { GameSnapshot, FleetManagerDetailPayload, PlanetManagerDetailPayload, MarketDetailPayload, SocietyDetailPayload, DiplomacyDetailPayload } from "../../src/game/GameProtocol";
import type { RuntimeContext } from "./types";
import { createSnapshot } from "./snapshot";
import { createDetailPayload } from "./detail-payloads";
import { getFleetLeaderEffects, getGovernmentFleetEffects } from "./state-queries";
import { withIntelViewAssembly } from "./intelligence";

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
export function createAiObservation(ctx: RuntimeContext, factionId: number, options: { disableViewCache?: boolean; fullMetadata?: boolean } = {}): AiObservation {
  return freezeObservation(options.disableViewCache ? structuredClone(buildAiObservation(ctx, factionId, options.fullMetadata ?? false))
    : withIntelViewAssembly(ctx.state, () => buildAiObservation(ctx, factionId, options.fullMetadata ?? false), !options.fullMetadata));
}

function buildAiObservation(ctx: RuntimeContext, factionId: number, fullMetadata: boolean): AiObservation {
  if (!ctx.state.factions.some((f) => f.id === factionId)) throw new Error("Country not found.");
  const perspective = { mode: "faction" as const, factionId };
  function detail<T>(scope: "planetManager" | "fleetManager" | "market" | "society" | "diplomacy"): T {
    const result = createDetailPayload(ctx, perspective, scope, null, { skipRevision: true });
    if ("error" in result) throw new Error(result.error);
    return result.payload as T;
  }
  const fleets = detail<FleetManagerDetailPayload>("fleetManager");
  const fleetUpkeepMultipliers: Record<string, number> = {};
  const newShipUpkeepMultiplier = getGovernmentFleetEffects(ctx.state, factionId).upkeepMultiplier;
  for (const fleet of fleets.fleets) {
    if (fleet.ownerId === factionId) fleetUpkeepMultipliers[fleet.id] = newShipUpkeepMultiplier * getFleetLeaderEffects(ctx.state, fleet.id).upkeepMultiplier;
  }
  const result: AiObservation = {
    factionId, snapshot: createSnapshot(ctx, perspective, fullMetadata ? undefined : new Set(["fleet", "ship", "starbase", "planet"])), fleetUpkeepMultipliers, newShipUpkeepMultiplier,
    planets: detail<PlanetManagerDetailPayload>("planetManager"), fleets,
    market: detail<MarketDetailPayload>("market"), society: detail<SocietyDetailPayload>("society"),
    diplomacy: detail<DiplomacyDetailPayload>("diplomacy"),
  };
  if (!fullMetadata) {
    // The materialized player views contain gameplay values. Keep only the
    // freshness metadata controllers use; omit expensive UI field tooltips.
    for (const entity of result.snapshot.intelligence.entities) {
      const fields = entity.kind === "planet" ? ["existence", "ownerId", "starId", "isHabited", "type", "features", "habitability", "buildings", "urbanSubDistricts"]
        : ["existence", "ownerId", "currentStarId"];
      entity.fields = Object.fromEntries(fields.flatMap((key) => entity.fields[key] ? [[key, entity.fields[key]]] : []));
    }
    delete result.snapshot.intelligence.sensorDebug;
  }
  return result;
}

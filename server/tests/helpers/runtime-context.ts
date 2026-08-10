import type { RuntimeContext } from "../../game/types";

export function minimalRuntimeContext(statePath: string, gameId = "testgame"): RuntimeContext {
  return {
    game: {
      id: gameId,
      name: "Test Game",
      seed: 1,
      countryCapacity: 1,
      createdAt: Date.now(),
      versionId: "dev",
      status: "active",
      schemaVersion: 30,
      protocolVersion: 11,
    },
    statePath,
    state: {} as RuntimeContext["state"],
    clients: new Set(),
    pendingPlanetDetailRefreshes: new Set(),
    hasDirtyState: false,
    lastSaveAt: 0,
    saveInFlight: null,
    saveQueued: false,
    ownershipToken: null,
  } as unknown as RuntimeContext;
}

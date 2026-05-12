import { SceneManager } from "@/SceneManager";
import { GalaxyScene } from "@/scenes/GalaxyScene";
import { SystemScene } from "@/scenes/SystemScene";
import type { IGameScene } from "@/SceneManager";
import { applyPlanetStatesToStars } from "@/data/StarMap";
import type { PlanetConfig, StarData } from "@/data/StarMap";
import type { PlanetState } from "@/data/Economy";
import type { GalaxySceneOptions, GalaxyViewState } from "@/scenes/GalaxyScene";
import { buildHyperlaneAdjacency } from "@/data/Hyperlanes";
import { HudOverlay } from "@/ui/HudOverlay";
import type { HudConnectedSystem, HudSidebarItemKey, HudVisualToggles } from "@/ui/HudOverlay";
import { FleetManagerPanel } from "@/ui/FleetManagerPanel";
import { GameServerClient } from "./GameServerClient";
import type { ClientCommand, GameSnapshot, ServerFleet, ServerUpdateField } from "./GameProtocol";

export interface BootOptions {
  onProgress?: (progress: number, detail: string) => void;
}

export async function boot(container: HTMLDivElement, options: BootOptions = {}): Promise<() => void> {
  const canvas = container.querySelector("#renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas not found in container");

  const reportProgress = (progress: number, detail: string) => {
    options.onProgress?.(progress, detail);
  };

  reportProgress(0.08, "Connecting to game server");
  const server = new GameServerClient();
  let snapshot = await server.connect();
  applyPlanetStatesToStars(snapshot.stars, snapshot.planetStates);

  reportProgress(0.28, "Receiving authoritative galaxy state");

  const mgr = new SceneManager();
  const engine = await mgr.initEngine(canvas);
  let isSwitching = false;
  let activeGalaxyScene: GalaxyScene | null = null;
  let activeSystemScene: SystemScene | null = null;
  let cachedGalaxyStars: StarData[] | null = snapshot.stars;
  let cachedGalaxyViewState: GalaxyViewState | null = null;
  let cachedHyperlanePairs: Array<[number, number]> = snapshot.hyperlanes;
  let cachedHyperlaneAdjacency: number[][] = buildHyperlaneAdjacency(snapshot.hyperlanes, snapshot.stars.length);
  let currentSystemStar: StarData | null = null;
  let hud: HudOverlay | null = null;
  let fleetManagerPanel: FleetManagerPanel | null = null;

  const visualToggles: HudVisualToggles = {
    hyperlanes: true,
    bloom: true,
    centerCloud: true,
    stars: true,
    ownership: true,
  };

  const resolveRoutingStars = (): StarData[] => cachedGalaxyStars ?? snapshot.stars;

  const getVisibleStarSet = (): Set<number> | null => (
    snapshot.visibleStarIds ? new Set(snapshot.visibleStarIds) : null
  );
  const getKnownStarSet = (): Set<number> | null => (
    snapshot.knownStarIds ? new Set(snapshot.knownStarIds) : null
  );

  const getFactionHomeStarIds = (): number[] => snapshot.factions.map((faction) => faction.homeStarId);
  const getStarbaseSystemIds = (): number[] => snapshot.starbases.map((starbase) => starbase.starId);
  const getPromotedStarbaseSystemIds = (): number[] => (
    snapshot.starbases
      .filter((starbase) => starbase.status === "online" && starbase.level !== "outpost")
      .map((starbase) => starbase.starId)
  );
  const getFleetSystemIds = (): number[] => snapshot.fleets.map((fleet) => fleet.currentStarId);
  const expandStarOwnership = (): number[] => {
    const ownerByStar = new Array<number>(snapshot.stars.length).fill(-1);
    for (const [starId, ownerId] of snapshot.starOwnership) {
      if (starId >= 0 && starId < ownerByStar.length) ownerByStar[starId] = ownerId;
    }
    return ownerByStar;
  };
  const getCurrentFactionEconomy = () => (
    (() => {
      const perspectiveFactionId = snapshot.perspective.mode === "faction" ? snapshot.perspective.factionId : null;
      if (perspectiveFactionId === null) return null;
      return snapshot.factionEconomies.find((economy) => economy.factionId === perspectiveFactionId) ?? null;
    })()
  );
  const getPlayerFactionId = (): number | null => (
    snapshot.perspective.mode === "faction" ? snapshot.perspective.factionId : null
  );
  const getFleetManagerData = () => ({
    fleets: snapshot.fleets,
    ships: snapshot.ships,
    starbases: snapshot.starbases,
    stars: snapshot.stars,
    factions: snapshot.factions,
    playerFactionId: getPlayerFactionId(),
    onFleetCommand: (command: ClientCommand) => server.send(command),
  });
  const openFleetManager = (): void => {
    if (!fleetManagerPanel) {
      fleetManagerPanel = new FleetManagerPanel();
    }
    fleetManagerPanel.show(getFleetManagerData());
  };
  const refreshFleetManager = (): void => {
    fleetManagerPanel?.refresh(getFleetManagerData());
  };
  const handleSidebarItem = (key: HudSidebarItemKey): void => {
    if (key === "fleets") {
      openFleetManager();
    }
  };

  const gameDaysPerYear = 360;
  const systemCenterPosition = () => ({ x: 23, y: 4.8, z: -19 });
  const systemExitPosition = () => ({ x: 42, y: 4.8, z: -28 });
  const systemEntryPosition = () => ({ x: -42, y: 4.8, z: 28 });
  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
  const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);
  const interpolateSystemPosition = (
    from: ReturnType<typeof systemCenterPosition>,
    to: ReturnType<typeof systemCenterPosition>,
    progress: number,
  ) => ({
    x: mix(from.x, to.x, progress),
    y: mix(from.y, to.y, progress),
    z: mix(from.z, to.z, progress),
  });

  const getFleetPhaseProgress = (fleet: ServerFleet): number => {
    if (fleet.phase === "idle" || fleet.phaseDurationDays <= 0) return 0;
    const elapsedDays = (snapshot.clock.year - fleet.phaseStartedAtYear) * gameDaysPerYear;
    return clamp01(elapsedDays / fleet.phaseDurationDays);
  };

  const getFleetHyperlanePosition = (fleet: ServerFleet) => {
    if (fleet.phase !== "jumpingHyperlane") return null;
    const fromStarId = fleet.route[fleet.routeIndex];
    const toStarId = fleet.route[fleet.routeIndex + 1];
    if (fromStarId === undefined || toStarId === undefined) return null;
    return {
      fromStarId,
      toStarId,
      progress: getFleetPhaseProgress(fleet),
    };
  };

  const getPrimaryFleetStarId = (): number => {
    const perspectiveFactionId = snapshot.perspective.mode === "faction" ? snapshot.perspective.factionId : null;
    if (perspectiveFactionId !== null) {
      const ownFleet = snapshot.fleets.find((fleet) => fleet.ownerId === perspectiveFactionId);
      if (ownFleet) return ownFleet.currentStarId;
    }
    return snapshot.fleets[0]?.currentStarId ?? -1;
  };

  const getPrimaryTransit = () => {
    const perspectiveFactionId = snapshot.perspective.mode === "faction" ? snapshot.perspective.factionId : null;
    const fleets = perspectiveFactionId === null
      ? snapshot.fleets
      : [
        ...snapshot.fleets.filter((fleet) => fleet.ownerId === perspectiveFactionId),
        ...snapshot.fleets.filter((fleet) => fleet.ownerId !== perspectiveFactionId),
      ];
    for (const fleet of fleets) {
      const transit = getFleetHyperlanePosition(fleet);
      if (transit) return transit;
    }
    return null;
  };

  const getFleetSystemPosition = (fleet: ServerFleet): { x: number; y: number; z: number } => {
    const progress = getFleetPhaseProgress(fleet);
    if (fleet.phase === "departingSystem") {
      return interpolateSystemPosition(systemCenterPosition(), systemExitPosition(), progress);
    }
    if (fleet.phase === "arrivingSystem") {
      return interpolateSystemPosition(systemEntryPosition(), systemCenterPosition(), progress);
    }
    return systemCenterPosition();
  };

  const getFleetSystemPositions = (): Record<number, { x: number; y: number; z: number }> => (
    Object.fromEntries(snapshot.fleets
      .filter((fleet) => fleet.phase !== "jumpingHyperlane")
      .map((fleet) => [fleet.currentStarId, getFleetSystemPosition(fleet)]))
  );

  const hyperlaneListsEqual = (a: Array<[number, number]>, b: Array<[number, number]>): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
    }
    return true;
  };

  const mergePlanetStates = (existing: PlanetState[], incoming: PlanetState[]): PlanetState[] => {
    const byId = new Map(existing.map((planetState) => [planetState.id, planetState]));
    for (const planetState of incoming) byId.set(planetState.id, planetState);
    return Array.from(byId.values());
  };

  const cacheSystemDetails = (star: StarData, planetStates: PlanetState[]): void => {
    const stars = snapshot.stars.slice();
    stars[star.id] = star;
    const mergedPlanetStates = mergePlanetStates(snapshot.planetStates, planetStates);
    applyPlanetStatesToStars([star], planetStates);
    snapshot = {
      ...snapshot,
      stars,
      planetStates: mergedPlanetStates,
    };
    cachedGalaxyStars = stars;
    if (currentSystemStar?.id === star.id) {
      currentSystemStar = star;
    }
  };

  const cachePlanetDetails = (starId: number, planet: PlanetConfig, planetState: PlanetState): StarData | null => {
    const star = snapshot.stars[starId];
    if (!star) return null;
    const planets = star.system.planets.slice();
    planets[planetState.planetIndex] = planet;
    const nextStar = {
      ...star,
      system: { planets },
    };
    cacheSystemDetails(nextStar, [planetState]);
    return nextStar;
  };

  const getConnectedSystems = (sourceStarId: number): HudConnectedSystem[] => {
    const stars = resolveRoutingStars();
    const known = getKnownStarSet();
    const sourceIndex = stars.findIndex((s) => s.id === sourceStarId);
    if (sourceIndex < 0 || sourceIndex >= cachedHyperlaneAdjacency.length) return [];

    return (cachedHyperlaneAdjacency[sourceIndex] ?? [])
      .map((neighborId) => stars[neighborId])
      .filter((star): star is StarData => !!star && (!known || known.has(star.id)))
      .map((star) => ({ id: star.id, name: star.name }));
  };

  const applyVisualToggles = (): void => {
    if (activeGalaxyScene) {
      activeGalaxyScene.setHyperlanesVisible(visualToggles.hyperlanes);
      activeGalaxyScene.setBloomEnabled(visualToggles.bloom);
      activeGalaxyScene.setCenterCloudVisible(visualToggles.centerCloud);
      activeGalaxyScene.setStarsVisible(visualToggles.stars);
      activeGalaxyScene.setOwnershipVisible(visualToggles.ownership);
    }

    if (activeSystemScene) {
      activeSystemScene.setFleetSystemPositions(getFleetSystemPositions());
    }

    if (activeSystemScene) {
      activeSystemScene.setBloomEnabled(visualToggles.bloom);
      activeSystemScene.setStarsVisible(visualToggles.stars);
    }
  };

  function updateHud(): void {
    if (!hud) return;
    const connectedSystems = currentSystemStar ? getConnectedSystems(currentSystemStar.id) : [];
    hud.update({
      title: currentSystemStar ? `${currentSystemStar.name} System` : "Galaxy Map",
      canExitSystem: currentSystemStar !== null,
      connectedSystems,
      toggles: visualToggles,
      clock: snapshot.clock,
      economy: getCurrentFactionEconomy(),
    });
  }

  function sendPlanetCommand(command: ClientCommand): void {
    server.send(command);
    if (
      command.type !== "buildDistrict"
      && command.type !== "buildPlanetBuilding"
      && command.type !== "setUrbanSubDistrict"
    ) {
      return;
    }
    window.setTimeout(() => {
      void server.requestPlanetDetails(command.planetId).catch(() => undefined);
    }, 50);
  }

  function applySnapshotToActiveScene(changed?: ServerUpdateField[]): void {
    const isFull = !changed;
    const has = (field: ServerUpdateField): boolean => isFull || changed.includes(field);

    if (isFull || has("planetStates")) {
      applyPlanetStatesToStars(snapshot.stars, snapshot.planetStates);
    }
    cachedGalaxyStars = snapshot.stars;
    if ((isFull || has("visibility")) && !hyperlaneListsEqual(snapshot.hyperlanes, cachedHyperlanePairs)) {
      cachedHyperlanePairs = snapshot.hyperlanes;
      cachedHyperlaneAdjacency = buildHyperlaneAdjacency(snapshot.hyperlanes, snapshot.stars.length);
    }

    if (activeGalaxyScene) {
      if (isFull || has("battles") || has("visibility")) {
        activeGalaxyScene.setBattles(snapshot.battles);
      }
      if (isFull || has("visibility")) {
        activeGalaxyScene.setVisibleStarIds(snapshot.visibleStarIds);
        activeGalaxyScene.setKnownStarIds(snapshot.knownStarIds);
        activeGalaxyScene.setStarOwnerships(expandStarOwnership());
      }
      if (isFull || has("visibility") || has("habitedPlanetSystems")) {
        activeGalaxyScene.setHabitedPlanetSystemIds(snapshot.habitedPlanetSystemIds);
      }
      if (isFull || has("starbases")) {
        activeGalaxyScene.setStarbaseSystemIds(getStarbaseSystemIds());
        activeGalaxyScene.setPromotedStarbaseSystemIds(getPromotedStarbaseSystemIds());
        activeGalaxyScene.setServerStarbases(snapshot.starbases);
      }
      if (isFull || has("ships")) {
        activeGalaxyScene.setServerShips(snapshot.ships);
      }
      if (isFull || has("fleets")) {
        activeGalaxyScene.setServerFleets(snapshot.fleets);
      }
      if (isFull || has("planetStates")) {
        activeGalaxyScene.setPlanetStates(snapshot.planetStates);
      }
      activeGalaxyScene.setPlayerShipState(
        getPrimaryFleetStarId(),
        getPrimaryTransit(),
      );
    }

    if (activeSystemScene) {
      if (isFull || has("battles") || has("visibility")) {
        activeSystemScene.setBattles(snapshot.battles);
      }
      if (isFull || has("clock") || has("fleets")) {
        activeSystemScene.setFleetSystemPositions(getFleetSystemPositions());
        activeSystemScene.setServerFleets(snapshot.fleets);
      }
      if (isFull || has("ships")) {
        activeSystemScene.setServerShips(snapshot.ships);
      }
      if (isFull || has("starbases")) {
        activeSystemScene.setStarbaseSystemIds(getStarbaseSystemIds());
        activeSystemScene.setServerStarbases(snapshot.starbases);
      }
      if (isFull || has("planetStates")) {
        activeSystemScene.setPlanetStates(snapshot.planetStates);
      }
    }

    updateHud();
    refreshFleetManager();
  }

  async function switchScene(factory: () => IGameScene): Promise<void> {
    if (isSwitching) return;
    isSwitching = true;
    try {
      await mgr.startScene(factory());
    } finally {
      isSwitching = false;
    }
  }

  async function openGalaxyView(): Promise<void> {
    reportProgress(0.58, "Loading galaxy scene");
    applyPlanetStatesToStars(snapshot.stars, snapshot.planetStates);

    const optionsForGalaxy: GalaxySceneOptions = {
      stars: snapshot.stars,
      factions: snapshot.factions,
      perspective: snapshot.perspective,
      playerFactionId: snapshot.perspective.mode === "faction" ? snapshot.perspective.factionId : 0,
      playerShipStarId: getPrimaryFleetStarId(),
      playerShipTransit: getPrimaryTransit(),
      playerShipSystemIds: getFleetSystemIds(),
      serverFleets: snapshot.fleets,
      serverShips: snapshot.ships,
      battles: snapshot.battles,
      starbaseSystemIds: getStarbaseSystemIds(),
      promotedStarbaseSystemIds: getPromotedStarbaseSystemIds(),
      starbases: snapshot.starbases,
      starOwnership: expandStarOwnership(),
      visibleStarIds: snapshot.visibleStarIds,
      knownStarIds: snapshot.knownStarIds,
          planetStates: snapshot.planetStates,
          habitedPlanetSystemIds: snapshot.habitedPlanetSystemIds,
      onShipCommand: (action, targetStarId, fleetId) => {
        if (!fleetId) return;
        if (action === "move") {
          server.send({ type: "moveFleet", fleetId, targetStarId });
        } else if (action === "build") {
          server.send({ type: "buildStarbase", fleetId, targetStarId });
        }
      },
      onFleetCommand: (command) => server.send(command),
      onPlanetCommand: sendPlanetCommand,
      onOpenHabitedPlanet: (starId) => openFirstHabitedPlanetFromGalaxy(starId),
    };

    if (cachedGalaxyViewState) {
      optionsForGalaxy.initialViewState = cachedGalaxyViewState;
    }

    await switchScene(() => {
      const galaxy = new GalaxyScene(engine, (star) => openSystemView(star), optionsForGalaxy);
      activeGalaxyScene = galaxy;
      activeSystemScene = null;
      currentSystemStar = null;
      return galaxy;
    });

    applyVisualToggles();
    updateHud();
    reportProgress(1, "Galaxy command is ready");
  }

  async function openSystemView(star: StarData): Promise<void> {
    const details = await server.requestSystemDetails(star.id);
    cacheSystemDetails(details.star, details.planetStates);
    const systemStar = details.star;

    if (activeGalaxyScene) {
      cachedGalaxyViewState = activeGalaxyScene.captureViewState();
      activeGalaxyScene = null;
    }

    await switchScene(() => {
      const system = new SystemScene(
        engine,
        systemStar,
        () => openGalaxyView(),
        snapshot.stars.length,
        {
          homeSystemStarIds: getFactionHomeStarIds(),
          playerShipSystemIds: getFleetSystemIds(),
          serverFleets: snapshot.fleets,
          serverShips: snapshot.ships,
          battles: snapshot.battles,
          starbaseSystemIds: getStarbaseSystemIds(),
          starbases: snapshot.starbases,
          factions: snapshot.factions,
          playerFactionId: snapshot.perspective.mode === "faction" ? snapshot.perspective.factionId : 0,
          playerShipStarId: getPrimaryFleetStarId(),
          shipTransit: getPrimaryTransit(),
          fleetSystemPositions: getFleetSystemPositions(),
          planetStates: details.planetStates,
          onPlanetCommand: sendPlanetCommand,
          onFleetCommand: (command) => server.send(command),
          onRequestPlanetDetails: async (planetId) => {
            const planetDetails = await server.requestPlanetDetails(planetId);
            cachePlanetDetails(planetDetails.starId, planetDetails.planet, planetDetails.planetState);
            return {
              planet: planetDetails.planet,
              planetState: planetDetails.planetState,
            };
          },
        },
      );
      activeSystemScene = system;
      currentSystemStar = systemStar;
      return system;
    });

    applyVisualToggles();
    updateHud();
  }

  async function openFirstHabitedPlanetFromGalaxy(starId: number): Promise<void> {
    const systemDetails = await server.requestSystemDetails(starId);
    cacheSystemDetails(systemDetails.star, systemDetails.planetStates);
    const habitedState = systemDetails.planetStates.find((planetState) => planetState.isHabited);
    if (!habitedState) return;
    const planetDetails = await server.requestPlanetDetails(habitedState.id);
    const star = cachePlanetDetails(planetDetails.starId, planetDetails.planet, planetDetails.planetState)
      ?? systemDetails.star;
    activeGalaxyScene?.showPlanetDetails(star, planetDetails.planet, planetDetails.planetState);
  }

  hud = new HudOverlay({
    onExitSystem: () => {
      if (!currentSystemStar) return;
      void openGalaxyView();
    },
    onNavigateConnectedSystem: (targetId) => {
      if (!currentSystemStar) return;
      const target = resolveRoutingStars().find((star) => star.id === targetId);
      if (!target) return;
      void openSystemView(target);
    },
    onToggleVisual: (key, enabled) => {
      visualToggles[key] = enabled;
      applyVisualToggles();
      updateHud();
    },
    onSidebarItem: handleSidebarItem,
  });

  const handleKeyDown = (ev: KeyboardEvent) => {
    const speedByKey: Record<string, number> = {
      "1": 1,
      "2": 2,
      "3": 3,
      "4": 4,
      "5": 5,
      "6": 50,
      "7": 100,
      "8": 200,
      "9": 500,
    };
    const multiplier = speedByKey[ev.key];
    if (!multiplier) return;
    server.send({ type: "setSpeedMultiplier", multiplier });
  };

  server.onSnapshot((nextSnapshot, changed) => {
    snapshot = nextSnapshot;
    if (!changed || changed.includes("planetStates")) {
      applyPlanetStatesToStars(snapshot.stars, snapshot.planetStates);
    }
    applySnapshotToActiveScene(changed);
  });

  server.onPlanetDetails((details) => {
    const star = cachePlanetDetails(details.starId, details.planet, details.planetState);
    if (!star) return;
    if (activeSystemScene && currentSystemStar?.id === details.starId) {
      activeSystemScene.refreshPlanetDetails(details.planet, details.planetState);
    }
    activeGalaxyScene?.refreshPlanetDetails(details.planet, details.planetState);
    updateHud();
  });

  window.addEventListener("keydown", handleKeyDown);

  reportProgress(0.5, "Starting galaxy command sequence");
  applyPlanetStatesToStars(snapshot.stars, snapshot.planetStates);
  await openGalaxyView();

  console.log("StellarFronts game running");

  return () => {
    window.removeEventListener("keydown", handleKeyDown);
    hud?.dispose();
    fleetManagerPanel?.dispose();
    server.dispose();
    mgr.dispose();
  };
}

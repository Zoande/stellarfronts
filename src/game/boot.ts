import { SceneManager } from "@/SceneManager";
import { GalaxyScene } from "@/scenes/GalaxyScene";
import { SystemScene } from "@/scenes/SystemScene";
import type { IGameScene } from "@/SceneManager";
import { applyPlanetStatesToStars } from "@/data/StarMap";
import type { PlanetConfig, StarData } from "@/data/StarMap";
import {
  getHyperlaneDirection,
  getHyperlaneExitSystemPosition,
  getPlanetSystemPosition,
  getSystemFleetStagingPosition,
  getSystemHyperlaneEntryPosition,
  getSystemHyperlaneExitPosition,
  getSystemOrbitLayout,
  DEFAULT_ORBIT_EPOCH_MS,
  SYSTEM_FLEET_Y,
  interpolateSystemPosition,
} from "@/data/SystemCoordinates";
import type { PlanetState } from "@/data/Economy";
import type { GalaxySceneOptions, GalaxyViewState } from "@/scenes/GalaxyScene";
import { buildHyperlaneAdjacency } from "@/data/Hyperlanes";
import { HudOverlay } from "@/ui/HudOverlay";
import type { HudConnectedSystem, HudSidebarItemKey, HudVisualToggles } from "@/ui/HudOverlay";
import { FleetManagerPanel } from "@/ui/FleetManagerPanel";
import { AdminCommandPanel } from "@/ui/AdminCommandPanel";
import { GameServerClient } from "./GameServerClient";
import type { ClientCommand, GameSnapshot, ServerFleet, ServerUpdateField } from "./GameProtocol";
import { isLocalAdminCommand, parseAdminCommand } from "./AdminCommands";
import type { AdminCommandContext, AdminCommandResult } from "./AdminCommands";
import { GAME_DAYS_PER_YEAR, GAME_START_YEAR, REAL_MS_PER_GAME_DAY, estimateClockYear } from "./GameTime";
import type { HyperlaneExitPoint, ShipAction } from "./GameplayTypes";

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
  let adminCommandPanel: AdminCommandPanel | null = null;
  let selectedFleetIds = new Set<string>();

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
  const createAdminContext = (): AdminCommandContext => ({
    currentStarId: currentSystemStar?.id ?? null,
    selectedFleetId: selectedFleetIds.values().next().value ?? null,
    selectedFleetIds: Array.from(selectedFleetIds),
    perspectiveOwnerId: getPlayerFactionId(),
  });
  const adminResult = (input: string, ok: boolean, message: string, rows?: AdminCommandResult["rows"]): AdminCommandResult => ({
    type: "adminCommandResult",
    ok,
    input,
    message,
    rows,
  });
  const executeLocalAdminCommand = async (input: string): Promise<AdminCommandResult> => {
    const parsed = parseAdminCommand(input);
    if (!parsed) return adminResult(input, false, "Enter an admin command.");
    const args = parsed.args;
    const currentContext = createAdminContext();
    const resolveSystemId = (token?: string): number => {
      const value = token ?? "current";
      if (value === "current" || value === "selected") return currentContext.currentStarId ?? snapshot.factions[0]?.homeStarId ?? 0;
      const id = Number(value);
      if (!Number.isInteger(id) || !snapshot.stars[id]) throw new Error("System not found.");
      return id;
    };
    const openFleetSystem = async (fleetId: string): Promise<ServerFleet> => {
      const fleet = snapshot.fleets.find((candidate) => candidate.id === fleetId);
      if (!fleet) throw new Error("Fleet not found.");
      const star = snapshot.stars[fleet.currentStarId];
      if (!star) throw new Error("Fleet system not found.");
      await openSystemView(star);
      activeSystemScene?.selectFleetById(fleet.id);
      return fleet;
    };
    try {
      if (parsed.canonicalName === "goto") {
        const kind = args[0];
        if (kind === "system") {
          const star = snapshot.stars[resolveSystemId(args[1])];
          await openSystemView(star);
          return adminResult(input, true, `Opened ${star.name}.`);
        }
        if (kind === "fleet") {
          const fleetId = args[1] === "selected" || !args[1] ? currentContext.selectedFleetId : args[1];
          if (!fleetId) throw new Error("No fleet selected.");
          const fleet = await openFleetSystem(fleetId);
          return adminResult(input, true, `Opened fleet ${fleet.id}.`);
        }
        if (kind === "starbase") {
          const starbaseId = args[1];
          const starbase = snapshot.starbases.find((candidate) => candidate.id === starbaseId);
          if (!starbase) throw new Error("Starbase not found.");
          await openSystemView(snapshot.stars[starbase.starId]);
          activeSystemScene?.selectStarbaseById(starbase.id);
          return adminResult(input, true, `Opened starbase ${starbase.id}.`);
        }
      }
      if (parsed.canonicalName === "select") {
        const kind = args[0];
        const id = args[1];
        if (kind === "fleet") {
          const fleetId = id === "selected" || !id ? currentContext.selectedFleetId : id;
          if (!fleetId) throw new Error("No fleet selected.");
          setSelectedFleetIds([fleetId]);
          const selected = activeSystemScene?.selectFleetById(fleetId) || activeGalaxyScene?.selectFleetById(fleetId);
          return adminResult(input, selected ? true : false, selected ? `Selected fleet ${fleetId}.` : "Fleet is not visible in the active view.");
        }
        if (kind === "starbase") {
          const selected = id ? activeSystemScene?.selectStarbaseById(id) : false;
          return adminResult(input, selected ? true : false, selected ? `Selected starbase ${id}.` : "Starbase is not visible in the active system.");
        }
      }
      if (parsed.canonicalName === "render_debug"
        || parsed.canonicalName === "show_ranges"
        || parsed.canonicalName === "show_footprints"
        || parsed.canonicalName === "show_labels") {
        if (parsed.canonicalName === "show_labels") {
          const enabled = (args[0] ?? "on") !== "off";
          document.body.classList.toggle("admin-hide-system-labels", !enabled);
          return adminResult(input, true, `System labels ${enabled ? "shown" : "hidden"}.`);
        }
        return adminResult(input, true, `${parsed.canonicalName} ${args[0] ?? "toggled"} recorded for this client session.`);
      }
      return adminResult(input, false, `"${parsed.canonicalName}" is not implemented as a local command.`);
    } catch (error) {
      return adminResult(input, false, error instanceof Error ? error.message : "Local command failed.");
    }
  };
  const executeAdminCommand = async (input: string): Promise<AdminCommandResult> => {
    const parsed = parseAdminCommand(input);
    if (parsed && isLocalAdminCommand(parsed.canonicalName)) {
      return executeLocalAdminCommand(input);
    }
    return server.executeAdminCommand(input, createAdminContext());
  };
  const openAdminCommandPanel = (): void => {
    if (!adminCommandPanel) {
      adminCommandPanel = new AdminCommandPanel({ onCommand: executeAdminCommand });
    }
    adminCommandPanel.toggle();
  };
  const setSelectedFleetIds = (fleetIds: Iterable<string>): void => {
    selectedFleetIds = new Set(fleetIds);
  };
  const requestFleetActionInGalaxy = (fleetId: string, action: ShipAction): void => {
    setSelectedFleetIds([fleetId]);
    void openGalaxyView().then(() => {
      activeGalaxyScene?.startFleetAction(fleetId, action);
    });
  };
  const getFleetManagerData = () => ({
    fleets: snapshot.fleets,
    ships: snapshot.ships,
    shipDesigns: snapshot.shipDesigns,
    starbases: snapshot.starbases,
    stars: snapshot.stars,
    factions: snapshot.factions,
    clockYear: getRenderClockYear(),
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

  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
  const getRenderClockYear = (): number => estimateClockYear(
    snapshot.clock.year,
    snapshot.clock.syncedAtMs,
    snapshot.clock.speedMultiplier,
  );

  const getFleetPhaseProgress = (fleet: ServerFleet, year = getRenderClockYear()): number => {
    if (fleet.phase === "idle" || fleet.phaseDurationDays <= 0) return 0;
    const elapsedDays = (year - fleet.phaseStartedAtYear) * GAME_DAYS_PER_YEAR;
    return clamp01(elapsedDays / fleet.phaseDurationDays);
  };

  const getFleetHyperlanePosition = (fleet: ServerFleet, year = getRenderClockYear()) => {
    if (fleet.movementPlan) {
      const segment = fleet.movementPlan.segments.find((candidate) => (
        candidate.kind === "hyperlane"
        && year >= candidate.startYear
        && year < candidate.endYear
      ));
      if (segment) {
        return {
          fromStarId: segment.fromStarId,
          toStarId: segment.toStarId,
          progress: clamp01((year - segment.startYear) / Math.max(0.000001, segment.endYear - segment.startYear)),
        };
      }
    }
    if (fleet.hyperlanePosition) return fleet.hyperlanePosition;
    if (fleet.phase !== "jumpingHyperlane") return null;
    const fromStarId = fleet.route[fleet.routeIndex];
    const toStarId = fleet.route[fleet.routeIndex + 1];
    if (fromStarId === undefined || toStarId === undefined) return null;
    return {
      fromStarId,
      toStarId,
      progress: getFleetPhaseProgress(fleet, year),
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

  const getFleetSystemPosition = (fleet: ServerFleet, year = getRenderClockYear()): { x: number; y: number; z: number } => {
    if (fleet.orbitTarget?.kind && fleet.orbitTarget.kind !== "planet") {
      return fleet.orbitTarget.position;
    }

    if (fleet.orbitTargetPlanetId) {
      const targetStar = snapshot.stars[fleet.currentStarId];
      const planetIndex = targetStar?.system.planets.findIndex((planet) => planet.id === fleet.orbitTargetPlanetId) ?? -1;
      const planet = planetIndex >= 0 ? targetStar.system.planets[planetIndex] : null;
      if (targetStar && planet) {
        const nowMs = DEFAULT_ORBIT_EPOCH_MS + ((year - GAME_START_YEAR) * GAME_DAYS_PER_YEAR * REAL_MS_PER_GAME_DAY);
        const planetPosition = getPlanetSystemPosition(planet, planetIndex, nowMs, getSystemOrbitLayout(targetStar.type));
        const offset = fleet.orbitOffset ?? { x: 3.4, y: SYSTEM_FLEET_Y, z: 0 };
        return {
          x: planetPosition.x + offset.x,
          y: offset.y,
          z: planetPosition.z + offset.z,
        };
      }
    }

    if (fleet.movementPlan) {
      const segment = fleet.movementPlan.segments.find((candidate) => (
        year >= candidate.startYear && year < candidate.endYear
      ));
      if (segment) {
        const progress = clamp01((year - segment.startYear) / Math.max(0.000001, segment.endYear - segment.startYear));
        return interpolateSystemPosition(segment.from, segment.to, progress);
      }
      const finalSegment = fleet.movementPlan.segments[fleet.movementPlan.segments.length - 1];
      if (finalSegment) return finalSegment.to;
    }

    if (fleet.systemPosition) return fleet.systemPosition;
    const progress = getFleetPhaseProgress(fleet, year);
    const stars = resolveRoutingStars();
    if (fleet.phase === "departingSystem") {
      const fromStar = stars[fleet.currentStarId];
      const toStar = fleet.route[fleet.routeIndex + 1] !== undefined
        ? stars[fleet.route[fleet.routeIndex + 1]]
        : undefined;
      return fromStar && toStar
        ? interpolateSystemPosition(getSystemFleetStagingPosition(), getSystemHyperlaneExitPosition(fromStar, toStar), progress)
        : getSystemFleetStagingPosition();
    }
    if (fleet.phase === "arrivingSystem") {
      const toStar = stars[fleet.currentStarId];
      const fromStar = fleet.route[fleet.routeIndex - 1] !== undefined
        ? stars[fleet.route[fleet.routeIndex - 1]]
        : undefined;
      return fromStar && toStar
        ? interpolateSystemPosition(getSystemHyperlaneEntryPosition(fromStar, toStar), getSystemFleetStagingPosition(), progress)
        : getSystemFleetStagingPosition();
    }
    return getSystemFleetStagingPosition();
  };

  const getFleetSystemPositions = (year = getRenderClockYear()): Record<string, { x: number; y: number; z: number }> => (
    Object.fromEntries(snapshot.fleets
      .filter((fleet) => !getFleetHyperlanePosition(fleet, year))
      .map((fleet) => [fleet.id, getFleetSystemPosition(fleet, year)]))
  );

  const getFleetSystemStarId = (fleet: ServerFleet, year = getRenderClockYear()): number => {
    const segment = fleet.movementPlan?.segments.find((candidate) => (
      candidate.kind !== "hyperlane"
      && year >= candidate.startYear
      && year < candidate.endYear
    ));
    return segment?.toStarId ?? fleet.currentStarId;
  };

  const getHyperlaneExitsForSystem = (star: StarData): HyperlaneExitPoint[] => {
    const stars = resolveRoutingStars();
    return (cachedHyperlaneAdjacency[star.id] ?? [])
      .map((targetStarId) => {
        const targetStar = stars[targetStarId];
        if (!targetStar) return null;
        const direction = getHyperlaneDirection(star, targetStar);
        return {
          starId: targetStar.id,
          name: targetStar.name,
          dx: direction.dx,
          dz: direction.dz,
          systemPosition: getHyperlaneExitSystemPosition(direction),
        };
      })
      .filter((exit): exit is HyperlaneExitPoint => exit !== null);
  };

  const updateSmoothGameplayFrame = (): void => {
    const year = getRenderClockYear();
    if (activeGalaxyScene) {
      activeGalaxyScene.setClockYear(year);
      activeGalaxyScene.setPlayerShipState(getPrimaryFleetStarId(), getPrimaryTransit());
    }
    if (activeSystemScene) {
      activeSystemScene.setClockYear(year);
      activeSystemScene.setFleetSystemPositions(getFleetSystemPositions(year), { refreshCards: false });
    }
  };

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

    if (isFull || has("fleets")) {
      const fleetIds = new Set(snapshot.fleets.map((fleet) => fleet.id));
      selectedFleetIds = new Set(Array.from(selectedFleetIds).filter((fleetId) => fleetIds.has(fleetId)));
    }

    if (isFull || has("planetStates")) {
      applyPlanetStatesToStars(snapshot.stars, snapshot.planetStates);
    }
    cachedGalaxyStars = snapshot.stars;
    if ((isFull || has("visibility")) && !hyperlaneListsEqual(snapshot.hyperlanes, cachedHyperlanePairs)) {
      cachedHyperlanePairs = snapshot.hyperlanes;
      cachedHyperlaneAdjacency = buildHyperlaneAdjacency(snapshot.hyperlanes, snapshot.stars.length);
    }

    if (activeGalaxyScene) {
      activeGalaxyScene.setClockYear(getRenderClockYear());
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
      if (isFull || has("shipDesigns")) {
        activeGalaxyScene.setShipDesigns(snapshot.shipDesigns);
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
      activeSystemScene.setClockYear(getRenderClockYear());
      if (isFull || has("combatContacts") || has("visibility")) {
        activeSystemScene.setRecentCombatContacts(snapshot.recentCombatContacts);
      }
      if (isFull || has("clock") || has("fleets")) {
        activeSystemScene.setFleetSystemPositions(getFleetSystemPositions(), { refreshCards: false });
      }
      if (isFull || has("fleets")) {
        activeSystemScene.setServerFleets(snapshot.fleets);
      }
      if (isFull || has("ships")) {
        activeSystemScene.setServerShips(snapshot.ships);
      }
      if (isFull || has("shipDesigns")) {
        activeSystemScene.setShipDesigns(snapshot.shipDesigns);
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
    if (
      isFull
      || has("fleets")
      || has("ships")
      || has("shipDesigns")
      || has("starbases")
      || has("visibility")
    ) {
      refreshFleetManager();
    }
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
      clockYear: getRenderClockYear(),
      playerShipSystemIds: getFleetSystemIds(),
      serverFleets: snapshot.fleets,
      serverShips: snapshot.ships,
      shipDesigns: snapshot.shipDesigns,
      starbaseSystemIds: getStarbaseSystemIds(),
      promotedStarbaseSystemIds: getPromotedStarbaseSystemIds(),
      starbases: snapshot.starbases,
      starOwnership: expandStarOwnership(),
      visibleStarIds: snapshot.visibleStarIds,
      knownStarIds: snapshot.knownStarIds,
      selectedFleetIds,
          planetStates: snapshot.planetStates,
          habitedPlanetSystemIds: snapshot.habitedPlanetSystemIds,
      onShipCommand: (action, targetStarId, fleetId) => {
        if (!fleetId) return;
        if (action === "move") {
          server.send({ type: "moveFleet", fleetId, targetStarId });
        } else if (action === "build") {
          server.send({ type: "buildStarbase", fleetId, targetStarId });
        } else if (action === "retreatTo") {
          server.send({ type: "retreatFleetTo", fleetId, targetStarId });
        } else if (action === "emergencyRetreatTo") {
          server.send({ type: "emergencyRetreatFleetTo", fleetId, targetStarId });
        }
      },
      onFleetCommand: (command) => server.send(command),
      onSelectedFleetIdsChange: setSelectedFleetIds,
      onPlanetCommand: sendPlanetCommand,
      onOpenHabitedPlanet: (starId) => openFirstHabitedPlanetFromGalaxy(starId),
      onGameplayFrame: updateSmoothGameplayFrame,
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
      activeGalaxyScene.setClockYear(getRenderClockYear());
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
          shipDesigns: snapshot.shipDesigns,
          recentCombatContacts: snapshot.recentCombatContacts,
          starbaseSystemIds: getStarbaseSystemIds(),
          starbases: snapshot.starbases,
          factions: snapshot.factions,
          playerFactionId: snapshot.perspective.mode === "faction" ? snapshot.perspective.factionId : 0,
          playerShipStarId: getPrimaryFleetStarId(),
          shipTransit: getPrimaryTransit(),
          fleetSystemPositions: getFleetSystemPositions(),
          hyperlaneExits: getHyperlaneExitsForSystem(systemStar),
          clockYear: getRenderClockYear(),
          selectedFleetIds,
          planetStates: details.planetStates,
          onPlanetCommand: sendPlanetCommand,
          onFleetCommand: (command) => server.send(command),
          onGameplayFrame: updateSmoothGameplayFrame,
          onSelectedFleetIdsChange: setSelectedFleetIds,
          onRequestFleetActionInGalaxy: requestFleetActionInGalaxy,
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

  const pressedCodes = new Set<string>();
  const handleKeyDown = (ev: KeyboardEvent) => {
    pressedCodes.add(ev.code);
    if (ev.shiftKey && pressedCodes.has("KeyN") && pressedCodes.has("Digit2")) {
      ev.preventDefault();
      ev.stopPropagation();
      pressedCodes.clear();
      openAdminCommandPanel();
    }
  };
  const handleKeyUp = (ev: KeyboardEvent) => {
    pressedCodes.delete(ev.code);
    if (ev.key === "Shift") pressedCodes.clear();
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
  window.addEventListener("keyup", handleKeyUp);

  reportProgress(0.5, "Starting galaxy command sequence");
  applyPlanetStatesToStars(snapshot.stars, snapshot.planetStates);
  await openGalaxyView();

  console.log("StellarFronts game running");

  return () => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    hud?.dispose();
    fleetManagerPanel?.dispose();
    adminCommandPanel?.dispose();
    server.dispose();
    mgr.dispose();
  };
}

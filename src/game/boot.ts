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
import { findNebulaForStar } from "@/data/Nebula";
import { HudOverlay } from "@/ui/HudOverlay";
import type { HudConnectedSystem, HudResourcePlanetSummary, HudSidebarItemKey, HudVisualToggles } from "@/ui/HudOverlay";
import { EventModal } from "@/ui/EventModal";
import { SituationModal } from "@/ui/SituationModal";
import { FleetManagerPanel } from "@/ui/FleetManagerPanel";
import { PlanetOperationsPanel } from "@/ui/PlanetOperationsPanel";
import { MarketPanel } from "@/ui/MarketPanel";
import { TechnologyPanel } from "@/ui/TechnologyPanel";
import { LeadersPanel } from "@/ui/LeadersPanel";
import { GovernmentPanel } from "@/ui/GovernmentPanel";
import { DiplomacyPanel } from "@/ui/DiplomacyPanel";
import { SocietyPanel } from "@/ui/SocietyPanel";
import { OPEN_LEADERS_PANEL_EVENT } from "@/ui/leaderEvents";
import type { LeaderAssignmentTarget, OpenLeadersPanelEventDetail } from "@/ui/leaderEvents";
import { AdminCommandPanel } from "@/ui/AdminCommandPanel";
import { GameServerClient } from "./GameServerClient";
import type {
  ClientCommand,
  DiplomacyDetailPayload,
  FleetManagerDetailPayload,
  GameSnapshot,
  GovernmentDetailPayload,
  LeadersDetailPayload,
  MarketDetailPayload,
  PlanetManagerDetailPayload,
  PlanetManagerPlanetEntry,
  PlanetDetailPayload,
  ServerFleet,
  ServerStarbase,
  ServerUpdateField,
  SocietyDetailPayload,
  StarbaseDetailPayload,
  SystemDetailPayload,
  TechnologyDetailPayload,
} from "./GameProtocol";
import { isLocalAdminCommand, parseAdminCommand } from "./AdminCommands";
import type { AdminCommandContext, AdminCommandResult } from "./AdminCommands";
import { GAME_DAYS_PER_YEAR, GAME_START_YEAR, REAL_MS_PER_GAME_DAY, estimateClockYear } from "./GameTime";
import type { HyperlaneExitPoint, ShipAction } from "./GameplayTypes";
import { getPlayerProfile } from "@/auth/client";

export interface BootOptions {
  adminCommandsEnabled?: boolean;
  gameId?: string;
  onProgress?: (progress: number, detail: string) => void;
}

export async function boot(container: HTMLDivElement, options: BootOptions = {}): Promise<() => void> {
  const canvas = container.querySelector("#renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas not found in container");

  const reportProgress = (progress: number, detail: string) => {
    options.onProgress?.(progress, detail);
  };

  reportProgress(0.08, "Connecting to game server");
  const server = new GameServerClient(options.gameId);
  const profilePromise = getPlayerProfile().catch(() => null);
  let snapshot = await server.connect();
  const initialProfile = await profilePromise;
  const initialDarkMatter = initialProfile?.darkMatter;
  let darkMatter = typeof initialDarkMatter === "number" && Number.isFinite(initialDarkMatter)
    ? Math.max(0, Math.floor(initialDarkMatter))
    : 0;
  const adminCommandsEnabled = options.adminCommandsEnabled === true;
  applyPlanetStatesToStars(snapshot.stars, snapshot.planetStates);

  reportProgress(0.28, "Receiving authoritative galaxy state");

  const mgr = new SceneManager();
  const engine = await mgr.initEngine(canvas);
  let isSwitching = false;
  let activeGalaxyScene: GalaxyScene | null = null;
  let activeSystemScene: SystemScene | null = null;
  let cachedGalaxyStars: StarData[] | null = snapshot.stars;
  let cachedGalaxyViewState: GalaxyViewState | null = null;
  // Galaxy snapshots deliberately omit system planets. Keep full system
  // payloads separately so a normal snapshot update cannot replace the base
  // star while an individual planet-detail request is still in flight.
  const cachedSystemStars = new Map<number, StarData>();
  let cachedHyperlanePairs: Array<[number, number]> = snapshot.hyperlanes;
  let cachedHyperlaneAdjacency: number[][] = buildHyperlaneAdjacency(snapshot.hyperlanes, snapshot.stars.length);
  let currentSystemStar: StarData | null = null;
  let hud: HudOverlay | null = null;
  let darkMatterRefreshTimer: number | null = null;
  const seenEventIds = new Set<string>();
  const eventModal = new EventModal({
    onResolve: (eventId, choiceId) => {
      server.send({ type: "resolveEvent", eventId, choiceId });
    },
  });
  const situationModal = new SituationModal();
  const syncEventAndSituationModals = (): void => {
    const events = snapshot.events ?? [];
    const situations = snapshot.situations ?? [];
    // Auto-popup the newest event the player hasn't seen yet (one at a time).
    if (!eventModal.isOpen) {
      const fresh = events.find((event) => !seenEventIds.has(event.id));
      if (fresh) {
        seenEventIds.add(fresh.id);
        eventModal.show(fresh, snapshot.clock.year);
      }
    }
    for (const event of events) seenEventIds.add(event.id);
    // Keep an open event modal in sync / close it if the event is gone.
    const openEventId = eventModal.currentEventId;
    if (openEventId) {
      const current = events.find((event) => event.id === openEventId);
      if (current) eventModal.sync(current, snapshot.clock.year);
      else eventModal.close();
    }
    // Keep an open situation modal in sync / close it if the situation ended.
    const openSituationId = situationModal.currentSituationId;
    if (openSituationId) {
      const current = situations.find((situation) => situation.id === openSituationId);
      if (current) situationModal.sync(current);
      else situationModal.close();
    }
  };
  let fleetManagerPanel: FleetManagerPanel | null = null;
  let planetOperationsPanel: PlanetOperationsPanel | null = null;
  let marketPanel: MarketPanel | null = null;
  let technologyPanel: TechnologyPanel | null = null;
  let leadersPanel: LeadersPanel | null = null;
  let governmentPanel: GovernmentPanel | null = null;
  let diplomacyPanel: DiplomacyPanel | null = null;
  let societyPanel: SocietyPanel | null = null;
  let adminCommandPanel: AdminCommandPanel | null = null;
  let leadersPanelAssignmentTarget: LeaderAssignmentTarget | null = null;
  let fleetManagerDetail: FleetManagerDetailPayload | null = null;
  let planetManagerDetail: PlanetManagerDetailPayload | null = null;
  let marketDetail: MarketDetailPayload | null = null;
  let technologyDetail: TechnologyDetailPayload | null = null;
  let leadersDetail: LeadersDetailPayload | null = null;
  let governmentDetail: GovernmentDetailPayload | null = null;
  let diplomacyDetail: DiplomacyDetailPayload | null = null;
  let societyDetail: SocietyDetailPayload | null = null;
  let releaseFleetManagerDetail: (() => void) | null = null;
  let releasePlanetManagerDetail: (() => void) | null = null;
  let releaseMarketDetail: (() => void) | null = null;
  let releaseTechnologyDetail: (() => void) | null = null;
  let releaseLeadersDetail: (() => void) | null = null;
  let releaseGovernmentDetail: (() => void) | null = null;
  let releaseDiplomacyDetail: (() => void) | null = null;
  let releaseSocietyDetail: (() => void) | null = null;
  let releaseActiveSystemDetail: (() => void) | null = null;
  const releaseStarbaseDetails = new Map<string, () => void>();
  const releasePlanetDetails = new Map<string, () => void>();
  const pendingPlanetDetailInitials = new Map<string, Promise<PlanetDetailPayload>>();
  let selectedFleetIds = new Set<string>();

  const visualToggles: HudVisualToggles = {
    hyperlanes: true,
    bloom: true,
    centerCloud: true,
    stars: true,
    ownership: true,
  };
  const systemViewToggles = {
    labels: true,
    ranges: true,
    footprints: false,
    renderDebug: false,
  };

  const resolveRoutingStars = (): StarData[] => cachedGalaxyStars ?? snapshot.stars;

  const getVisibleStarSet = (): Set<number> | null => (
    snapshot.visibleStarIds ? new Set(snapshot.visibleStarIds) : null
  );
  const getKnownStarSet = (): Set<number> | null => (
    snapshot.knownStarIds ? new Set(snapshot.knownStarIds) : null
  );

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
  const getCurrentFactionTechnology = () => (
    (() => {
      const perspectiveFactionId = snapshot.perspective.mode === "faction" ? snapshot.perspective.factionId : null;
      if (perspectiveFactionId === null) return null;
      return technologyDetail?.technologies.find((technology) => technology.factionId === perspectiveFactionId)
        ?? snapshot.technologies.find((technology) => technology.factionId === perspectiveFactionId)
        ?? null;
    })()
  );
  const getCurrentFactionName = (): string | undefined => {
    const factionId = getPlayerFactionId();
    return factionId === null ? undefined : snapshot.factions.find((faction) => faction.id === factionId)?.name;
  };
  const getPlayerFactionId = (): number | null => (
    snapshot.perspective.mode === "faction" ? snapshot.perspective.factionId : null
  );
  const getCurrentFactionResourcePlanets = (): HudResourcePlanetSummary[] => {
    const factionId = getPlayerFactionId();
    if (factionId === null) return [];
    const ownerByStar = expandStarOwnership();
    return snapshot.planetStates
      .filter((planetState) => (ownerByStar[planetState.starId] ?? -1) === factionId)
      .map((planetState) => {
        const star = snapshot.stars[planetState.starId];
        const planet = star?.system.planets[planetState.planetIndex];
        return {
          id: planetState.id,
          name: planet?.name ?? `Planet ${planetState.planetIndex + 1}`,
          starName: star?.name ?? `System ${planetState.starId}`,
          population: planetState.population,
          production: planetState.economy.production,
          upkeep: planetState.economy.upkeep,
          net: planetState.economy.net,
          deficit: planetState.economy.deficit,
        };
      });
  };
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
        const enabled = (args[0] ?? "on") !== "off";
        if (parsed.canonicalName === "show_labels") {
          systemViewToggles.labels = enabled;
          document.body.classList.toggle("admin-hide-system-labels", !enabled);
          activeSystemScene?.setLabelsVisible(enabled);
          return adminResult(input, true, `System labels ${enabled ? "shown" : "hidden"}.`);
        }
        if (parsed.canonicalName === "show_ranges") {
          systemViewToggles.ranges = enabled;
          activeSystemScene?.setRangeRingsVisible(enabled);
          return adminResult(input, true, `System range rings ${enabled ? "shown" : "hidden"}.`);
        }
        if (parsed.canonicalName === "show_footprints") {
          systemViewToggles.footprints = enabled;
          activeSystemScene?.setFootprintsVisible(enabled);
          return adminResult(input, true, `System fleet footprints ${enabled ? "shown" : "hidden"}.`);
        }
        systemViewToggles.renderDebug = enabled;
        activeSystemScene?.setRenderDebugEnabled(enabled);
        return adminResult(input, true, `System render debug ${enabled ? "enabled" : "disabled"}.`);
      }
      return adminResult(input, false, `"${parsed.canonicalName}" is not implemented as a local command.`);
    } catch (error) {
      return adminResult(input, false, error instanceof Error ? error.message : "Local command failed.");
    }
  };
  const executeAdminCommand = async (input: string): Promise<AdminCommandResult> => {
    if (!adminCommandsEnabled) {
      return adminResult(input, false, "Admin commands are not available for this account.");
    }
    const parsed = parseAdminCommand(input);
    if (parsed && isLocalAdminCommand(parsed.canonicalName)) {
      return executeLocalAdminCommand(input);
    }
    return server.executeAdminCommand(input, createAdminContext());
  };
  const openAdminCommandPanel = (): void => {
    if (!adminCommandsEnabled) return;
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
    fleets: fleetManagerDetail?.fleets ?? snapshot.fleets,
    ships: fleetManagerDetail?.ships ?? snapshot.ships,
    shipDesigns: fleetManagerDetail?.shipDesigns ?? snapshot.shipDesigns,
    starbases: fleetManagerDetail?.starbases ?? [],
    stars: snapshot.stars,
    factions: snapshot.factions,
    clockYear: getRenderClockYear(),
    combatReports: fleetManagerDetail?.combatReports ?? snapshot.combatReports,
    playerFactionId: getPlayerFactionId(),
    technology: fleetManagerDetail?.technologies.find((technology) => technology.factionId === getPlayerFactionId())
      ?? getCurrentFactionTechnology(),
    onFleetCommand: (command: ClientCommand) => server.send(command),
    onClose: () => {
      releaseFleetManagerDetail?.();
      releaseFleetManagerDetail = null;
    },
  });
  const getPlanetManagerFallbackPlanets = (): PlanetManagerPlanetEntry[] => {
    const factionId = getPlayerFactionId();
    if (factionId === null) return [];
    const ownerByStar = expandStarOwnership();
    return snapshot.planetStates
      .filter((planetState) => planetState.isHabited && (ownerByStar[planetState.starId] ?? -1) === factionId)
      .map((planetState) => {
        const star = snapshot.stars[planetState.starId];
        const planet = star?.system.planets[planetState.planetIndex];
        if (!star || !planet) return null;
        return {
          starId: planetState.starId,
          starName: star.name,
          ownerId: ownerByStar[planetState.starId] ?? -1,
          planet,
          planetState,
        };
      })
      .filter((entry): entry is PlanetManagerPlanetEntry => entry !== null);
  };
  const getPlanetOperationsData = () => ({
    planets: planetManagerDetail?.planets ?? getPlanetManagerFallbackPlanets(),
    leaders: planetManagerDetail?.leaders ?? snapshot.leaders,
    factionEconomies: planetManagerDetail?.factionEconomies ?? snapshot.factionEconomies,
    factions: snapshot.factions,
    playerFactionId: getPlayerFactionId(),
    factionName: getCurrentFactionName(),
    onOpenPlanet: (planetId: string) => {
      void openPlanetFromManager(planetId);
    },
    onClose: () => {
      releasePlanetManagerDetail?.();
      releasePlanetManagerDetail = null;
    },
  });
  const getMarketPanelData = () => ({
    resources: marketDetail?.resources ?? [],
    playerStats: marketDetail?.playerStats ?? null,
    autoTrades: marketDetail?.autoTrades ?? [],
    transactions: marketDetail?.transactions ?? [],
    marketFee: marketDetail?.marketFee ?? 0.05,
    playerFactionId: getPlayerFactionId(),
    factionName: getCurrentFactionName(),
    onMarketCommand: (command: ClientCommand) => server.send(command),
    onClose: () => {
      releaseMarketDetail?.();
      releaseMarketDetail = null;
    },
  });
  const getTechnologyPanelData = () => ({
    technology: technologyDetail?.technologies.find((technology) => technology.factionId === getPlayerFactionId())
      ?? getCurrentFactionTechnology(),
    factionName: getCurrentFactionName(),
    onTechnologyCommand: (command: ClientCommand) => server.send(command),
    onClose: () => {
      releaseTechnologyDetail?.();
      releaseTechnologyDetail = null;
    },
  });
  const sendLeaderCommand = (command: ClientCommand): void => {
    server.send(command);
    if (command.type !== "assignLeader") return;
    const assignedLeader = snapshot.leaders.find((leader) => leader.id === command.leaderId);
    if (!assignedLeader) return;
    const assignment = command.assignment;
    snapshot = {
      ...snapshot,
      leaders: snapshot.leaders.map((leader) => {
        if (leader.id === command.leaderId) {
          return {
            ...leader,
            status: "recruited",
            assignment,
            recruitedAtYear: leader.recruitedAtYear ?? getRenderClockYear(),
          };
        }
        if (
          assignment
          && leader.factionId === assignedLeader.factionId
          && leader.assignment?.kind === assignment.kind
          && leader.assignment.targetId === assignment.targetId
        ) {
          return { ...leader, assignment: null };
        }
        return leader;
      }),
    };
    applySnapshotToActiveScene(["leaders"]);
  };
  const getLeadersPanelData = () => ({
    leaders: leadersDetail?.leaders ?? snapshot.leaders,
    fleets: leadersDetail?.fleets ?? snapshot.fleets,
    stars: snapshot.stars,
    planetStates: leadersDetail?.planetStates ?? snapshot.planetStates,
    factions: snapshot.factions,
    playerFactionId: getPlayerFactionId(),
    factionName: getCurrentFactionName(),
    clockYear: getRenderClockYear(),
    assignmentTarget: leadersPanelAssignmentTarget,
    onLeaderCommand: sendLeaderCommand,
    onClose: () => {
      releaseLeadersDetail?.();
      releaseLeadersDetail = null;
    },
  });
  const getCurrentFactionGovernment = () => {
    const factionId = getPlayerFactionId();
    if (factionId === null) return null;
    return governmentDetail?.government
      ?? snapshot.governments.find((government) => government.factionId === factionId)
      ?? null;
  };
  const sendGovernmentCommand = (command: ClientCommand): void => {
    if (command.type === "assignLeader") {
      sendLeaderCommand(command);
      return;
    }
    server.send(command);
  };
  const openFleetManager = (): void => {
    if (!fleetManagerPanel) {
      fleetManagerPanel = new FleetManagerPanel();
    }
    if (!releaseFleetManagerDetail) {
      releaseFleetManagerDetail = server.subscribeDetail<FleetManagerDetailPayload>("fleetManager", null, (event) => {
        if (event.payload && "fleets" in event.payload && "shipDesigns" in event.payload) {
          fleetManagerDetail = event.payload;
          fleetManagerPanel?.refresh(getFleetManagerData());
        }
      });
    }
    fleetManagerPanel.show(getFleetManagerData());
  };
  const openPlanetOperations = (): void => {
    if (!planetOperationsPanel) {
      planetOperationsPanel = new PlanetOperationsPanel();
    }
    if (!releasePlanetManagerDetail) {
      releasePlanetManagerDetail = server.subscribeDetail<PlanetManagerDetailPayload>("planetManager", null, (event) => {
        if (event.payload && "planets" in event.payload) {
          planetManagerDetail = event.payload;
          planetOperationsPanel?.refresh(getPlanetOperationsData());
          const planetStates = event.payload.planets.map((entry) => entry.planetState);
          const stars = snapshot.stars.slice();
          for (const entry of event.payload.planets) {
            const star = stars[entry.starId];
            if (!star) continue;
            const planets = star.system.planets.slice();
            planets[entry.planetState.planetIndex] = entry.planet;
            stars[entry.starId] = {
              ...star,
              name: entry.starName,
              system: { planets },
            };
          }
          snapshot = {
            ...snapshot,
            stars,
            planetStates: mergePlanetStates(snapshot.planetStates, planetStates),
          };
          cachedGalaxyStars = stars;
          applyPlanetStatesToStars(snapshot.stars, planetStates);
          updateHud();
        }
      });
    }
    planetOperationsPanel.show(getPlanetOperationsData());
  };
  const openMarketPanel = (): void => {
    if (!marketPanel) {
      marketPanel = new MarketPanel();
    }
    if (!releaseMarketDetail) {
      releaseMarketDetail = server.subscribeDetail<MarketDetailPayload>("market", null, (event) => {
        if (event.payload && "resources" in event.payload && "marketFee" in event.payload) {
          marketDetail = event.payload;
          marketPanel?.refresh(getMarketPanelData());
        }
      });
    }
    marketPanel.show(getMarketPanelData());
  };
  const openTechnologyPanel = (): void => {
    if (!technologyPanel) {
      technologyPanel = new TechnologyPanel();
    }
    if (!releaseTechnologyDetail) {
      releaseTechnologyDetail = server.subscribeDetail<TechnologyDetailPayload>("technology", null, (event) => {
        if (event.payload && "technologies" in event.payload) {
          technologyDetail = event.payload;
          technologyPanel?.refresh(getTechnologyPanelData());
          applySnapshotToActiveScene(["technologies"]);
        }
      });
    }
    technologyPanel.show(getTechnologyPanelData());
  };
  const openLeadersPanel = (assignmentTarget: LeaderAssignmentTarget | null = null): void => {
    leadersPanelAssignmentTarget = assignmentTarget;
    if (!leadersPanel) {
      leadersPanel = new LeadersPanel();
    }
    if (!releaseLeadersDetail) {
      releaseLeadersDetail = server.subscribeDetail<LeadersDetailPayload>("leaders", null, (event) => {
        if (event.payload && "leaders" in event.payload) {
          leadersDetail = event.payload;
          leadersPanel?.refresh(getLeadersPanelData());
          activeGalaxyScene?.setLeaders(event.payload.leaders);
          activeSystemScene?.setLeaders(event.payload.leaders);
        }
      });
    }
    leadersPanel.show(getLeadersPanelData());
  };
  const getGovernmentPanelData = () => ({
    government: getCurrentFactionGovernment(),
    leaders: governmentDetail?.leaders ?? snapshot.leaders,
    technology: governmentDetail?.technologies.find((technology) => technology.factionId === getPlayerFactionId())
      ?? getCurrentFactionTechnology(),
    factionEconomy: governmentDetail?.factionEconomies.find((economy) => economy.factionId === getPlayerFactionId())
      ?? getCurrentFactionEconomy(),
    factions: snapshot.factions,
    playerFactionId: getPlayerFactionId(),
    factionName: getCurrentFactionName(),
    clockYear: getRenderClockYear(),
    onGovernmentCommand: sendGovernmentCommand,
    onOpenLeaderAssignment: (target: LeaderAssignmentTarget) => {
      openLeadersPanel(target);
    },
    onClose: () => {
      releaseGovernmentDetail?.();
      releaseGovernmentDetail = null;
    },
  });
  const getDiplomacyPanelData = () => {
    const playerFactionId = diplomacyDetail?.playerFactionId ?? getPlayerFactionId();
    return {
      countries: diplomacyDetail?.countries ?? snapshot.factions.map((faction) => ({
        faction,
        isSelf: faction.id === playerFactionId,
        atWar: false,
        ourBorderPolicy: faction.id === playerFactionId ? "open" as const : "closed" as const,
        theirBorderPolicy: faction.id === playerFactionId ? "open" as const : "closed" as const,
        activeTreatyCount: 0,
        pendingProposalCount: 0,
        tradePrivilegeActive: false,
        tradePrivilegeSuspended: false,
        migrationPactActive: false,
        migrationPactSuspended: false,
      })),
      wars: diplomacyDetail?.wars ?? [],
      treaties: diplomacyDetail?.treaties ?? [],
      proposals: diplomacyDetail?.proposals ?? [],
      chatMessages: diplomacyDetail?.chatMessages ?? [],
      eligiblePeaceTransferSystems: diplomacyDetail?.eligiblePeaceTransferSystems ?? [],
      treatyArticles: diplomacyDetail?.treatyArticles ?? [],
      playerFactionId,
      factionName: getCurrentFactionName(),
      clockYear: getRenderClockYear(),
      onDiplomacyCommand: (command: ClientCommand) => server.send(command),
      onClose: () => {
        releaseDiplomacyDetail?.();
        releaseDiplomacyDetail = null;
      },
    };
  };
  const getSocietyPanelData = () => {
    const playerFactionId = societyDetail?.playerFactionId ?? getPlayerFactionId();
    const fallbackFaction = playerFactionId === null
      ? null
      : snapshot.factions.find((faction) => faction.id === playerFactionId) ?? null;
    const fallbackSpecies = playerFactionId === null
      ? snapshot.species
      : snapshot.species.filter((species) => species.originFactionId === playerFactionId);
    return {
      playerFactionId,
      faction: societyDetail?.faction ?? fallbackFaction,
      species: societyDetail?.species ?? fallbackSpecies,
      rights: societyDetail?.rights ?? null,
      legalOptions: societyDetail?.legalOptions ?? {
        livingStandards: [],
        citizenship: [],
        migration: [],
        workEligibility: [],
      },
      government: societyDetail?.government ?? getCurrentFactionGovernment(),
      factionEconomy: societyDetail?.factionEconomy ?? getCurrentFactionEconomy(),
      planets: societyDetail?.planets ?? [],
      laws: societyDetail?.laws ?? {
        civilRights: "civicRegistry",
        speciesPolicy: "managedResidency",
      },
      factionName: getCurrentFactionName(),
      clockYear: getRenderClockYear(),
      onSocietyCommand: (command: ClientCommand) => server.send(command),
      onClose: () => {
        releaseSocietyDetail?.();
        releaseSocietyDetail = null;
      },
    };
  };
  const openGovernmentPanel = (): void => {
    if (!governmentPanel) {
      governmentPanel = new GovernmentPanel();
    }
    if (!releaseGovernmentDetail) {
      releaseGovernmentDetail = server.subscribeDetail<GovernmentDetailPayload>("government", null, (event) => {
        if (event.payload && "government" in event.payload) {
          governmentDetail = event.payload;
          governmentPanel?.refresh(getGovernmentPanelData());
          if (event.payload.leaders) {
            activeGalaxyScene?.setLeaders(event.payload.leaders);
            activeSystemScene?.setLeaders(event.payload.leaders);
          }
        }
      });
    }
    governmentPanel.show(getGovernmentPanelData());
  };
  const openDiplomacyPanel = (): void => {
    if (!diplomacyPanel) {
      diplomacyPanel = new DiplomacyPanel();
    }
    if (!releaseDiplomacyDetail) {
      releaseDiplomacyDetail = server.subscribeDetail<DiplomacyDetailPayload>("diplomacy", null, (event) => {
        if (event.payload && "countries" in event.payload) {
          diplomacyDetail = event.payload;
          diplomacyPanel?.refresh(getDiplomacyPanelData());
        }
      });
    }
    diplomacyPanel.show(getDiplomacyPanelData());
  };
  const openSocietyPanel = (): void => {
    if (!societyPanel) {
      societyPanel = new SocietyPanel();
    }
    if (!releaseSocietyDetail) {
      releaseSocietyDetail = server.subscribeDetail<SocietyDetailPayload>("society", null, (event) => {
        if (event.payload && "species" in event.payload) {
          societyDetail = event.payload;
          societyPanel?.refresh(getSocietyPanelData());
        }
      });
    }
    societyPanel.show(getSocietyPanelData());
  };
  const refreshFleetManager = (): void => {
    fleetManagerPanel?.refresh(getFleetManagerData());
  };
  const refreshPlanetOperations = (): void => {
    planetOperationsPanel?.refresh(getPlanetOperationsData());
  };
  const refreshMarketPanel = (): void => {
    marketPanel?.refresh(getMarketPanelData());
  };
  const refreshTechnologyPanel = (): void => {
    technologyPanel?.refresh(getTechnologyPanelData());
  };
  const refreshLeadersPanel = (): void => {
    leadersPanel?.refresh(getLeadersPanelData());
  };
  const refreshGovernmentPanel = (): void => {
    governmentPanel?.refresh(getGovernmentPanelData());
  };
  const refreshDiplomacyPanel = (): void => {
    diplomacyPanel?.refresh(getDiplomacyPanelData());
  };
  const refreshSocietyPanel = (): void => {
    societyPanel?.refresh(getSocietyPanelData());
  };
  const handleSidebarItem = (key: HudSidebarItemKey): void => {
    if (key === "fleets") {
      openFleetManager();
    } else if (key === "government") {
      openGovernmentPanel();
    } else if (key === "diplomacy") {
      openDiplomacyPanel();
    } else if (key === "planets") {
      openPlanetOperations();
    } else if (key === "market") {
      openMarketPanel();
    } else if (key === "technology") {
      openTechnologyPanel();
    } else if (key === "leaders") {
      openLeadersPanel(null);
    } else if (key === "society") {
      openSocietyPanel();
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

  const cacheSystemDetails = (
    star: StarData,
    planetStates: PlanetState[],
    hasFullSystem = true,
  ): void => {
    if (hasFullSystem) cachedSystemStars.set(star.id, star);
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
    const cachedSystemStar = cachedSystemStars.get(starId);
    const star = cachedSystemStar ?? snapshot.stars[starId];
    if (!star) return null;
    const planets = star.system.planets.slice();
    // Do not create holes in a redacted map star. The normal galaxy-icon flow
    // has a full cached system here; other callers may only have the map shell.
    if (
      Number.isInteger(planetState.planetIndex)
      && planetState.planetIndex >= 0
      && planetState.planetIndex <= planets.length
    ) {
      planets[planetState.planetIndex] = planet;
    }
    const nextStar = {
      ...star,
      system: { planets },
    };
    cacheSystemDetails(nextStar, [planetState], cachedSystemStar !== undefined);
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
      activeSystemScene.setBloomEnabled(visualToggles.bloom);
      activeSystemScene.setStarsVisible(visualToggles.stars);
      activeSystemScene.setLabelsVisible(systemViewToggles.labels);
      activeSystemScene.setRangeRingsVisible(systemViewToggles.ranges);
      activeSystemScene.setFootprintsVisible(systemViewToggles.footprints);
      activeSystemScene.setRenderDebugEnabled(systemViewToggles.renderDebug);
    }
  };

  function updateHud(): void {
    if (!hud) return;
    const connectedSystems = currentSystemStar ? getConnectedSystems(currentSystemStar.id) : [];
    const perspective = snapshot.perspective;
    const currentFaction = perspective.mode === "faction"
      ? snapshot.factions.find((faction) => faction.id === perspective.factionId) ?? null
      : null;
    hud.update({
      title: currentSystemStar ? `${currentSystemStar.name} System` : "Galaxy Map",
      canExitSystem: currentSystemStar !== null,
      connectedSystems,
      toggles: visualToggles,
      clock: snapshot.clock,
      economy: getCurrentFactionEconomy(),
      darkMatter,
      resourcePlanets: getCurrentFactionResourcePlanets(),
      flagDesign: currentFaction?.flagDesign ?? null,
      situations: snapshot.situations,
      events: snapshot.events,
      tradeAlerts: snapshot.tradeAlerts ?? [],
    });
    syncEventAndSituationModals();
  }

  function sendPlanetCommand(command: ClientCommand): void {
    server.send(command);
  }

  function releaseStarbaseDetail(starbaseId: string): void {
    releaseStarbaseDetails.get(starbaseId)?.();
    releaseStarbaseDetails.delete(starbaseId);
  }

  function releasePlanetDetail(planetId: string): void {
    releasePlanetDetails.get(planetId)?.();
    releasePlanetDetails.delete(planetId);
    pendingPlanetDetailInitials.delete(planetId);
  }

  function subscribePlanetDetail(planetId: string): Promise<PlanetDetailPayload> {
    const existingPending = pendingPlanetDetailInitials.get(planetId);
    if (existingPending) return existingPending;
    const cached = server.getCachedDetail<PlanetDetailPayload>("planet", planetId);
    if (releasePlanetDetails.has(planetId) && cached) return Promise.resolve(cached);

    let resolveInitial!: (payload: PlanetDetailPayload) => void;
    let rejectInitial!: (error: Error) => void;
    const initial = new Promise<PlanetDetailPayload>((resolve, reject) => {
      resolveInitial = resolve;
      rejectInitial = reject;
    });
    pendingPlanetDetailInitials.set(planetId, initial);
    const timeout = window.setTimeout(() => {
      pendingPlanetDetailInitials.delete(planetId);
      rejectInitial(new Error("Timed out waiting for planet details."));
    }, 8_000);

    const release = server.subscribeDetail<PlanetDetailPayload>("planet", planetId, (event) => {
      if (event.status === "unavailable") {
        window.clearTimeout(timeout);
        pendingPlanetDetailInitials.delete(planetId);
        rejectInitial(new Error(event.message ?? "Planet details are unavailable."));
        return;
      }
      if (!event.payload || !("planetState" in event.payload)) return;
      window.clearTimeout(timeout);
      pendingPlanetDetailInitials.delete(planetId);
      resolveInitial(event.payload);
      const star = cachePlanetDetails(event.payload.starId, event.payload.planet, event.payload.planetState);
      if (!star) return;
      if (activeSystemScene && currentSystemStar?.id === event.payload.starId) {
        activeSystemScene.refreshPlanetDetails(event.payload.planet, event.payload.planetState);
      }
      activeGalaxyScene?.refreshPlanetDetails(event.payload.planet, event.payload.planetState);
      updateHud();
    }, { emitCached: false });
    releasePlanetDetails.set(planetId, release);
    return initial;
  }

  function requestStarbaseDetails(starbaseId: string): Promise<ServerStarbase | null> {
    const cached = server.getCachedDetail<StarbaseDetailPayload>("starbase", starbaseId);
    if (!releaseStarbaseDetails.has(starbaseId)) {
      const release = server.subscribeDetail<StarbaseDetailPayload>("starbase", starbaseId, (event) => {
        if (!event.payload || !("starbase" in event.payload)) return;
        activeGalaxyScene?.refreshStarbaseDetails(event.payload.starbase);
        activeSystemScene?.refreshStarbaseDetails(event.payload.starbase);
      });
      releaseStarbaseDetails.set(starbaseId, release);
    }
    if (cached?.starbase) return Promise.resolve(cached.starbase);
    return server.requestDetail<StarbaseDetailPayload>("starbase", starbaseId)
      .then((event) => (event.payload && "starbase" in event.payload ? event.payload.starbase : null))
      .catch(() => null);
  }

  function releaseSystemDetail(): void {
    releaseActiveSystemDetail?.();
    releaseActiveSystemDetail = null;
  }

  function applySystemDetailPayload(payload: SystemDetailPayload): void {
    cacheSystemDetails(payload.star, payload.planetStates);
    if (!activeSystemScene || currentSystemStar?.id !== payload.star.id) return;
    currentSystemStar = payload.star;
    activeSystemScene.applySystemPayload(payload, {
      leaders: snapshot.leaders,
      selectedFleetIds,
      clockYear: getRenderClockYear(),
    });
    updateHud();
  }

  function subscribeSystemDetail(starId: number): void {
    releaseSystemDetail();
    releaseActiveSystemDetail = server.subscribeDetail<SystemDetailPayload>("system", starId, (event) => {
      if (!event.payload || !("star" in event.payload)) return;
      applySystemDetailPayload(event.payload);
    });
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
        activeGalaxyScene.setFactions(snapshot.factions);
        activeGalaxyScene.setVisibleStarIds(snapshot.visibleStarIds);
        activeGalaxyScene.setKnownStarIds(snapshot.knownStarIds);
        activeGalaxyScene.setStarOwnerships(expandStarOwnership());
      }
      if (isFull || has("diplomacy")) {
        activeGalaxyScene.setDiplomacyMovement(snapshot.diplomacy);
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
      if (isFull || has("leaders")) {
        activeGalaxyScene.setLeaders(snapshot.leaders);
      }
      if (isFull || has("planetStates")) {
        activeGalaxyScene.setPlanetStates(snapshot.planetStates);
      }
      if (isFull || has("technologies")) {
        activeGalaxyScene.setTechnology(getCurrentFactionTechnology());
      }
      activeGalaxyScene.setPlayerShipState(
        getPrimaryFleetStarId(),
        getPrimaryTransit(),
      );
    }

    if (activeSystemScene) {
      activeSystemScene.setClockYear(getRenderClockYear());
      if (isFull || has("visibility")) {
        activeSystemScene.setStarOwnerships(expandStarOwnership());
      }
      if (isFull || has("diplomacy")) {
        activeSystemScene.setDiplomacyMovement(snapshot.diplomacy);
      }
      if (isFull || has("leaders")) {
        activeSystemScene.setLeaders(snapshot.leaders);
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
      if (!releaseFleetManagerDetail) refreshFleetManager();
    }
    if (
      isFull
      || has("planetStates")
      || has("factionEconomies")
      || has("leaders")
      || has("visibility")
    ) {
      if (!releasePlanetManagerDetail) refreshPlanetOperations();
    }
    if (isFull || has("market") || has("factionEconomies")) {
      if (!releaseMarketDetail) refreshMarketPanel();
    }
    if (isFull || has("technologies") || has("factionEconomies")) {
      if (!releaseTechnologyDetail) refreshTechnologyPanel();
    }
    if (
      isFull
      || has("leaders")
      || has("fleets")
      || has("planetStates")
      || has("visibility")
    ) {
      if (!releaseLeadersDetail) refreshLeadersPanel();
    }
    if (
      isFull
      || has("governments")
      || has("leaders")
      || has("technologies")
      || has("factionEconomies")
    ) {
      if (!releaseGovernmentDetail) refreshGovernmentPanel();
    }
    if (
      isFull
      || has("diplomacy")
      || has("visibility")
      || has("market")
      || has("clock")
    ) {
      if (!releaseDiplomacyDetail) refreshDiplomacyPanel();
    }
    if (
      isFull
      || has("species")
      || has("planetStates")
      || has("factionEconomies")
      || has("governments")
      || has("visibility")
    ) {
      if (!releaseSocietyDetail) refreshSocietyPanel();
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
    releaseSystemDetail();
    applyPlanetStatesToStars(snapshot.stars, snapshot.planetStates);

    const optionsForGalaxy: GalaxySceneOptions = {
      stars: snapshot.stars,
      nebulae: snapshot.nebulae,
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
      leaders: snapshot.leaders,
      starbaseSystemIds: getStarbaseSystemIds(),
      promotedStarbaseSystemIds: getPromotedStarbaseSystemIds(),
      starbases: snapshot.starbases,
      starOwnership: expandStarOwnership(),
      diplomacy: snapshot.diplomacy,
      visibleStarIds: snapshot.visibleStarIds,
      knownStarIds: snapshot.knownStarIds,
      selectedFleetIds,
      planetStates: snapshot.planetStates,
      technology: getCurrentFactionTechnology(),
      habitedPlanetSystemIds: snapshot.habitedPlanetSystemIds,
      onShipCommand: (action, targetStarId, fleetId) => {
        if (!fleetId) return;
        if (action === "move") {
          server.send({ type: "moveFleet", fleetId, targetStarId });
        } else if (action === "build") {
          server.send({ type: "buildStarbase", fleetId, targetStarId });
        } else if (action === "attack") {
          server.send({ type: "attackSystem", fleetId, targetStarId });
        } else if (action === "colonize") {
          setSelectedFleetIds([fleetId]);
          activeSystemScene?.selectFleetById(fleetId);
          activeSystemScene?.startFleetAction(fleetId, "colonize");
        } else if (action === "retreatTo") {
          server.send({ type: "retreatFleetTo", fleetId, targetStarId });
        } else if (action === "emergencyRetreatTo") {
          server.send({ type: "emergencyRetreatFleetTo", fleetId, targetStarId });
        }
      },
      onFleetCommand: (command) => server.send(command),
      onSelectedFleetIdsChange: setSelectedFleetIds,
      onPlanetCommand: sendPlanetCommand,
      onReleasePlanetDetails: releasePlanetDetail,
      onRequestStarbaseDetails: requestStarbaseDetails,
      onReleaseStarbaseDetails: releaseStarbaseDetail,
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
    const detailEvent = await server.requestDetail<SystemDetailPayload>("system", star.id);
    const systemPayload = detailEvent.payload ?? server.getCachedDetail<SystemDetailPayload>("system", star.id);
    if (!systemPayload || !("star" in systemPayload)) throw new Error("System details are unavailable.");
    cacheSystemDetails(systemPayload.star, systemPayload.planetStates);
    const systemStar = systemPayload.star;

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
        {
          playerShipSystemIds: getFleetSystemIds(),
          systemPayload,
          nebula: findNebulaForStar(snapshot.nebulae, systemStar.id),
          serverFleets: systemPayload.fleets,
          serverShips: systemPayload.ships,
          shipDesigns: systemPayload.shipDesigns,
          recentCombatContacts: systemPayload.recentCombatContacts,
          combatProjectiles: systemPayload.combatProjectiles ?? [],
          starbaseSystemIds: systemPayload.starbases.map((starbase) => starbase.starId),
          starbases: systemPayload.starbases,
          factions: systemPayload.factions,
          starOwnership: expandStarOwnership(),
          diplomacy: snapshot.diplomacy,
          playerFactionId: snapshot.perspective.mode === "faction" ? snapshot.perspective.factionId : 0,
          playerShipStarId: getPrimaryFleetStarId(),
          shipTransit: getPrimaryTransit(),
          fleetSystemPositions: {},
          hyperlaneExits: systemPayload.hyperlaneExits,
          clockYear: getRenderClockYear(),
          selectedFleetIds,
          planetStates: systemPayload.planetStates,
          leaders: snapshot.leaders,
          technology: systemPayload.technology,
          onPlanetCommand: sendPlanetCommand,
          onFleetCommand: (command) => server.send(command),
          onReleasePlanetDetails: releasePlanetDetail,
          onRequestStarbaseDetails: requestStarbaseDetails,
          onReleaseStarbaseDetails: releaseStarbaseDetail,
          onGameplayFrame: updateSmoothGameplayFrame,
          onSelectedFleetIdsChange: setSelectedFleetIds,
          onRequestFleetActionInGalaxy: requestFleetActionInGalaxy,
          onRequestPlanetDetails: async (planetId) => {
            const planetDetails = await subscribePlanetDetail(planetId);
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

    subscribeSystemDetail(systemStar.id);
    applyVisualToggles();
    updateHud();
  }

  async function openFirstHabitedPlanetFromGalaxy(starId: number): Promise<void> {
    const systemDetails = await server.requestSystemDetails(starId);
    cacheSystemDetails(systemDetails.star, systemDetails.planetStates);
    const habitedState = systemDetails.planetStates.find((planetState) => planetState.isHabited);
    if (!habitedState) return;
    const cachedPlanet = systemDetails.star.system.planets[habitedState.planetIndex];
    if (cachedPlanet) activeGalaxyScene?.showPlanetDetails(systemDetails.star, cachedPlanet, habitedState, false);
    const planetDetails = await subscribePlanetDetail(habitedState.id);
    if (cachedPlanet && !activeGalaxyScene?.isShowingPlanetDetails(habitedState.id)) return;
    const star = cachePlanetDetails(planetDetails.starId, planetDetails.planet, planetDetails.planetState)
      ?? systemDetails.star;
    activeGalaxyScene?.showPlanetDetails(star, planetDetails.planet, planetDetails.planetState);
  }

  async function openPlanetFromManager(planetId: string): Promise<void> {
    const localEntry = (planetManagerDetail?.planets ?? getPlanetManagerFallbackPlanets())
      .find((entry) => entry.planetState.id === planetId);
    const pendingDetails = subscribePlanetDetail(planetId);
    let showedLocal = false;
    if (localEntry) {
      const localStar = cachePlanetDetails(localEntry.starId, localEntry.planet, localEntry.planetState);
      if (activeSystemScene && currentSystemStar?.id === localEntry.starId) {
        activeSystemScene.showPlanetDetails(localEntry.planet, localEntry.planetState, false);
        showedLocal = true;
      } else {
        if (!activeGalaxyScene) await openGalaxyView();
        if (localStar) {
          activeGalaxyScene?.showPlanetDetails(localStar, localEntry.planet, localEntry.planetState, false);
          showedLocal = true;
        }
      }
    }
    const planetDetails = await pendingDetails;
    if (showedLocal) {
      const stillShowingInSystem = activeSystemScene?.isShowingPlanetDetails(planetId) === true;
      const stillShowingInGalaxy = activeGalaxyScene?.isShowingPlanetDetails(planetId) === true;
      if (!stillShowingInSystem && !stillShowingInGalaxy) return;
    }
    const star = cachePlanetDetails(planetDetails.starId, planetDetails.planet, planetDetails.planetState);
    if (!star) return;
    if (activeSystemScene && currentSystemStar?.id === planetDetails.starId) {
      activeSystemScene.showPlanetDetails(planetDetails.planet, planetDetails.planetState);
      return;
    }
    if (!activeGalaxyScene) {
      await openGalaxyView();
    }
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
    onOpenEvent: (eventId) => {
      const event = snapshot.events?.find((candidate) => candidate.id === eventId);
      if (event) eventModal.show(event, snapshot.clock.year);
    },
    onOpenSituation: (situationId) => {
      const situation = snapshot.situations?.find((candidate) => candidate.id === situationId);
      if (situation) situationModal.show(situation);
    },
    onOpenMarket: () => openMarketPanel(),
  });
  server.onAccountResources((nextDarkMatter) => {
    const normalized = Number.isFinite(nextDarkMatter)
      ? Math.max(0, Math.floor(nextDarkMatter))
      : darkMatter;
    if (normalized === darkMatter) return;
    darkMatter = normalized;
    updateHud();
  });
  darkMatterRefreshTimer = window.setInterval(() => {
    void getPlayerProfile()
      .then((profile) => {
        const nextDarkMatter = Number.isFinite(profile.darkMatter)
          ? Math.max(0, Math.floor(profile.darkMatter))
          : 0;
        if (nextDarkMatter === darkMatter) return;
        darkMatter = nextDarkMatter;
        updateHud();
      })
      .catch(() => {
        // The account service can be temporarily unavailable while the game
        // server remains healthy; retain the last authoritative balance.
      });
  }, 60_000);

  const pressedCodes = new Set<string>();
  const handleKeyDown = (ev: KeyboardEvent) => {
    pressedCodes.add(ev.code);
    if (adminCommandsEnabled && ev.shiftKey && pressedCodes.has("KeyN") && pressedCodes.has("Digit2")) {
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
  const handleOpenLeadersPanel = (ev: Event): void => {
    const detail = (ev as CustomEvent<OpenLeadersPanelEventDetail>).detail;
    openLeadersPanel(detail?.assignmentTarget ?? null);
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
  window.addEventListener(OPEN_LEADERS_PANEL_EVENT, handleOpenLeadersPanel);

  reportProgress(0.5, "Starting galaxy command sequence");
  applyPlanetStatesToStars(snapshot.stars, snapshot.planetStates);
  await openGalaxyView();

  console.log("StellarFronts game running");

  return () => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener(OPEN_LEADERS_PANEL_EVENT, handleOpenLeadersPanel);
    if (darkMatterRefreshTimer !== null) window.clearInterval(darkMatterRefreshTimer);
    hud?.dispose();
    eventModal.dispose();
    situationModal.dispose();
    fleetManagerPanel?.dispose();
    planetOperationsPanel?.dispose();
    marketPanel?.dispose();
    technologyPanel?.dispose();
    leadersPanel?.dispose();
    governmentPanel?.dispose();
    diplomacyPanel?.dispose();
    societyPanel?.dispose();
    for (const release of releaseStarbaseDetails.values()) release();
    releaseStarbaseDetails.clear();
    for (const release of releasePlanetDetails.values()) release();
    releasePlanetDetails.clear();
    releaseSystemDetail();
    releaseSocietyDetail?.();
    adminCommandPanel?.dispose();
    server.dispose();
    mgr.dispose();
  };
}

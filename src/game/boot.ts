import { SceneManager } from "@/SceneManager";
import { GalaxyScene } from "@/scenes/GalaxyScene";
import { SystemScene } from "@/scenes/SystemScene";
import type { IGameScene } from "@/SceneManager";
import type { StarData } from "@/data/StarMap";
import type { GalaxyPerspective } from "@/data/Factions";
import type { GalaxySceneOptions, GalaxyViewState } from "@/scenes/GalaxyScene";
import { buildHyperlaneAdjacency } from "@/data/Hyperlanes";
import { HudOverlay } from "@/ui/HudOverlay";
import type { HudConnectedSystem, HudVisualToggles } from "@/ui/HudOverlay";
import { GameServerClient } from "./GameServerClient";
import type { GameSnapshot, ServerShip } from "./GameProtocol";

export interface BootOptions {
  perspective?: GalaxyPerspective;
  onProgress?: (progress: number, detail: string) => void;
}

export async function boot(container: HTMLDivElement, options: BootOptions = {}) {
  const canvas = container.querySelector("#renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas not found in container");

  const reportProgress = (progress: number, detail: string) => {
    options.onProgress?.(progress, detail);
  };

  const perspective: GalaxyPerspective = options.perspective ?? { mode: "observer" };

  reportProgress(0.08, "Connecting to game server");
  const server = new GameServerClient(perspective);
  let snapshot = await server.connect();

  reportProgress(0.28, "Receiving authoritative galaxy state");

  const mgr = new SceneManager();
  const engine = await mgr.initEngine(canvas);
  let isSwitching = false;
  let activeGalaxyScene: GalaxyScene | null = null;
  let activeSystemScene: SystemScene | null = null;
  let cachedGalaxyStars: StarData[] | null = snapshot.stars;
  let cachedGalaxyViewState: GalaxyViewState | null = null;
  let cachedHyperlaneAdjacency: number[][] = buildHyperlaneAdjacency(snapshot.hyperlanes, snapshot.stars.length);
  let currentSystemStar: StarData | null = null;
  let hud: HudOverlay | null = null;

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

  const getFactionHomeStarIds = (): number[] => snapshot.factions.map((faction) => faction.homeStarId);
  const getStarbaseSystemIds = (): number[] => snapshot.starbases.map((starbase) => starbase.starId);
  const getShipSystemIds = (): number[] => snapshot.ships.map((ship) => ship.currentStarId);

  const getPrimaryTransitShip = (): ServerShip | null => (
    snapshot.ships.find((ship) => ship.hyperlanePosition !== null) ?? null
  );

  const getPrimaryShipStarId = (): number => {
    if (perspective.mode === "faction") {
      const ownShip = snapshot.ships.find((ship) => ship.ownerId === perspective.factionId);
      if (ownShip) return ownShip.currentStarId;
    }
    return snapshot.ships[0]?.currentStarId ?? -1;
  };

  const getPrimaryTransit = () => {
    const ship = getPrimaryTransitShip();
    return ship?.hyperlanePosition
      ? {
        fromStarId: ship.hyperlanePosition.fromStarId,
        toStarId: ship.hyperlanePosition.toStarId,
        progress: ship.hyperlanePosition.progress,
      }
      : null;
  };

  const getShipSystemPositions = (): Record<number, { x: number; y: number; z: number }> => (
    Object.fromEntries(snapshot.ships.map((ship) => [ship.currentStarId, ship.systemPosition]))
  );

  const getConnectedSystems = (sourceStarId: number): HudConnectedSystem[] => {
    const stars = resolveRoutingStars();
    const visible = getVisibleStarSet();
    const sourceIndex = stars.findIndex((s) => s.id === sourceStarId);
    if (sourceIndex < 0 || sourceIndex >= cachedHyperlaneAdjacency.length) return [];

    return (cachedHyperlaneAdjacency[sourceIndex] ?? [])
      .map((neighborId) => stars[neighborId])
      .filter((star): star is StarData => !!star && (!visible || visible.has(star.id)))
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
      activeSystemScene.setShipSystemPositions(getShipSystemPositions());
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
    });
  }

  function applySnapshotToActiveScene(): void {
    cachedGalaxyStars = snapshot.stars;
    cachedHyperlaneAdjacency = buildHyperlaneAdjacency(snapshot.hyperlanes, snapshot.stars.length);

    if (activeGalaxyScene) {
      activeGalaxyScene.setVisibleStarIds(snapshot.visibleStarIds);
      activeGalaxyScene.setStarOwnerships(snapshot.starOwnership);
      activeGalaxyScene.setStarbaseSystemIds(getStarbaseSystemIds());
      activeGalaxyScene.setServerShips(snapshot.ships);
      activeGalaxyScene.setPlayerShipState(
        getPrimaryTransitShip()?.currentStarId ?? getPrimaryShipStarId(),
        getPrimaryTransit(),
      );
    }

    updateHud();
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

    const optionsForGalaxy: GalaxySceneOptions = {
      stars: snapshot.stars,
      factions: snapshot.factions,
      perspective,
      playerFactionId: perspective.mode === "faction" ? perspective.factionId : 0,
      playerShipStarId: getPrimaryTransitShip()?.currentStarId ?? getPrimaryShipStarId(),
      playerShipTransit: getPrimaryTransit(),
      playerShipSystemIds: getShipSystemIds(),
      serverShips: snapshot.ships,
      starbaseSystemIds: getStarbaseSystemIds(),
      starOwnership: snapshot.starOwnership,
      visibleStarIds: snapshot.visibleStarIds,
      onShipCommand: (action, targetStarId, shipId) => {
        if (!shipId) return;
        if (action === "move") {
          server.send({ type: "moveShip", shipId, targetStarId });
        } else if (action === "build") {
          server.send({ type: "buildStarbase", shipId, targetStarId });
        }
      },
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
    if (activeGalaxyScene) {
      cachedGalaxyViewState = activeGalaxyScene.captureViewState();
      activeGalaxyScene = null;
    }

    await switchScene(() => {
      const system = new SystemScene(
        engine,
        star,
        () => openGalaxyView(),
        snapshot.stars.length,
        {
          homeSystemStarIds: getFactionHomeStarIds(),
          playerShipSystemIds: getShipSystemIds(),
          starbaseSystemIds: getStarbaseSystemIds(),
          playerShipStarId: getPrimaryShipStarId(),
          shipTransit: getPrimaryTransit(),
          shipSystemPositions: getShipSystemPositions(),
        },
      );
      activeSystemScene = system;
      currentSystemStar = star;
      return system;
    });

    applyVisualToggles();
    updateHud();
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
  });

  server.onSnapshot((nextSnapshot) => {
    snapshot = nextSnapshot;
    applySnapshotToActiveScene();
  });

  window.addEventListener("keydown", (ev) => {
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
  });

  reportProgress(0.5, "Starting galaxy command sequence");
  await openGalaxyView();

  console.log("StellarFronts game running");
}

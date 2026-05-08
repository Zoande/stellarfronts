import { SceneManager } from "@/SceneManager";
import { buildHyperlaneAdjacency, buildHyperlanePairs, GalaxyScene } from "@/scenes/GalaxyScene";
import { SystemScene } from "@/scenes/SystemScene";
import type { IGameScene } from "@/SceneManager";
import { generateStarMap } from "@/data/StarMap";
import type { StarData } from "@/data/StarMap";
import { GALAXY_MAP } from "@/data/GalaxyMap";
import {
  buildFactions,
  FOG_OF_WAR_MAX_JUMPS,
} from "@/data/Factions";
import type { FactionInfo, GalaxyPerspective } from "@/data/Factions";
import type { GalaxySceneOptions, GalaxyViewState } from "@/scenes/GalaxyScene";
import { HudOverlay } from "@/ui/HudOverlay";
import type { HudConnectedSystem, HudVisualToggles } from "@/ui/HudOverlay";

export interface BootOptions {
  perspective?: GalaxyPerspective;
  onProgress?: (progress: number, detail: string) => void;
}

/**
 * Boot the game with a selectable perspective.
 */
export async function boot(container: HTMLDivElement, options: BootOptions = {}) {
  const canvas = container.querySelector("#renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas not found in container");

  const reportProgress = (progress: number, detail: string) => {
    options.onProgress?.(progress, detail);
  };

  const perspective: GalaxyPerspective = options.perspective ?? { mode: "observer" };

  reportProgress(0.05, "Charting galaxy star map");

  const cfg = GALAXY_MAP;
  const initialStars = generateStarMap(
    cfg.width,
    cfg.height,
    cfg.starCount,
    cfg.seed,
    cfg.minStarSpacing,
    cfg.shape,
  );

  reportProgress(0.2, "Mapping factions and ownership");

  const factions: FactionInfo[] = buildFactions(initialStars, cfg);

  reportProgress(0.35, "Initializing galaxy renderer");

  const mgr = new SceneManager();
  const engine = await mgr.initEngine(canvas);
  let isSwitching = false;
  let activeGalaxyScene: GalaxyScene | null = null;
  let activeSystemScene: SystemScene | null = null;
  let cachedGalaxyStars: StarData[] | null = initialStars;
  let cachedGalaxyViewState: GalaxyViewState | null = null;
  let cachedHyperlaneAdjacency: number[][] = [];
  let currentSystemStar: StarData | null = null;

  const visualToggles: HudVisualToggles = {
    hyperlanes: true,
    bloom: true,
    centerCloud: true,
    stars: true,
    ownership: true,
  };

  const resolveRoutingStars = (): StarData[] => {
    if (cachedGalaxyStars && cachedGalaxyStars.length > 0) return cachedGalaxyStars;
    if (activeGalaxyScene) return activeGalaxyScene.getStars();
    return [];
  };

  const getPerspectiveVisibleStars = (): Set<number> | null => {
    return null;
  };

  const rebuildHyperlaneAdjacency = (stars: StarData[]): void => {
    if (stars.length === 0) {
      cachedHyperlaneAdjacency = [];
      return;
    }
    const pairs = buildHyperlanePairs(
      stars,
      GALAXY_MAP.width,
      GALAXY_MAP.height,
      GALAXY_MAP.shape,
      GALAXY_MAP.seed,
    );
    cachedHyperlaneAdjacency = buildHyperlaneAdjacency(pairs, stars.length);
  };

  const getConnectedSystems = (sourceStarId: number): HudConnectedSystem[] => {
    const stars = resolveRoutingStars();
    if (stars.length === 0) return [];

    const sourceIndex = stars.findIndex((s) => s.id === sourceStarId);
    if (sourceIndex < 0 || sourceIndex >= cachedHyperlaneAdjacency.length) return [];

    const targets: HudConnectedSystem[] = [];
    const visibleStarIds = getPerspectiveVisibleStars();
    const neighborIndices = cachedHyperlaneAdjacency[sourceIndex] ?? [];
    for (const neighborIndex of neighborIndices) {
      const targetStar = stars[neighborIndex];
      if (!targetStar) continue;
      if (visibleStarIds && !visibleStarIds.has(targetStar.id)) continue;
      targets.push({ id: targetStar.id, name: targetStar.name });
    }
    return targets;
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
    }
  };

  let hud: HudOverlay;

  function updateHud(): void {
    const connectedSystems = currentSystemStar
      ? getConnectedSystems(currentSystemStar.id)
      : [];

    hud.update({
      title: currentSystemStar ? `${currentSystemStar.name} System` : "Galaxy Map",
      canExitSystem: currentSystemStar !== null,
      connectedSystems,
      toggles: visualToggles,
    });
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
    reportProgress(0.6, "Loading galaxy scene");

    const factionHomeStarIds = factions.map((faction) => faction.homeStarId);
    const options: GalaxySceneOptions = {
      factions,
      perspective,
      playerFactionId: perspective.mode === "faction" ? perspective.factionId : 0,
      playerShipSystemIds: factionHomeStarIds,
      starbaseSystemIds: factionHomeStarIds,
      visibilityJumps: FOG_OF_WAR_MAX_JUMPS,
    };
    if (cachedGalaxyStars && cachedGalaxyStars.length > 0) {
      options.stars = cachedGalaxyStars;
    }
    if (cachedGalaxyViewState) {
      options.initialViewState = cachedGalaxyViewState;
    }

    await switchScene(() => {
      const galaxy = new GalaxyScene(engine, (star) => openSystemView(star), options);
      activeGalaxyScene = galaxy;
      activeSystemScene = null;
      currentSystemStar = null;
      return galaxy;
    });

    reportProgress(0.88, "Applying visibility and HUD layers");

    if (activeGalaxyScene) {
      cachedGalaxyStars = activeGalaxyScene.getStars();
      rebuildHyperlaneAdjacency(cachedGalaxyStars);
    }

    applyVisualToggles();
    updateHud();
    reportProgress(1, "Galaxy command is ready");
  }

  async function openSystemView(star: StarData): Promise<void> {
    if (activeGalaxyScene) {
      cachedGalaxyStars = activeGalaxyScene.getStars();
      cachedGalaxyViewState = activeGalaxyScene.captureViewState();
      activeGalaxyScene = null;
    }

    if (cachedGalaxyStars && cachedHyperlaneAdjacency.length !== cachedGalaxyStars.length) {
      rebuildHyperlaneAdjacency(cachedGalaxyStars);
    }

    await switchScene(() => {
      const actualStarCount = cachedGalaxyStars ? cachedGalaxyStars.length : 500;
      const factionHomeStarIds = factions.map((faction) => faction.homeStarId);
      const system = new SystemScene(
        engine,
        star,
        () => openGalaxyView(),
        actualStarCount,
        {
          homeSystemStarIds: factionHomeStarIds,
          playerShipSystemIds: factionHomeStarIds,
          starbaseSystemIds: factionHomeStarIds,
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
      const stars = resolveRoutingStars();
      const target = stars.find((s) => s.id === targetId);
      if (!target) return;
      void openSystemView(target);
    },
    onToggleVisual: (key, enabled) => {
      visualToggles[key] = enabled;
      applyVisualToggles();
      updateHud();
    },
  });

  reportProgress(0.5, "Starting galaxy command sequence");
  await openGalaxyView();

  console.log("StellarFronts game running");
}

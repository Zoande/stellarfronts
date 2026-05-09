import { SceneManager } from "@/SceneManager";
import { GalaxyScene } from "@/scenes/GalaxyScene";
import { SystemScene } from "@/scenes/SystemScene";
import type { IGameScene } from "@/SceneManager";
import {
  ensureHabitedHomePlanets,
  generateStarMap,
  normalizeCelestialObjectDetails,
} from "@/data/StarMap";
import type { StarData } from "@/data/StarMap";
import { GALAXY_MAP } from "@/data/GalaxyMap";
import { buildHyperlaneAdjacency, buildHyperlanePairs } from "@/data/Hyperlanes";
import {
  buildFactions,
  computeVisibleStarIds,
  FOG_OF_WAR_MAX_JUMPS,
} from "@/data/Factions";
import type { FactionInfo, GalaxyPerspective } from "@/data/Factions";
import type { GalaxySceneOptions, GalaxyViewState } from "@/scenes/GalaxyScene";
import { HudOverlay } from "@/ui/HudOverlay";
import type { HudConnectedSystem, HudVisualToggles } from "@/ui/HudOverlay";
import { LoginOverlay } from "@/ui/LoginOverlay";

async function boot() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  if (!canvas) throw new Error("Canvas not found");

  const cfg = GALAXY_MAP;
  const initialStars = generateStarMap(
    cfg.width,
    cfg.height,
    cfg.starCount,
    cfg.seed,
    cfg.minStarSpacing,
    cfg.shape,
  );
  const factions: FactionInfo[] = buildFactions(initialStars, cfg);
  const login = new LoginOverlay(factions);
  const perspective: GalaxyPerspective = await login.show();
  login.dispose();

  const mgr = new SceneManager();
  const engine = await mgr.initEngine(canvas);
  let isSwitching = false;
  let activeGalaxyScene: GalaxyScene | null = null;
  let activeSystemScene: SystemScene | null = null;
  let cachedGalaxyStars: StarData[] | null = initialStars;
  let cachedGalaxyViewState: GalaxyViewState | null = null;
  let cachedHyperlaneAdjacency: number[][] = [];
  let currentSystemStar: StarData | null = null;

  const normalizeLocalStars = (stars: StarData[], homeStarIds: Iterable<number>): void => {
    normalizeCelestialObjectDetails(stars);
    ensureHabitedHomePlanets(stars, homeStarIds);
  };

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
    if (perspective.mode === "observer") return null;
    const faction = factions.find((f) => f.id === perspective.factionId);
    if (!faction) return new Set<number>();
    return computeVisibleStarIds(
      cachedHyperlaneAdjacency,
      faction.homeStarId,
      FOG_OF_WAR_MAX_JUMPS,
    );
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
    const factionHomeStarIds = factions.map((faction) => faction.homeStarId);
    if (cachedGalaxyStars && cachedGalaxyStars.length > 0) {
      normalizeLocalStars(cachedGalaxyStars, factionHomeStarIds);
    }
    const options: GalaxySceneOptions = {
      factions,
      perspective,
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

    if (activeGalaxyScene) {
      cachedGalaxyStars = activeGalaxyScene.getStars();
      normalizeLocalStars(cachedGalaxyStars, factionHomeStarIds);
      rebuildHyperlaneAdjacency(cachedGalaxyStars);
    }

    applyVisualToggles();
    updateHud();
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
      if (cachedGalaxyStars && cachedGalaxyStars.length > 0) {
        normalizeLocalStars(cachedGalaxyStars, factionHomeStarIds);
      }
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

  await openGalaxyView();

  console.log("Space Strategy prototype running");
}

boot().catch(console.error);

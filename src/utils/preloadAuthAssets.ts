import { SHIP_MODEL_DEFINITIONS, STARBASE_MODEL_DEFINITIONS } from "../data/Starbase";

type AuthPreloadProgress = {
  progress: number;
  detail: string;
};

type ProgressListener = (state: AuthPreloadProgress) => void;

const listeners = new Set<ProgressListener>();
let preloadPromise: Promise<void> | null = null;

function emitProgress(state: AuthPreloadProgress): void {
  for (const listener of listeners) {
    listener(state);
  }
}

function loadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
}

async function fetchAsset(src: string): Promise<void> {
  try {
    const response = await fetch(src, { cache: 'force-cache' });
    if (!response.ok) return;
    await response.arrayBuffer();
  } catch {
    // Warm what we can and keep the app moving.
  }
}

type PreloadStep = {
  detail: string;
  load: () => Promise<void>;
};

const preloadSteps: PreloadStep[] = [
  {
    detail: 'Loading command branding and login interface assets',
    load: () => Promise.all([
      loadImage('/branding/stellarfrontslogo.webp'),
      loadImage('/branding/stellarfrontslogonotext-transparent.png'),
      loadImage('/textures/own_ship_icon.webp'),
      loadImage('/flag-previews/aurora-vanguard.webp'),
    ]).then(() => undefined),
  },
  {
    detail: 'Decoding star glow and surface textures',
    load: () => Promise.all([
      loadImage('/textures/star.glow.webp'),
      loadImage('/textures/star_surface.webp'),
    ]).then(() => undefined),
  },
  {
    detail: 'Loading planet textures: gas giant, rocky, and ice',
    load: () => Promise.all([
      loadImage('/textures/gas_giant.webp'),
      loadImage('/textures/rocky_planet.webp'),
      loadImage('/textures/ice_planet.webp'),
      loadImage('/textures/planets/Arid/Arid_01-1024x512.webp'),
      loadImage('/textures/planet-banners/Grassland_banner_city.webp'),
      loadImage('/textures/planet-banners/Star_A_banner.webp'),
      loadImage('/textures/starbase/Starbase_banner.webp'),
    ]).then(() => undefined),
  },
  {
    detail: 'Fetching starbase GLB models',
    load: () => Promise.all(
      Object.values(STARBASE_MODEL_DEFINITIONS).map((definition) => (
        fetchAsset(`${definition.modelPath}${definition.modelFile}`)
      )),
    ).then(() => undefined),
  },
  {
    detail: 'Fetching ship GLB models',
    load: () => Promise.all(
      Object.values(SHIP_MODEL_DEFINITIONS).map((definition) => (
        fetchAsset(`${definition.modelPath}${definition.modelFile}`)
      )),
    ).then(() => undefined),
  },
];

async function runPreload(): Promise<void> {
  const total = preloadSteps.length;
  emitProgress({ progress: 0, detail: 'Preparing auth assets' });

  for (let index = 0; index < preloadSteps.length; index += 1) {
    const step = preloadSteps[index];
    emitProgress({
      progress: index / total,
      detail: step.detail,
    });
    await step.load();
    emitProgress({
      progress: (index + 1) / total,
      detail: step.detail,
    });
  }

  emitProgress({
    progress: 1,
    detail: 'Auth background assets are ready',
  });
}

export function preloadAuthAssets(onProgress?: ProgressListener): Promise<void> {
  if (onProgress) {
    listeners.add(onProgress);
  }

  if (!preloadPromise) {
    preloadPromise = runPreload().catch(() => undefined);
  }

  return preloadPromise.finally(() => {
    if (onProgress) {
      listeners.delete(onProgress);
    }
  });
}

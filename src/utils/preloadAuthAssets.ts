import loginBackdrop from '../../background login.png';
import lobbyBackdrop from '../../backgroudn lobby.png';
import stellarLogo from '../../logosteller.png';

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

type PreloadStep = {
  detail: string;
  load: () => Promise<void>;
};

const preloadSteps: PreloadStep[] = [
  {
    detail: 'Loading StellarFronts launcher artwork',
    load: () => Promise.all([
      loadImage(loginBackdrop),
      loadImage(stellarLogo),
    ]).then(() => undefined),
  },
  {
    detail: 'Loading command center background',
    load: () => Promise.all([
      loadImage(lobbyBackdrop),
      loadImage('/textures/planets/Methane/Methane_04-1024x512.png'),
      loadImage('/textures/planets/Martian/Martian_03-1024x512.png'),
    ]).then(() => undefined),
  },
  {
    detail: 'Warming galaxy map textures',
    load: () => Promise.all([
      loadImage('/textures/galaxy_bg.png'),
      loadImage('/textures/star.glow.png'),
      loadImage('/textures/gas_giant.png'),
    ]).then(() => undefined),
  },
];

async function runPreload(): Promise<void> {
  const total = preloadSteps.length;
  emitProgress({ progress: 0, detail: 'Preparing login station' });

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
    detail: 'Command launcher is ready',
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

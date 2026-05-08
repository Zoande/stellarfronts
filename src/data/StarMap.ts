/**
 * StarMap  Star type definitions and procedural star generation.
 * Generates a deterministic field of stars using a seeded PRNG.
 * Each star includes visual metadata used by both galaxy and system views.
 */

/*  Star spectral types  */

export enum StarType {
  B = "B",
  A = "A",
  F = "F",
  G = "G",
  K = "K",
  M = "M",
  MRedGiant = "M Red Giant",
  TBrownDwarf = "T Brown Dwarf",
  NeutronStar = "Neutron Star",
  Pulsar = "Pulsar",
  BlackHole = "Black Hole",
}

export type StarVisualKind =
  | "main-sequence"
  | "red-giant"
  | "brown-dwarf"
  | "neutron-star"
  | "pulsar"
  | "black-hole";

export interface StarTypeConfig {
  /** Base RGB color [0-1] */
  color: [number, number, number];
  /** Visual luminosity range (affects galaxy glow size) */
  luminosityMin: number;
  luminosityMax: number;
  /** Spawn probability weight */
  weight: number;
  /** Base star size hint for system view */
  systemDiameter: number;
  /** High-level visual family used by system renderer */
  kind: StarVisualKind;

  /** Galaxy-view sprite modifiers */
  galaxyCoreScale: number;
  galaxyHaloScale: number;
  galaxyColorPreservation: number;

  /** Galaxy-view pulse ranges */
  galaxyPulseAmplitude: [number, number];
  galaxyPulseFrequency: [number, number];
}

export const STAR_TYPES: Record<StarType, StarTypeConfig> = {
  [StarType.B]: {
    color: [0.57, 0.72, 1.0],
    luminosityMin: 1.9,
    luminosityMax: 2.7,
    weight: 4,
    systemDiameter: 7.4,
    kind: "main-sequence",
    galaxyCoreScale: 1.2,
    galaxyHaloScale: 1.35,
    galaxyColorPreservation: 0.45,
    galaxyPulseAmplitude: [0.03, 0.08],
    galaxyPulseFrequency: [0.7, 1.4],
  },
  [StarType.A]: {
    color: [0.86, 0.93, 1.0],
    luminosityMin: 1.45,
    luminosityMax: 2.1,
    weight: 8,
    systemDiameter: 6.6,
    kind: "main-sequence",
    galaxyCoreScale: 1.1,
    galaxyHaloScale: 1.2,
    galaxyColorPreservation: 0.38,
    galaxyPulseAmplitude: [0.02, 0.05],
    galaxyPulseFrequency: [0.6, 1.0],
  },
  [StarType.F]: {
    color: [1.0, 0.96, 0.86],
    luminosityMin: 1.1,
    luminosityMax: 1.55,
    weight: 14,
    systemDiameter: 5.8,
    kind: "main-sequence",
    galaxyCoreScale: 1.02,
    galaxyHaloScale: 1.08,
    galaxyColorPreservation: 0.35,
    galaxyPulseAmplitude: [0.01, 0.03],
    galaxyPulseFrequency: [0.5, 0.9],
  },
  [StarType.G]: {
    color: [1.0, 0.92, 0.7],
    luminosityMin: 0.95,
    luminosityMax: 1.35,
    weight: 17,
    systemDiameter: 5.2,
    kind: "main-sequence",
    galaxyCoreScale: 1.0,
    galaxyHaloScale: 1.0,
    galaxyColorPreservation: 0.36,
    galaxyPulseAmplitude: [0.01, 0.025],
    galaxyPulseFrequency: [0.45, 0.8],
  },
  [StarType.K]: {
    color: [1.0, 0.76, 0.46],
    luminosityMin: 0.75,
    luminosityMax: 1.1,
    weight: 18,
    systemDiameter: 4.8,
    kind: "main-sequence",
    galaxyCoreScale: 0.96,
    galaxyHaloScale: 0.92,
    galaxyColorPreservation: 0.45,
    galaxyPulseAmplitude: [0.01, 0.03],
    galaxyPulseFrequency: [0.55, 0.95],
  },
  [StarType.M]: {
    color: [1.0, 0.52, 0.28],
    luminosityMin: 0.38,
    luminosityMax: 0.72,
    weight: 24,
    systemDiameter: 4.1,
    kind: "main-sequence",
    galaxyCoreScale: 0.85,
    galaxyHaloScale: 0.8,
    galaxyColorPreservation: 0.58,
    galaxyPulseAmplitude: [0.02, 0.06],
    galaxyPulseFrequency: [0.7, 1.3],
  },
  [StarType.MRedGiant]: {
    color: [1.0, 0.43, 0.22],
    luminosityMin: 1.65,
    luminosityMax: 2.4,
    weight: 5,
    systemDiameter: 10.5,
    kind: "red-giant",
    galaxyCoreScale: 1.25,
    galaxyHaloScale: 2.0,
    galaxyColorPreservation: 0.62,
    galaxyPulseAmplitude: [0.03, 0.08],
    galaxyPulseFrequency: [0.4, 0.8],
  },
  [StarType.TBrownDwarf]: {
    color: [0.58, 0.34, 0.3],
    luminosityMin: 0.12,
    luminosityMax: 0.24,
    weight: 5,
    systemDiameter: 3.5,
    kind: "brown-dwarf",
    galaxyCoreScale: 0.55,
    galaxyHaloScale: 0.45,
    galaxyColorPreservation: 0.75,
    galaxyPulseAmplitude: [0.02, 0.08],
    galaxyPulseFrequency: [0.8, 1.6],
  },
  [StarType.NeutronStar]: {
    color: [0.76, 0.86, 1.0],
    luminosityMin: 0.6,
    luminosityMax: 1.0,
    weight: 1.5,
    systemDiameter: 1.8,
    kind: "neutron-star",
    galaxyCoreScale: 0.65,
    galaxyHaloScale: 0.85,
    galaxyColorPreservation: 0.44,
    galaxyPulseAmplitude: [0.08, 0.18],
    galaxyPulseFrequency: [1.8, 3.4],
  },
  [StarType.Pulsar]: {
    color: [0.72, 0.84, 1.0],
    luminosityMin: 0.68,
    luminosityMax: 1.1,
    weight: 0.9,
    systemDiameter: 1.5,
    kind: "pulsar",
    galaxyCoreScale: 0.72,
    galaxyHaloScale: 0.95,
    galaxyColorPreservation: 0.4,
    galaxyPulseAmplitude: [0.55, 0.85],
    galaxyPulseFrequency: [3.5, 6.8],
  },
  [StarType.BlackHole]: {
    color: [0.3, 0.24, 0.22],
    luminosityMin: 0.18,
    luminosityMax: 0.35,
    weight: 0.6,
    systemDiameter: 3.0,
    kind: "black-hole",
    galaxyCoreScale: 0.42,
    galaxyHaloScale: 0.82,
    galaxyColorPreservation: 0.85,
    galaxyPulseAmplitude: [0.05, 0.12],
    galaxyPulseFrequency: [0.9, 1.6],
  },
};

/*  Per-star data interfaces  */

export enum PlanetType {
  Barren = "Barren",
  Gaseous = "Gaseous",
  Snowy = "Snowy",
  Arid = "Arid",
  Dusty = "Dusty",
  Grassland = "Grassland",
  Jungle = "Jungle",
  Marshy = "Marshy",
  Martian = "Martian",
  Methane = "Methane",
  Sandy = "Sandy",
  Tundra = "Tundra",
}

export interface PlanetTypeConfig {
  /** Friendly display name */
  name: string;
  /** Texture path prefix (no extension) */
  texturePrefix: string;
  /** Number of texture variations available */
  variations: number;
  /** Spawn probability weight per star visual kind */
  weightByStarKind: Record<StarVisualKind, number>;
  /** Size range for this planet type */
  diameterMin: number;
  diameterMax: number;
  /** Orbit speed multiplier */
  orbitSpeedMultiplier: number;
}

export const PLANET_TYPES: Record<PlanetType, PlanetTypeConfig> = {
  [PlanetType.Barren]: {
    name: "Barren",
    texturePrefix: "/textures/planets/Barren/Barren",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 18,
      "red-giant": 15,
      "brown-dwarf": 12,
      "neutron-star": 20,
      "pulsar": 15,
      "black-hole": 25,
    },
    diameterMin: 0.9,
    diameterMax: 2.1,
    orbitSpeedMultiplier: 0.35,
  },
  [PlanetType.Gaseous]: {
    name: "Gaseous",
    texturePrefix: "/textures/planets/Gaseous/Gaseous",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 22,
      "red-giant": 25,
      "brown-dwarf": 35,
      "neutron-star": 15,
      "pulsar": 12,
      "black-hole": 20,
    },
    diameterMin: 2.0,
    diameterMax: 4.5,
    orbitSpeedMultiplier: 0.12,
  },
  [PlanetType.Snowy]: {
    name: "Snowy",
    texturePrefix: "/textures/planets/Snowy/Snowy",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 12,
      "red-giant": 8,
      "brown-dwarf": 8,
      "neutron-star": 10,
      "pulsar": 8,
      "black-hole": 5,
    },
    diameterMin: 0.7,
    diameterMax: 1.7,
    orbitSpeedMultiplier: 0.45,
  },
  [PlanetType.Arid]: {
    name: "Arid",
    texturePrefix: "/textures/planets/Arid/Arid",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 16,
      "red-giant": 14,
      "brown-dwarf": 10,
      "neutron-star": 8,
      "pulsar": 10,
      "black-hole": 8,
    },
    diameterMin: 0.8,
    diameterMax: 1.9,
    orbitSpeedMultiplier: 0.38,
  },
  [PlanetType.Dusty]: {
    name: "Dusty",
    texturePrefix: "/textures/planets/Dusty/Dusty",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 14,
      "red-giant": 12,
      "brown-dwarf": 11,
      "neutron-star": 12,
      "pulsar": 14,
      "black-hole": 10,
    },
    diameterMin: 0.85,
    diameterMax: 1.95,
    orbitSpeedMultiplier: 0.4,
  },
  [PlanetType.Grassland]: {
    name: "Grassland",
    texturePrefix: "/textures/planets/Grassland/Grassland",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 15,
      "red-giant": 10,
      "brown-dwarf": 5,
      "neutron-star": 5,
      "pulsar": 5,
      "black-hole": 2,
    },
    diameterMin: 0.9,
    diameterMax: 1.8,
    orbitSpeedMultiplier: 0.36,
  },
  [PlanetType.Jungle]: {
    name: "Jungle",
    texturePrefix: "/textures/planets/Jungle/Jungle",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 12,
      "red-giant": 8,
      "brown-dwarf": 3,
      "neutron-star": 2,
      "pulsar": 2,
      "black-hole": 1,
    },
    diameterMin: 0.95,
    diameterMax: 2.0,
    orbitSpeedMultiplier: 0.34,
  },
  [PlanetType.Marshy]: {
    name: "Marshy",
    texturePrefix: "/textures/planets/Marshy/Marshy",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 11,
      "red-giant": 9,
      "brown-dwarf": 4,
      "neutron-star": 3,
      "pulsar": 3,
      "black-hole": 2,
    },
    diameterMin: 0.88,
    diameterMax: 1.85,
    orbitSpeedMultiplier: 0.37,
  },
  [PlanetType.Martian]: {
    name: "Martian",
    texturePrefix: "/textures/planets/Martian/Martian",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 13,
      "red-giant": 11,
      "brown-dwarf": 9,
      "neutron-star": 11,
      "pulsar": 13,
      "black-hole": 9,
    },
    diameterMin: 0.82,
    diameterMax: 1.92,
    orbitSpeedMultiplier: 0.39,
  },
  [PlanetType.Methane]: {
    name: "Methane",
    texturePrefix: "/textures/planets/Methane/Methane",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 18,
      "red-giant": 20,
      "brown-dwarf": 30,
      "neutron-star": 12,
      "pulsar": 10,
      "black-hole": 15,
    },
    diameterMin: 2.1,
    diameterMax: 4.2,
    orbitSpeedMultiplier: 0.15,
  },
  [PlanetType.Sandy]: {
    name: "Sandy",
    texturePrefix: "/textures/planets/Sandy/Sandy",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 14,
      "red-giant": 12,
      "brown-dwarf": 8,
      "neutron-star": 9,
      "pulsar": 11,
      "black-hole": 7,
    },
    diameterMin: 0.8,
    diameterMax: 1.9,
    orbitSpeedMultiplier: 0.38,
  },
  [PlanetType.Tundra]: {
    name: "Tundra",
    texturePrefix: "/textures/planets/Tundra/Tundra",
    variations: 5,
    weightByStarKind: {
      "main-sequence": 10,
      "red-giant": 6,
      "brown-dwarf": 6,
      "neutron-star": 8,
      "pulsar": 6,
      "black-hole": 4,
    },
    diameterMin: 0.75,
    diameterMax: 1.8,
    orbitSpeedMultiplier: 0.46,
  },
};

export interface PlanetConfig {
  type: PlanetType;
  textureVariation: number;
  diameter: number;
  orbitRadius: number;
  orbitSpeed: number;
  name: string;
  isHabited?: boolean;
}

export interface StarSystemConfig {
  planets: PlanetConfig[];
}

export interface StarData {
  id: number;
  name: string;
  type: StarType;
  x: number;
  z: number;
  luminosity: number;
  /** Per-star color (slightly varied from type base color) */
  color: [number, number, number];
  /** Galaxy-view pulse amplitude used by sprite renderer */
  galaxyPulseAmplitude: number;
  /** Galaxy-view pulse frequency used by sprite renderer */
  galaxyPulseFrequency: number;
  system: StarSystemConfig;
}

/*  Seeded PRNG (Mulberry32)  */

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*  Name generator  */

const NAME_PREFIXES = [
  "Al", "Be", "Ca", "De", "El", "Fa", "Ga", "Ha", "Ir", "Ja",
  "Ka", "Le", "Ma", "Na", "Or", "Pa", "Qu", "Ra", "Sa", "Ta",
  "Ul", "Va", "Wa", "Xa", "Za", "An", "Br", "Cr", "Dr", "Er",
  "Fi", "Gl", "Hy", "In", "Ju", "Kr", "Lo", "Mi", "No", "Ob",
  "Pr", "Ri", "Si", "Th", "Un", "Ve", "Wy", "Xe", "Yo", "Zi",
];

const NAME_SUFFIXES = [
  "thar", "rius", "gon", "nia", "pha", "dra", "tos", "lux",
  "nix", "vos", "rae", "tis", "lon", "mus", "pex", "kra",
  "zel", "bur", "dan", "fer", "hol", "jun", "kel", "mir",
  "nor", "pul", "rem", "sol", "tar", "ven", "wis", "xar",
  "yan", "zor", "ath", "bis", "cor", "div", "eon", "fyr",
];

const NAME_DESIGNATIONS = [
  "", "", "", "", "", "", "", "", "", "",
  " Prime", " Major", " Minor",
  "-\u03b1", "-\u03b2", "-\u03b3", "-\u03b4",
  " I", " II", " III",
];

/*  Generator  */

export function generateStarMap(
  width: number,
  height: number,
  count: number,
  seed: number,
  minDist: number,
  shape?: {
    innerRadiusFraction: number;
    outerRadiusFraction: number;
    spiralArms: number;
    spiralTightness: number;
    armSpread: number;
  },
): StarData[] {
  const rng = mulberry32(seed);
  const minDistSq = minDist * minDist;

  const cellSize = minDist;
  const grid = new Map<string, Array<{ x: number; z: number }>>();

  function gridKey(x: number, z: number): string {
    return `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
  }

  function insertGrid(x: number, z: number): void {
    const key = gridKey(x, z);
    let cell = grid.get(key);
    if (!cell) {
      cell = [];
      grid.set(key, cell);
    }
    cell.push({ x, z });
  }

  function isTooClose(x: number, z: number): boolean {
    const gx = Math.floor(x / cellSize);
    const gz = Math.floor(z / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = grid.get(`${gx + dx},${gz + dz}`);
        if (!cell) continue;
        for (const s of cell) {
          const ddx = x - s.x;
          const ddz = z - s.z;
          if (ddx * ddx + ddz * ddz < minDistSq) return true;
        }
      }
    }
    return false;
  }

  const typeEntries = Object.entries(STAR_TYPES) as [StarType, StarTypeConfig][];
  const totalWeight = typeEntries.reduce((sum, [, config]) => sum + config.weight, 0);

  function pickType(): StarType {
    let r = rng() * totalWeight;
    for (const [type, config] of typeEntries) {
      r -= config.weight;
      if (r <= 0) return type;
    }
    return StarType.G;
  }

  function generateName(): string {
    const p = NAME_PREFIXES[Math.floor(rng() * NAME_PREFIXES.length)];
    const s = NAME_SUFFIXES[Math.floor(rng() * NAME_SUFFIXES.length)];
    const d = NAME_DESIGNATIONS[Math.floor(rng() * NAME_DESIGNATIONS.length)];
    return `${p}${s}${d}`;
  }

  function pickPlanetType(kind: StarVisualKind): PlanetType {
    const typeEntries = Object.entries(PLANET_TYPES) as [PlanetType, PlanetTypeConfig][];
    const totalWeight = typeEntries.reduce((sum, [, cfg]) => sum + cfg.weightByStarKind[kind], 0);
    
    let r = rng() * totalWeight;
    for (const [type, cfg] of typeEntries) {
      r -= cfg.weightByStarKind[kind];
      if (r <= 0) return type;
    }
    return PlanetType.Barren;
  }

  function generatePlanets(starType: StarType, starName: string): PlanetConfig[] {
    const typeCfg = STAR_TYPES[starType];

    let minPlanets = 1;
    let maxPlanets = 4;
    let baseOrbit = 7;
    let orbitSpacing = 5;
    let orbitSpeedScale = 1;

    switch (typeCfg.kind) {
      case "red-giant":
        minPlanets = 2;
        maxPlanets = 5;
        baseOrbit = 22;
        orbitSpacing = 8;
        orbitSpeedScale = 0.7;
        break;
      case "brown-dwarf":
        minPlanets = 0;
        maxPlanets = 3;
        baseOrbit = 10;
        orbitSpacing = 5;
        orbitSpeedScale = 1.1;
        break;
      case "neutron-star":
        minPlanets = 0;
        maxPlanets = 3;
        baseOrbit = 12;
        orbitSpacing = 6;
        orbitSpeedScale = 1.25;
        break;
      case "pulsar":
        minPlanets = 0;
        maxPlanets = 3;
        baseOrbit = 14;
        orbitSpacing = 6;
        orbitSpeedScale = 1.4;
        break;
      case "black-hole":
        minPlanets = 0;
        maxPlanets = 2;
        baseOrbit = 18;
        orbitSpacing = 9;
        orbitSpeedScale = 0.9;
        break;
      default:
        break;
    }

    const numPlanets = minPlanets + Math.floor(rng() * (maxPlanets - minPlanets + 1));
    if (numPlanets === 0) return [];

    const planets: PlanetConfig[] = [];
    for (let i = 0; i < numPlanets; i++) {
      const planetType = pickPlanetType(typeCfg.kind);
      const planetCfg = PLANET_TYPES[planetType];
      const textureVar = Math.floor(rng() * planetCfg.variations);
      const diameter = planetCfg.diameterMin + rng() * (planetCfg.diameterMax - planetCfg.diameterMin);
      const orbitSpeed = (0.2 + rng() * 0.3) * planetCfg.orbitSpeedMultiplier * orbitSpeedScale;
      const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
      const planetName = `${starName} ${romanNumerals[i] || i + 1}`;

      planets.push({
        type: planetType,
        textureVariation: textureVar,
        diameter,
        orbitRadius: baseOrbit + i * orbitSpacing + rng() * (orbitSpacing * 0.8),
        orbitSpeed,
        name: planetName,
      });
    }

    return planets;
  }

  const halfSize = Math.min(width, height) / 2;
  const innerR = shape ? halfSize * shape.innerRadiusFraction : 0;
  const outerR = shape ? halfSize * shape.outerRadiusFraction : halfSize * 0.95;
  const arms = shape?.spiralArms ?? 0;
  const tightness = shape?.spiralTightness ?? 0;
  const armSpread = shape?.armSpread ?? 1;

  function samplePosition(): { x: number; z: number } {
    if (arms <= 0) {
      const angle = rng() * Math.PI * 2;
      const rFrac = Math.sqrt(rng());
      const r = innerR + rFrac * (outerR - innerR);
      const xScale = width / Math.min(width, height);
      const zScale = height / Math.min(width, height);
      return { x: Math.cos(angle) * r * xScale, z: Math.sin(angle) * r * zScale };
    }

    const arm = Math.floor(rng() * arms);
    const armAngleOffset = (arm / arms) * Math.PI * 2;

    const rFrac = Math.sqrt(rng());
    const r = innerR + rFrac * (outerR - innerR);

    const normalizedR = (r - innerR) / (outerR - innerR);
    const spiralAngle = armAngleOffset + normalizedR * tightness * Math.PI;

    const scatter = (rng() - 0.5) * armSpread * (0.5 + 0.5 * normalizedR);
    const finalAngle = spiralAngle + scatter;

    const xScale = width / Math.min(width, height);
    const zScale = height / Math.min(width, height);
    return {
      x: Math.cos(finalAngle) * r * xScale,
      z: Math.sin(finalAngle) * r * zScale,
    };
  }

  const stars: StarData[] = [];
  const maxTotalPlacementAttempts = count * 6000;
  let placementAttempts = 0;

  while (stars.length < count && placementAttempts < maxTotalPlacementAttempts) {
    placementAttempts++;

    const pos = samplePosition();
    const x = pos.x;
    const z = pos.z;
    if (isTooClose(x, z)) {
      continue;
    }

    insertGrid(x, z);

    const type = pickType();
    const cfg = STAR_TYPES[type];
    const luminosity = cfg.luminosityMin + rng() * (cfg.luminosityMax - cfg.luminosityMin);

    const variance = cfg.kind === "black-hole" ? 0.03 : 0.08;
    const color: [number, number, number] = [
      Math.min(1, Math.max(0, cfg.color[0] + (rng() - 0.5) * variance)),
      Math.min(1, Math.max(0, cfg.color[1] + (rng() - 0.5) * variance)),
      Math.min(1, Math.max(0, cfg.color[2] + (rng() - 0.5) * variance)),
    ];

    const pulseAmp = cfg.galaxyPulseAmplitude[0]
      + rng() * (cfg.galaxyPulseAmplitude[1] - cfg.galaxyPulseAmplitude[0]);
    const pulseFreq = cfg.galaxyPulseFrequency[0]
      + rng() * (cfg.galaxyPulseFrequency[1] - cfg.galaxyPulseFrequency[0]);

    const starName = generateName();
    stars.push({
      id: stars.length,
      name: starName,
      type,
      x,
      z,
      luminosity,
      color,
      galaxyPulseAmplitude: pulseAmp,
      galaxyPulseFrequency: pulseFreq,
      system: { planets: generatePlanets(type, starName) },
    });
  }

  if (stars.length < count) {
    console.warn(
      `[StarMap] Requested ${count} stars with minimum spacing ${minDist}, but placed ${stars.length}.`,
    );
  }

  return stars;
}

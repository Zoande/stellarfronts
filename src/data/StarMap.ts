/**
 * StarMap  Star type definitions and procedural star generation.
 * Generates a deterministic field of stars using a seeded PRNG.
 * Each star includes visual metadata used by both galaxy and system views.
 */

import { createPlanetStateFromSeed } from "./Economy";
import type { PlanetFeatureKind, PlanetState } from "./Economy";
import {
  normalizePlanetOrbitFields,
  withPlanetOrbitFields,
} from "./SystemCoordinates";

export type { PlanetState } from "./Economy";

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

export type DistrictKind = "city" | "generator" | "mining" | "agriculture";

export interface DistrictCounts {
  city: number;
  generator: number;
  mining: number;
  agriculture: number;
}

export interface CelestialObjectDetails {
  size: number;
  typeName: string;
  description: string;
  habitability: number | null;
  districtLimits: DistrictCounts;
  builtDistricts: DistrictCounts;
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
  /** Whether ordinary empires may colonize this environment without a future override technology. */
  colonizableByDefault: boolean;
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
    colonizableByDefault: false,
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
    colonizableByDefault: false,
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
    colonizableByDefault: true,
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
    colonizableByDefault: true,
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
    colonizableByDefault: false,
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
    colonizableByDefault: true,
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
    colonizableByDefault: true,
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
    colonizableByDefault: true,
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
    colonizableByDefault: false,
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
    colonizableByDefault: false,
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
    colonizableByDefault: true,
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
    colonizableByDefault: true,
  },
};

const ZERO_DISTRICTS: DistrictCounts = {
  city: 0,
  generator: 0,
  mining: 0,
  agriculture: 0,
};

const PLANET_DESCRIPTIONS: Record<PlanetType, string> = {
  [PlanetType.Barren]: "A stripped rocky world with little atmosphere, harsh radiation, and exposed mineral seams across the surface.",
  [PlanetType.Gaseous]: "A massive gaseous planet with deep storm bands, volatile cloud layers, and extractable atmospheric energy pockets.",
  [PlanetType.Snowy]: "A frozen terrestrial world with glacial basins, buried oceans, and scattered geothermal refuge zones.",
  [PlanetType.Arid]: "A dry terrestrial world with thin seas, broad deserts, and settlement corridors around sparse water tables.",
  [PlanetType.Dusty]: "A wind-scoured rocky planet covered in fine regolith, crater fields, and accessible industrial minerals.",
  [PlanetType.Grassland]: "A temperate terrestrial world with open plains, stable weather patterns, and broad agricultural potential.",
  [PlanetType.Jungle]: "A humid biological world dominated by dense vegetation, high biodiversity, and difficult but fertile terrain.",
  [PlanetType.Marshy]: "A wet lowland planet of deltas, shallow seas, and saturated soils that favor biological extraction and farming.",
  [PlanetType.Martian]: "A cold red desert world with oxidized terrain, canyon systems, and rich subsurface ore deposits.",
  [PlanetType.Methane]: "A cold giant or sub-giant world with methane-rich weather systems and volatile atmospheric resources.",
  [PlanetType.Sandy]: "A hot desert planet with deep dune seas, high solar exposure, and concentrated mineral outcrops.",
  [PlanetType.Tundra]: "A cold terrestrial world with hardy biomes, permafrost plains, and limited but reliable settlement zones.",
};

export const HUMAN_BASE_HABITABILITY_BY_PLANET_TYPE: Record<PlanetType, number> = {
  [PlanetType.Barren]: 10,
  [PlanetType.Gaseous]: 0,
  [PlanetType.Snowy]: 45,
  [PlanetType.Arid]: 50,
  [PlanetType.Dusty]: 30,
  [PlanetType.Grassland]: 80,
  [PlanetType.Jungle]: 70,
  [PlanetType.Marshy]: 65,
  [PlanetType.Martian]: 25,
  [PlanetType.Methane]: 0,
  [PlanetType.Sandy]: 45,
  [PlanetType.Tundra]: 40,
};

const STAR_DESCRIPTIONS: Record<StarType, string> = {
  [StarType.B]: "A brilliant blue-white main sequence star with intense radiation output and a short, energetic lifespan.",
  [StarType.A]: "A bright white main sequence star with strong luminosity and a relatively stable inner system.",
  [StarType.F]: "A pale yellow-white main sequence star, hotter than a solar analogue and favorable to compact habitable zones.",
  [StarType.G]: "A yellow main sequence star with steady output and long-lived orbital conditions.",
  [StarType.K]: "An orange main sequence star with moderate radiation and a broad stable lifespan.",
  [StarType.M]: "A small red main sequence star with low luminosity, frequent flaring, and tight orbital bands.",
  [StarType.MRedGiant]: "An expanded red giant with a swollen atmosphere, variable output, and engulfed inner orbital space.",
  [StarType.TBrownDwarf]: "A dim substellar brown dwarf radiating residual heat and faint infrared light.",
  [StarType.NeutronStar]: "A compact stellar remnant with extreme gravity, radiation, and dense magnetic activity.",
  [StarType.Pulsar]: "A rapidly rotating neutron star that emits focused radiation beams at regular intervals.",
  [StarType.BlackHole]: "A collapsed stellar remnant surrounded by gravitational distortion and high-energy accretion debris.",
};

const PLANET_DISTRICT_BASELINES: Record<
  PlanetType,
  {
    sizeMin: number;
    sizeMax: number;
    generator: number;
    mining: number;
    agriculture: number;
  }
> = {
  [PlanetType.Barren]: { sizeMin: 6, sizeMax: 16, generator: 2, mining: 9, agriculture: 0 },
  [PlanetType.Gaseous]: { sizeMin: 14, sizeMax: 30, generator: 10, mining: 2, agriculture: 0 },
  [PlanetType.Snowy]: { sizeMin: 8, sizeMax: 18, generator: 6, mining: 5, agriculture: 3 },
  [PlanetType.Arid]: { sizeMin: 8, sizeMax: 18, generator: 6, mining: 6, agriculture: 2 },
  [PlanetType.Dusty]: { sizeMin: 7, sizeMax: 17, generator: 4, mining: 8, agriculture: 1 },
  [PlanetType.Grassland]: { sizeMin: 10, sizeMax: 20, generator: 4, mining: 3, agriculture: 8 },
  [PlanetType.Jungle]: { sizeMin: 10, sizeMax: 21, generator: 5, mining: 3, agriculture: 9 },
  [PlanetType.Marshy]: { sizeMin: 9, sizeMax: 19, generator: 5, mining: 3, agriculture: 8 },
  [PlanetType.Martian]: { sizeMin: 7, sizeMax: 18, generator: 3, mining: 9, agriculture: 1 },
  [PlanetType.Methane]: { sizeMin: 12, sizeMax: 26, generator: 9, mining: 4, agriculture: 0 },
  [PlanetType.Sandy]: { sizeMin: 8, sizeMax: 18, generator: 8, mining: 5, agriculture: 1 },
  [PlanetType.Tundra]: { sizeMin: 8, sizeMax: 18, generator: 5, mining: 5, agriculture: 4 },
};

function cloneDistricts(counts: DistrictCounts): DistrictCounts {
  return {
    city: counts.city,
    generator: counts.generator,
    mining: counts.mining,
    agriculture: counts.agriculture,
  };
}

export function createPlanetId(starId: number, planetIndex: number): string {
  return `star-${starId}-planet-${planetIndex}`;
}

function normalizeDistrictCounts(
  counts: Partial<DistrictCounts> | undefined,
  limits: DistrictCounts,
): DistrictCounts {
  return {
    city: clampInt(counts?.city ?? 0, 0, limits.city),
    generator: clampInt(counts?.generator ?? 0, 0, limits.generator),
    mining: clampInt(counts?.mining ?? 0, 0, limits.mining),
    agriculture: clampInt(counts?.agriculture ?? 0, 0, limits.agriculture),
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function jitterFromHash(hash: number, shift: number, amplitude: number): number {
  return ((hash >>> shift) % (amplitude * 2 + 1)) - amplitude;
}

export function createStarObjectDetails(type: StarType): CelestialObjectDetails {
  const cfg = STAR_TYPES[type];
  return {
    size: Math.max(1, Math.round(cfg.systemDiameter * 2)),
    typeName: type,
    description: STAR_DESCRIPTIONS[type],
    habitability: null,
    districtLimits: cloneDistricts(ZERO_DISTRICTS),
    builtDistricts: cloneDistricts(ZERO_DISTRICTS),
  };
}

export function createPlanetObjectDetails(
  planet: Pick<PlanetConfig, "type" | "diameter" | "name" | "isHabited">,
  detailKey = planet.name,
): CelestialObjectDetails {
  const cfg = PLANET_TYPES[planet.type];
  const baseline = PLANET_DISTRICT_BASELINES[planet.type];
  const hash = hashString(`${detailKey}:${planet.type}:${planet.diameter.toFixed(3)}`);
  const diameterT = (planet.diameter - cfg.diameterMin) / Math.max(0.0001, cfg.diameterMax - cfg.diameterMin);
  const size = clampInt(
    baseline.sizeMin + diameterT * (baseline.sizeMax - baseline.sizeMin) + jitterFromHash(hash, 0, 1),
    baseline.sizeMin,
    baseline.sizeMax,
  );

  const districtLimits: DistrictCounts = {
    city: size,
    generator: clampInt(baseline.generator + jitterFromHash(hash, 4, 2), 0, size),
    mining: clampInt(baseline.mining + jitterFromHash(hash, 8, 2), 0, size),
    agriculture: clampInt(baseline.agriculture + jitterFromHash(hash, 12, 2), 0, size),
  };

  const builtDistricts: DistrictCounts = {
    city: 0,
    generator: 0,
    mining: 0,
    agriculture: 0,
  };

  return {
    size,
    typeName: cfg.name,
    description: PLANET_DESCRIPTIONS[planet.type],
    habitability: HUMAN_BASE_HABITABILITY_BY_PLANET_TYPE[planet.type],
    districtLimits,
    builtDistricts,
  };
}

export function withPlanetObjectDetails<T extends Omit<PlanetConfig, "objectDetails"> & { objectDetails?: CelestialObjectDetails }>(
  planet: T,
  detailKey = planet.name,
): T & { objectDetails: CelestialObjectDetails } {
  return {
    ...planet,
    objectDetails: planet.objectDetails ?? createPlanetObjectDetails(planet, detailKey),
  };
}

function createHomeworldPlanet(star: StarData, planetIndex: number): PlanetConfig {
  const cfg = PLANET_TYPES[PlanetType.Grassland];
  const diameter = (cfg.diameterMin + cfg.diameterMax) / 2;
  const lastOrbit = star.system.planets.reduce((max, planet) => Math.max(max, planet.orbitRadius), 4);
  const name = `${star.name} Homeworld`;
  return withPlanetObjectDetails(withPlanetOrbitFields({
    id: createPlanetId(star.id, planetIndex),
    type: PlanetType.Grassland,
    textureVariation: star.id % cfg.variations,
    diameter,
    orbitRadius: lastOrbit + 6,
    orbitSpeed: 0.24 * cfg.orbitSpeedMultiplier,
    name,
    isHabited: true,
  }, star.id, planetIndex), `${star.id}:${planetIndex}:${name}:homeworld`);
}

export function ensureHabitedHomePlanets(stars: StarData[], homeStarIds: Iterable<number>): boolean {
  let changed = false;
  const homeIds = new Set(homeStarIds);
  for (const star of stars) {
    if (!homeIds.has(star.id)) continue;

    const existingHabited = star.system.planets.find((planet) => planet.isHabited === true);
    if (existingHabited) {
      continue;
    }

    const planet = createHomeworldPlanet(star, star.system.planets.length);
    star.system.planets.push(planet);
    changed = true;
  }
  return changed;
}

export function normalizeCelestialObjectDetails(stars: StarData[]): boolean {
  let changed = false;
  for (const star of stars) {
    if (!star.objectDetails) {
      star.objectDetails = createStarObjectDetails(star.type);
      changed = true;
    }

    for (let i = 0; i < star.system.planets.length; i++) {
      const planet = star.system.planets[i];
      if (!planet) continue;
      const expectedId = createPlanetId(star.id, i);
      if (planet.id !== expectedId) {
        planet.id = expectedId;
        changed = true;
      }
      changed = normalizePlanetOrbitFields(planet, star.id, i) || changed;
      if (!planet.objectDetails) {
        planet.objectDetails = createPlanetObjectDetails(planet, `${star.id}:${i}:${planet.name}`);
        changed = true;
      }
      const expectedHabitability = HUMAN_BASE_HABITABILITY_BY_PLANET_TYPE[planet.type];
      if (planet.objectDetails.habitability !== expectedHabitability) {
        planet.objectDetails.habitability = expectedHabitability;
        changed = true;
      }
    }
  }
  return changed;
}

export function createPlanetStateFromConfig(
  starId: number,
  planetIndex: number,
  planet: PlanetConfig,
  existing?: Partial<PlanetState>,
  seedFeatures?: PlanetFeatureKind[],
  options?: { starterInfrastructure?: boolean; startingPopulation?: number },
): PlanetState {
  return createPlanetStateFromSeed({
    id: planet.id || createPlanetId(starId, planetIndex),
    starId,
    planetIndex,
    isHabited: planet.isHabited === true,
    habitability: planet.objectDetails.habitability,
    features: seedFeatures,
    builtDistricts: normalizeDistrictCounts(planet.objectDetails.builtDistricts, planet.objectDetails.districtLimits),
    districtLimits: planet.objectDetails.districtLimits,
    starterInfrastructure: options?.starterInfrastructure,
    startingPopulation: options?.startingPopulation,
  }, existing);
}

export function buildPlanetStatesFromStars(stars: StarData[], homeStarIds: Iterable<number> = []): PlanetState[] {
  const states: PlanetState[] = [];
  normalizeCelestialObjectDetails(stars);
  const homeIds = new Set(homeStarIds);
  for (const star of stars) {
    for (let planetIndex = 0; planetIndex < star.system.planets.length; planetIndex++) {
      const planet = star.system.planets[planetIndex];
      const features = homeIds.has(star.id) && planet.isHabited === true ? ["homePlanet" as const] : undefined;
      states.push(createPlanetStateFromConfig(star.id, planetIndex, planet, undefined, features));
    }
  }
  return states;
}

export function normalizePlanetStates(
  stars: StarData[],
  existingStates: PlanetState[] = [],
  homeStarIds: Iterable<number> = [],
): { planetStates: PlanetState[]; changed: boolean } {
  let changed = normalizeCelestialObjectDetails(stars);
  const byId = new Map(existingStates.map((state) => [state.id, state]));
  const normalized: PlanetState[] = [];
  const homeIds = new Set(homeStarIds);

  for (const star of stars) {
    for (let planetIndex = 0; planetIndex < star.system.planets.length; planetIndex++) {
      const planet = star.system.planets[planetIndex];
      const expectedId = createPlanetId(star.id, planetIndex);
      const source = byId.get(planet.id) ?? byId.get(expectedId);
      const features = homeIds.has(star.id) && planet.isHabited === true ? ["homePlanet" as const] : undefined;
      const nextState = createPlanetStateFromConfig(
        star.id,
        planetIndex,
        planet,
        source,
        features,
        { starterInfrastructure: source === undefined },
      );

      if (!source || JSON.stringify(source) !== JSON.stringify(nextState)) {
        changed = true;
      }

      normalized.push(nextState);
    }
  }

  if (existingStates.length !== normalized.length) {
    changed = true;
  }

  return { planetStates: normalized, changed };
}

export function applyPlanetStatesToStars(stars: StarData[], planetStates: PlanetState[]): boolean {
  let changed = normalizeCelestialObjectDetails(stars);
  const byId = new Map(planetStates.map((state) => [state.id, state]));

  for (const star of stars) {
    for (let planetIndex = 0; planetIndex < star.system.planets.length; planetIndex++) {
      const planet = star.system.planets[planetIndex];
      // Client-side detail caches can temporarily contain a sparse planet array
      // while a full system payload and an individual planet payload cross in
      // flight. Persisted/server-owned star maps are dense, but this shared
      // applicator also runs against those transient client copies.
      if (!planet) continue;
      const state = byId.get(planet.id) ?? byId.get(createPlanetId(star.id, planetIndex));
      if (!state) continue;

      const nextBuiltDistricts = normalizeDistrictCounts(
        state.builtDistricts,
        planet.objectDetails.districtLimits,
      );
      if (planet.isHabited !== state.isHabited) {
        planet.isHabited = state.isHabited;
        changed = true;
      }
      if (planet.objectDetails.habitability !== state.habitability) {
        planet.objectDetails.habitability = state.habitability;
        changed = true;
      }
      if (
        planet.objectDetails.builtDistricts.city !== nextBuiltDistricts.city
        || planet.objectDetails.builtDistricts.generator !== nextBuiltDistricts.generator
        || planet.objectDetails.builtDistricts.mining !== nextBuiltDistricts.mining
        || planet.objectDetails.builtDistricts.agriculture !== nextBuiltDistricts.agriculture
      ) {
        planet.objectDetails.builtDistricts = nextBuiltDistricts;
        changed = true;
      }
    }
  }

  return changed;
}

export interface PlanetConfig {
  id: string;
  type: PlanetType;
  textureVariation: number;
  diameter: number;
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhaseAtEpoch: number;
  orbitEpochMs: number;
  name: string;
  isHabited?: boolean;
  objectDetails: CelestialObjectDetails;
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
  /** Id of the nebula covering this system, if any (see src/data/Nebula.ts). */
  nebulaId?: number;
  objectDetails: CelestialObjectDetails;
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

  function generatePlanets(starType: StarType, starName: string, starId: number): PlanetConfig[] {
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

      planets.push(withPlanetObjectDetails(withPlanetOrbitFields({
        id: createPlanetId(starId, i),
        type: planetType,
        textureVariation: textureVar,
        diameter,
        orbitRadius: baseOrbit + i * orbitSpacing + rng() * (orbitSpacing * 0.8),
        orbitSpeed,
        name: planetName,
      }, starId, i), `${starId}:${i}:${planetName}`));
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
      objectDetails: createStarObjectDetails(type),
      system: { planets: generatePlanets(type, starName, stars.length) },
    });
  }

  if (stars.length < count) {
    console.warn(
      `[StarMap] Requested ${count} stars with minimum spacing ${minDist}, but placed ${stars.length}.`,
    );
  }

  return stars;
}

import { GALAXY_MAP } from "./GalaxyMap";
import type { GalaxyMapConfig } from "./GalaxyMap";
import type { StarData } from "./StarMap";
import type { FlagDesign } from "../flags/flagTypes";

export const FACTION_COUNT = 15;
export const FOG_OF_WAR_MAX_JUMPS = 3;

export type GalaxyPerspective =
  | { mode: "observer" }
  | { mode: "faction"; factionId: number };

export interface FactionInfo {
  id: number;
  name: string;
  color: [number, number, number];
  homeStarId: number;
  flagDesign?: FlagDesign | null;
}

const FACTION_COLOR_BANK: Array<[number, number, number]> = [
  [112, 184, 255],
  [255, 156, 92],
  [126, 220, 156],
  [206, 142, 255],
  [255, 216, 102],
  [255, 112, 145],
  [98, 214, 220],
  [180, 220, 104],
  [255, 132, 214],
  [157, 167, 255],
  [230, 177, 95],
  [121, 215, 132],
  [119, 188, 161],
  [178, 187, 107],
  [206, 125, 164],
];

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function pickFactionPalette(factionCount: number, rng: () => number): Array<[number, number, number]> {
  const available = FACTION_COLOR_BANK.slice();
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = available[i];
    available[i] = available[j];
    available[j] = temp;
  }

  const palette: Array<[number, number, number]> = [];
  for (let i = 0; i < factionCount; i++) {
    const [r, g, b] = available[i % available.length];
    const jitter = (rng() - 0.5) * 0.07;
    palette.push([
      clamp(r / 255 + jitter, 0.08, 1),
      clamp(g / 255 + jitter, 0.08, 1),
      clamp(b / 255 + jitter, 0.08, 1),
    ]);
  }
  return palette;
}

function selectFactionHomeStarIds(
  stars: StarData[],
  factionCount: number,
  mapWidth: number,
  mapHeight: number,
  rng: () => number,
): number[] {
  const targetCount = Math.max(0, Math.min(factionCount, stars.length));
  if (targetCount === 0) return [];

  const homeStarIds: number[] = [];
  const used = new Set<number>();

  for (let i = 0; i < targetCount; i++) {
    const startX = (rng() - 0.5) * mapWidth;
    const startZ = (rng() - 0.5) * mapHeight;
    let bestIndex = -1;
    let bestDistanceSq = Number.POSITIVE_INFINITY;

    for (let starIndex = 0; starIndex < stars.length; starIndex++) {
      if (used.has(starIndex)) continue;
      const dx = stars[starIndex].x - startX;
      const dz = stars[starIndex].z - startZ;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestIndex = starIndex;
      }
    }

    if (bestIndex >= 0) {
      used.add(bestIndex);
      homeStarIds.push(bestIndex);
    }
  }

  if (homeStarIds.length < targetCount) {
    for (let starIndex = 0; starIndex < stars.length && homeStarIds.length < targetCount; starIndex++) {
      if (used.has(starIndex)) continue;
      used.add(starIndex);
      homeStarIds.push(starIndex);
    }
  }

  return homeStarIds;
}

export function buildFactions(
  stars: StarData[],
  config: Pick<GalaxyMapConfig, "width" | "height" | "seed"> = GALAXY_MAP,
): FactionInfo[] {
  const rng = mulberry32(config.seed ^ 0x43a7f12d);
  const homeStarIds = selectFactionHomeStarIds(
    stars,
    FACTION_COUNT,
    config.width,
    config.height,
    rng,
  );
  const palette = pickFactionPalette(homeStarIds.length, rng);

  return homeStarIds.map((homeStarId, id) => ({
    id,
    name: `Color ${id + 1}`,
    color: palette[id],
    homeStarId,
  }));
}

export function buildHomeSystemOwnership(stars: StarData[], factions: FactionInfo[]): number[] {
  const ownerByStar = new Array<number>(stars.length).fill(-1);
  for (const faction of factions) {
    if (faction.homeStarId < 0 || faction.homeStarId >= stars.length) continue;
    ownerByStar[faction.homeStarId] = faction.id;
  }
  return ownerByStar;
}

export function computeVisibleStarIds(
  adjacency: number[][],
  homeStarId: number,
  maxJumps = FOG_OF_WAR_MAX_JUMPS,
): Set<number> {
  const visible = new Set<number>();
  if (homeStarId < 0 || homeStarId >= adjacency.length) return visible;

  const queue: Array<{ starId: number; jumps: number }> = [{ starId: homeStarId, jumps: 0 }];
  let head = 0;
  visible.add(homeStarId);

  while (head < queue.length) {
    const current = queue[head++];
    if (current.jumps >= maxJumps) continue;

    const neighbors = adjacency[current.starId] ?? [];
    for (const neighborId of neighbors) {
      if (neighborId < 0 || neighborId >= adjacency.length) continue;
      if (visible.has(neighborId)) continue;
      visible.add(neighborId);
      queue.push({ starId: neighborId, jumps: current.jumps + 1 });
    }
  }

  return visible;
}

export function getPerspectiveVisibleStarIds(
  perspective: GalaxyPerspective,
  factions: FactionInfo[],
  adjacency: number[][],
  maxJumps = FOG_OF_WAR_MAX_JUMPS,
): Set<number> | null {
  if (perspective.mode === "observer") return null;

  const faction = factions.find((f) => f.id === perspective.factionId);
  if (!faction) return new Set<number>();
  return computeVisibleStarIds(adjacency, faction.homeStarId, maxJumps);
}

export function colorToCss(color: [number, number, number]): string {
  const r = Math.round(clamp(color[0], 0, 1) * 255);
  const g = Math.round(clamp(color[1], 0, 1) * 255);
  const b = Math.round(clamp(color[2], 0, 1) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

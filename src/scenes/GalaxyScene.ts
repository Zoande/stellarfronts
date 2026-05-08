/**
 * GalaxyScene
 * Pure galaxy-map view with stars and camera controls.
 * Clicking a star requests navigation into a separate SystemScene.
 */

import {
  Scene,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Texture,
  PointerEventTypes,
} from "@babylonjs/core";
import type { AbstractEngine, Mesh, Observer, PointerInfo } from "@babylonjs/core";
import type { IGameScene } from "../SceneManager";
import { GALAXY_MAP } from "../data/GalaxyMap";
import {
  FOG_OF_WAR_MAX_JUMPS,
  buildFactions,
  buildHomeSystemOwnership,
  getPerspectiveVisibleStarIds,
} from "../data/Factions";
import type { FactionInfo, GalaxyPerspective } from "../data/Factions";
import { generateStarMap } from "../data/StarMap";
import type { StarData } from "../data/StarMap";
import { CameraController } from "../systems/CameraController";
import { OwnershipOverlayRenderer } from "../systems/OwnershipOverlayRenderer";
import { StarFieldRenderer } from "../systems/StarFieldRenderer";
import type { ShipIconStyle } from "../systems/StarFieldRenderer";
import { SelectionPanel } from "../ui/SelectionPanel";
import type { GalaxyShipTransit, ShipAction } from "../game/GameplayTypes";
import type { ServerShip } from "../game/GameProtocol";

type EnterSystemHandler = (star: StarData) => void | Promise<void>;

export interface GalaxyViewState {
  alpha: number;
  beta: number;
  radius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export interface GalaxySceneOptions {
  stars?: StarData[];
  initialViewState?: GalaxyViewState;
  factions?: FactionInfo[];
  perspective?: GalaxyPerspective;
  visibilityJumps?: number;
  visibleStarIds?: Iterable<number> | null;
  starOwnership?: number[];
  playerFactionId?: number;
  playerShipStarId?: number;
  playerShipSystemIds?: Iterable<number>;
  playerShipTransit?: GalaxyShipTransit | null;
  serverShips?: ServerShip[];
  starbaseSystemIds?: Iterable<number>;
  onGameplayFrame?: (deltaTime: number) => void;
  onShipCommand?: (action: ShipAction, targetStarId: number, shipId?: string) => void;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const HYPERLANE_MIN_CONNECTIONS = 2;
const HYPERLANE_MAX_CONNECTIONS = 3;
const HYPERLANE_BASE_VISIBILITY = 0.052;
const HYPERLANE_ZOOM_VISIBILITY_BOOST = 0.15;
const HYPERLANE_BASE_ALPHA = 0.011;
const HYPERLANE_DISTANCE_ALPHA_BOOST = 0.026;
const HYPERLANE_ENDPOINT_ALPHA_FACTOR = 0.14;
const HYPERLANE_STAR_ENDPOINT_OFFSET_FACTOR = 0.2;
const HYPERLANE_STAR_ENDPOINT_OFFSET_MIN = 4;
const HYPERLANE_STAR_ENDPOINT_OFFSET_MAX = 10;
const OWNERSHIP_FACTION_COUNT = 15;
const OWNERSHIP_TEXTURE_SIZE = 2400;
const OWNERSHIP_OVERLAY_PADDING_FACTOR = 0.16;
const OWNERSHIP_OVERLAY_Y = 0.055;
const OWNERSHIP_TIE_EPSILON = 0.0001;
const STAR_PICK_RADIUS_MIN = 5.5;
const STAR_PICK_RADIUS_MAX = 10;
const STAR_PICK_RADIUS_CAMERA_FACTOR = 0.012;
const SHIP_TARGET_SCALE_BOOST = 1.36;
const ACTION_MENU_STYLE_ID = "space-action-menu-style";

const OWNERSHIP_COLOR_BANK: Array<[number, number, number]> = [
  [224, 83, 83],
  [230, 128, 74],
  [216, 172, 79],
  [186, 196, 86],
  [123, 185, 85],
  [77, 183, 121],
  [66, 176, 152],
  [74, 171, 219],
  [92, 132, 222],
  [121, 106, 216],
  [158, 102, 204],
  [194, 98, 188],
  [217, 97, 152],
  [213, 109, 121],
  [173, 130, 102],
  [145, 170, 191],
  [130, 158, 95],
  [193, 146, 86],
  [173, 104, 86],
  [122, 144, 186],
  [94, 162, 206],
  [119, 188, 161],
  [178, 187, 107],
  [206, 125, 164],
];

function pickOwnershipPalette(factionCount: number, rng: () => number): Color3[] {
  const available = OWNERSHIP_COLOR_BANK.slice();
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = available[i];
    available[i] = available[j];
    available[j] = temp;
  }

  const palette: Color3[] = [];
  for (let i = 0; i < factionCount; i++) {
    const [r, g, b] = available[i % available.length];
    const jitter = (rng() - 0.5) * 0.07;
    palette.push(
      new Color3(
        clamp(r / 255 + jitter, 0.08, 1),
        clamp(g / 255 + jitter, 0.08, 1),
        clamp(b / 255 + jitter, 0.08, 1),
      ),
    );
  }
  return palette;
}

function ensureActionMenuStyles(): void {
  if (document.getElementById(ACTION_MENU_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = ACTION_MENU_STYLE_ID;
  style.textContent = `
.spaceActionMenu {
  position: fixed;
  z-index: 80;
  min-width: 150px;
  border: 1px solid rgba(150, 200, 230, 0.72);
  border-radius: 5px;
  background: linear-gradient(180deg, rgba(16, 22, 30, 0.98), rgba(8, 12, 18, 0.98));
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.46);
  padding: 6px;
  pointer-events: auto;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

.spaceActionMenuTitle {
  padding: 6px 8px 8px;
  color: rgba(214, 226, 242, 0.94);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(136, 151, 171, 0.38);
  margin-bottom: 5px;
}

.spaceActionMenuBtn {
  width: 100%;
  min-height: 30px;
  border: 1px solid rgba(136, 151, 171, 0.42);
  border-radius: 4px;
  background: rgba(18, 25, 33, 0.96);
  color: #c4d1e2;
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-top: 5px;
}

.spaceActionMenuBtn:hover {
  border-color: rgba(90, 220, 255, 0.86);
  color: #edfaff;
  background: rgba(29, 43, 57, 0.98);
}
`;
  document.head.appendChild(style);
}

function selectOwnershipSeedIndices(
  stars: StarData[],
  factionCount: number,
  mapWidth: number,
  mapHeight: number,
  rng: () => number,
): number[] {
  const targetCount = Math.max(0, Math.min(factionCount, stars.length));
  if (targetCount === 0) return [];

  const seeds: number[] = [];
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
      seeds.push(bestIndex);
    }
  }

  if (seeds.length < targetCount) {
    for (let starIndex = 0; starIndex < stars.length && seeds.length < targetCount; starIndex++) {
      if (used.has(starIndex)) continue;
      used.add(starIndex);
      seeds.push(starIndex);
    }
  }

  return seeds;
}

function computeHyperlaneJumpDistances(adjacency: number[][], seedIndex: number): number[] {
  const count = adjacency.length;
  const distances = new Array<number>(count).fill(-1);
  if (seedIndex < 0 || seedIndex >= count) return distances;

  const queue: number[] = [seedIndex];
  let head = 0;
  distances[seedIndex] = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const nextDistance = distances[current] + 1;
    const neighbors = adjacency[current] ?? [];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || neighbor >= count) continue;
      if (distances[neighbor] >= 0) continue;
      distances[neighbor] = nextDistance;
      queue.push(neighbor);
    }
  }

  return distances;
}

function assignOwnershipToStars(
  stars: StarData[],
  seedIndices: number[],
  adjacency: number[][],
): number[] {
  if (seedIndices.length === 0) return new Array<number>(stars.length).fill(-1);

  // Ownership is determined by lane-jump distance from each faction seed.
  // Factions that run out of reachable neighbors simply stop expanding.
  const jumpMaps = seedIndices.map((seed) => computeHyperlaneJumpDistances(adjacency, seed));
  const ownerByStar = new Array<number>(stars.length).fill(-1);

  for (let starIndex = 0; starIndex < stars.length; starIndex++) {
    let bestOwner = -1;
    let bestJumps = Number.POSITIVE_INFINITY;
    let bestSeedDistanceSq = Number.POSITIVE_INFINITY;

    for (let ownerIndex = 0; ownerIndex < seedIndices.length; ownerIndex++) {
      const jumps = jumpMaps[ownerIndex][starIndex];
      if (jumps < 0) continue;

      const seed = stars[seedIndices[ownerIndex]];
      const star = stars[starIndex];
      const dx = star.x - seed.x;
      const dz = star.z - seed.z;
      const distanceSq = dx * dx + dz * dz;

      if (jumps < bestJumps) {
        bestOwner = ownerIndex;
        bestJumps = jumps;
        bestSeedDistanceSq = distanceSq;
        continue;
      }

      if (jumps === bestJumps) {
        if (
          distanceSq < bestSeedDistanceSq - OWNERSHIP_TIE_EPSILON
          || (Math.abs(distanceSq - bestSeedDistanceSq) <= OWNERSHIP_TIE_EPSILON
            && (bestOwner < 0 || ownerIndex < bestOwner))
        ) {
          bestOwner = ownerIndex;
          bestJumps = jumps;
          bestSeedDistanceSq = distanceSq;
        }
      }
    }

    ownerByStar[starIndex] = bestOwner;
  }

  return ownerByStar;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(angle: number): number {
  let a = angle % TAU;
  if (a < 0) a += TAU;
  return a;
}

function shortestAngleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
}

export type CoreTextureShape = {
  innerRadiusFraction: number;
  outerRadiusFraction: number;
  spiralArms: number;
  spiralTightness: number;
  armSpread: number;
};

type StarArmMeta = {
  armIndex: number;
  spiralPhase: number;
  normalizedR: number;
};

type HyperlaneCandidate = {
  index: number;
  distance: number;
  score: number;
  sameArm: boolean;
};

function buildStarArmMetadata(
  stars: StarData[],
  width: number,
  height: number,
  shape: CoreTextureShape,
): StarArmMeta[] {
  const minAxis = Math.min(width, height);
  const xScale = width / minAxis;
  const zScale = height / minAxis;
  const halfSize = minAxis / 2;
  const innerR = halfSize * shape.innerRadiusFraction;
  const outerR = halfSize * shape.outerRadiusFraction;
  const radialSpan = Math.max(0.0001, outerR - innerR);
  const armCount = Math.max(0, Math.floor(shape.spiralArms));
  const armSector = armCount > 0 ? TAU / armCount : TAU;

  const metadata: StarArmMeta[] = [];
  for (const star of stars) {
    const nx = star.x / xScale;
    const nz = star.z / zScale;
    const r = Math.hypot(nx, nz);
    const theta = Math.atan2(nz, nx);
    const normalizedR = clamp((r - innerR) / radialSpan, 0, 1);
    const twist = normalizedR * shape.spiralTightness * Math.PI;
    const spiralPhase = normalizeAngle(theta - twist);

    let armIndex = 0;
    if (armCount > 0) {
      armIndex = Math.round(spiralPhase / armSector) % armCount;
      if (armIndex < 0) armIndex += armCount;
    }

    metadata.push({ armIndex, spiralPhase, normalizedR });
  }

  return metadata;
}

export function buildHyperlanePairs(
  stars: StarData[],
  width: number,
  height: number,
  shape: CoreTextureShape,
  seed: number,
): Array<[number, number]> {
  if (stars.length < 2) return [];

  const rng = mulberry32(seed ^ 0x9e3779b1);
  const armCount = Math.max(0, Math.floor(shape.spiralArms));
  const starMeta = buildStarArmMetadata(stars, width, height, shape);

  const minAxis = Math.min(width, height);
  const maxCandidateDistance = minAxis * 0.34;
  const minBridgeDistance = minAxis * 0.1;
  const candidatePoolSize = 26;

  const candidates: HyperlaneCandidate[][] = Array.from({ length: stars.length }, () => []);

  for (let i = 0; i < stars.length; i++) {
    const localCandidates: HyperlaneCandidate[] = [];
    for (let j = 0; j < stars.length; j++) {
      if (i === j) continue;

      const dx = stars[j].x - stars[i].x;
      const dz = stars[j].z - stars[i].z;
      const distance = Math.hypot(dx, dz);
      if (distance > maxCandidateDistance) continue;

      const sameArm = armCount > 0 && starMeta[i].armIndex === starMeta[j].armIndex;
      const radialDelta = Math.abs(starMeta[i].normalizedR - starMeta[j].normalizedR);
      const spiralDelta = shortestAngleDiff(starMeta[i].spiralPhase, starMeta[j].spiralPhase);

      let score = distance;
      if (armCount > 0) {
        if (sameArm) {
          score *= 0.78 + radialDelta * 0.32;
          score *= 1 + (spiralDelta / Math.PI) * 0.18;
        } else {
          score *= 1.18 + Math.max(0, 0.1 - radialDelta) * 0.6;
          score *= 1 + ((Math.PI - spiralDelta) / Math.PI) * 0.08;
        }
      }

      localCandidates.push({ index: j, distance, score, sameArm });
    }

    if (localCandidates.length === 0) {
      for (let j = 0; j < stars.length; j++) {
        if (i === j) continue;
        const dx = stars[j].x - stars[i].x;
        const dz = stars[j].z - stars[i].z;
        localCandidates.push({
          index: j,
          distance: Math.hypot(dx, dz),
          score: Math.hypot(dx, dz),
          sameArm: armCount > 0 && starMeta[i].armIndex === starMeta[j].armIndex,
        });
      }
    }

    localCandidates.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.distance - b.distance;
    });
    candidates[i] = localCandidates.slice(0, candidatePoolSize);
  }

  const degree = new Uint8Array(stars.length);
  const targetDegree = new Uint8Array(stars.length);
  for (let i = 0; i < stars.length; i++) {
    targetDegree[i] = rng() < 0.42 ? 3 : 2;
  }

  const edges = new Set<string>();
  const hyperlanes: Array<[number, number]> = [];

  const edgeKey = (a: number, b: number): string => {
    const x = Math.min(a, b);
    const y = Math.max(a, b);
    return `${x}:${y}`;
  };

  const connect = (a: number, b: number): boolean => {
    if (a === b) return false;
    if (degree[a] >= HYPERLANE_MAX_CONNECTIONS || degree[b] >= HYPERLANE_MAX_CONNECTIONS) {
      return false;
    }

    const key = edgeKey(a, b);
    if (edges.has(key)) return false;

    edges.add(key);
    degree[a] += 1;
    degree[b] += 1;
    hyperlanes.push([Math.min(a, b), Math.max(a, b)]);
    return true;
  };

  // Pass 1: ensure each star reaches at least 2 links where possible.
  for (let pass = 0; pass < HYPERLANE_MIN_CONNECTIONS; pass++) {
    for (let i = 0; i < stars.length; i++) {
      while (degree[i] <= pass && degree[i] < HYPERLANE_MIN_CONNECTIONS) {
        const candidate = candidates[i].find((c) => {
          if (degree[c.index] >= HYPERLANE_MAX_CONNECTIONS) return false;
          return !edges.has(edgeKey(i, c.index));
        });
        if (!candidate) break;
        connect(i, candidate.index);
      }
    }
  }

  // Pass 2: fill some stars to 3 links, mostly preserving lane structure.
  for (let i = 0; i < stars.length; i++) {
    if (degree[i] >= targetDegree[i]) continue;

    const candidate = candidates[i].find((c) => {
      if (degree[c.index] >= HYPERLANE_MAX_CONNECTIONS) return false;
      if (edges.has(edgeKey(i, c.index))) return false;
      return c.sameArm || rng() < 0.24;
    });

    if (candidate) connect(i, candidate.index);
  }

  // Pass 3: occasional inter-arm bridges to create cross-lane navigation.
  if (armCount > 1) {
    for (let i = 0; i < stars.length; i++) {
      if (degree[i] >= HYPERLANE_MAX_CONNECTIONS) continue;
      if (rng() > 0.18) continue;

      const bridge = candidates[i].find((c) => {
        if (c.sameArm) return false;
        if (c.distance < minBridgeDistance) return false;
        if (degree[c.index] >= HYPERLANE_MAX_CONNECTIONS) return false;
        return !edges.has(edgeKey(i, c.index));
      });

      if (bridge) connect(i, bridge.index);
    }
  }

  // Final rescue: try to pull low-degree stars up to 2 links.
  for (let i = 0; i < stars.length; i++) {
    while (degree[i] < HYPERLANE_MIN_CONNECTIONS) {
      const candidate = candidates[i].find((c) => {
        if (degree[c.index] >= HYPERLANE_MAX_CONNECTIONS) return false;
        return !edges.has(edgeKey(i, c.index));
      });
      if (!candidate) break;
      connect(i, candidate.index);
    }
  }

  return hyperlanes;
}

export function buildHyperlaneAdjacency(
  hyperlanes: Array<[number, number]>,
  starCount: number,
): number[][] {
  const adjacency: number[][] = Array.from({ length: starCount }, () => []);
  for (const [a, b] of hyperlanes) {
    if (a < 0 || b < 0 || a >= starCount || b >= starCount) continue;
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return adjacency;
}

function createGalacticCoreTextureDataURL(
  size: number,
  shape: CoreTextureShape,
  axisRatio: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQAY0x6sAAAAAElFTkSuQmCC";
  }

  const c = size / 2;
  ctx.clearRect(0, 0, size, size);

  const majorStretch = Math.max(1.05, Math.min(1.34, axisRatio * 0.88));
  const minorStretch = Math.max(0.74, Math.min(0.98, 1 / (majorStretch * 0.96)));
  const armCount = Math.max(2, shape.spiralArms);
  const armTightness = Math.max(1.35, shape.spiralTightness);
  const armSpread = Math.max(0.12, shape.armSpread);

  // Keep the core physically broad, but make brightness drop much faster.
  const decayRadius =
    c
    * Math.max(0.56, Math.min(0.74, shape.innerRadiusFraction * 1.9 + 0.18));
  const shoulderRadius = c * Math.max(0.78, Math.min(0.96, decayRadius / c + 0.26));

  const base = ctx.createRadialGradient(c, c, 0, c, c, decayRadius);
  base.addColorStop(0, "rgba(255,244,220,1)");
  base.addColorStop(0.08, "rgba(255,230,196,0.84)");
  base.addColorStop(0.2, "rgba(255,208,160,0.46)");
  base.addColorStop(0.36, "rgba(255,187,138,0.17)");
  base.addColorStop(0.52, "rgba(255,170,120,0.05)");
  base.addColorStop(1, "rgba(255,164,116,0)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const diffuse = ctx.createRadialGradient(c, c, decayRadius * 0.68, c, c, shoulderRadius);
  diffuse.addColorStop(0, "rgba(255,224,186,0)");
  diffuse.addColorStop(0.52, "rgba(255,188,134,0.08)");
  diffuse.addColorStop(1, "rgba(255,176,124,0)");
  ctx.fillStyle = diffuse;
  ctx.fillRect(0, 0, size, size);

  const rng = mulberry32(7331);
  ctx.globalCompositeOperation = "screen";

  // Irregular warm cloud field with mixed directional drift.
  // Still favors galaxy elongation, but spreads into diagonal/vertical directions too.
  for (let i = 0; i < 360; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 1.85) * size * 0.46;
    const directionMode = rng();
    let dirX = 0;
    let dirY = 0;
    if (directionMode < 0.46) {
      dirX = (rng() < 0.5 ? -1 : 1) * (0.42 + rng() * 0.58);
      dirY = (rng() - 0.5) * 0.48;
    } else if (directionMode < 0.78) {
      dirX = (rng() < 0.5 ? -1 : 1) * (0.34 + rng() * 0.54);
      dirY = (rng() < 0.5 ? -1 : 1) * (0.34 + rng() * 0.54);
    } else {
      dirX = (rng() - 0.5) * 0.44;
      dirY = (rng() < 0.5 ? -1 : 1) * (0.44 + rng() * 0.56);
    }
    const dirPull = size * (0.004 + rng() * 0.048) * (0.4 + r / (size * 0.46));
    const x =
      c
      + Math.cos(ang) * r * majorStretch
      + dirX * dirPull;
    const y =
      c
      + Math.sin(ang) * r * minorStretch * (0.72 + rng() * 0.28)
      + dirY * dirPull * 0.92
      + Math.sin(ang * (1.2 + rng() * 0.8)) * size * 0.01;
    const blobRadius = size * (0.01 + rng() * 0.09);
    const alpha = 0.02 + rng() * 0.11 + (1 - r / (size * 0.46)) * 0.07;
    const warmR = 255;
    const warmG = 204 + Math.floor(rng() * 36);
    const warmB = 150 + Math.floor(rng() * 40);

    const blob = ctx.createRadialGradient(x, y, 0, x, y, blobRadius);
    blob.addColorStop(0, `rgba(${warmR},${warmG},${warmB},${alpha})`);
    blob.addColorStop(1, `rgba(${warmR},${warmG},${warmB},0)`);

    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(x, y, blobRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Secondary isotropic plume layer to spread energy off the major axis.
  for (let i = 0; i < 120; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 1.55) * size * 0.4;
    const radialWarp = 0.88 + rng() * 0.28;
    const x = c + Math.cos(ang) * r * radialWarp;
    const y = c + Math.sin(ang) * r * radialWarp;
    const rr = size * (0.012 + rng() * 0.065);
    const alpha = 0.012 + rng() * 0.055;
    const plume = ctx.createRadialGradient(x, y, 0, x, y, rr);
    plume.addColorStop(0, `rgba(255,198,142,${alpha})`);
    plume.addColorStop(1, "rgba(255,174,120,0)");
    ctx.fillStyle = plume;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "lighter";
  // Arm-like wisps anchored to galaxy settings, with jitter so it does not look ringed/even.
  for (let arm = 0; arm < armCount; arm++) {
    const strands = 4 + Math.floor(rng() * 3);
    for (let s = 0; s < strands; s++) {
      const phase = (arm / armCount) * Math.PI * 2 + (rng() - 0.5) * 0.48;
      const jitterA = rng() * Math.PI * 2;
      const jitterB = rng() * Math.PI * 2;
      const wobbleAmp = size * (0.004 + rng() * 0.012);
      const lineAlpha = 0.018 + rng() * 0.035;
      const armLength = size * (0.24 + rng() * 0.34);
      const sideSkew = rng() < 0.68 ? 1 : -1;
      const verticalSkew = (rng() < 0.5 ? -1 : 1) * size * (0.004 + rng() * 0.01);
      ctx.lineWidth = Math.max(1, size * (0.0014 + rng() * 0.0032));
      ctx.beginPath();
      for (let t = 0; t <= 1; t += 0.015) {
        const swirl = t * armTightness * Math.PI + Math.sin(t * 7 + jitterA) * 0.18;
        const rr = Math.pow(t, 1.25) * armLength;
        const scatter = Math.sin(t * 15 + jitterB) * wobbleAmp * (0.5 + t);
        const sidePull = sideSkew * size * 0.014 * t * t;
        const x = c + Math.cos(phase + swirl) * rr * majorStretch + scatter + sidePull;
        const y =
          c
          + Math.sin(phase + swirl) * rr * minorStretch
          + Math.cos(t * 11 + jitterA * 0.7) * wobbleAmp * 0.8
          + Math.sin(t * 6 + jitterB) * size * armSpread * 0.009
          + verticalSkew * t * t;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(255,204,150,${lineAlpha})`;
      ctx.stroke();
    }
  }

  // Mixed-direction drifting veils break ring cues while spreading beyond horizontal.
  for (let i = 0; i < 34; i++) {
    const dirMode = rng();
    let angle: number;
    if (dirMode < 0.42) {
      angle = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.56;
    } else if (dirMode < 0.76) {
      angle = (rng() < 0.5 ? Math.PI / 4 : -Math.PI / 4) + (rng() - 0.5) * 0.68;
    } else {
      angle = (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.58;
    }

    const perp = angle + Math.PI / 2;
    const startRadius = size * (0.03 + rng() * 0.09);
    const length = size * (0.14 + rng() * 0.28);
    const bend = size * (0.05 + rng() * 0.18);

    const startX = c + Math.cos(angle + (rng() - 0.5) * 0.8) * startRadius;
    const startY = c + Math.sin(angle + (rng() - 0.5) * 0.8) * startRadius;
    const endX = startX + Math.cos(angle) * length + Math.cos(perp) * (rng() - 0.5) * bend;
    const endY = startY + Math.sin(angle) * length + Math.sin(perp) * (rng() - 0.5) * bend;
    const cpX = c + Math.cos(angle) * length * (0.45 + rng() * 0.22);
    const cpY = c + Math.sin(angle) * length * (0.45 + rng() * 0.22);

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    ctx.strokeStyle = `rgba(255,194,140,${0.011 + rng() * 0.024})`;
    ctx.lineWidth = size * (0.003 + rng() * 0.008);
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // Carve uneven dust channels and pits to destroy concentric ring cues.
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 24; i++) {
    const laneRadius = size * (0.08 + rng() * 0.3);
    const laneStart = rng() * Math.PI * 2;
    const laneSweep = (0.2 + rng() * 0.55) * Math.PI;
    const laneWidth = size * (0.006 + rng() * 0.018);

    ctx.save();
    ctx.translate(c + (rng() - 0.35) * size * 0.08, c + (rng() - 0.5) * size * 0.08);
    ctx.rotate((rng() - 0.5) * 0.9);
    ctx.scale(majorStretch * (0.86 + rng() * 0.24), minorStretch * (0.72 + rng() * 0.28));
    ctx.beginPath();
    ctx.arc(0, 0, laneRadius, laneStart, laneStart + laneSweep);
    ctx.strokeStyle = `rgba(0,0,0,${0.03 + rng() * 0.07})`;
    ctx.lineWidth = laneWidth;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  for (let i = 0; i < 32; i++) {
    const x = c + (rng() - 0.5) * size * 0.8;
    const y = c + (rng() - 0.5) * size * 0.56;
    const rr = size * (0.01 + rng() * 0.04);
    const pit = ctx.createRadialGradient(x, y, 0, x, y, rr);
    pit.addColorStop(0, `rgba(0,0,0,${0.04 + rng() * 0.09})`);
    pit.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pit;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Keep center punchy while the outer glow fades quickly.
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 24; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 2.5) * size * 0.11;
    const x = c + Math.cos(ang) * r * majorStretch;
    const y = c + Math.sin(ang) * r * minorStretch;
    const rr = size * (0.016 + rng() * 0.04);
    const knot = ctx.createRadialGradient(x, y, 0, x, y, rr);
    knot.addColorStop(0, `rgba(255,240,208,${0.16 + rng() * 0.2})`);
    knot.addColorStop(1, "rgba(255,224,182,0)");
    ctx.fillStyle = knot;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Keep very faint asymmetrical haze with multi-direction distribution.
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 24; i++) {
    const mode = rng();
    let ang: number;
    if (mode < 0.45) {
      ang = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.7;
    } else if (mode < 0.76) {
      ang = (rng() < 0.5 ? Math.PI / 3 : -Math.PI / 3) + (rng() - 0.5) * 0.78;
    } else {
      ang = (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.64;
    }
    const radial = size * (0.1 + rng() * 0.28);
    const x = c + Math.cos(ang) * radial * (0.92 + rng() * 0.24);
    const y = c + Math.sin(ang) * radial * (0.92 + rng() * 0.24);
    const rr = size * (0.08 + rng() * 0.16);
    const haze = ctx.createRadialGradient(x, y, 0, x, y, rr);
    haze.addColorStop(0, `rgba(255,184,128,${0.015 + rng() * 0.03})`);
    haze.addColorStop(1, "rgba(255,166,112,0)");
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "source-over";
  return canvas.toDataURL("image/png");
}

export class GalaxyScene implements IGameScene {
  public scene: Scene;
  private engine: AbstractEngine;
  private canvas!: HTMLCanvasElement;
  private cam!: CameraController;
  private starField!: StarFieldRenderer;
  private stars: StarData[] = [];
  private clickPlane!: Mesh;
  private hyperlaneMesh: Mesh | null = null;
  private ownershipOverlayMesh: Mesh | null = null;
  private ownershipRenderer: OwnershipOverlayRenderer | null = null;
  private hyperlanePairs: Array<[number, number]> = [];
  private hyperlaneAdjacency: number[][] = [];
  private starOwnership: number[] = [];
  private factions: FactionInfo[] = [];
  private perspective: GalaxyPerspective = { mode: "observer" };
  private visibleStarIds: Set<number> | null = null;
  private explicitVisibleStarIds: Set<number> | null | undefined = undefined;
  private playerFactionId = 0;
  private playerShipStarId = -1;
  private playerShipSystemIds = new Set<number>();
  private playerShipTransit: GalaxyShipTransit | null = null;
  private serverShips: ServerShip[] = [];
  private starbaseSystemIds = new Set<number>();
  private selectedShip = false;
  private selectedCommandShipStarId = -1;
  private selectedCommandShipId: string | null = null;
  private activeShipAction: ShipAction | null = null;
  private targetableStarIds = new Set<number>();
  private actionMenuElement: HTMLDivElement | null = null;
  private galacticCoreMeshes: Mesh[] = [];
  private galacticCoreSpinSpeeds: number[] = [];
  private hoveredStarId = -1;
  private readonly hoverScaleBoost = 1.3;
  private selectionPanel!: SelectionPanel;

  private hyperlanesVisible = true;
  private centerCloudVisible = true;
  private starsVisible = true;
  private bloomEnabled = true;
  private ownershipVisible = true;

  private pointerObserver: Observer<PointerInfo> | null = null;
  private isNavigating = false;
  private readonly onEnterSystem: EnterSystemHandler;
  private readonly options: GalaxySceneOptions;

  private readonly onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
  };

  private readonly onCanvasPointerLeave = (): void => {
    this.hoveredStarId = -1;
  };

  constructor(
    engine: AbstractEngine,
    onEnterSystem: EnterSystemHandler,
    options?: GalaxySceneOptions,
  ) {
    this.engine = engine;
    this.onEnterSystem = onEnterSystem;
    this.options = options ?? {};
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0, 0, 0, 1);
  }

  async setup(): Promise<void> {
    this.canvas = this.engine.getRenderingCanvas()!;
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.canvas.addEventListener("mouseleave", this.onCanvasPointerLeave);

    const cfg = GALAXY_MAP;
    this.stars =
      this.options.stars && this.options.stars.length > 0
        ? this.options.stars
        : generateStarMap(
          cfg.width,
          cfg.height,
          cfg.starCount,
          cfg.seed,
          cfg.minStarSpacing,
          cfg.shape,
        );
    this.factions =
      this.options.factions && this.options.factions.length > 0
        ? this.options.factions
        : buildFactions(this.stars, cfg);
    this.perspective = this.options.perspective ?? { mode: "observer" };
    this.playerFactionId = this.options.playerFactionId
      ?? (this.perspective.mode === "faction" ? this.perspective.factionId : 0);
    this.playerShipStarId = this.options.playerShipStarId
      ?? this.factions[this.playerFactionId]?.homeStarId
      ?? this.factions[0]?.homeStarId
      ?? -1;
    this.playerShipSystemIds = new Set(
      this.options.playerShipSystemIds
        ? Array.from(this.options.playerShipSystemIds)
        : this.factions.map((faction) => faction.homeStarId),
    );
    if (this.playerShipStarId >= 0) {
      this.playerShipSystemIds.add(this.playerShipStarId);
    }
    this.playerShipTransit = this.options.playerShipTransit ?? null;
    this.serverShips = this.options.serverShips ?? [];
    this.starbaseSystemIds = new Set(
      this.options.starbaseSystemIds
        ? Array.from(this.options.starbaseSystemIds)
        : this.factions.map((faction) => faction.homeStarId),
    );
    if ("visibleStarIds" in this.options) {
      this.explicitVisibleStarIds = this.options.visibleStarIds
        ? new Set(this.options.visibleStarIds)
        : null;
    }

    const initialViewState = this.options.initialViewState;

    this.cam = new CameraController(this.scene, this.canvas, {
      alpha: initialViewState?.alpha ?? cfg.camera.startAlpha,
      beta: initialViewState?.beta ?? cfg.camera.startBeta,
      radius: initialViewState?.radius ?? cfg.camera.startRadius,
      target: initialViewState
        ? new Vector3(
          initialViewState.targetX,
          initialViewState.targetY,
          initialViewState.targetZ,
        )
        : Vector3.Zero(),
      lowerRadiusLimit: cfg.camera.minRadius,
      upperRadiusLimit: cfg.camera.maxRadius,
      lowerBetaLimit: cfg.camera.minBeta,
      upperBetaLimit: cfg.camera.maxBeta,
      wheelDeltaPercentage: cfg.camera.wheelDeltaPercentage,
      inertia: cfg.camera.inertia,
    });

    this.cam.setBounds(
      -cfg.width / 2,
      cfg.width / 2,
      -cfg.height / 2,
      cfg.height / 2,
    );

    this.clickPlane = MeshBuilder.CreateGround(
      "galaxyClickPlane",
      { width: cfg.width * 1.5, height: cfg.height * 1.5 },
      this.scene,
    );
    this.clickPlane.isVisible = false;
    this.clickPlane.isPickable = true;

    const bgSphere = MeshBuilder.CreateSphere(
      "galaxyBackground",
      { diameter: 5000, segments: 24 },
      this.scene,
    );
    const bgMat = new StandardMaterial("galaxyBackgroundMat", this.scene);
    bgMat.emissiveTexture = new Texture("/textures/galaxy_bg.png", this.scene);
    bgMat.disableLighting = true;
    bgMat.backFaceCulling = false;
    bgSphere.material = bgMat;
    bgSphere.isPickable = false;
    bgSphere.infiniteDistance = true;

    this.setupGalacticCore(cfg.width, cfg.height);
    this.setupHyperlanes(cfg.width, cfg.height, cfg.shape, cfg.seed);
    this.setupOwnershipLayer(cfg.width, cfg.height, cfg.seed);

    this.starField = new StarFieldRenderer(
      this.scene,
      this.stars,
      this.playerShipStarId,
      Array.from(this.starbaseSystemIds),
      Array.from(this.playerShipSystemIds),
      this.getShipIconStyles(),
    );
    this.starField.setVisibleStarIds(this.visibleStarIds);
    this.starField.setPlayerShipState(this.playerShipStarId, this.playerShipTransit);

    this.selectionPanel = new SelectionPanel(this.canvas, {
      onShipAction: (action) => this.beginShipAction(action),
    });
    this.starField.setIconClickCallback((type, shiftKey, starId) => {
      this.handleIconClick(type, shiftKey, starId);
    });

    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
        this.updateHoveredStarFromPointer();
        return;
      }

      if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;
      const ev = pointerInfo.event as PointerEvent;
      if (this.isNavigating) return;

      if (ev.button === 2) {
        ev.preventDefault();
        this.openShipActionMenuAtPointer(ev);
        return;
      }

      if (ev.button !== 0) return;
      this.closeActionMenu();

      if (this.tryIssueActiveShipActionAtPointer()) {
        return;
      }
      
      // Check for icon click first
      const rect = this.canvas.getBoundingClientRect();
      const canvasX = (ev.clientX - rect.left) * (this.canvas.width / rect.width);
      const canvasY = (ev.clientY - rect.top) * (this.canvas.height / rect.height);
      console.log("Checking icon click at canvas coords:", {canvasX, canvasY, clientX: ev.clientX, clientY: ev.clientY});
      if (this.starField.checkIconClick(canvasX, canvasY, {width: this.canvas.width, height: this.canvas.height}, ev.shiftKey)) {
        return;
      }
      
      this.tryEnterSystemAtPointer();
    });

    await this.scene.whenReadyAsync();
  }

  onBeforeRender(): void {
    const dt = this.engine.getDeltaTime() / 1000;
    this.options.onGameplayFrame?.(dt);
    this.cam.updatePanning(dt);

    const camera = this.cam.camera;
    const minRadius = camera.lowerRadiusLimit ?? GALAXY_MAP.camera.minRadius;
    const maxRadius = camera.upperRadiusLimit ?? GALAXY_MAP.camera.maxRadius;
    const zoomOutBlend =
      (this.cam.radius - minRadius) / Math.max(0.0001, maxRadius - minRadius);

    this.starField.update(dt);
    this.starField.resetOverrides();
    if (this.hoveredStarId >= 0 && this.hoveredStarId < this.stars.length) {
      this.starField.setStarScale(this.hoveredStarId, this.hoverScaleBoost);
    }
    for (const starId of this.targetableStarIds) {
      this.starField.setStarScale(starId, SHIP_TARGET_SCALE_BOOST);
    }
    this.starField.setSelectionMarkerStar(this.hoveredStarId);
    this.starField.setZoomOutBlend(zoomOutBlend);
    this.starField.setStarsVisible(this.starsVisible);
    this.starField.setBloomEnabled(this.bloomEnabled);
    this.starField.applyVisuals();

    if (this.hyperlaneMesh) {
      this.hyperlaneMesh.visibility = this.hyperlanesVisible
        ? HYPERLANE_BASE_VISIBILITY + zoomOutBlend * HYPERLANE_ZOOM_VISIBILITY_BOOST
        : 0;
    }

    for (let i = 0; i < this.galacticCoreMeshes.length; i++) {
      this.galacticCoreMeshes[i].setEnabled(this.centerCloudVisible);
      this.galacticCoreMeshes[i].rotation.y += this.galacticCoreSpinSpeeds[i] * dt;
    }
  }

  private updateVisibilityFromPerspective(): void {
    if (this.explicitVisibleStarIds !== undefined) {
      this.visibleStarIds = this.explicitVisibleStarIds
        ? new Set(this.explicitVisibleStarIds)
        : null;
      return;
    }

    this.visibleStarIds = getPerspectiveVisibleStarIds(
      this.perspective,
      this.factions,
      this.hyperlaneAdjacency,
      this.options.visibilityJumps ?? FOG_OF_WAR_MAX_JUMPS,
    );
  }

  private isStarVisibleToPerspective(starId: number): boolean {
    return this.visibleStarIds === null || this.visibleStarIds.has(starId);
  }

  private applyVisibilityToOwnership(ownerByStar: number[]): number[] {
    if (this.visibleStarIds === null) return ownerByStar;

    return ownerByStar.map((owner, starId) => (
      this.visibleStarIds?.has(starId) ? owner : -1
    ));
  }

  private setupHyperlanes(
    width: number,
    height: number,
    shape: CoreTextureShape,
    seed: number,
  ): void {
    const hyperlanes = buildHyperlanePairs(this.stars, width, height, shape, seed);
    this.hyperlanePairs = hyperlanes;
    this.hyperlaneAdjacency = buildHyperlaneAdjacency(hyperlanes, this.stars.length);
    this.updateVisibilityFromPerspective();
    this.rebuildHyperlaneMesh(width, height);
  }

  private rebuildHyperlaneMesh(width: number, height: number): void {
    this.hyperlaneMesh?.dispose();
    this.hyperlaneMesh = null;
    const hyperlanes = this.hyperlanePairs;
    if (hyperlanes.length === 0) return;

    const minAxis = Math.min(width, height);
    const maxLaneDistance = minAxis * 0.34;
    const lineSegments: Vector3[][] = [];
    const lineColors: Color4[][] = [];

    for (const [a, b] of hyperlanes) {
      if (!this.isStarVisibleToPerspective(a) || !this.isStarVisibleToPerspective(b)) {
        continue;
      }

      const starA = this.stars[a];
      const starB = this.stars[b];

      const dx = starB.x - starA.x;
      const dz = starB.z - starA.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.0001) continue;

      const endpointInset = clamp(
        distance * HYPERLANE_STAR_ENDPOINT_OFFSET_FACTOR,
        HYPERLANE_STAR_ENDPOINT_OFFSET_MIN,
        HYPERLANE_STAR_ENDPOINT_OFFSET_MAX,
      );

      const ux = dx / distance;
      const uz = dz / distance;
      const ax = starA.x + ux * endpointInset;
      const az = starA.z + uz * endpointInset;
      const bx = starB.x - ux * endpointInset;
      const bz = starB.z - uz * endpointInset;
      const mx = (ax + bx) * 0.5;
      const mz = (az + bz) * 0.5;

      const shortLaneFactor = 1 - clamp(distance / maxLaneDistance, 0, 1);
      const midAlpha = HYPERLANE_BASE_ALPHA + shortLaneFactor * HYPERLANE_DISTANCE_ALPHA_BOOST;
      const endAlpha = midAlpha * HYPERLANE_ENDPOINT_ALPHA_FACTOR;

      const laneColorStart = new Color4(0.53, 0.57, 0.62, endAlpha);
      const laneColorMid = new Color4(0.56, 0.61, 0.67, midAlpha);
      const laneColorEnd = new Color4(0.53, 0.57, 0.62, endAlpha);

      lineSegments.push([
        new Vector3(ax, 0.06, az),
        new Vector3(mx, 0.06, mz),
        new Vector3(bx, 0.06, bz),
      ]);
      lineColors.push([laneColorStart, laneColorMid, laneColorEnd]);
    }

    if (lineSegments.length === 0) return;

    this.hyperlaneMesh = MeshBuilder.CreateLineSystem(
      "galaxyHyperlanes",
      {
        lines: lineSegments,
        colors: lineColors,
        updatable: false,
      },
      this.scene,
    );
    this.hyperlaneMesh.isPickable = false;
    this.hyperlaneMesh.alwaysSelectAsActiveMesh = true;
    this.hyperlaneMesh.visibility = this.hyperlanesVisible
      ? HYPERLANE_BASE_VISIBILITY + HYPERLANE_ZOOM_VISIBILITY_BOOST
      : 0;
  }

  private setupOwnershipLayer(width: number, height: number, seed: number): void {
    if (this.stars.length === 0) return;

    const factionCount = Math.min(this.factions.length, this.stars.length);
    if (factionCount <= 0) return;

    const palette = this.factions
      .slice(0, factionCount)
      .map((faction) => new Color3(faction.color[0], faction.color[1], faction.color[2]));
    this.starOwnership = this.options.starOwnership
      ? this.options.starOwnership.slice(0, this.stars.length)
      : buildHomeSystemOwnership(this.stars, this.factions);
    while (this.starOwnership.length < this.stars.length) {
      this.starOwnership.push(-1);
    }
    const ownershipPadding = Math.min(width, height) * OWNERSHIP_OVERLAY_PADDING_FACTOR;
    const ownershipWidth = width + ownershipPadding * 2;
    const ownershipHeight = height + ownershipPadding * 2;

    this.ownershipRenderer = new OwnershipOverlayRenderer(this.scene, {
      textureSize: OWNERSHIP_TEXTURE_SIZE,
      mapWidth: ownershipWidth,
      mapHeight: ownershipHeight,
      stars: this.stars,
      palette,
    });
    this.ownershipRenderer.updateOwnership(this.applyVisibilityToOwnership(this.starOwnership));

    const overlay = MeshBuilder.CreateGround(
      "galaxyOwnershipOverlay",
      { width: ownershipWidth, height: ownershipHeight },
      this.scene,
    );
    overlay.position.y = OWNERSHIP_OVERLAY_Y;
    overlay.isPickable = false;
    overlay.alwaysSelectAsActiveMesh = true;

    const tex = this.ownershipRenderer.texture;

    const mat = new StandardMaterial("galaxyOwnershipOverlayMat", this.scene);
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveTexture = tex;
    mat.diffuseColor = Color3.White();
    mat.emissiveColor = Color3.White();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 1;

    overlay.material = mat;
    overlay.setEnabled(this.ownershipVisible);
    this.ownershipOverlayMesh = overlay;
  }

  private setupGalacticCore(width: number, height: number): void {
    const minSize = Math.min(width, height);
    const axisRatio = width / Math.max(1, height);
    const coreTextureDataURL = createGalacticCoreTextureDataURL(
      1024,
      GALAXY_MAP.shape,
      axisRatio,
    );
    const majorScale = Math.max(1.08, Math.min(1.32, axisRatio * 0.88));
    const minorScale = Math.max(0.76, Math.min(0.98, 1 / (majorScale * 0.96)));

    const layers = [
      {
        name: "galaxyCoreOuter",
        radius: minSize * 0.62,
        alpha: 0.065,
        color: new Color3(1.0, 0.69, 0.47),
        spin: 0.0019,
        scaleX: majorScale * 1.03,
        scaleZ: minorScale * 1.1,
        offsetX: minSize * 0.012,
        offsetZ: -minSize * 0.016,
        yaw: 0.11,
        texScale: 1.02,
        texOffsetU: -0.012,
        texOffsetV: 0.01,
      },
      {
        name: "galaxyCoreMid",
        radius: minSize * 0.49,
        alpha: 0.115,
        color: new Color3(1.0, 0.74, 0.51),
        spin: -0.0036,
        scaleX: majorScale * 0.99,
        scaleZ: minorScale * 1.07,
        offsetX: -minSize * 0.008,
        offsetZ: minSize * 0.014,
        yaw: -0.15,
        texScale: 1.0,
        texOffsetU: 0.007,
        texOffsetV: -0.013,
      },
      {
        name: "galaxyCoreInner",
        radius: minSize * 0.35,
        alpha: 0.195,
        color: new Color3(1.0, 0.81, 0.6),
        spin: 0.0058,
        scaleX: majorScale * 0.94,
        scaleZ: minorScale * 0.99,
        offsetX: minSize * 0.004,
        offsetZ: minSize * 0.009,
        yaw: 0.08,
        texScale: 0.985,
        texOffsetU: -0.004,
        texOffsetV: 0.011,
      },
      {
        name: "galaxyCoreNucleus",
        radius: minSize * 0.24,
        alpha: 0.285,
        color: new Color3(1.0, 0.88, 0.7),
        spin: -0.0105,
        scaleX: majorScale * 0.89,
        scaleZ: minorScale * 0.92,
        offsetX: -minSize * 0.003,
        offsetZ: -minSize * 0.006,
        yaw: -0.06,
        texScale: 0.97,
        texOffsetU: 0.003,
        texOffsetV: -0.007,
      },
    ];

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const disc = MeshBuilder.CreateDisc(
        layer.name,
        { radius: layer.radius, tessellation: 96 },
        this.scene,
      );
      disc.rotation.x = Math.PI / 2;
      disc.rotation.z = layer.yaw;
      disc.position.y = 0.02 + i * 0.01;
      disc.position.x = layer.offsetX;
      disc.position.z = layer.offsetZ;
      disc.scaling.x = layer.scaleX;
      disc.scaling.y = layer.scaleZ;
      disc.isPickable = false;

      const layerTexture = new Texture(coreTextureDataURL, this.scene);
      layerTexture.hasAlpha = true;
      layerTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
      layerTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
      layerTexture.uScale = layer.texScale;
      layerTexture.vScale = layer.texScale * (0.97 + i * 0.012);
      layerTexture.uOffset = layer.texOffsetU;
      layerTexture.vOffset = layer.texOffsetV;

      const mat = new StandardMaterial(`${layer.name}Mat`, this.scene);
      mat.emissiveTexture = layerTexture;
      mat.opacityTexture = layerTexture;
      mat.emissiveColor = layer.color;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alpha = layer.alpha;

      disc.material = mat;
      this.galacticCoreMeshes.push(disc);
      this.galacticCoreSpinSpeeds.push(layer.spin);
    }
  }

  private getShipOwnerForStarId(starId: number): FactionInfo | null {
    const serverShip = this.serverShips.find((ship) => ship.currentStarId === starId);
    if (serverShip) {
      return this.factions.find((faction) => faction.id === serverShip.ownerId) ?? null;
    }
    return this.factions.find((faction) => faction.homeStarId === starId) ?? null;
  }

  private getShipForStarId(starId: number): ServerShip | null {
    return this.serverShips.find((ship) => ship.currentStarId === starId) ?? null;
  }

  private getShipIconStyles(): ShipIconStyle[] {
    const styles: ShipIconStyle[] = [];
    for (const starId of this.playerShipSystemIds) {
      const owner = this.getShipOwnerForStarId(starId);
      if (!owner) continue;
      styles.push({ starId, color: owner.color });
    }
    return styles;
  }

  private isOwnShipOwner(ownerId: number | null): boolean {
    return ownerId !== null && ownerId === this.playerFactionId;
  }

  private getCurrentCommandOriginStarId(): number {
    return this.playerShipTransit?.toStarId
      ?? (this.selectedCommandShipStarId >= 0 ? this.selectedCommandShipStarId : this.playerShipStarId);
  }

  private getReachableStarIds(action: ShipAction): Set<number> {
    const reachable = new Set<number>();
    if (action === "attack") return reachable;

    const start = this.getCurrentCommandOriginStarId();
    if (start < 0 || start >= this.hyperlaneAdjacency.length) return reachable;
    if (!this.isStarVisibleToPerspective(start)) return reachable;

    const queue: number[] = [start];
    let head = 0;
    reachable.add(start);

    while (head < queue.length) {
      const current = queue[head++];
      for (const neighbor of this.hyperlaneAdjacency[current] ?? []) {
        if (neighbor < 0 || neighbor >= this.hyperlaneAdjacency.length) continue;
        if (reachable.has(neighbor)) continue;
        if (!this.isStarVisibleToPerspective(neighbor)) continue;
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }

    if (action === "move") {
      reachable.delete(start);
      return reachable;
    }

    for (const starId of Array.from(reachable)) {
      if (this.starbaseSystemIds.has(starId)) {
        reachable.delete(starId);
      }
    }
    return reachable;
  }

  private beginShipAction(action: ShipAction): void {
    if (!this.selectedShip || this.selectedCommandShipStarId < 0) {
      this.clearShipAction();
      return;
    }

    if (action === "attack") {
      console.info("Attack command is a placeholder.");
      this.clearShipAction();
      return;
    }

    if (this.activeShipAction === action) {
      this.clearShipAction();
      return;
    }

    this.activeShipAction = action;
    this.targetableStarIds = this.getReachableStarIds(action);
    this.starField.setHighlightedStarIds(this.targetableStarIds);
    this.selectionPanel.setActiveShipAction(action);
  }

  private clearShipAction(): void {
    this.activeShipAction = null;
    this.targetableStarIds.clear();
    this.starField.setHighlightedStarIds([]);
    this.selectionPanel?.setActiveShipAction(null);
  }

  private tryIssueActiveShipActionAtPointer(): boolean {
    if (!this.activeShipAction) return false;

    const nearestStar = this.findNearestStarAtPointer();
    if (!nearestStar) return true;
    if (!this.targetableStarIds.has(nearestStar.id)) return true;

    const action = this.activeShipAction;
    const shipId = this.selectedCommandShipId ?? undefined;
    this.clearShipAction();
    this.options.onShipCommand?.(action, nearestStar.id, shipId);
    return true;
  }

  private openShipActionMenuAtPointer(ev: PointerEvent): void {
    const star = this.findNearestStarAtPointer();
    if (!star || !this.selectedShip || !this.isStarVisibleToPerspective(star.id)) {
      this.closeActionMenu();
      return;
    }

    ensureActionMenuStyles();
    this.closeActionMenu();

    const menu = document.createElement("div");
    menu.className = "spaceActionMenu";
    menu.style.left = `${Math.min(ev.clientX, window.innerWidth - 170)}px`;
    menu.style.top = `${Math.min(ev.clientY, window.innerHeight - 150)}px`;

    const title = document.createElement("div");
    title.className = "spaceActionMenuTitle";
    title.textContent = star.name;
    menu.appendChild(title);

    const actions: Array<{ action: ShipAction; label: string }> = [
      { action: "move", label: "Move" },
      { action: "build", label: "Build" },
      { action: "attack", label: "Attack" },
    ];

    for (const item of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "spaceActionMenuBtn";
      button.textContent = item.label;
      button.addEventListener("click", (clickEv) => {
        clickEv.stopPropagation();
        this.closeActionMenu();
        if (item.action === "attack") {
          console.info("Attack command is a placeholder.");
          return;
        }
        this.options.onShipCommand?.(item.action, star.id, this.selectedCommandShipId ?? undefined);
      });
      menu.appendChild(button);
    }

    document.body.appendChild(menu);
    this.actionMenuElement = menu;
  }

  private closeActionMenu(): void {
    this.actionMenuElement?.remove();
    this.actionMenuElement = null;
  }

  private findNearestStarAtPointer(): StarData | null {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => mesh === this.clickPlane,
      false,
      this.cam.camera,
    );

    if (!pick?.hit || !pick.pickedPoint) return null;

    const clickX = pick.pickedPoint.x;
    const clickZ = pick.pickedPoint.z;
    const pickRadius = clamp(
      this.cam.radius * STAR_PICK_RADIUS_CAMERA_FACTOR,
      STAR_PICK_RADIUS_MIN,
      STAR_PICK_RADIUS_MAX,
    );
    const pickRadiusSq = pickRadius * pickRadius;

    let nearestStar: StarData | null = null;
    let nearestDistSq = Infinity;

    for (const star of this.stars) {
      if (!this.isStarVisibleToPerspective(star.id)) continue;

      const dx = clickX - star.x;
      const dz = clickZ - star.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearestStar = star;
      }
    }

    if (!nearestStar || nearestDistSq > pickRadiusSq) return null;
    return nearestStar;
  }

  private updateHoveredStarFromPointer(): void {
    const hovered = this.findNearestStarAtPointer();
    this.hoveredStarId = hovered ? hovered.id : -1;
  }

  private tryEnterSystemAtPointer(): void {
    const nearestStar = this.findNearestStarAtPointer();
    if (!nearestStar) return;
    this.requestEnterSystem(nearestStar);
  }

  private requestEnterSystem(star: StarData): void {
    if (this.isNavigating) return;
    this.isNavigating = true;
    Promise.resolve(this.onEnterSystem(star))
      .catch((err) => console.error("Failed to open system view", err))
      .finally(() => {
        this.isNavigating = false;
      });
  }

  private handleIconClick(type: "ship" | "starbase", shiftKey: boolean, starId?: number): void {
    if (type === "ship") {
      const shipStarId = starId ?? this.playerShipStarId;
      const serverShip = this.getShipForStarId(shipStarId);
      const owner = serverShip
        ? this.factions.find((faction) => faction.id === serverShip.ownerId) ?? null
        : this.getShipOwnerForStarId(shipStarId);
      const ownerId = owner?.id ?? null;
      const canCommand = this.isOwnShipOwner(ownerId);

      if (canCommand) {
        this.selectedShip = true;
        this.selectedCommandShipStarId = shipStarId;
        this.selectedCommandShipId = serverShip?.id ?? null;
      } else if (!shiftKey) {
        this.selectedShip = false;
        this.selectedCommandShipStarId = -1;
        this.selectedCommandShipId = null;
        this.clearShipAction();
      }

      this.selectionPanel.select(
        {
          type: "ship",
          id: String(shipStarId),
          name: owner ? `${owner.name} Vessel` : "Unidentified Vessel",
          hp: 95,
          maxHp: 100,
          class: "Sovereign-Class",
          status: serverShip && serverShip.phase !== "idle"
            ? serverShip.phase
            : this.playerShipTransit && shipStarId === this.playerShipStarId ? "Moving" : "Operational",
          detail: canCommand
            ? "Select a command, then choose a highlighted system."
            : "Foreign ship. Command controls unavailable.",
          ownerName: owner?.name ?? "Unknown",
          ownerColor: owner?.color,
          canCommand,
        },
        shiftKey,
      );
    } else if (type === "starbase") {
      if (!shiftKey) {
        this.selectedShip = false;
        this.selectedCommandShipStarId = -1;
        this.selectedCommandShipId = null;
        this.clearShipAction();
      }
      this.selectionPanel.select(
        {
          type: "starbase",
          name: "Starbase 375",
          hp: 88,
          maxHp: 100,
          class: "Outpost",
        },
        shiftKey,
      );
    }
  }

  getStars(): StarData[] {
    return this.stars;
  }

  getConnectedStars(starId: number): StarData[] {
    if (starId < 0 || starId >= this.hyperlaneAdjacency.length) return [];
    const neighborIds = this.hyperlaneAdjacency[starId] ?? [];
    const out: StarData[] = [];
    for (const neighborId of neighborIds) {
      if (!this.isStarVisibleToPerspective(neighborId)) continue;
      const star = this.stars[neighborId];
      if (star) out.push(star);
    }
    return out;
  }

  setHyperlanesVisible(visible: boolean): void {
    this.hyperlanesVisible = visible;
    if (this.hyperlaneMesh) {
      this.hyperlaneMesh.visibility = visible
        ? HYPERLANE_BASE_VISIBILITY + HYPERLANE_ZOOM_VISIBILITY_BOOST
        : 0;
    }
  }

  setCenterCloudVisible(visible: boolean): void {
    this.centerCloudVisible = visible;
    for (const mesh of this.galacticCoreMeshes) {
      mesh.setEnabled(visible);
    }
  }

  setStarsVisible(visible: boolean): void {
    this.starsVisible = visible;
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
  }

  setOwnershipVisible(visible: boolean): void {
    this.ownershipVisible = visible;
    this.ownershipOverlayMesh?.setEnabled(visible);
  }

  setVisibleStarIds(starIds: Iterable<number> | null): void {
    this.explicitVisibleStarIds = starIds ? new Set(starIds) : null;
    this.updateVisibilityFromPerspective();
    this.starField?.setVisibleStarIds(this.visibleStarIds);
    this.ownershipRenderer?.updateOwnership(this.applyVisibilityToOwnership(this.starOwnership));
    this.rebuildHyperlaneMesh(GALAXY_MAP.width, GALAXY_MAP.height);
    if (this.activeShipAction) {
      this.targetableStarIds = this.getReachableStarIds(this.activeShipAction);
      this.starField?.setHighlightedStarIds(this.targetableStarIds);
    }
  }

  setPlayerShipState(starId: number, transit: GalaxyShipTransit | null): void {
    this.playerShipStarId = starId;
    if (starId >= 0) {
      this.playerShipSystemIds.add(starId);
    }
    this.playerShipTransit = transit;
    this.starField?.setPlayerShipSystemIds(this.playerShipSystemIds);
    this.starField?.setShipIconStyles(this.getShipIconStyles());
    this.starField?.setPlayerShipState(starId, transit);
  }

  setServerShips(ships: ServerShip[]): void {
    this.serverShips = ships;
    this.playerShipSystemIds = new Set(
      ships
        .map((ship) => ship.currentStarId)
        .filter((starId) => starId >= 0),
    );
    if (this.playerShipStarId >= 0) {
      this.playerShipSystemIds.add(this.playerShipStarId);
    }
    this.starField?.setPlayerShipSystemIds(this.playerShipSystemIds);
    this.starField?.setShipIconStyles(this.getShipIconStyles());
  }

  setStarbaseSystemIds(starIds: Iterable<number>): void {
    this.starbaseSystemIds = new Set(starIds);
    this.starField?.setStarbaseSystemIds(this.starbaseSystemIds);
    if (this.activeShipAction === "build") {
      this.targetableStarIds = this.getReachableStarIds("build");
      this.starField?.setHighlightedStarIds(this.targetableStarIds);
    }
  }

  setStarOwnership(starId: number, owner: number): void {
    if (starId < 0 || starId >= this.starOwnership.length) return;
    this.starOwnership[starId] = owner;
    this.ownershipRenderer?.setStarOwner(
      starId,
      this.isStarVisibleToPerspective(starId) ? owner : -1,
    );
  }

  setStarOwnerships(ownerByStar: number[]): void {
    this.starOwnership = ownerByStar.slice(0, this.stars.length);
    while (this.starOwnership.length < this.stars.length) {
      this.starOwnership.push(-1);
    }
    this.ownershipRenderer?.updateOwnership(this.applyVisibilityToOwnership(this.starOwnership));
  }

  captureViewState(): GalaxyViewState | null {
    if (!this.cam) return null;

    const target = this.cam.target;
    return {
      alpha: this.cam.camera.alpha,
      beta: this.cam.camera.beta,
      radius: this.cam.radius,
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z,
    };
  }

  dispose(): void {
    this.closeActionMenu();
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    this.canvas?.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas?.removeEventListener("mouseleave", this.onCanvasPointerLeave);
    this.selectionPanel?.clear();
    this.hyperlaneMesh?.dispose();
    this.hyperlaneMesh = null;
    if (this.ownershipOverlayMesh) {
      const ownershipMaterial = this.ownershipOverlayMesh.material;
      this.ownershipOverlayMesh.material = null;
      this.ownershipOverlayMesh.dispose();
      ownershipMaterial?.dispose(false, false);
      this.ownershipOverlayMesh = null;
    }
    this.ownershipRenderer?.dispose();
    this.ownershipRenderer = null;
    this.hyperlanePairs = [];
    this.hyperlaneAdjacency = [];
    this.starOwnership = [];
    this.hoveredStarId = -1;
    this.galacticCoreMeshes = [];
    this.galacticCoreSpinSpeeds = [];
    this.clickPlane?.dispose();
    this.starField?.dispose();
    this.cam?.dispose();
    this.scene.dispose();
  }
}

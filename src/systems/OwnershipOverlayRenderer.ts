import { Color3, DynamicTexture, Texture } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { StarData } from "../data/StarMap";

type PixelBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type ProjectedStar = {
  x: number;
  y: number;
};

type ContourSegment = {
  oax: number;
  oay: number;
  obx: number;
  oby: number;
  nx: number;
  ny: number;
};

type ContourPoint = [number, number];

export interface OwnershipOverlayRendererOptions {
  textureSize: number;
  mapWidth: number;
  mapHeight: number;
  stars: StarData[];
  palette: Color3[];
  territoryRadiusWorld?: number;
}

const FILL_ALPHA = 0.1;
const BORDER_CONTOUR_STEP = 1;
const BORDER_GLOW_WIDTH = 5.5;
const BORDER_SOFT_WIDTH = 2.8;
const BORDER_CORE_WIDTH = 1.2;
const BORDER_GLOW_BLUR = 5.5;
const BORDER_SOFT_BLUR = 2.6;
const BORDER_GLOW_ALPHA = 0.16;
const BORDER_SOFT_ALPHA = 0.34;
const BORDER_CORE_ALPHA = 0.82;
const REFERENCE_TEXTURE_SIZE = 1600;
const TERRITORY_RADIUS_NEAREST_FACTOR = 0.68;
const TERRITORY_RADIUS_MIN_MAP_FACTOR = 0.014;
const TERRITORY_RADIUS_MAX_MAP_FACTOR = 0.032;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeOwnershipRadiusWorld(
  mapWidth: number,
  mapHeight: number,
  stars: StarData[],
): number {
  const minAxis = Math.min(mapWidth, mapHeight);
  const minRadius = minAxis * TERRITORY_RADIUS_MIN_MAP_FACTOR;
  const maxRadius = minAxis * TERRITORY_RADIUS_MAX_MAP_FACTOR;

  if (stars.length < 2) {
    return clamp(minAxis * 0.022, minRadius, maxRadius);
  }

  const nearestDistances: number[] = [];
  for (let i = 0; i < stars.length; i++) {
    let nearestSq = Number.POSITIVE_INFINITY;
    const a = stars[i];
    for (let j = 0; j < stars.length; j++) {
      if (i === j) continue;
      const b = stars[j];
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < nearestSq) {
        nearestSq = distanceSq;
      }
    }

    if (Number.isFinite(nearestSq)) {
      nearestDistances.push(Math.sqrt(nearestSq));
    }
  }

  if (nearestDistances.length === 0) {
    return clamp(minAxis * 0.022, minRadius, maxRadius);
  }

  nearestDistances.sort((a, b) => a - b);
  const medianNearest = nearestDistances[Math.floor(nearestDistances.length * 0.5)];
  return clamp(medianNearest * TERRITORY_RADIUS_NEAREST_FACTOR, minRadius, maxRadius);
}

function colorToRgb(color: Color3): { r: number; g: number; b: number } {
  return {
    r: Math.round(clamp(color.r, 0, 1) * 255),
    g: Math.round(clamp(color.g, 0, 1) * 255),
    b: Math.round(clamp(color.b, 0, 1) * 255),
  };
}

function rgbaString(
  color: { r: number; g: number; b: number },
  alpha: number,
  lift = 1,
): string {
  const r = Math.min(255, Math.round(color.r * lift + 10));
  const g = Math.min(255, Math.round(color.g * lift + 10));
  const b = Math.min(255, Math.round(color.b * lift + 10));
  return `rgba(${r},${g},${b},${alpha})`;
}

export class OwnershipOverlayRenderer {
  readonly texture: DynamicTexture;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly widthPx: number;
  private readonly heightPx: number;
  private readonly stars: StarData[];
  private readonly paletteRgb: Array<{ r: number; g: number; b: number }>;
  private readonly projectedStars: ProjectedStar[];
  private readonly fullBounds: PixelBounds;
  private readonly territoryOuterRadiusPx: number;
  private readonly outerRadiusSq: number;
  private readonly invOuterRadius: number;
  private readonly ownerMap: Int16Array;
  private readonly distanceSqMap: Float32Array;
  private readonly influenceMap: Float32Array;
  private readonly borderPixelScale: number;

  private ownerByStar: number[];

  constructor(scene: Scene, options: OwnershipOverlayRendererOptions) {
    const mapAspect = options.mapWidth / Math.max(1, options.mapHeight);
    this.widthPx = mapAspect >= 1
      ? options.textureSize
      : Math.max(640, Math.round(options.textureSize * mapAspect));
    this.heightPx = mapAspect >= 1
      ? Math.max(640, Math.round(options.textureSize / Math.max(0.001, mapAspect)))
      : options.textureSize;

    this.stars = options.stars;
    this.ownerByStar = new Array<number>(options.stars.length).fill(-1);
    this.paletteRgb = options.palette.map(colorToRgb);
    this.borderPixelScale = options.textureSize / REFERENCE_TEXTURE_SIZE;
    this.fullBounds = {
      minX: 0,
      minY: 0,
      maxX: this.widthPx - 1,
      maxY: this.heightPx - 1,
    };

    this.texture = new DynamicTexture(
      "galaxyOwnershipOverlayTexture",
      { width: this.widthPx, height: this.heightPx },
      scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    this.texture.hasAlpha = true;
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.texture.anisotropicFilteringLevel = 8;

    this.ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    const pxPerWorldX = (this.widthPx - 1) / Math.max(1, options.mapWidth);
    const pxPerWorldY = (this.heightPx - 1) / Math.max(1, options.mapHeight);
    const avgPxPerWorld = (pxPerWorldX + pxPerWorldY) * 0.5;
    const territoryRadiusWorld = options.territoryRadiusWorld
      ?? computeOwnershipRadiusWorld(options.mapWidth, options.mapHeight, options.stars);
    this.territoryOuterRadiusPx = Math.max(4, territoryRadiusWorld * avgPxPerWorld);
    this.outerRadiusSq = this.territoryOuterRadiusPx * this.territoryOuterRadiusPx;
    this.invOuterRadius = 1 / Math.max(0.001, this.territoryOuterRadiusPx);

    const pixelCount = this.widthPx * this.heightPx;
    this.ownerMap = new Int16Array(pixelCount);
    this.distanceSqMap = new Float32Array(pixelCount);
    this.influenceMap = new Float32Array(pixelCount);

    this.projectedStars = options.stars.map((star) => ({
      x: (star.x / options.mapWidth + 0.5) * (this.widthPx - 1),
      y: (0.5 - star.z / options.mapHeight) * (this.heightPx - 1),
    }));
  }

  updateOwnership(ownerByStar: number[]): void {
    this.ownerByStar = ownerByStar
      .slice(0, this.stars.length)
      .map((owner) => this.normalizeOwner(owner));
    while (this.ownerByStar.length < this.stars.length) {
      this.ownerByStar.push(-1);
    }
    this.render();
  }

  setStarOwner(starId: number, owner: number): void {
    if (starId < 0 || starId >= this.stars.length) return;
    const normalizedOwner = this.normalizeOwner(owner);
    if (this.ownerByStar[starId] === normalizedOwner) return;

    this.ownerByStar[starId] = normalizedOwner;
    this.render();
  }

  setStarOwners(changes: Array<{ starId: number; owner: number }>): void {
    let changed = false;

    for (const change of changes) {
      if (change.starId < 0 || change.starId >= this.stars.length) continue;
      const normalizedOwner = this.normalizeOwner(change.owner);
      if (this.ownerByStar[change.starId] === normalizedOwner) continue;
      this.ownerByStar[change.starId] = normalizedOwner;
      changed = true;
    }

    if (changed) {
      this.render();
    }
  }

  dispose(): void {
    this.texture.dispose();
  }

  private normalizeOwner(owner: number): number {
    if (!Number.isFinite(owner)) return -1;
    const normalizedOwner = Math.trunc(owner);
    return normalizedOwner >= 0 && normalizedOwner < this.paletteRgb.length
      ? normalizedOwner
      : -1;
  }

  private render(): void {
    const renderBounds = this.fullBounds;

    this.clearCanvas(renderBounds);
    this.clearMaps(renderBounds);
    this.stampOwnership(renderBounds);
    this.paintFill(renderBounds);
    this.drawBorders(renderBounds);
    this.texture.update(true);
  }

  private clearCanvas(bounds: PixelBounds): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.shadowBlur = 0;
    this.ctx.clearRect(
      bounds.minX,
      bounds.minY,
      bounds.maxX - bounds.minX + 1,
      bounds.maxY - bounds.minY + 1,
    );
    this.ctx.restore();
  }

  private clearMaps(bounds: PixelBounds): void {
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      const start = y * this.widthPx + bounds.minX;
      const end = y * this.widthPx + bounds.maxX + 1;
      this.ownerMap.fill(-1, start, end);
      this.distanceSqMap.fill(Number.POSITIVE_INFINITY, start, end);
      this.influenceMap.fill(0, start, end);
    }
  }

  private stampOwnership(bounds: PixelBounds): void {
    for (let starIndex = 0; starIndex < this.projectedStars.length; starIndex++) {
      const owner = this.ownerByStar[starIndex] ?? -1;
      if (owner < 0 || owner >= this.paletteRgb.length) continue;

      const star = this.projectedStars[starIndex];
      const starMinX = Math.floor(star.x - this.territoryOuterRadiusPx);
      const starMaxX = Math.ceil(star.x + this.territoryOuterRadiusPx);
      const starMinY = Math.floor(star.y - this.territoryOuterRadiusPx);
      const starMaxY = Math.ceil(star.y + this.territoryOuterRadiusPx);

      const minX = Math.max(bounds.minX, starMinX);
      const maxX = Math.min(bounds.maxX, starMaxX);
      const minY = Math.max(bounds.minY, starMinY);
      const maxY = Math.min(bounds.maxY, starMaxY);
      if (minX > maxX || minY > maxY) continue;

      for (let y = minY; y <= maxY; y++) {
        const dy = y - star.y;
        for (let x = minX; x <= maxX; x++) {
          const dx = x - star.x;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq > this.outerRadiusSq) continue;

          const idx = y * this.widthPx + x;
          const currentOwner = this.ownerMap[idx];
          const currentDistanceSq = this.distanceSqMap[idx];
          const influenceLinear = clamp(1 - Math.sqrt(distanceSq) * this.invOuterRadius, 0, 1);
          const influence = influenceLinear * influenceLinear;

          if (currentOwner < 0 || distanceSq < currentDistanceSq) {
            this.ownerMap[idx] = owner;
            this.distanceSqMap[idx] = distanceSq;
            this.influenceMap[idx] = influence;
            continue;
          }

          if (currentOwner === owner && influence > this.influenceMap[idx]) {
            this.influenceMap[idx] = influence;
          }
        }
      }
    }
  }

  private paintFill(bounds: PixelBounds): void {
    const width = bounds.maxX - bounds.minX + 1;
    const height = bounds.maxY - bounds.minY + 1;
    const imageData = this.ctx.createImageData(width, height);
    const pixels = imageData.data;
    const fillAlphaByte = Math.round(255 * FILL_ALPHA);

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const srcIdx = y * this.widthPx + x;
        const owner = this.ownerMap[srcIdx];
        if (owner < 0) continue;

        const color = this.paletteRgb[owner];
        if (!color) continue;

        const influence = this.influenceMap[srcIdx];
        const localIdx = ((y - bounds.minY) * width + (x - bounds.minX)) * 4;
        pixels[localIdx] = color.r;
        pixels[localIdx + 1] = color.g;
        pixels[localIdx + 2] = color.b;
        pixels[localIdx + 3] = Math.round(
          fillAlphaByte * clamp(0.32 + influence * 0.78, 0.22, 1),
        );
      }
    }

    this.ctx.putImageData(imageData, bounds.minX, bounds.minY);
  }

  private drawBorders(bounds: PixelBounds): void {
    const segmentBuckets = this.buildBorderSegments(bounds);

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(
      bounds.minX,
      bounds.minY,
      bounds.maxX - bounds.minX + 1,
      bounds.maxY - bounds.minY + 1,
    );
    this.ctx.clip();
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    const glowWidth = this.scaleBorderPixels(BORDER_GLOW_WIDTH);
    const softWidth = this.scaleBorderPixels(BORDER_SOFT_WIDTH);
    const coreWidth = this.scaleBorderPixels(BORDER_CORE_WIDTH);
    const glowBlur = this.scaleBorderPixels(BORDER_GLOW_BLUR);
    const softBlur = this.scaleBorderPixels(BORDER_SOFT_BLUR);

    this.drawBorderPass(
      this.createBorderPaths(segmentBuckets, glowWidth * 0.5 + glowBlur * 0.25),
      glowWidth,
      BORDER_GLOW_ALPHA,
      1.16,
      glowBlur,
    );
    this.drawBorderPass(
      this.createBorderPaths(segmentBuckets, softWidth * 0.5 + softBlur * 0.2),
      softWidth,
      BORDER_SOFT_ALPHA,
      1.12,
      softBlur,
    );
    this.drawBorderPass(
      this.createBorderPaths(segmentBuckets, coreWidth * 0.5),
      coreWidth,
      BORDER_CORE_ALPHA,
      1.24,
      0,
    );

    this.ctx.restore();
  }

  private drawBorderPass(
    paths: Path2D[],
    lineWidth: number,
    alpha: number,
    lift: number,
    shadowBlur: number,
  ): void {
    this.ctx.lineWidth = lineWidth;
    this.ctx.shadowBlur = shadowBlur;
    this.ctx.globalCompositeOperation = "source-over";

    for (let owner = 0; owner < paths.length; owner++) {
      const color = this.paletteRgb[owner];
      if (!color) continue;
      this.ctx.strokeStyle = rgbaString(color, alpha, lift);
      this.ctx.shadowColor = rgbaString(color, alpha * 0.9, lift);
      this.ctx.stroke(paths[owner]);
    }

    this.ctx.shadowBlur = 0;
    this.ctx.globalCompositeOperation = "source-over";
  }

  private scaleBorderPixels(value: number): number {
    return value * this.borderPixelScale;
  }

  private buildBorderSegments(bounds: PixelBounds): ContourSegment[][] {
    const segmentBuckets = this.paletteRgb.map((): ContourSegment[] => []);
    const step = BORDER_CONTOUR_STEP;
    const minX = Math.max(0, bounds.minX - step);
    const minY = Math.max(0, bounds.minY - step);
    const maxX = Math.min(this.widthPx - 1 - step, bounds.maxX + step);
    const maxY = Math.min(this.heightPx - 1 - step, bounds.maxY + step);

    for (let y = minY; y <= maxY; y += step) {
      for (let x = minX; x <= maxX; x += step) {
        const owners = [
          this.ownerAt(x, y),
          this.ownerAt(x + step, y),
          this.ownerAt(x + step, y + step),
          this.ownerAt(x, y + step),
        ];
        if (owners[0] === owners[1] && owners[1] === owners[2] && owners[2] === owners[3]) {
          continue;
        }

        const uniqueOwners = new Set(owners.filter((owner) => owner >= 0));
        for (const owner of uniqueOwners) {
          const mask =
            (owners[0] === owner ? 1 : 0)
            | (owners[1] === owner ? 2 : 0)
            | (owners[2] === owner ? 4 : 0)
            | (owners[3] === owner ? 8 : 0);
          this.addMarchingSquareSegments(
            segmentBuckets[owner],
            x,
            y,
            step,
            mask,
          );
        }
      }
    }

    return segmentBuckets;
  }

  private createBorderPaths(
    segmentBuckets: ContourSegment[][],
    inwardOffsetPx: number,
  ): Path2D[] {
    return segmentBuckets.map((segments) => (
      this.createSmoothedContourPath(segments, inwardOffsetPx)
    ));
  }

  private ownerAt(x: number, y: number): number {
    const clampedX = clamp(Math.round(x), 0, this.widthPx - 1);
    const clampedY = clamp(Math.round(y), 0, this.heightPx - 1);
    return this.ownerMap[clampedY * this.widthPx + clampedX];
  }

  private addMarchingSquareSegments(
    segments: ContourSegment[],
    x: number,
    y: number,
    step: number,
    mask: number,
  ): void {
    if (mask <= 0 || mask >= 15) return;

    const top: [number, number] = [x + step * 0.5, y];
    const right: [number, number] = [x + step, y + step * 0.5];
    const bottom: [number, number] = [x + step * 0.5, y + step];
    const left: [number, number] = [x, y + step * 0.5];

    const cornerCenter = (cornerMask: number): [number, number] => {
      let sx = 0;
      let sy = 0;
      let count = 0;
      const addCorner = (bit: number, cx: number, cy: number): void => {
        if ((cornerMask & bit) === 0) return;
        sx += cx;
        sy += cy;
        count++;
      };

      addCorner(1, x, y);
      addCorner(2, x + step, y);
      addCorner(4, x + step, y + step);
      addCorner(8, x, y + step);

      if (count === 0) return [x + step * 0.5, y + step * 0.5];
      return [sx / count, sy / count];
    };

    const add = (
      a: [number, number],
      b: [number, number],
      targetMask = mask,
    ): void => {
      const center = cornerCenter(targetMask);
      const mx = (a[0] + b[0]) * 0.5;
      const my = (a[1] + b[1]) * 0.5;
      let nx = center[0] - mx;
      let ny = center[1] - my;
      const len = Math.hypot(nx, ny);
      if (len > 0.0001) {
        nx /= len;
        ny /= len;
      } else {
        nx = 0;
        ny = 0;
      }

      segments.push({
        oax: a[0],
        oay: a[1],
        obx: b[0],
        oby: b[1],
        nx,
        ny,
      });
    };

    switch (mask) {
      case 1:
      case 14:
        add(left, top);
        break;
      case 2:
      case 13:
        add(top, right);
        break;
      case 3:
      case 12:
        add(left, right);
        break;
      case 4:
      case 11:
        add(right, bottom);
        break;
      case 5:
        add(left, top, 1);
        add(right, bottom, 4);
        break;
      case 6:
      case 9:
        add(top, bottom);
        break;
      case 7:
      case 8:
        add(left, bottom);
        break;
      case 10:
        add(top, right, 2);
        add(bottom, left, 8);
        break;
      default:
        break;
    }
  }

  private createSmoothedContourPath(
    segments: ContourSegment[],
    inwardOffsetPx: number,
  ): Path2D {
    const path = new Path2D();
    if (segments.length === 0) return path;

    const pointCoords = new Map<string, { x: number; y: number; count: number }>();
    const adjacency = new Map<string, string[]>();
    const unusedEdges = new Set<string>();

    const keyForPoint = (
      originalX: number,
      originalY: number,
      offsetX: number,
      offsetY: number,
    ): string => {
      const key = `${Math.round(originalX * 2)},${Math.round(originalY * 2)}`;
      const existing = pointCoords.get(key);
      if (existing) {
        existing.x += offsetX;
        existing.y += offsetY;
        existing.count++;
      } else {
        pointCoords.set(key, { x: offsetX, y: offsetY, count: 1 });
      }
      return key;
    };

    const pointForKey = (key: string): ContourPoint | null => {
      const point = pointCoords.get(key);
      if (!point || point.count <= 0) return null;
      return [point.x / point.count, point.y / point.count];
    };

    const edgeKey = (a: string, b: string): string => (
      a < b ? `${a}|${b}` : `${b}|${a}`
    );

    const addNeighbor = (a: string, b: string): void => {
      const neighbors = adjacency.get(a);
      if (neighbors) {
        neighbors.push(b);
      } else {
        adjacency.set(a, [b]);
      }
    };

    for (const segment of segments) {
      const a = keyForPoint(
        segment.oax,
        segment.oay,
        segment.oax + segment.nx * inwardOffsetPx,
        segment.oay + segment.ny * inwardOffsetPx,
      );
      const b = keyForPoint(
        segment.obx,
        segment.oby,
        segment.obx + segment.nx * inwardOffsetPx,
        segment.oby + segment.ny * inwardOffsetPx,
      );
      if (a === b) continue;
      unusedEdges.add(edgeKey(a, b));
      addNeighbor(a, b);
      addNeighbor(b, a);
    }

    const takeNextNeighbor = (current: string, previous: string | null): string | null => {
      const neighbors = adjacency.get(current);
      if (!neighbors) return null;

      for (const neighbor of neighbors) {
        if (neighbor === previous && neighbors.length > 1) continue;
        const key = edgeKey(current, neighbor);
        if (unusedEdges.has(key)) {
          unusedEdges.delete(key);
          return neighbor;
        }
      }

      return null;
    };

    while (unusedEdges.size > 0) {
      const firstEdge = unusedEdges.values().next().value as string | undefined;
      if (!firstEdge) break;
      unusedEdges.delete(firstEdge);

      const [a, b] = firstEdge.split("|");
      const keys = [a, b];

      let previous = a;
      let current = b;
      for (;;) {
        const next = takeNextNeighbor(current, previous);
        if (!next) break;
        keys.push(next);
        if (next === keys[0]) break;
        previous = current;
        current = next;
      }

      previous = keys[1];
      current = keys[0];
      for (;;) {
        const next = takeNextNeighbor(current, previous);
        if (!next) break;
        keys.unshift(next);
        if (next === keys[keys.length - 1]) break;
        previous = current;
        current = next;
      }

      const points = keys
        .map((key) => pointForKey(key))
        .filter((point): point is ContourPoint => !!point);
      this.addSmoothedPolyline(path, points);
    }

    return path;
  }

  private addSmoothedPolyline(path: Path2D, points: ContourPoint[]): void {
    if (points.length < 2) return;

    const isClosed =
      points.length > 3
      && points[0][0] === points[points.length - 1][0]
      && points[0][1] === points[points.length - 1][1];
    const pts = isClosed ? points.slice(0, -1) : points;
    if (pts.length < 2) return;

    if (isClosed) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      path.moveTo((last[0] + first[0]) * 0.5, (last[1] + first[1]) * 0.5);

      for (let i = 0; i < pts.length; i++) {
        const current = pts[i];
        const next = pts[(i + 1) % pts.length];
        path.quadraticCurveTo(
          current[0],
          current[1],
          (current[0] + next[0]) * 0.5,
          (current[1] + next[1]) * 0.5,
        );
      }
      path.closePath();
      return;
    }

    path.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 2) {
      path.lineTo(pts[1][0], pts[1][1]);
      return;
    }

    for (let i = 1; i < pts.length - 1; i++) {
      const current = pts[i];
      const next = pts[i + 1];
      path.quadraticCurveTo(
        current[0],
        current[1],
        (current[0] + next[0]) * 0.5,
        (current[1] + next[1]) * 0.5,
      );
    }

    const last = pts[pts.length - 1];
    path.lineTo(last[0], last[1]);
  }
}

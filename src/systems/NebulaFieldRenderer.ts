// =============================================================================
// NebulaFieldRenderer — paints nebula regions as soft, colorful clouds on the
// galaxy plane. Mirrors OwnershipOverlayRenderer's DynamicTexture-on-ground
// approach, but tuned for luminous gas rather than territory borders.
//
// Driven purely by the (public, never fog-gated) nebula regions, so the cloud
// always renders even over unexplored systems — you can see a nebula is there
// without seeing what's inside it.
// =============================================================================

import { DynamicTexture, Texture } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { StarData } from "../data/StarMap";
import { NEBULA_DEFINITIONS } from "../data/Nebula";
import type { NebulaRegion } from "../data/Nebula";

export interface NebulaFieldRendererOptions {
  textureSize: number;
  mapWidth: number;
  mapHeight: number;
  stars: StarData[];
  nebulae: NebulaRegion[];
}

type Rgb = { r: number; g: number; b: number };

const BASE_GRADIENT_ALPHA = 0.05;
const PUFF_ALPHA = 0.09;
const PUFFS_PER_MEMBER = 3;

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toRgb(color: [number, number, number]): Rgb {
  return {
    r: Math.round(Math.max(0, Math.min(1, color[0])) * 255),
    g: Math.round(Math.max(0, Math.min(1, color[1])) * 255),
    b: Math.round(Math.max(0, Math.min(1, color[2])) * 255),
  };
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

export class NebulaFieldRenderer {
  readonly texture: DynamicTexture;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly widthPx: number;
  private readonly heightPx: number;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private readonly stars: StarData[];
  private readonly nebulae: NebulaRegion[];

  constructor(scene: Scene, options: NebulaFieldRendererOptions) {
    const mapAspect = options.mapWidth / Math.max(1, options.mapHeight);
    this.widthPx = mapAspect >= 1
      ? options.textureSize
      : Math.max(640, Math.round(options.textureSize * mapAspect));
    this.heightPx = mapAspect >= 1
      ? Math.max(640, Math.round(options.textureSize / Math.max(0.001, mapAspect)))
      : options.textureSize;
    this.mapWidth = options.mapWidth;
    this.mapHeight = options.mapHeight;
    this.stars = options.stars;
    this.nebulae = options.nebulae;

    this.texture = new DynamicTexture(
      "galaxyNebulaFieldTexture",
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

    this.render();
  }

  dispose(): void {
    this.texture.dispose();
  }

  private projectX(worldX: number): number {
    return (worldX / this.mapWidth + 0.5) * (this.widthPx - 1);
  }

  private projectY(worldZ: number): number {
    return (0.5 - worldZ / this.mapHeight) * (this.heightPx - 1);
  }

  private worldToPx(worldRadius: number): number {
    const pxPerWorldX = (this.widthPx - 1) / Math.max(1, this.mapWidth);
    const pxPerWorldY = (this.heightPx - 1) / Math.max(1, this.mapHeight);
    return worldRadius * (pxPerWorldX + pxPerWorldY) * 0.5;
  }

  private render(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.widthPx, this.heightPx);
    // Additive compositing gives the clouds a soft luminous glow.
    this.ctx.globalCompositeOperation = "lighter";

    for (const nebula of this.nebulae) {
      this.paintNebula(nebula);
    }

    this.ctx.restore();
    this.texture.update(true);
  }

  private paintNebula(nebula: NebulaRegion): void {
    const definition = NEBULA_DEFINITIONS[nebula.kind];
    const baseColor = toRgb(definition.color);
    const accentColor = toRgb(definition.accentColor);
    const rand = mulberry32((nebula.id + 1) * 0x85ebca6b);

    const centerX = this.projectX(nebula.centerX);
    const centerY = this.projectY(nebula.centerZ);
    const radiusPx = Math.max(8, this.worldToPx(nebula.radiusWorld));

    // Wide, faint base wash for cohesion.
    this.paintPuff(centerX, centerY, radiusPx * 1.15, baseColor, BASE_GRADIENT_ALPHA);

    // Organic puffs anchored to member stars plus jittered fill toward the center.
    const memberStars = nebula.starIds
      .map((starId) => this.stars[starId])
      .filter((star): star is StarData => !!star);

    for (const star of memberStars) {
      const sx = this.projectX(star.x);
      const sy = this.projectY(star.z);
      for (let i = 0; i < PUFFS_PER_MEMBER; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = rand() * radiusPx * 0.4;
        const px = sx + Math.cos(angle) * dist;
        const py = sy + Math.sin(angle) * dist;
        const puffRadius = radiusPx * (0.28 + rand() * 0.34);
        const color = mixRgb(baseColor, accentColor, rand() * 0.8);
        this.paintPuff(px, py, puffRadius, color, PUFF_ALPHA * (0.7 + rand() * 0.6));
      }
    }
  }

  private paintPuff(x: number, y: number, radius: number, color: Rgb, alpha: number): void {
    if (radius <= 0) return;
    const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${color.r},${color.g},${color.b},${alpha})`);
    gradient.addColorStop(0.55, `rgba(${color.r},${color.g},${color.b},${alpha * 0.45})`);
    gradient.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }
}

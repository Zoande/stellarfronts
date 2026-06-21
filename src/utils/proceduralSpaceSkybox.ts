import {
  Color3,
  CubeTexture,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
} from "@babylonjs/core";

import { NEBULA_DEFINITIONS } from "../data/Nebula";
import type { NebulaRegion } from "../data/Nebula";
import nebulaShaderSource from "../assets/space-3d/glsl/nebula.glsl?raw";
import pointStarsShaderSource from "../assets/space-3d/glsl/point-stars.glsl?raw";
import starShaderSource from "../assets/space-3d/glsl/star.glsl?raw";
import sunShaderSource from "../assets/space-3d/glsl/sun.glsl?raw";
import classicNoiseSource from "../assets/space-3d/glsl/classic-noise-4d.snip?raw";

type Vec3 = [number, number, number];
type Mat4 = Float32Array;
type SkyboxFaceName = "front" | "back" | "left" | "right" | "top" | "bottom";

export interface SpaceSkyboxRenderSettings {
  seed: string;
  resolution?: number;
  pointStars?: boolean;
  brightStars?: boolean;
  nebulae?: boolean;
  sun?: boolean;
  maxPointStarLayers?: number;
  maxBrightStars?: number;
  maxNebulae?: number;
  /** Bias generated nebula colors toward this palette (e.g. a system's nebula theme). */
  nebulaPalette?: Vec3[];
  /** 0 = fully random color, 1 = exactly the palette color. Defaults to ~0.8 when a palette is set. */
  nebulaColorBias?: number;
}

export interface ProceduralSpaceSkyboxOptions {
  name: string;
  materialName?: string;
  size: number;
  render: SpaceSkyboxRenderSettings;
  textureLevel?: number;
  environmentIntensity?: number;
}

interface NormalizedSkyboxRenderSettings {
  seed: string;
  resolution: number;
  pointStars: boolean;
  brightStars: boolean;
  nebulae: boolean;
  sun: boolean;
  maxPointStarLayers: number;
  maxBrightStars: number;
  maxNebulae: number;
  nebulaPalette: Vec3[];
  nebulaColorBias: number;
}

interface SkyboxFaceUrls {
  front: string;
  back: string;
  left: string;
  right: string;
  top: string;
  bottom: string;
}

interface DirectionConfig {
  target: Vec3;
  up: Vec3;
}

interface PointStarParams {
  rotation: Mat4;
}

interface BrightStarParams {
  pos: Vec3;
  color: Vec3;
  size: number;
  falloff: number;
}

interface NebulaParams {
  scale: number;
  color: Vec3;
  intensity: number;
  falloff: number;
  offset: Vec3;
}

interface BufferLayoutEntry {
  buffer: WebGLBuffer;
  size: number;
}

const POINT_STAR_COUNT = 100000;
const GENERATED_SKYBOX_CACHE_LIMIT = 10;
const BABYLON_CUBE_FACE_ORDER: SkyboxFaceName[] = ["right", "top", "front", "left", "bottom", "back"];

const SKYBOX_DIRECTIONS: Record<SkyboxFaceName, DirectionConfig> = {
  front: { target: [0, 0, -1], up: [0, 1, 0] },
  back: { target: [0, 0, 1], up: [0, 1, 0] },
  left: { target: [-1, 0, 0], up: [0, 1, 0] },
  right: { target: [1, 0, 0], up: [0, 1, 0] },
  top: { target: [0, 1, 0], up: [0, 0, 1] },
  bottom: { target: [0, -1, 0], up: [0, 0, -1] },
};

const generatedSkyboxCache = new Map<string, SkyboxFaceUrls>();
let generator: SpaceSkyboxGenerator | null = null;
let generatorUnavailable = false;

export function getGalaxySkyboxSettings(): SpaceSkyboxRenderSettings {
  return {
    seed: "stellar-fronts-galaxy-skybox-v1",
    resolution: 1024,
    pointStars: true,
    brightStars: true,
    nebulae: false,
    sun: false,
    maxPointStarLayers: 6,
    maxBrightStars: 95,
    maxNebulae: 0,
  };
}

export function getSystemSkyboxSettings(
  star: { id: number; name: string; type?: string },
  nebula?: NebulaRegion | null,
): SpaceSkyboxRenderSettings {
  const base: SpaceSkyboxRenderSettings = {
    seed: `stellar-fronts-system-skybox-v1:${star.id}:${star.name}:${star.type ?? ""}`,
    resolution: 1024,
    pointStars: true,
    brightStars: true,
    nebulae: true,
    sun: false,
    maxPointStarLayers: 7,
    maxBrightStars: 130,
    maxNebulae: 4,
  };
  if (!nebula) return base;

  // Inside a nebula: keep the layout procedural/random (the seed still varies per
  // system) but saturate it with the nebula's signature colors and add more clouds.
  const definition = NEBULA_DEFINITIONS[nebula.kind];
  return {
    ...base,
    seed: `${base.seed}:nebula-${nebula.id}-${nebula.kind}`,
    maxNebulae: 7,
    maxBrightStars: 150,
    nebulaPalette: [definition.color, definition.accentColor],
    nebulaColorBias: 0.82,
  };
}

export function createProceduralSpaceSkybox(
  scene: Scene,
  options: ProceduralSpaceSkyboxOptions,
): { texture: CubeTexture } | null {
  const faceUrls = getGeneratedSkyboxFaceUrls(options.render);
  if (!faceUrls) return null;

  const texture = new CubeTexture(
    "",
    scene,
    undefined,
    false,
    BABYLON_CUBE_FACE_ORDER.map((face) => faceUrls[face]),
  );
  texture.coordinatesMode = Texture.SKYBOX_MODE;
  texture.gammaSpace = true;
  texture.level = options.textureLevel ?? 0.85;

  scene.environmentTexture = texture;
  scene.environmentIntensity = options.environmentIntensity ?? 0.28;

  const skybox = MeshBuilder.CreateBox(options.name, { size: options.size }, scene);
  const material = new StandardMaterial(options.materialName ?? `${options.name}Mat`, scene);
  material.reflectionTexture = texture;
  material.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  skybox.material = material;
  skybox.isPickable = false;
  skybox.infiniteDistance = true;

  return { texture };
}

function getGeneratedSkyboxFaceUrls(settings: SpaceSkyboxRenderSettings): SkyboxFaceUrls | null {
  if (generatorUnavailable || typeof document === "undefined") return null;

  const normalized = normalizeSettings(settings);
  const cacheKey = skyboxCacheKey(normalized);
  const cached = generatedSkyboxCache.get(cacheKey);
  if (cached) {
    generatedSkyboxCache.delete(cacheKey);
    generatedSkyboxCache.set(cacheKey, cached);
    return cached;
  }

  try {
    generator ??= new SpaceSkyboxGenerator();
    const generated = generator.render(normalized);
    generatedSkyboxCache.set(cacheKey, generated);
    while (generatedSkyboxCache.size > GENERATED_SKYBOX_CACHE_LIMIT) {
      const oldestKey = generatedSkyboxCache.keys().next().value;
      if (!oldestKey) break;
      generatedSkyboxCache.delete(oldestKey);
    }
    return generated;
  } catch (err) {
    generatorUnavailable = true;
    console.warn("Procedural skybox generation failed; using static fallback.", err);
    return null;
  }
}

function normalizeSettings(settings: SpaceSkyboxRenderSettings): NormalizedSkyboxRenderSettings {
  return {
    seed: settings.seed,
    resolution: clampInteger(settings.resolution ?? 1024, 256, 2048),
    pointStars: settings.pointStars ?? true,
    brightStars: settings.brightStars ?? true,
    nebulae: settings.nebulae ?? true,
    sun: settings.sun ?? true,
    maxPointStarLayers: clampInteger(settings.maxPointStarLayers ?? 8, 0, 12),
    maxBrightStars: clampInteger(settings.maxBrightStars ?? 140, 0, 240),
    maxNebulae: clampInteger(settings.maxNebulae ?? 5, 0, 8),
    nebulaPalette: settings.nebulaPalette ?? [],
    nebulaColorBias: Math.max(0, Math.min(1, settings.nebulaColorBias ?? (settings.nebulaPalette ? 0.8 : 0))),
  };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function skyboxCacheKey(settings: NormalizedSkyboxRenderSettings): string {
  return [
    settings.seed,
    settings.resolution,
    settings.pointStars ? 1 : 0,
    settings.brightStars ? 1 : 0,
    settings.nebulae ? 1 : 0,
    settings.sun ? 1 : 0,
    settings.maxPointStarLayers,
    settings.maxBrightStars,
    settings.maxNebulae,
    settings.nebulaPalette.map((color) => color.join(",")).join(";"),
    settings.nebulaColorBias,
  ].join("|");
}

class SpaceSkyboxGenerator {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly nebulaProgram: Program;
  private readonly pointStarsProgram: Program;
  private readonly starProgram: Program;
  private readonly sunProgram: Program;
  private readonly pointStarsRenderable: Renderable;
  private readonly nebulaRenderable: Renderable;
  private readonly starRenderable: Renderable;
  private readonly sunRenderable: Renderable;

  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
      stencil: false,
    });
    if (!gl) {
      throw new Error("WebGL is not available for procedural skybox generation.");
    }

    this.gl = gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);

    this.nebulaProgram = loadProgram(gl, nebulaShaderSource);
    this.pointStarsProgram = loadProgram(gl, pointStarsShaderSource);
    this.starProgram = loadProgram(gl, starShaderSource);
    this.sunProgram = loadProgram(gl, sunShaderSource);

    this.pointStarsRenderable = this.buildPointStarsRenderable();
    this.nebulaRenderable = buildBoxRenderable(gl, this.nebulaProgram);
    this.starRenderable = buildBoxRenderable(gl, this.starProgram);
    this.sunRenderable = buildBoxRenderable(gl, this.sunProgram);
  }

  render(settings: NormalizedSkyboxRenderSettings): SkyboxFaceUrls {
    const textures = {} as SkyboxFaceUrls;
    const gl = this.gl;
    const resolution = settings.resolution;
    this.canvas.width = resolution;
    this.canvas.height = resolution;
    gl.viewport(0, 0, resolution, resolution);

    const pointStarParams = this.createPointStarParams(settings);
    const brightStarParams = this.createBrightStarParams(settings);
    const nebulaParams = this.createNebulaParams(settings);
    const sunParams = this.createSunParams(settings);

    const projection = perspective(Math.PI / 2, 1, 0.1, 256);
    const faceNames = Object.keys(SKYBOX_DIRECTIONS) as SkyboxFaceName[];
    for (const face of faceNames) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const dir = SKYBOX_DIRECTIONS[face];
      const view = lookAt([0, 0, 0], dir.target, dir.up);
      let model = identity();

      this.pointStarsProgram.use();
      this.pointStarsProgram.setMatrix4("uView", view);
      this.pointStarsProgram.setMatrix4("uProjection", projection);
      for (const pointStar of pointStarParams) {
        model = multiplyMat4(pointStar.rotation, model);
        this.pointStarsProgram.setMatrix4("uModel", model);
        this.pointStarsRenderable.render();
      }

      this.starProgram.use();
      this.starProgram.setMatrix4("uView", view);
      this.starProgram.setMatrix4("uProjection", projection);
      this.starProgram.setMatrix4("uModel", model);
      for (const star of brightStarParams) {
        this.starProgram.setVec3("uPosition", star.pos);
        this.starProgram.setVec3("uColor", star.color);
        this.starProgram.set1f("uSize", star.size);
        this.starProgram.set1f("uFalloff", star.falloff);
        this.starRenderable.render();
      }

      const nebulaModel = identity();
      this.nebulaProgram.use();
      this.nebulaProgram.setMatrix4("uView", view);
      this.nebulaProgram.setMatrix4("uProjection", projection);
      this.nebulaProgram.setMatrix4("uModel", nebulaModel);
      for (const nebula of nebulaParams) {
        this.nebulaProgram.set1f("uScale", nebula.scale);
        this.nebulaProgram.setVec3("uColor", nebula.color);
        this.nebulaProgram.set1f("uIntensity", nebula.intensity);
        this.nebulaProgram.set1f("uFalloff", nebula.falloff);
        this.nebulaProgram.setVec3("uOffset", nebula.offset);
        this.nebulaRenderable.render();
      }

      this.sunProgram.use();
      this.sunProgram.setMatrix4("uView", view);
      this.sunProgram.setMatrix4("uProjection", projection);
      this.sunProgram.setMatrix4("uModel", nebulaModel);
      for (const sun of sunParams) {
        this.sunProgram.setVec3("uPosition", sun.pos);
        this.sunProgram.setVec3("uColor", sun.color);
        this.sunProgram.set1f("uSize", sun.size);
        this.sunProgram.set1f("uFalloff", sun.falloff);
        this.sunRenderable.render();
      }

      gl.flush();
      textures[face] = this.copyCurrentFaceToDataUrl(resolution);
    }

    return textures;
  }

  private buildPointStarsRenderable(): Renderable {
    const position = new Float32Array(18 * POINT_STAR_COUNT);
    const color = new Float32Array(18 * POINT_STAR_COUNT);
    const rand = new MT19937(hashcode("best seed ever") + 5000);
    for (let i = 0; i < POINT_STAR_COUNT; i++) {
      const star = buildPointStar(0.05, randomUnitVector(rand), 128, rand);
      position.set(star.position, i * 18);
      color.set(star.color, i * 18);
    }

    return new Renderable(
      this.gl,
      this.pointStarsProgram,
      {
        aPosition: createBuffer(this.gl, position, 3),
        aColor: createBuffer(this.gl, color, 3),
      },
      position.length / 3,
    );
  }

  private createPointStarParams(settings: NormalizedSkyboxRenderSettings): PointStarParams[] {
    if (!settings.pointStars) return [];
    const rand = new MT19937(hashcode(settings.seed) + 1000);
    const params: PointStarParams[] = [];
    while (params.length < settings.maxPointStarLayers) {
      params.push({ rotation: randomRotation(rand) });
      if (rand.random() < 0.2) break;
    }
    return params;
  }

  private createBrightStarParams(settings: NormalizedSkyboxRenderSettings): BrightStarParams[] {
    if (!settings.brightStars) return [];
    const rand = new MT19937(hashcode(settings.seed) + 3000);
    const params: BrightStarParams[] = [];
    while (params.length < settings.maxBrightStars) {
      params.push({
        pos: randomUnitVector(rand),
        color: [1, 1, 1],
        size: 0,
        falloff: rand.random() * 2 ** 20 + 2 ** 20,
      });
      if (rand.random() < 0.01) break;
    }
    return params;
  }

  private createNebulaParams(settings: NormalizedSkyboxRenderSettings): NebulaParams[] {
    if (!settings.nebulae) return [];
    const rand = new MT19937(hashcode(settings.seed) + 2000);
    const palette = settings.nebulaPalette;
    const bias = settings.nebulaColorBias;
    const params: NebulaParams[] = [];
    while (params.length < settings.maxNebulae) {
      const randomColor: Vec3 = [rand.random(), rand.random(), rand.random()];
      let color = randomColor;
      if (palette.length > 0 && bias > 0) {
        // Blend the random color toward a palette entry so clouds read as the
        // nebula's color while staying varied.
        const target = palette[Math.floor(rand.random() * palette.length)];
        color = [
          randomColor[0] + (target[0] - randomColor[0]) * bias,
          randomColor[1] + (target[1] - randomColor[1]) * bias,
          randomColor[2] + (target[2] - randomColor[2]) * bias,
        ];
      }
      params.push({
        scale: rand.random() * 0.5 + 0.25,
        color,
        intensity: rand.random() * 0.2 + 0.9,
        falloff: rand.random() * 3 + 3,
        offset: [
          rand.random() * 2000 - 1000,
          rand.random() * 2000 - 1000,
          rand.random() * 2000 - 1000,
        ],
      });
      if (rand.random() < 0.5) break;
    }
    return params;
  }

  private createSunParams(settings: NormalizedSkyboxRenderSettings): BrightStarParams[] {
    if (!settings.sun) return [];
    const rand = new MT19937(hashcode(settings.seed) + 4000);
    return [
      {
        pos: randomUnitVector(rand),
        color: [rand.random(), rand.random(), rand.random()],
        size: rand.random() * 0.0001 + 0.0001,
        falloff: rand.random() * 16 + 8,
      },
    ];
  }

  private copyCurrentFaceToDataUrl(resolution: number): string {
    const canvas = document.createElement("canvas");
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create 2D canvas for procedural skybox face.");
    ctx.drawImage(this.canvas, 0, 0);
    return canvas.toDataURL("image/png");
  }
}

class Program {
  private readonly program: WebGLProgram;
  private readonly attribs = new Map<string, number>();
  private readonly uniforms = new Map<string, WebGLUniformLocation>();

  constructor(private readonly gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
    this.program = this.compileProgram(vertexSource, fragmentSource);
    this.gatherAttribs();
    this.gatherUniforms();
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  getAttribLocation(name: string): number {
    const location = this.attribs.get(name);
    if (location === undefined) throw new Error(`Could not find shader attribute "${name}".`);
    return location;
  }

  setMatrix4(name: string, value: Mat4): void {
    this.gl.uniformMatrix4fv(this.getUniformLocation(name), false, value);
  }

  setVec3(name: string, value: Vec3): void {
    this.gl.uniform3fv(this.getUniformLocation(name), value);
  }

  set1f(name: string, value: number): void {
    this.gl.uniform1f(this.getUniformLocation(name), value);
  }

  private getUniformLocation(name: string): WebGLUniformLocation {
    const location = this.uniforms.get(name);
    if (!location) throw new Error(`Could not find shader uniform "${name}".`);
    return location;
  }

  private compileProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const vertexShader = this.compileShader(vertexSource, this.gl.VERTEX_SHADER);
    const fragmentShader = this.compileShader(fragmentSource, this.gl.FRAGMENT_SHADER);
    const program = this.gl.createProgram();
    if (!program) throw new Error("Could not create WebGL program.");
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(this.gl.getProgramInfoLog(program) ?? "Failed to link WebGL program.");
    }
    return program;
  }

  private compileShader(source: string, type: number): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error("Could not create WebGL shader.");
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const typeName = type === this.gl.VERTEX_SHADER ? "vertex" : "fragment";
      throw new Error(this.gl.getShaderInfoLog(shader) ?? `Failed to compile ${typeName} shader.`);
    }
    return shader;
  }

  private gatherAttribs(): void {
    const count = this.gl.getProgramParameter(this.program, this.gl.ACTIVE_ATTRIBUTES) as number;
    for (let i = 0; i < count; i++) {
      const attrib = this.gl.getActiveAttrib(this.program, i);
      if (!attrib) continue;
      this.attribs.set(attrib.name, this.gl.getAttribLocation(this.program, attrib.name));
    }
  }

  private gatherUniforms(): void {
    const count = this.gl.getProgramParameter(this.program, this.gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const uniform = this.gl.getActiveUniform(this.program, i);
      if (!uniform) continue;
      const location = this.gl.getUniformLocation(this.program, uniform.name);
      if (location) this.uniforms.set(uniform.name, location);
    }
  }
}

class Renderable {
  constructor(
    private readonly gl: WebGLRenderingContext,
    private readonly program: Program,
    private readonly buffers: Record<string, BufferLayoutEntry>,
    private readonly vertexCount: number,
  ) {}

  render(): void {
    this.program.use();
    for (const [name, entry] of Object.entries(this.buffers)) {
      const location = this.program.getAttribLocation(name);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, entry.buffer);
      this.gl.enableVertexAttribArray(location);
      this.gl.vertexAttribPointer(location, entry.size, this.gl.FLOAT, false, 0, 0);
    }
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertexCount);
    for (const name of Object.keys(this.buffers)) {
      this.gl.disableVertexAttribArray(this.program.getAttribLocation(name));
    }
  }
}

function loadProgram(gl: WebGLRenderingContext, source: string): Program {
  const [vertexSource, fragmentSource] = source
    .replace("__noise4d__", classicNoiseSource)
    .split("__split__");
  if (!vertexSource || !fragmentSource) {
    throw new Error("Procedural skybox shader source is missing the __split__ marker.");
  }
  return new Program(gl, vertexSource.trim(), fragmentSource.trim());
}

function createBuffer(gl: WebGLRenderingContext, data: Float32Array, size: number): BufferLayoutEntry {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Could not create WebGL buffer.");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return { buffer, size };
}

function buildBoxRenderable(gl: WebGLRenderingContext, program: Program): Renderable {
  const position = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, -1, -1, 1, 1, -1, -1, 1, -1,
    1, -1, 1, -1, -1, 1, -1, 1, 1, 1, -1, 1, -1, 1, 1, 1, 1, 1,
    1, -1, -1, 1, -1, 1, 1, 1, 1, 1, -1, -1, 1, 1, 1, 1, 1, -1,
    -1, -1, 1, -1, -1, -1, -1, 1, -1, -1, -1, 1, -1, 1, -1, -1, 1, 1,
    -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, -1, 1, 1, 1, -1, 1, 1,
    -1, -1, 1, 1, -1, 1, 1, -1, -1, -1, -1, 1, 1, -1, -1, -1, -1, -1,
  ]);
  return new Renderable(gl, program, { aPosition: createBuffer(gl, position, 3) }, position.length / 3);
}

function buildPointStar(size: number, pos: Vec3, distance: number, rand: MT19937): { position: number[]; color: number[] } {
  const c = rand.random() ** 4;
  const color = new Array<number>(18).fill(c);
  const center = scaleVec3(pos, distance);
  const right = normalize(cross(Math.abs(pos[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0], pos));
  const up = normalize(cross(pos, right));
  const vertices: Array<[number, number]> = [
    [-size, -size],
    [size, -size],
    [size, size],
    [-size, -size],
    [size, size],
    [-size, size],
  ];
  const position: number[] = [];
  for (const [x, y] of vertices) {
    const vertex = addVec3(center, addVec3(scaleVec3(right, x), scaleVec3(up, y)));
    position.push(vertex[0], vertex[1], vertex[2]);
  }
  return { position, color };
}

function identity(): Mat4 {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = normalize(subVec3(eye, center));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0]
        + a[1 * 4 + row] * b[col * 4 + 1]
        + a[2 * 4 + row] * b[col * 4 + 2]
        + a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function randomRotation(rand: MT19937): Mat4 {
  return multiplyMat4(
    multiplyMat4(rotationX(rand.random() * Math.PI * 2), rotationY(rand.random() * Math.PI * 2)),
    rotationZ(rand.random() * Math.PI * 2),
  );
}

function rotationX(angle: number): Mat4 {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return new Float32Array([
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ]);
}

function rotationY(angle: number): Mat4 {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return new Float32Array([
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ]);
}

function rotationZ(angle: number): Mat4 {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return new Float32Array([
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function randomUnitVector(rand: MT19937): Vec3 {
  const z = rand.random() * 2 - 1;
  const theta = rand.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return [Math.cos(theta) * radius, Math.sin(theta) * radius, z];
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec3(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length <= 0.000001) return [0, 0, 0];
  return [v[0] / length, v[1] / length, v[2] / length];
}

function hashcode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash += (i + 1) * str.charCodeAt(i);
  }
  return hash >>> 0;
}

class MT19937 {
  private readonly mt = new Uint32Array(624);
  private index = 624;

  constructor(seed: number) {
    this.mt[0] = seed >>> 0;
    for (let i = 1; i < 624; i++) {
      this.mt[i] = (Math.imul(1812433253, this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)) + i) >>> 0;
    }
  }

  random(): number {
    return this.nextUint32() / 4294967296;
  }

  private nextUint32(): number {
    if (this.index >= 624) this.twist();
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  private twist(): void {
    for (let i = 0; i < 624; i++) {
      const y = (this.mt[i] & 0x80000000) + (this.mt[(i + 1) % 624] & 0x7fffffff);
      this.mt[i] = this.mt[(i + 397) % 624] ^ (y >>> 1);
      if (y % 2 !== 0) this.mt[i] ^= 0x9908b0df;
    }
    this.index = 0;
  }
}

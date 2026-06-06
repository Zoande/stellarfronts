import {
  Color3,
  GlowLayer,
  Material,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { LinesMesh } from "@babylonjs/core";

interface TimedBeam {
  mesh: LinesMesh;
  ttl: number;
  maxTtl: number;
}

interface TimedProjectile {
  mesh: Mesh;
  material: StandardMaterial;
  velocity: Vector3;
  ttl: number;
  maxTtl: number;
}

interface TimedTrail {
  ownerId: string;
  mesh: Mesh;
  material: StandardMaterial;
  age: number;
  ttl: number;
  startAlpha: number;
  fadePower: number;
}

export interface QueueTrailOptions {
  name: string;
  ownerId: string;
  from: Vector3;
  to: Vector3;
  radius: number;
  diffuse: Color3;
  emissive: Color3;
  ttl: number;
  startAlpha: number;
  tessellation?: number;
  fadePower?: number;
  maxPerOwner?: number;
}

export class SystemEffectsRenderer {
  private readonly beams: TimedBeam[] = [];
  private readonly projectiles: TimedProjectile[] = [];
  private readonly trails: TimedTrail[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly glowLayer: GlowLayer,
    private readonly limits: { maxBeams?: number; maxProjectiles?: number } = {},
  ) {}

  queueBeam(
    name: string,
    from: Vector3,
    to: Vector3,
    color: Color3,
    ttl: number,
    alpha = 0.85,
  ): void {
    const beam = MeshBuilder.CreateLines(name, { points: [from, to] }, this.scene);
    beam.color = color;
    beam.alpha = alpha;
    beam.isPickable = false;
    this.glowLayer.addIncludedOnlyMesh(beam);
    this.beams.push({ mesh: beam, ttl, maxTtl: ttl });
    this.trimBeams();
  }

  queueProjectile(
    name: string,
    from: Vector3,
    to: Vector3,
    color: Color3,
    ttl: number,
    diameter: number,
  ): void {
    const projectile = MeshBuilder.CreateSphere(name, { diameter, segments: 10 }, this.scene);
    projectile.position.copyFrom(from);
    projectile.isPickable = false;

    const material = new StandardMaterial(`${name}Mat`, this.scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = color.scale(1.8);
    material.disableLighting = true;
    material.alpha = 1;
    projectile.material = material;

    this.glowLayer.addIncludedOnlyMesh(projectile);
    const velocity = to.subtract(from).scale(1 / Math.max(0.01, ttl));
    this.projectiles.push({ mesh: projectile, material, velocity, ttl, maxTtl: ttl });
    this.trimProjectiles();
  }

  queueTrail(options: QueueTrailOptions): void {
    const material = new StandardMaterial(`${options.name}Mat`, this.scene);
    material.diffuseColor = options.diffuse;
    material.emissiveColor = options.emissive;
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.alpha = options.startAlpha;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;

    const mesh = MeshBuilder.CreateTube(
      options.name,
      {
        path: [options.from, options.to],
        radius: options.radius,
        tessellation: options.tessellation ?? 6,
        cap: Mesh.NO_CAP,
      },
      this.scene,
    );
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    this.glowLayer.addIncludedOnlyMesh(mesh);

    this.trails.push({
      ownerId: options.ownerId,
      mesh,
      material,
      age: 0,
      ttl: options.ttl,
      startAlpha: options.startAlpha,
      fadePower: options.fadePower ?? 1.4,
    });
    this.trimTrails(options.ownerId, options.maxPerOwner);
  }

  removeTrails(ownerId: string): void {
    for (let index = this.trails.length - 1; index >= 0; index -= 1) {
      if (this.trails[index].ownerId === ownerId) {
        this.disposeTrail(index);
      }
    }
  }

  update(deltaTime: number): void {
    for (let index = this.beams.length - 1; index >= 0; index -= 1) {
      const beam = this.beams[index];
      beam.ttl -= deltaTime;
      if (beam.ttl <= 0) {
        this.disposeBeam(index);
        continue;
      }
      beam.mesh.alpha = Math.max(0, beam.ttl / beam.maxTtl);
    }

    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.ttl -= deltaTime;
      if (projectile.ttl <= 0) {
        this.disposeProjectile(index);
        continue;
      }
      projectile.mesh.position.addInPlace(projectile.velocity.scale(deltaTime));
      projectile.material.alpha = Math.max(0, projectile.ttl / projectile.maxTtl);
    }

    for (let index = this.trails.length - 1; index >= 0; index -= 1) {
      const trail = this.trails[index];
      trail.age += deltaTime;
      const life = Math.max(0, 1 - trail.age / trail.ttl);
      trail.material.alpha = trail.startAlpha * Math.pow(life, trail.fadePower);
      if (trail.age >= trail.ttl) {
        this.disposeTrail(index);
      }
    }
  }

  dispose(): void {
    for (let index = this.beams.length - 1; index >= 0; index -= 1) {
      this.disposeBeam(index);
    }
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      this.disposeProjectile(index);
    }
    for (let index = this.trails.length - 1; index >= 0; index -= 1) {
      this.disposeTrail(index);
    }
  }

  private trimBeams(): void {
    const max = this.limits.maxBeams ?? 96;
    while (this.beams.length > max) {
      this.disposeBeam(0);
    }
  }

  private trimProjectiles(): void {
    const max = this.limits.maxProjectiles ?? 160;
    while (this.projectiles.length > max) {
      this.disposeProjectile(0);
    }
  }

  private trimTrails(ownerId: string, maxPerOwner = 64): void {
    let count = this.trails.reduce((total, trail) => total + (trail.ownerId === ownerId ? 1 : 0), 0);
    for (let index = 0; index < this.trails.length && count > maxPerOwner; index += 1) {
      if (this.trails[index].ownerId !== ownerId) continue;
      this.disposeTrail(index);
      index -= 1;
      count -= 1;
    }
  }

  private disposeBeam(index: number): void {
    const [beam] = this.beams.splice(index, 1);
    if (!beam) return;
    this.glowLayer.removeIncludedOnlyMesh(beam.mesh);
    beam.mesh.dispose();
  }

  private disposeProjectile(index: number): void {
    const [projectile] = this.projectiles.splice(index, 1);
    if (!projectile) return;
    this.glowLayer.removeIncludedOnlyMesh(projectile.mesh);
    projectile.mesh.dispose();
    projectile.material.dispose();
  }

  private disposeTrail(index: number): void {
    const [trail] = this.trails.splice(index, 1);
    if (!trail) return;
    this.glowLayer.removeIncludedOnlyMesh(trail.mesh);
    trail.mesh.dispose();
    trail.material.dispose();
  }
}

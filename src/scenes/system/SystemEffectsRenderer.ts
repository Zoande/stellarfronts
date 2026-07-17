import {
  Color3,
  DynamicTexture,
  GlowLayer,
  Material,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { LinesMesh } from "@babylonjs/core";
import type { CombatAttackClass } from "../../game/CombatTypes";
import type { ServerCombatContact, ServerCombatProjectile } from "../../game/GameProtocol";

interface TimedBeam {
  mesh: LinesMesh;
  ttl: number;
  maxTtl: number;
}

interface TimedProjectile {
  mesh: Mesh;
  material: StandardMaterial;
  velocity: Vector3;
  spin: Vector3;
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

interface TimedPulse {
  root: TransformNode;
  meshes: Mesh[];
  materials: StandardMaterial[];
  light: PointLight | null;
  age: number;
  ttl: number;
  startScale: number;
  endScale: number;
  startAlpha: number;
  spin: Vector3;
}

interface TimedParticleBurst {
  system: ParticleSystem;
  ttl: number;
}

interface ActiveCombatProjectile {
  data: ServerCombatProjectile;
  root: TransformNode;
  meshes: Mesh[];
  materials: StandardMaterial[];
  light: PointLight | null;
  trail: LinesMesh | null;
  trailPoints: Vector3[];
  seed: number;
  lastPosition: Vector3;
}

interface WeaponVisualProfile {
  family: "standard" | "phase" | "gauss" | "fusion" | "swarmer" | "torpedo" | "flak";
  core: Color3;
  aura: Color3;
  impact: Color3;
  size: number;
  trailAlpha: number;
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

export interface CombatImpactOptions {
  id: string;
  position: Vector3;
  attackClass: CombatAttackClass;
  shieldDamage: number;
  armorDamage: number;
  hullDamage: number;
  destroyed: boolean;
  hit: boolean;
  weaponId?: string;
}

const WEAPON_COLORS: Record<CombatAttackClass, { core: Color3; aura: Color3; impact: Color3 }> = {
  beam: { core: new Color3(0.92, 0.98, 1), aura: new Color3(0.08, 0.58, 1), impact: new Color3(0.22, 0.75, 1) },
  kinetic: { core: new Color3(1, 0.93, 0.68), aura: new Color3(1, 0.42, 0.08), impact: new Color3(1, 0.62, 0.18) },
  plasma: { core: new Color3(0.94, 0.78, 1), aura: new Color3(0.73, 0.12, 1), impact: new Color3(0.88, 0.26, 1) },
  missile: { core: new Color3(1, 0.92, 0.68), aura: new Color3(1, 0.32, 0.04), impact: new Color3(1, 0.48, 0.06) },
  torpedo: { core: new Color3(1, 0.78, 0.42), aura: new Color3(1, 0.08, 0.02), impact: new Color3(1, 0.22, 0.03) },
  pointDefense: { core: new Color3(0.9, 1, 1), aura: new Color3(0.18, 0.95, 1), impact: new Color3(0.35, 0.95, 1) },
};

export class SystemEffectsRenderer {
  private readonly beams: TimedBeam[] = [];
  private readonly projectiles: TimedProjectile[] = [];
  private readonly trails: TimedTrail[] = [];
  private readonly pulses: TimedPulse[] = [];
  private readonly particleBursts: TimedParticleBurst[] = [];
  private readonly activeCombatProjectiles = new Map<string, ActiveCombatProjectile>();
  private readonly impactTexture: DynamicTexture;
  private cameraImpulse = 0;

  constructor(
    private readonly scene: Scene,
    private readonly glowLayer: GlowLayer,
    private readonly limits: { maxBeams?: number; maxProjectiles?: number; maxPulses?: number; maxParticles?: number } = {},
  ) {
    this.impactTexture = this.createRadialTexture();
  }

  queueBeam(name: string, from: Vector3, to: Vector3, color: Color3, ttl: number, alpha = 0.85): void {
    const aura = MeshBuilder.CreateLines(name, { points: [from, to] }, this.scene);
    aura.color = color;
    aura.alpha = alpha;
    aura.isPickable = false;
    this.glowLayer.addIncludedOnlyMesh(aura);
    this.beams.push({ mesh: aura, ttl, maxTtl: ttl });

    const core = MeshBuilder.CreateLines(`${name}-core`, { points: [from, to] }, this.scene);
    core.color = Color3.White();
    core.alpha = Math.min(1, alpha * 1.2);
    core.isPickable = false;
    this.glowLayer.addIncludedOnlyMesh(core);
    this.beams.push({ mesh: core, ttl: ttl * 0.55, maxTtl: ttl * 0.55 });
    this.trimBeams();
  }

  queueProjectile(name: string, from: Vector3, to: Vector3, color: Color3, ttl: number, diameter: number): void {
    const material = this.createEmissiveMaterial(`${name}Mat`, color, 1.8);
    const projectile = MeshBuilder.CreateSphere(name, { diameter, segments: 10 }, this.scene);
    projectile.position.copyFrom(from);
    projectile.isPickable = false;
    projectile.material = material;
    this.glowLayer.addIncludedOnlyMesh(projectile);
    this.projectiles.push({
      mesh: projectile,
      material,
      velocity: to.subtract(from).scale(1 / Math.max(0.01, ttl)),
      spin: new Vector3(0, 0, 0),
      ttl,
      maxTtl: ttl,
    });
    this.trimProjectiles();
  }

  queueTrail(options: QueueTrailOptions): void {
    const material = this.createEmissiveMaterial(`${options.name}Mat`, options.emissive, 1);
    material.diffuseColor = options.diffuse;
    material.alpha = options.startAlpha;
    const mesh = MeshBuilder.CreateTube(options.name, {
      path: [options.from, options.to],
      radius: options.radius,
      tessellation: options.tessellation ?? 6,
      cap: Mesh.NO_CAP,
    }, this.scene);
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

  syncCombatProjectiles(
    projectiles: ServerCombatProjectile[],
    gameYear: number,
    resolvePosition?: (entityId: string | null | undefined) => Vector3 | null,
  ): void {
    const maxActiveProjectiles = this.limits.maxProjectiles ?? 220;
    const visibleProjectiles = projectiles.length <= maxActiveProjectiles
      ? projectiles
      : [...projectiles]
        .sort((left, right) => this.getProjectileVisualPriority(left) - this.getProjectileVisualPriority(right)
          || left.impactYear - right.impactYear
          || left.id.localeCompare(right.id))
        .slice(0, maxActiveProjectiles);
    const incoming = new Set(visibleProjectiles.map((projectile) => projectile.id));
    for (const [id, visual] of this.activeCombatProjectiles) {
      if (incoming.has(id)) continue;
      const removedBeforeImpact = visual.data.impactYear > gameYear + 1e-8;
      if (visual.data.attackClass === "pointDefense") {
        const size = this.getWeaponVisualProfile(visual.data.sourceMountKey, visual.data.attackClass).size;
        this.queueInterceptionBurst(`intercept-${id}`, visual.lastPosition, 0.7 * size);
      } else if (removedBeforeImpact && (visual.data.attackClass === "missile" || visual.data.attackClass === "torpedo")) {
        const size = this.getWeaponVisualProfile(visual.data.sourceMountKey, visual.data.attackClass).size;
        this.queueInterceptionBurst(`intercepted-warhead-${id}`, visual.lastPosition, 0.9 * size);
      }
      this.disposeActiveProjectile(id);
    }

    for (const projectile of visibleProjectiles) {
      let visual = this.activeCombatProjectiles.get(projectile.id);
      if (!visual) {
        visual = this.createActiveProjectile(projectile);
        this.activeCombatProjectiles.set(projectile.id, visual);
        this.queueMuzzleFlash(`launch-${projectile.id}`, this.resolveProjectilePoint(projectile, true, resolvePosition), projectile.attackClass, projectile.sourceMountKey);
      }
      visual.data = projectile;
      this.updateActiveProjectile(visual, gameYear, resolvePosition);
    }
  }

  queueCombatContact(contact: ServerCombatContact, from: Vector3, to: Vector3): void {
    const weaponId = contact.weaponId ?? contact.weaponName ?? "";
    const attackClass = this.inferAttackClass(weaponId);
    const profile = this.getWeaponVisualProfile(weaponId, attackClass);
    if (!contact.hit) {
      const missDirection = to.subtract(from).normalize();
      const missEnd = to.add(missDirection.scale(3.5));
      if (attackClass === "beam" || attackClass === "pointDefense") {
        this.queueBeam(`miss-${contact.id}`, from, missEnd, profile.aura, 0.2, 0.24);
      }
      return;
    }
    if (attackClass === "beam") {
      this.queueBeam(`beam-impact-${contact.id}`, from, to, profile.aura, profile.family === "phase" ? 0.48 : 0.32, 0.92);
      if (profile.family === "phase") this.queuePhaseEchoes(`phase-impact-${contact.id}`, from, to, profile.aura);
    } else if (attackClass === "kinetic") {
      this.queueKineticTracer(`kinetic-impact-${contact.id}`, from, to, profile);
    } else if (attackClass === "plasma") {
      this.queuePlasmaBolt(`plasma-impact-${contact.id}`, from, to, profile);
    }
    this.queueImpact({
      id: contact.id,
      position: to,
      attackClass,
      shieldDamage: contact.shieldDamage,
      armorDamage: contact.armorDamage,
      hullDamage: contact.hullDamage,
      destroyed: contact.targetDestroyed,
      hit: contact.hit,
      weaponId,
    });
  }

  queueImpact(options: CombatImpactOptions): void {
    if (!options.hit) return;
    const profile = this.getWeaponVisualProfile(options.weaponId ?? "", options.attackClass);
    const totalDamage = options.shieldDamage + options.armorDamage + options.hullDamage;
    const strength = Math.max(0.35, Math.min(2.4, 0.35 + Math.sqrt(Math.max(0, totalDamage)) * 0.075));
    if (options.shieldDamage > 0) this.queueShieldImpact(`${options.id}-shield`, options.position, strength, options.attackClass, profile);
    if (options.armorDamage > 0) this.queueArmorImpact(`${options.id}-armor`, options.position, strength, options.attackClass, profile);
    if (options.hullDamage > 0) this.queueHullImpact(`${options.id}-hull`, options.position, strength, options.attackClass, profile);
    if (options.destroyed) this.queueDestruction(`${options.id}-destroyed`, options.position, Math.max(1.2, strength * 1.35));
    this.cameraImpulse = Math.min(1.4, this.cameraImpulse + (options.destroyed ? 0.7 : strength * 0.08));
  }

  queueDestruction(name: string, position: Vector3, scale = 1): void {
    this.queuePulse(name, position, new Color3(1, 0.3, 0.025), 1.05, 0.15 * scale, 3.4 * scale, 1, true, 16 * scale);
    this.queuePulse(`${name}-white`, position, new Color3(1, 0.92, 0.68), 0.24, 0.1 * scale, 1.4 * scale, 0.95, false, 24 * scale);
    for (let index = 0; index < 3; index += 1) {
      const angle = (this.hash(name) * 0.0001 + index * 2.17) % (Math.PI * 2);
      const offset = new Vector3(Math.cos(angle), (index - 1) * 0.22, Math.sin(angle)).scale(scale * (0.28 + index * 0.12));
      this.queuePulse(
        `${name}-secondary-${index}`,
        position.add(offset),
        index === 1 ? new Color3(1, 0.82, 0.28) : new Color3(1, 0.12, 0.01),
        0.46 + index * 0.16,
        0.04 * scale,
        (0.75 + index * 0.32) * scale,
        0.86,
        false,
        0,
      );
    }
    this.queueShockwave(`${name}-shock`, position, scale);
    this.queueParticles(`${name}-fire`, position, new Color3(1, 0.28, 0.015), 70, 5.5 * scale, 0.75, 0.18 * scale, 0.65 * scale);
    this.queueParticles(`${name}-sparks`, position, new Color3(1, 0.78, 0.22), 90, 9 * scale, 0.95, 0.035 * scale, 0.12 * scale);
    this.queueDebris(name, position, scale, 16);
  }

  removeTrails(ownerId: string): void {
    for (let index = this.trails.length - 1; index >= 0; index -= 1) {
      if (this.trails[index].ownerId === ownerId) this.disposeTrail(index);
    }
  }

  consumeCameraImpulse(): number {
    const impulse = this.cameraImpulse;
    this.cameraImpulse = 0;
    return impulse;
  }

  update(deltaTime: number): void {
    this.cameraImpulse *= Math.exp(-deltaTime * 8);
    for (let index = this.beams.length - 1; index >= 0; index -= 1) {
      const beam = this.beams[index];
      beam.ttl -= deltaTime;
      if (beam.ttl <= 0) { this.disposeBeam(index); continue; }
      beam.mesh.alpha = Math.max(0, beam.ttl / beam.maxTtl);
    }
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.ttl -= deltaTime;
      if (projectile.ttl <= 0) { this.disposeProjectile(index); continue; }
      projectile.mesh.position.addInPlace(projectile.velocity.scale(deltaTime));
      projectile.mesh.rotation.addInPlace(projectile.spin.scale(deltaTime));
      projectile.material.alpha = Math.max(0, projectile.ttl / projectile.maxTtl);
    }
    for (let index = this.trails.length - 1; index >= 0; index -= 1) {
      const trail = this.trails[index];
      trail.age += deltaTime;
      trail.material.alpha = trail.startAlpha * Math.pow(Math.max(0, 1 - trail.age / trail.ttl), trail.fadePower);
      if (trail.age >= trail.ttl) this.disposeTrail(index);
    }
    for (let index = this.pulses.length - 1; index >= 0; index -= 1) {
      const pulse = this.pulses[index];
      pulse.age += deltaTime;
      if (pulse.age >= pulse.ttl) { this.disposePulse(index); continue; }
      const progress = pulse.age / pulse.ttl;
      const eased = 1 - (1 - progress) ** 3;
      const scale = pulse.startScale + (pulse.endScale - pulse.startScale) * eased;
      pulse.root.scaling.setAll(scale);
      pulse.root.rotation.addInPlace(pulse.spin.scale(deltaTime));
      for (const material of pulse.materials) material.alpha = pulse.startAlpha * (1 - progress) ** 1.4;
      if (pulse.light) pulse.light.intensity *= Math.exp(-deltaTime * 5.5);
    }
    for (let index = this.particleBursts.length - 1; index >= 0; index -= 1) {
      this.particleBursts[index].ttl -= deltaTime;
      if (this.particleBursts[index].ttl <= 0) {
        this.particleBursts[index].system.dispose();
        this.particleBursts.splice(index, 1);
      }
    }
    for (const visual of this.activeCombatProjectiles.values()) {
      const pulse = 0.82 + Math.sin(performance.now() * 0.012 + visual.seed) * 0.18;
      for (const material of visual.materials) material.alpha = Math.max(0.35, pulse);
      for (const mesh of visual.meshes) {
        if (mesh.name.includes("Halo") || mesh.name.includes("Ring")) mesh.rotation.z += deltaTime * 7;
      }
      if (visual.light) visual.light.intensity = (visual.data.attackClass === "torpedo" ? 6 : 3) * pulse;
    }
  }

  dispose(): void {
    for (const id of Array.from(this.activeCombatProjectiles.keys())) this.disposeActiveProjectile(id);
    for (let index = this.beams.length - 1; index >= 0; index -= 1) this.disposeBeam(index);
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) this.disposeProjectile(index);
    for (let index = this.trails.length - 1; index >= 0; index -= 1) this.disposeTrail(index);
    for (let index = this.pulses.length - 1; index >= 0; index -= 1) this.disposePulse(index);
    for (const burst of this.particleBursts) burst.system.dispose();
    this.particleBursts.length = 0;
    this.impactTexture.dispose();
  }

  private createActiveProjectile(projectile: ServerCombatProjectile): ActiveCombatProjectile {
    const root = new TransformNode(`combatProjectile-${projectile.id}`, this.scene);
    const profile = this.getWeaponVisualProfile(projectile.sourceMountKey, projectile.attackClass);
    const meshes: Mesh[] = [];
    const materials: StandardMaterial[] = [];
    const addSphere = (name: string, diameter: number, color: Color3, emissive = 2): Mesh => {
      const mesh = MeshBuilder.CreateSphere(name, { diameter, segments: 10 }, this.scene);
      mesh.parent = root;
      mesh.isPickable = false;
      const material = this.createEmissiveMaterial(`${name}Mat`, color, emissive);
      mesh.material = material;
      meshes.push(mesh);
      materials.push(material);
      this.glowLayer.addIncludedOnlyMesh(mesh);
      return mesh;
    };
    if (projectile.attackClass === "beam") {
      addSphere(`${projectile.id}-photon`, 0.08 * profile.size, profile.core, 4);
      if (profile.family === "phase") {
        const echoA = addSphere(`${projectile.id}-phaseEchoA`, 0.055 * profile.size, profile.aura, 3.2);
        const echoB = addSphere(`${projectile.id}-phaseEchoB`, 0.055 * profile.size, profile.aura, 3.2);
        echoA.position.x = 0.09 * profile.size;
        echoB.position.x = -0.09 * profile.size;
      }
    } else if (projectile.attackClass === "kinetic") {
      const bolt = addSphere(`${projectile.id}-slug`, 0.14 * profile.size, profile.core, profile.family === "gauss" ? 4 : 2.8);
      bolt.scaling.set(0.55, 0.55, profile.family === "gauss" ? 7 : 5.5);
      if (profile.family === "gauss") {
        const halo = MeshBuilder.CreateTorus(`${projectile.id}-gaussHalo`, { diameter: 0.32 * profile.size, thickness: 0.025 * profile.size, tessellation: 18 }, this.scene);
        halo.parent = root;
        halo.rotation.x = Math.PI / 2;
        halo.isPickable = false;
        const material = this.createEmissiveMaterial(`${projectile.id}-gaussHaloMat`, profile.aura, 3.5);
        halo.material = material;
        meshes.push(halo);
        materials.push(material);
        this.glowLayer.addIncludedOnlyMesh(halo);
      }
    } else if (projectile.attackClass === "plasma") {
      addSphere(`${projectile.id}-plasmaCore`, 0.24 * profile.size, profile.core, 3.5);
      const corona = addSphere(`${projectile.id}-plasmaCorona`, 0.46 * profile.size, profile.aura, profile.family === "fusion" ? 3.4 : 2.4);
      corona.material!.alpha = 0.42;
      if (profile.family === "fusion") {
        const ring = MeshBuilder.CreateTorus(`${projectile.id}-fusionRing`, { diameter: 0.58 * profile.size, thickness: 0.035 * profile.size, tessellation: 24 }, this.scene);
        ring.parent = root;
        ring.isPickable = false;
        const material = this.createEmissiveMaterial(`${projectile.id}-fusionRingMat`, profile.core, 3.4);
        ring.material = material;
        meshes.push(ring);
        materials.push(material);
        this.glowLayer.addIncludedOnlyMesh(ring);
      }
    } else if (projectile.attackClass === "missile" || projectile.attackClass === "torpedo") {
      const size = (projectile.attackClass === "torpedo" ? 0.34 : profile.family === "swarmer" ? 0.14 : 0.2) * profile.size;
      const body = addSphere(`${projectile.id}-warhead`, size, profile.core, 2.6);
      body.scaling.set(0.62, 0.62, projectile.attackClass === "torpedo" ? 3.8 : 2.8);
      const exhaust = addSphere(`${projectile.id}-exhaust`, size * 0.75, profile.aura, 4);
      exhaust.position.z = -size * 1.8;
      if (projectile.attackClass === "torpedo") {
        const driveRing = MeshBuilder.CreateTorus(`${projectile.id}-torpedoDrive`, { diameter: size * 1.25, thickness: size * 0.09, tessellation: 18 }, this.scene);
        driveRing.parent = root;
        driveRing.position.z = -size * 1.55;
        driveRing.isPickable = false;
        const material = this.createEmissiveMaterial(`${projectile.id}-torpedoDriveMat`, profile.aura, 4.2);
        driveRing.material = material;
        meshes.push(driveRing);
        materials.push(material);
        this.glowLayer.addIncludedOnlyMesh(driveRing);
      }
    } else {
      const pellet = addSphere(`${projectile.id}-pd`, 0.07 * profile.size, profile.core, 4);
      pellet.scaling.z = profile.family === "flak" ? 2.4 : 4;
    }
    const light = projectile.attackClass === "pointDefense" || projectile.attackClass === "beam" || !this.canCreateEffectLight()
      ? null
      : new PointLight(`${projectile.id}-light`, Vector3.Zero(), this.scene);
    if (light) {
      light.parent = root;
      light.diffuse = profile.aura;
      light.specular = profile.core;
      light.range = (projectile.attackClass === "torpedo" ? 10 : 6) * profile.size;
      light.intensity = (projectile.attackClass === "torpedo" ? 6 : 3) * profile.size;
    }
    return {
      data: projectile,
      root,
      meshes,
      materials,
      light,
      trail: null,
      trailPoints: [],
      seed: this.hash(projectile.id),
      lastPosition: Vector3.Zero(),
    };
  }

  private updateActiveProjectile(
    visual: ActiveCombatProjectile,
    gameYear: number,
    resolvePosition?: (entityId: string | null | undefined) => Vector3 | null,
  ): void {
    const projectile = visual.data;
    const profile = this.getWeaponVisualProfile(projectile.sourceMountKey, projectile.attackClass);
    const duration = Math.max(1e-9, projectile.impactYear - projectile.launchYear);
    const progress = Math.max(0, Math.min(1, (gameYear - projectile.launchYear) / duration));
    const from = new Vector3(projectile.sourcePosition.x, projectile.sourcePosition.y, projectile.sourcePosition.z);
    const trackedProjectile = projectile.targetProjectileId
      ? this.activeCombatProjectiles.get(projectile.targetProjectileId)
      : null;
    const to = trackedProjectile?.lastPosition.clone()
      ?? (projectile.guided
        ? this.resolveProjectilePoint(projectile, false, resolvePosition)
        : new Vector3(projectile.targetPosition.x, projectile.targetPosition.y, projectile.targetPosition.z));
    let position = Vector3.Lerp(from, to, progress);
    const direction = to.subtract(from);
    if (projectile.guided && direction.lengthSquared() > 0.001) {
      const side = Vector3.Cross(direction.normalize(), Vector3.Up()).normalize();
      const wobbleFrequency = profile.family === "swarmer" ? 6 : 3;
      const wobble = Math.sin(progress * Math.PI * wobbleFrequency + visual.seed) * Math.sin(progress * Math.PI) * (projectile.attackClass === "torpedo" ? 0.35 : profile.family === "swarmer" ? 1.05 : 0.7);
      position = position.add(side.scale(wobble));
    }
    visual.root.position.copyFrom(position);
    if (direction.lengthSquared() > 0.001) visual.root.lookAt(to);
    visual.lastPosition.copyFrom(position);
    if (visual.trailPoints.length === 0 || Vector3.DistanceSquared(visual.trailPoints.at(-1)!, position) > 0.08) {
      visual.trailPoints.push(position.clone());
      const maxPoints = projectile.attackClass === "missile" || projectile.attackClass === "torpedo" ? 16 : 7;
      if (visual.trailPoints.length > maxPoints) visual.trailPoints.shift();
      if (visual.trailPoints.length >= 2) {
        const firstPoint = visual.trailPoints[0];
        const renderPoints = Array.from({ length: maxPoints }, (_, index) => {
          const sourceIndex = Math.max(0, visual.trailPoints.length - maxPoints + index);
          return (visual.trailPoints[sourceIndex] ?? firstPoint).clone();
        });
        if (!visual.trail) {
          visual.trail = MeshBuilder.CreateLines(`${projectile.id}-trail`, { points: renderPoints }, this.scene);
          visual.trail.isPickable = false;
          this.glowLayer.addIncludedOnlyMesh(visual.trail);
        } else {
          MeshBuilder.CreateLines(visual.trail.name, { points: renderPoints, instance: visual.trail }, this.scene);
        }
        visual.trail.color = profile.aura;
        visual.trail.alpha = profile.trailAlpha;
      }
    }
  }

  private resolveProjectilePoint(
    projectile: ServerCombatProjectile,
    source: boolean,
    resolvePosition?: (entityId: string | null | undefined) => Vector3 | null,
  ): Vector3 {
    const resolved = source
      ? resolvePosition?.(projectile.sourceShipId) ?? resolvePosition?.(projectile.sourceActorId)
      : resolvePosition?.(projectile.targetShipId) ?? resolvePosition?.(projectile.targetActorId);
    if (resolved) return resolved;
    const position = source ? projectile.sourcePosition : projectile.targetPosition;
    return new Vector3(position.x, position.y, position.z);
  }

  private queueMuzzleFlash(name: string, position: Vector3, attackClass: CombatAttackClass, weaponId = ""): void {
    const profile = this.getWeaponVisualProfile(weaponId, attackClass);
    const color = profile.aura;
    const scale = (attackClass === "torpedo" ? 0.65 : attackClass === "missile" ? 0.4 : 0.25) * profile.size;
    this.queuePulse(name, position, color, 0.18, scale * 0.2, scale, 0.82, false, 4);
    if (attackClass === "kinetic" || attackClass === "missile" || attackClass === "torpedo") {
      this.queueParticles(`${name}-sparks`, position, color, 10, 2.2, 0.24, 0.025, 0.07);
    }
  }

  private queueShieldImpact(name: string, position: Vector3, strength: number, attackClass: CombatAttackClass, profile: WeaponVisualProfile): void {
    const color = profile.family === "fusion"
      ? new Color3(0.2, 1, 0.66)
      : profile.family === "phase"
        ? new Color3(0.82, 0.25, 1)
        : attackClass === "plasma" ? new Color3(0.62, 0.3, 1) : new Color3(0.12, 0.72, 1);
    this.queuePulse(name, position, color, 0.62, 0.25 * strength, 1.6 * strength, 0.5, true, 3.5 * strength);
    this.queueParticles(`${name}-ions`, position, color, 18, 2.5 * strength, 0.38, 0.025, 0.09);
  }

  private queueArmorImpact(name: string, position: Vector3, strength: number, _attackClass: CombatAttackClass, profile: WeaponVisualProfile): void {
    const color = profile.impact;
    this.queuePulse(name, position, color, 0.24, 0.08 * strength, 0.62 * strength, 0.9, false, 8 * strength);
    this.queueParticles(`${name}-sparks`, position, new Color3(1, 0.73, 0.18), Math.round(12 + strength * 14), 4.5 * strength, 0.5, 0.025, 0.08);
  }

  private queueHullImpact(name: string, position: Vector3, strength: number, _attackClass: CombatAttackClass, profile: WeaponVisualProfile): void {
    const color = profile.impact;
    this.queuePulse(name, position, color, 0.42, 0.1 * strength, 1.05 * strength, 0.95, false, 10 * strength);
    this.queueParticles(`${name}-fire`, position, new Color3(1, 0.22, 0.025), Math.round(16 + strength * 18), 3.5 * strength, 0.62, 0.05, 0.18);
    this.queueDebris(name, position, strength * 0.45, Math.round(4 + strength * 3));
  }

  private queueInterceptionBurst(name: string, position: Vector3, strength: number): void {
    this.queuePulse(name, position, new Color3(0.18, 0.92, 1), 0.3, 0.05, strength, 0.9, false, 7);
    this.queueParticles(`${name}-fragments`, position, new Color3(0.72, 0.98, 1), 22, 4.5, 0.42, 0.018, 0.06);
  }

  private queueShockwave(name: string, position: Vector3, scale: number): void {
    const root = new TransformNode(name, this.scene);
    root.position.copyFrom(position);
    const material = this.createEmissiveMaterial(`${name}Mat`, new Color3(1, 0.42, 0.08), 2);
    material.alpha = 0.65;
    const ring = MeshBuilder.CreateTorus(name, { diameter: 1, thickness: 0.035, tessellation: 48 }, this.scene);
    ring.parent = root;
    ring.material = material;
    ring.isPickable = false;
    ring.rotation.x = Math.PI / 2;
    this.glowLayer.addIncludedOnlyMesh(ring);
    this.pulses.push({ root, meshes: [ring], materials: [material], light: null, age: 0, ttl: 0.8, startScale: 0.2 * scale, endScale: 4.5 * scale, startAlpha: 0.65, spin: Vector3.Zero() });
    this.trimPulses();
  }

  private queuePulse(name: string, position: Vector3, color: Color3, ttl: number, startScale: number, endScale: number, alpha: number, shell: boolean, lightIntensity: number): void {
    const root = new TransformNode(name, this.scene);
    root.position.copyFrom(position);
    const material = this.createEmissiveMaterial(`${name}Mat`, color, 2.6);
    material.alpha = alpha;
    material.backFaceCulling = !shell;
    const mesh = MeshBuilder.CreateSphere(name, { diameter: 1, segments: shell ? 20 : 12 }, this.scene);
    mesh.parent = root;
    mesh.material = material;
    mesh.isPickable = false;
    this.glowLayer.addIncludedOnlyMesh(mesh);
    const light = lightIntensity > 0 && this.canCreateEffectLight() ? new PointLight(`${name}Light`, position.clone(), this.scene) : null;
    if (light) {
      light.diffuse = color;
      light.specular = color;
      light.intensity = lightIntensity;
      light.range = Math.max(4, endScale * 5);
    }
    this.pulses.push({ root, meshes: [mesh], materials: [material], light, age: 0, ttl, startScale, endScale, startAlpha: alpha, spin: new Vector3(0.4, 0.7, 0.2) });
    this.trimPulses();
  }

  private queueParticles(name: string, position: Vector3, color: Color3, count: number, speed: number, life: number, minSize: number, maxSize: number): void {
    if (this.particleBursts.length >= (this.limits.maxParticles ?? 48)) return;
    const system = new ParticleSystem(name, Math.max(16, count), this.scene);
    system.particleTexture = this.impactTexture;
    system.emitter = position.clone();
    system.color1.set(color.r, color.g, color.b, 1);
    system.color2.set(Math.min(1, color.r * 1.4), Math.min(1, color.g * 1.3), Math.min(1, color.b * 1.2), 0.8);
    system.colorDead.set(color.r * 0.2, color.g * 0.15, color.b * 0.1, 0);
    system.minSize = minSize;
    system.maxSize = maxSize;
    system.minLifeTime = life * 0.45;
    system.maxLifeTime = life;
    system.minEmitPower = speed * 0.25;
    system.maxEmitPower = speed;
    system.direction1 = new Vector3(-1, -1, -1);
    system.direction2 = new Vector3(1, 1, 1);
    system.gravity = new Vector3(0, -0.15, 0);
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    system.manualEmitCount = count;
    system.targetStopDuration = 0.03;
    system.disposeOnStop = false;
    system.start();
    this.particleBursts.push({ system, ttl: life + 0.25 });
  }

  private queueDebris(name: string, position: Vector3, scale: number, count: number): void {
    const color = new Color3(0.92, 0.48, 0.16);
    for (let index = 0; index < count; index += 1) {
      const material = this.createEmissiveMaterial(`${name}-debrisMat-${index}`, color, 0.8);
      const mesh = MeshBuilder.CreateBox(`${name}-debris-${index}`, { size: 0.05 + (index % 4) * 0.025 }, this.scene);
      mesh.position.copyFrom(position);
      mesh.material = material;
      mesh.isPickable = false;
      const angle = (index / Math.max(1, count)) * Math.PI * 2 + this.hash(name) * 0.01;
      const vertical = ((index * 37) % 11) / 10 - 0.5;
      const speed = (1.5 + (index % 5) * 0.7) * scale;
      this.projectiles.push({
        mesh,
        material,
        velocity: new Vector3(Math.cos(angle) * speed, vertical * speed, Math.sin(angle) * speed),
        spin: new Vector3(2 + index % 3, 3 + index % 5, 1 + index % 4),
        ttl: 0.65 + (index % 4) * 0.15,
        maxTtl: 1.1,
      });
    }
    this.trimProjectiles();
  }

  private queueKineticTracer(name: string, from: Vector3, to: Vector3, profile: WeaponVisualProfile): void {
    const direction = to.subtract(from).normalize();
    const start = to.subtract(direction.scale(5.5 * profile.size));
    this.queueBeam(name, start, to, profile.aura, profile.family === "gauss" ? 0.2 : 0.14, 0.82);
    if (profile.family === "gauss") {
      this.queueParticles(`${name}-gaussArc`, to, profile.aura, 18, 3.2 * profile.size, 0.32, 0.018, 0.055 * profile.size);
    }
  }

  private queuePlasmaBolt(name: string, from: Vector3, to: Vector3, profile: WeaponVisualProfile): void {
    this.queueProjectile(name, from, to, profile.aura, profile.family === "fusion" ? 0.5 : 0.42, 0.3 * profile.size);
    this.queueTrail({ name: `${name}-trail`, ownerId: name, from, to, radius: 0.035 * profile.size, diffuse: Color3.Black(), emissive: profile.aura, ttl: 0.5, startAlpha: profile.trailAlpha, tessellation: 6, maxPerOwner: 2 });
    if (profile.family === "fusion") this.queuePulse(`${name}-fusionBloom`, to, profile.core, 0.34, 0.08, 0.8 * profile.size, 0.7, false, 6 * profile.size);
  }

  private queuePhaseEchoes(name: string, from: Vector3, to: Vector3, color: Color3): void {
    const direction = to.subtract(from).normalize();
    let side = Vector3.Cross(direction, Vector3.Up());
    if (side.lengthSquared() < 0.001) side = Vector3.Right();
    side.normalize();
    this.queueBeam(`${name}-a`, from.add(side.scale(0.08)), to.add(side.scale(0.08)), color, 0.24, 0.32);
    this.queueBeam(`${name}-b`, from.subtract(side.scale(0.08)), to.subtract(side.scale(0.08)), color, 0.24, 0.32);
  }

  private getWeaponVisualProfile(weaponId: string, attackClass: CombatAttackClass): WeaponVisualProfile {
    const id = weaponId.toLowerCase();
    const size = id.includes("large") ? 1.35 : id.includes("medium") ? 1 : id.includes("small") ? 0.78 : 1;
    const defaults = WEAPON_COLORS[attackClass];
    if (id.includes("phase")) {
      return {
        family: "phase",
        core: new Color3(1, 0.9, 1),
        aura: new Color3(0.82, 0.08, 1),
        impact: new Color3(0.96, 0.24, 1),
        size,
        trailAlpha: 0.92,
      };
    }
    if (id.includes("gauss")) {
      return {
        family: "gauss",
        core: new Color3(0.9, 1, 1),
        aura: new Color3(0.04, 0.82, 1),
        impact: new Color3(0.18, 0.92, 1),
        size,
        trailAlpha: 0.72,
      };
    }
    if (id.includes("fusion")) {
      return {
        family: "fusion",
        core: new Color3(0.88, 1, 0.7),
        aura: new Color3(0.04, 1, 0.48),
        impact: new Color3(0.18, 1, 0.52),
        size,
        trailAlpha: 0.7,
      };
    }
    if (id.includes("swarmer")) {
      return {
        family: "swarmer",
        core: new Color3(1, 1, 0.72),
        aura: new Color3(0.72, 1, 0.05),
        impact: new Color3(0.92, 1, 0.16),
        size: size * 0.82,
        trailAlpha: 0.7,
      };
    }
    if (attackClass === "torpedo" || id.includes("torpedo")) {
      return {
        family: "torpedo",
        core: WEAPON_COLORS.torpedo.core,
        aura: WEAPON_COLORS.torpedo.aura,
        impact: WEAPON_COLORS.torpedo.impact,
        size,
        trailAlpha: 0.82,
      };
    }
    if (attackClass === "pointDefense" && (id.includes("medium") || id.includes("large") || id.includes("flak"))) {
      return {
        family: "flak",
        core: new Color3(1, 1, 0.84),
        aura: new Color3(0.38, 0.9, 1),
        impact: new Color3(0.72, 0.98, 1),
        size,
        trailAlpha: 0.76,
      };
    }
    return {
      family: "standard",
      core: defaults.core,
      aura: defaults.aura,
      impact: defaults.impact,
      size,
      trailAlpha: attackClass === "beam" ? 0.85 : attackClass === "missile" ? 0.62 : 0.45,
    };
  }

  private inferAttackClass(value: string): CombatAttackClass {
    const id = value.toLowerCase();
    if (id.includes("torpedo")) return "torpedo";
    if (id.includes("missile") || id.includes("rocket")) return "missile";
    if (id.includes("point") || id.includes("flak") || id.includes("pd")) return "pointDefense";
    if (id.includes("plasma")) return "plasma";
    if (id.includes("rail") || id.includes("kinetic") || id.includes("cannon")) return "kinetic";
    return "beam";
  }

  private createEmissiveMaterial(name: string, color: Color3, intensity: number): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = color.scale(intensity);
    material.disableLighting = true;
    material.alpha = 1;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    return material;
  }

  private createRadialTexture(): DynamicTexture {
    const texture = new DynamicTexture("combatParticleTexture", { width: 64, height: 64 }, this.scene, false);
    texture.hasAlpha = true;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    const context = texture.getContext();
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.2, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.58, "rgba(255,255,255,0.34)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.clearRect(0, 0, 64, 64);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    texture.update(false);
    return texture;
  }

  private hash(value: string): number {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
    return result >>> 0;
  }

  private getProjectileVisualPriority(projectile: ServerCombatProjectile): number {
    if (projectile.targetProjectileId || projectile.attackClass === "pointDefense") return 0;
    if (projectile.attackClass === "torpedo") return 1;
    if (projectile.attackClass === "missile") return 2;
    if (projectile.attackClass === "plasma") return 3;
    return 4;
  }

  private canCreateEffectLight(): boolean {
    let activeLights = 0;
    for (const visual of this.activeCombatProjectiles.values()) {
      if (visual.light) activeLights += 1;
    }
    for (const pulse of this.pulses) {
      if (pulse.light) activeLights += 1;
    }
    return activeLights < 24;
  }

  private trimBeams(): void {
    while (this.beams.length > (this.limits.maxBeams ?? 128)) this.disposeBeam(0);
  }

  private trimProjectiles(): void {
    while (this.projectiles.length > (this.limits.maxProjectiles ?? 220)) this.disposeProjectile(0);
  }

  private trimPulses(): void {
    while (this.pulses.length > (this.limits.maxPulses ?? 80)) this.disposePulse(0);
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

  private disposeActiveProjectile(id: string): void {
    const visual = this.activeCombatProjectiles.get(id);
    if (!visual) return;
    for (const mesh of visual.meshes) {
      this.glowLayer.removeIncludedOnlyMesh(mesh);
      mesh.dispose();
    }
    for (const material of visual.materials) material.dispose();
    if (visual.trail) {
      this.glowLayer.removeIncludedOnlyMesh(visual.trail);
      visual.trail.dispose();
    }
    visual.light?.dispose();
    visual.root.dispose();
    this.activeCombatProjectiles.delete(id);
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

  private disposePulse(index: number): void {
    const [pulse] = this.pulses.splice(index, 1);
    if (!pulse) return;
    for (const mesh of pulse.meshes) {
      this.glowLayer.removeIncludedOnlyMesh(mesh);
      mesh.dispose();
    }
    for (const material of pulse.materials) material.dispose();
    pulse.light?.dispose();
    pulse.root.dispose();
  }
}

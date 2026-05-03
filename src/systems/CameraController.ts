import { ArcRotateCamera, Vector3, KeyboardEventTypes } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

export interface CameraConfig {
  alpha: number;
  beta: number;
  radius: number;
  target: Vector3;
  lowerRadiusLimit: number;
  upperRadiusLimit: number;
  lowerBetaLimit?: number;
  upperBetaLimit?: number;
  /** Percentage of radius per scroll tick (overrides wheelPrecision) */
  wheelDeltaPercentage?: number;
  wheelPrecision?: number;
  inertia: number;
}

/**
 * CameraController
 * ArcRotateCamera with WASD + mouse-edge panning on the XZ plane.
 * Scroll wheel zooms in/out (exponential). Right-click drag to orbit.
 * Supports galaxy bounds clamping and system-focus border constraints.
 */
export class CameraController {
  public camera: ArcRotateCamera;
  private scene: Scene;
  private canvas: HTMLCanvasElement;

  // WASD / edge pan state
  private keysDown = new Set<string>();
  private panSpeed = 120;       // units per second at max zoom-out (increased from 60)
  private edgeThreshold = 20;   // harsh edge threshold - only very close to edge triggers panning
  private rotateSpeed = 1.5;    // radians per second for Q/E orbit
  private mouseX = 0;
  private mouseY = 0;

  // Galaxy bounds (default: unbounded)
  private boundsMinX = -Infinity;
  private boundsMaxX = Infinity;
  private boundsMinZ = -Infinity;
  private boundsMaxZ = Infinity;

  // System focus constraint
  private _focusCenter: Vector3 | null = null;
  private _focusRadius = 0;
  private _focusStrength = 0; // 0 = no constraint, 1 = hard clamp

  // bound handlers for cleanup
  private _onMouseMove: (e: MouseEvent) => void;

  constructor(scene: Scene, canvas: HTMLCanvasElement, config: CameraConfig) {
    this.scene = scene;
    this.canvas = canvas;

    this.camera = new ArcRotateCamera(
      "camera",
      config.alpha,
      config.beta,
      config.radius,
      config.target.clone(),
      scene,
    );

    this.camera.attachControl(canvas, true);

    // Zoom limits
    this.camera.lowerRadiusLimit = config.lowerRadiusLimit;
    this.camera.upperRadiusLimit = config.upperRadiusLimit;

    if (config.lowerBetaLimit !== undefined) {
      this.camera.lowerBetaLimit = config.lowerBetaLimit;
    }
    if (config.upperBetaLimit !== undefined) {
      this.camera.upperBetaLimit = config.upperBetaLimit;
    }

    // Exponential zoom (percentage per tick) or linear zoom
    if (config.wheelDeltaPercentage !== undefined) {
      this.camera.wheelDeltaPercentage = config.wheelDeltaPercentage;
    } else if (config.wheelPrecision !== undefined) {
      this.camera.wheelPrecision = config.wheelPrecision;
    }

    this.camera.inertia = config.inertia;

    // Disable panning via right-click drag — we handle our own panning
    this.camera.panningSensibility = 0;

    // Disable default camera keyboard controls
    this.camera.keysUp = [];
    this.camera.keysDown = [];
    this.camera.keysLeft = [];
    this.camera.keysRight = [];

    this.camera.useAutoRotationBehavior = false;
    this.camera.useBouncingBehavior = false;
    this.camera.useFramingBehavior = false;

    // ── Keyboard input ──
    scene.onKeyboardObservable.add((kbInfo) => {
      const key = kbInfo.event.key.toLowerCase();
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        this.keysDown.add(key);
      } else {
        this.keysDown.delete(key);
      }
    });

    // ── Mouse position for edge panning ──
    this._onMouseMove = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    canvas.addEventListener("mousemove", this._onMouseMove);
  }

  /* ─── Accessors ─── */

  get radius(): number {
    return this.camera.radius;
  }

  get target(): Vector3 {
    return this.camera.target;
  }

  /* ─── Bounds ─── */

  /** Set the galaxy-level panning bounds (XZ plane). */
  setBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.boundsMinX = minX;
    this.boundsMaxX = maxX;
    this.boundsMinZ = minZ;
    this.boundsMaxZ = maxZ;
  }

  /* ─── System focus constraint ─── */

  /**
   * Set a soft border around a star system.
   * @param center  World position of the star.
   * @param radius  Max panning distance from center when strength=1.
   * @param strength 0–1 blend: 0=no constraint, 1=hard clamp at radius.
   */
  setSystemFocus(center: Vector3, radius: number, strength: number): void {
    this._focusCenter = center;
    this._focusRadius = radius;
    this._focusStrength = strength;
  }

  /** Release the system-focus border constraint. */
  clearSystemFocus(): void {
    this._focusCenter = null;
    this._focusStrength = 0;
  }

  /* ─── Per-frame update ─── */

  /**
   * Call each frame with dt in seconds.
   * Handles WASD + mouse-edge panning, then enforces constraints.
   */
  updatePanning(dt: number): void {
    // Scale pan speed: faster when zoomed out, slower when zoomed in
    const radiusFactor = this.camera.radius / (this.camera.upperRadiusLimit ?? 800);
    const speed = this.panSpeed * radiusFactor;

    let dx = 0; // positive = right
    let dz = 0; // positive = forward

    // WASD — W forward, S backward, A left, D right
    if (this.keysDown.has("w") || this.keysDown.has("arrowup")) dz += 1;
    if (this.keysDown.has("s") || this.keysDown.has("arrowdown")) dz -= 1;
    if (this.keysDown.has("a") || this.keysDown.has("arrowleft")) dx -= 1;
    if (this.keysDown.has("d") || this.keysDown.has("arrowright")) dx += 1;

    // Mouse edge panning — gradient intensity based on distance from edge (harsher threshold)
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const et = this.edgeThreshold;

    // Left edge: intensity increases as we get closer to the very edge
    if (this.mouseX < et) {
      dx += (1 - this.mouseX / et);
    }
    // Right edge: intensity increases as we get closer to the very edge
    if (this.mouseX > w - et) {
      dx -= (1 - (w - this.mouseX) / et);
    }
    // Top edge: intensity increases as we get closer to the very edge
    if (this.mouseY < et) {
      dz += (1 - this.mouseY / et);
    }
    // Bottom edge: intensity increases as we get closer to the very edge
    if (this.mouseY > h - et) {
      dz -= (1 - (h - this.mouseY) / et);
    }

    if (dx !== 0 || dz !== 0) {
      // Normalize if diagonal
      const len = Math.sqrt(dx * dx + dz * dz);
      dx /= len;
      dz /= len;

      // Camera-relative directions on XZ plane
      const forward = this.camera.getForwardRay().direction;
      const fwd = new Vector3(forward.x, 0, forward.z).normalize();
      const right = new Vector3(-fwd.z, 0, fwd.x); // perpendicular right

      const move = fwd.scale(dz * speed * dt).add(right.scale(dx * speed * dt));
      this.camera.target.addInPlace(move);
    }

    // ── Q / E — orbit camera horizontally around target ──
    if (this.keysDown.has("q")) {
      this.camera.alpha -= this.rotateSpeed * dt;
    }
    if (this.keysDown.has("e")) {
      this.camera.alpha += this.rotateSpeed * dt;
    }

    // ── Enforce system focus constraint ──
    if (this._focusCenter && this._focusStrength > 0.01) {
      const cx = this._focusCenter.x;
      const cz = this._focusCenter.z;
      const offX = this.camera.target.x - cx;
      const offZ = this.camera.target.z - cz;
      const dist = Math.sqrt(offX * offX + offZ * offZ);
      const maxDist = this._focusRadius;

      if (dist > maxDist) {
        // Pull back proportional to strength
        // At strength=1, hard clamp at maxDist
        // At strength<1, allow exceeding but pull back partially
        const targetDist = maxDist + (dist - maxDist) * (1 - this._focusStrength);
        const scale = targetDist / dist;
        this.camera.target.x = cx + offX * scale;
        this.camera.target.z = cz + offZ * scale;
      }
    }

    // ── Enforce galaxy bounds ──
    this.camera.target.x = Math.max(this.boundsMinX, Math.min(this.boundsMaxX, this.camera.target.x));
    this.camera.target.z = Math.max(this.boundsMinZ, Math.min(this.boundsMaxZ, this.camera.target.z));
    this.camera.target.y = 0; // always on galaxy plane
  }

  dispose(): void {
    this.canvas.removeEventListener("mousemove", this._onMouseMove);
    this.camera.detachControl();
    this.camera.dispose();
  }
}

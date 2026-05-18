import type { Mesh } from "@babylonjs/core";
import type { SystemPosition } from "../data/SystemCoordinates";

export interface OrbitalBody {
  mesh: Mesh;
  getSystemPosition: (nowMs: number) => SystemPosition;
  axialRotationSpeed: number; // radians per second
}

/**
 * OrbitSystem
 * Updates planet positions and rotations each frame.
 * No physics engine — pure trigonometric orbits.
 */
export class OrbitSystem {
  private bodies: OrbitalBody[] = [];

  addBody(body: OrbitalBody): void {
    this.bodies.push(body);
  }

  /** Call once per frame with delta time in seconds. */
  update(deltaTime: number, nowMs = Date.now()): void {
    for (const body of this.bodies) {
      const position = body.getSystemPosition(nowMs);
      body.mesh.position.x = position.x;
      body.mesh.position.y = position.y;
      body.mesh.position.z = position.z;

      // Axial rotation
      body.mesh.rotation.y += body.axialRotationSpeed * deltaTime;
    }
  }

  dispose(): void {
    this.bodies.length = 0;
  }
}

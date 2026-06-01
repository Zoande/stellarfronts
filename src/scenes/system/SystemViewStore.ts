import type { PlanetState } from "../../data/Economy";
import type { FactionInfo } from "../../data/Factions";
import type { LeaderState } from "../../data/Leaders";
import type { ShipDesign } from "../../data/ShipDesigns";
import type { PlanetConfig, StarData } from "../../data/StarMap";
import {
  DEFAULT_ORBIT_EPOCH_MS,
  getPlanetSystemPosition,
  getSystemOrbitLayout,
  interpolateSystemPosition,
  SYSTEM_FLEET_Y,
} from "../../data/SystemCoordinates";
import type { SystemPosition } from "../../data/SystemCoordinates";
import { GAME_DAYS_PER_YEAR, GAME_START_YEAR, REAL_MS_PER_GAME_DAY } from "../../game/GameTime";
import type {
  ServerCombatContact,
  ServerFleet,
  ServerShip,
  ServerStarbaseSummary,
  SystemDetailPayload,
  SystemHyperlaneExitPoint,
} from "../../game/GameProtocol";
import type { FactionTechnologyView } from "../../data/Technology";

export interface SystemViewStorePayload extends SystemDetailPayload {
  leaders?: LeaderState[];
}

export class SystemViewStore {
  private payload: SystemViewStorePayload;
  private clockYear: number;
  private selectedFleetIds = new Set<string>();
  private shipsByFleetId = new Map<string, ServerShip[]>();
  private fleetById = new Map<string, ServerFleet>();
  private starbaseById = new Map<string, ServerStarbaseSummary>();

  constructor(payload: SystemViewStorePayload, clockYear = GAME_START_YEAR) {
    this.payload = payload;
    this.clockYear = clockYear;
    this.rebuildIndexes();
  }

  applyPayload(payload: SystemViewStorePayload): void {
    this.payload = payload;
    this.rebuildIndexes();
    this.selectedFleetIds = new Set(
      Array.from(this.selectedFleetIds).filter((fleetId) => this.fleetById.has(fleetId)),
    );
  }

  setClockYear(year: number): void {
    this.clockYear = year;
  }

  setSelectedFleetIds(fleetIds: Iterable<string>): void {
    this.selectedFleetIds = new Set(
      Array.from(fleetIds).filter((fleetId) => this.fleetById.has(fleetId)),
    );
  }

  getSelectedFleetIds(): string[] {
    return Array.from(this.selectedFleetIds);
  }

  getPrimarySelectedFleetId(): string | null {
    return this.selectedFleetIds.values().next().value ?? null;
  }

  getStar(): StarData {
    return this.payload.star;
  }

  getPlanetStates(): PlanetState[] {
    return this.payload.planetStates;
  }

  getPlanetConfigs(): PlanetConfig[] {
    return this.payload.star.system.planets;
  }

  getFleets(): ServerFleet[] {
    return this.payload.fleets;
  }

  getShips(): ServerShip[] {
    return this.payload.ships;
  }

  getShipDesigns(): ShipDesign[] {
    return this.payload.shipDesigns;
  }

  getStarbases(): ServerStarbaseSummary[] {
    return this.payload.starbases;
  }

  getFactions(): FactionInfo[] {
    return this.payload.factions;
  }

  getRecentCombatContacts(): ServerCombatContact[] {
    return this.payload.recentCombatContacts;
  }

  getHyperlaneExits(): SystemHyperlaneExitPoint[] {
    return this.payload.hyperlaneExits;
  }

  getTechnology(): FactionTechnologyView | null {
    return this.payload.technology;
  }

  getStarOwnerId(): number | null {
    return this.payload.starOwnerId;
  }

  getLeaders(): LeaderState[] {
    return this.payload.leaders ?? [];
  }

  getFleetById(fleetId: string): ServerFleet | null {
    return this.fleetById.get(fleetId) ?? null;
  }

  getStarbaseById(starbaseId: string): ServerStarbaseSummary | null {
    return this.starbaseById.get(starbaseId) ?? null;
  }

  getShipsForFleet(fleetId: string): ServerShip[] {
    return this.shipsByFleetId.get(fleetId) ?? [];
  }

  getFleetSystemPositions(year = this.clockYear): Record<string, SystemPosition> {
    return Object.fromEntries(
      this.payload.fleets.map((fleet) => [fleet.id, this.getFleetSystemPosition(fleet, year)]),
    );
  }

  getFleetSystemPosition(fleet: ServerFleet, year = this.clockYear): SystemPosition {
    if (fleet.orbitTarget?.kind && fleet.orbitTarget.kind !== "planet") {
      return fleet.orbitTarget.position;
    }

    if (fleet.orbitTargetPlanetId) {
      const planetIndex = this.payload.star.system.planets.findIndex((planet) => planet.id === fleet.orbitTargetPlanetId);
      const planet = planetIndex >= 0 ? this.payload.star.system.planets[planetIndex] : null;
      if (planet) {
        const nowMs = DEFAULT_ORBIT_EPOCH_MS + ((year - GAME_START_YEAR) * GAME_DAYS_PER_YEAR * REAL_MS_PER_GAME_DAY);
        const planetPosition = getPlanetSystemPosition(
          planet,
          planetIndex,
          nowMs,
          getSystemOrbitLayout(this.payload.star.type),
        );
        const offset = fleet.orbitOffset ?? { x: 3.4, y: SYSTEM_FLEET_Y, z: 0 };
        return {
          x: planetPosition.x + offset.x,
          y: offset.y,
          z: planetPosition.z + offset.z,
        };
      }
    }

    if (fleet.movementPlan) {
      const segment = fleet.movementPlan.segments.find((candidate) => (
        year >= candidate.startYear && year < candidate.endYear
      ));
      if (segment) {
        const progress = Math.max(
          0,
          Math.min(1, (year - segment.startYear) / Math.max(0.000001, segment.endYear - segment.startYear)),
        );
        return interpolateSystemPosition(segment.from, segment.to, progress);
      }
      const finalSegment = fleet.movementPlan.segments[fleet.movementPlan.segments.length - 1];
      if (finalSegment) return finalSegment.to;
    }

    return fleet.systemPosition ?? { x: 23, y: SYSTEM_FLEET_Y, z: -19 };
  }

  private rebuildIndexes(): void {
    this.fleetById = new Map(this.payload.fleets.map((fleet) => [fleet.id, fleet]));
    this.starbaseById = new Map(this.payload.starbases.map((starbase) => [starbase.id, starbase]));
    const shipsByFleetId = new Map<string, ServerShip[]>();
    for (const ship of this.payload.ships) {
      const ships = shipsByFleetId.get(ship.fleetId) ?? [];
      ships.push(ship);
      shipsByFleetId.set(ship.fleetId, ships);
    }
    this.shipsByFleetId = shipsByFleetId;
  }
}

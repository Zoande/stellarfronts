import { buildHyperlaneAdjacency } from "@/data/Hyperlanes";
import type { PlanetState } from "@/data/Economy";
import type { StarData } from "@/data/StarMap";
import type {
  GameSnapshot,
  PlanetDetailsEvent,
  ServerFleet,
  ServerShip,
  ServerUpdateField,
  SystemDetailsEvent,
} from "./GameProtocol";

export type GameSessionField = ServerUpdateField | "selection" | "view" | "details" | "darkMatter";
export type GameSessionSubscriber = (
  store: GameSessionStore,
  changed: ReadonlySet<GameSessionField>,
) => void;

interface Subscription {
  fields: ReadonlySet<GameSessionField> | null;
  subscriber: GameSessionSubscriber;
}

export class GameSessionStore {
  private snapshot: GameSnapshot | null = null;
  private fleets = new Map<string, ServerFleet>();
  private ships = new Map<string, ServerShip>();
  private planets = new Map<string, PlanetState>();
  private factions = new Map<number, GameSnapshot["factions"][number]>();
  private starbases = new Map<string, GameSnapshot["starbases"][number]>();
  private selectedFleetIds = new Set<string>();
  private fullSystemStars = new Map<number, StarData>();
  private adjacency: number[][] = [];
  private subscriptions = new Set<Subscription>();
  private currentSystemStarId: number | null = null;
  private currentView: "galaxy" | "system" = "galaxy";
  private darkMatter = 0;

  getSnapshot(): GameSnapshot | null {
    return this.snapshot;
  }

  requireSnapshot(): GameSnapshot {
    if (!this.snapshot) throw new Error("Game session has not received a snapshot.");
    return this.snapshot;
  }

  applySnapshot(snapshot: GameSnapshot, changed?: ServerUpdateField[]): void {
    this.snapshot = snapshot;
    const fields = new Set<GameSessionField>(changed ?? [
      "fleets",
      "ships",
      "planetStates",
      "starbases",
      "visibility",
    ]);
    if (!changed || fields.has("fleets")) {
      this.fleets = new Map(snapshot.fleets.map((fleet) => [fleet.id, fleet]));
      this.pruneSelection();
    }
    if (!changed || fields.has("ships")) {
      this.ships = new Map(snapshot.ships.map((ship) => [ship.id, ship]));
    }
    if (!changed || fields.has("planetStates")) {
      this.planets = new Map(snapshot.planetStates.map((planet) => [planet.id, planet]));
    }
    if (!changed || fields.has("visibility")) {
      this.factions = new Map(snapshot.factions.map((faction) => [faction.id, faction]));
    }
    if (!changed || fields.has("starbases") || fields.has("visibility")) {
      this.starbases = new Map(snapshot.starbases.map((starbase) => [starbase.id, starbase]));
    }
    if (!changed || fields.has("visibility")) {
      this.adjacency = buildHyperlaneAdjacency(snapshot.hyperlanes, snapshot.stars.length);
    }
    this.notify(fields);
  }

  materializeSystemDetails(event: SystemDetailsEvent): StarData {
    const star = {
      ...event.star,
      system: {
        ...event.star.system,
        planets: event.star.system.planets.map((planet) => ({ ...planet })),
      },
    };
    this.fullSystemStars.set(event.star.id, star);
    for (const planet of event.planetStates) this.planets.set(planet.id, planet);
    this.notify(new Set(["details"]));
    return star;
  }

  materializePlanetDetails(event: PlanetDetailsEvent): StarData | null {
    this.planets.set(event.planetState.id, event.planetState);
    const existing = this.fullSystemStars.get(event.starId);
    if (!existing) {
      this.notify(new Set(["details"]));
      return null;
    }
    const planets = existing.system.planets.map((planet) =>
      planet.id === event.planet.id ? { ...event.planet } : planet);
    const star = { ...existing, system: { ...existing.system, planets } };
    this.fullSystemStars.set(event.starId, star);
    this.notify(new Set(["details"]));
    return star;
  }

  getFleet(id: string): ServerFleet | undefined { return this.fleets.get(id); }
  getShip(id: string): ServerShip | undefined { return this.ships.get(id); }
  getPlanet(id: string): PlanetState | undefined { return this.planets.get(id); }
  getFaction(id: number): GameSnapshot["factions"][number] | undefined { return this.factions.get(id); }
  getStarbase(id: string): GameSnapshot["starbases"][number] | undefined { return this.starbases.get(id); }
  getFullSystemStar(starId: number): StarData | undefined { return this.fullSystemStars.get(starId); }
  getHyperlaneAdjacency(): readonly number[][] { return this.adjacency; }

  getSelectedFleetIds(): ReadonlySet<string> {
    return this.selectedFleetIds;
  }

  setSelectedFleetIds(fleetIds: Iterable<string>): void {
    this.selectedFleetIds = new Set(fleetIds);
    this.pruneSelection();
    this.notify(new Set(["selection"]));
  }

  setView(view: "galaxy" | "system", systemStarId: number | null = null): void {
    if (this.currentView === view && this.currentSystemStarId === systemStarId) return;
    this.currentView = view;
    this.currentSystemStarId = systemStarId;
    this.notify(new Set(["view"]));
  }

  getView(): { view: "galaxy" | "system"; systemStarId: number | null } {
    return { view: this.currentView, systemStarId: this.currentSystemStarId };
  }

  setDarkMatter(value: number): void {
    const normalized = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    if (normalized === this.darkMatter) return;
    this.darkMatter = normalized;
    this.notify(new Set(["darkMatter"]));
  }

  getDarkMatter(): number {
    return this.darkMatter;
  }

  subscribe(
    fields: Iterable<GameSessionField> | null,
    subscriber: GameSessionSubscriber,
  ): () => void {
    const subscription: Subscription = {
      fields: fields ? new Set(fields) : null,
      subscriber,
    };
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }

  private pruneSelection(): void {
    this.selectedFleetIds = new Set(
      Array.from(this.selectedFleetIds).filter((fleetId) => this.fleets.has(fleetId)),
    );
  }

  private notify(changed: ReadonlySet<GameSessionField>): void {
    for (const subscription of this.subscriptions) {
      if (
        subscription.fields
        && !Array.from(changed).some((field) => subscription.fields?.has(field))
      ) continue;
      subscription.subscriber(this, changed);
    }
  }
}

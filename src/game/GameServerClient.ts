import type {
  ClientCommand,
  GameSnapshot,
  PlanetDetailsEvent,
  ServerEvent,
  ServerUpdateField,
  SystemDetailsEvent,
} from "./GameProtocol";

type SnapshotHandler = (snapshot: GameSnapshot, changed?: ServerUpdateField[]) => void;
type MessageHandler = (message: string, ok: boolean) => void;
type PlanetDetailsHandler = (event: PlanetDetailsEvent) => void;
type PendingRequest<T> = {
  resolve: (event: T) => void;
  reject: (error: Error) => void;
};

function withClientClockSync<T extends { clock?: GameSnapshot["clock"] }>(event: T): T {
  if (!event.clock) return event;
  return {
    ...event,
    clock: {
      ...event.clock,
      syncedAtMs: Date.now(),
    },
  };
}

function getWebSocketUrl(): string {
  // Support VITE_WS_URL env var for production (set at build time by Vite)
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  return 'ws://localhost:8787';
}

export class GameServerClient {
  private socket: WebSocket | null = null;
  private latestSnapshot: GameSnapshot | null = null;
  private snapshotHandlers = new Set<SnapshotHandler>();
  private messageHandlers = new Set<MessageHandler>();
  private planetDetailsHandlers = new Set<PlanetDetailsHandler>();
  private systemDetailsRequests = new Map<number, PendingRequest<SystemDetailsEvent>>();
  private planetDetailsRequests = new Map<string, PendingRequest<PlanetDetailsEvent>>();

  constructor(private readonly url = getWebSocketUrl()) {}

  async connect(): Promise<GameSnapshot> {
    if (this.latestSnapshot) return this.latestSnapshot;

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      let resolved = false;

      socket.addEventListener("open", () => {
        this.send({ type: "join" });
      });

      socket.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data)) as ServerEvent;
        if (parsed.type === "snapshot") {
          this.latestSnapshot = withClientClockSync(parsed);
          for (const handler of this.snapshotHandlers) handler(this.latestSnapshot);
          if (!resolved) {
            resolved = true;
            resolve(this.latestSnapshot);
          }
          return;
        }

        if (parsed.type === "update") {
          if (!this.latestSnapshot) return;
          const update = withClientClockSync(parsed);
          const visibleStarIds = Object.prototype.hasOwnProperty.call(parsed, "visibleStarIds")
            ? parsed.visibleStarIds!
            : this.latestSnapshot.visibleStarIds;
          const knownStarIds = Object.prototype.hasOwnProperty.call(parsed, "knownStarIds")
            ? parsed.knownStarIds!
            : this.latestSnapshot.knownStarIds;
          this.latestSnapshot = {
            ...this.latestSnapshot,
            type: "snapshot",
            perspective: parsed.perspective,
            clock: update.clock ?? this.latestSnapshot.clock,
            stars: parsed.stars ?? this.latestSnapshot.stars,
            planetStates: parsed.planetStates ?? this.latestSnapshot.planetStates,
            factionEconomies: parsed.factionEconomies ?? this.latestSnapshot.factionEconomies,
            habitedPlanetSystemIds: parsed.habitedPlanetSystemIds ?? this.latestSnapshot.habitedPlanetSystemIds,
            hyperlanes: parsed.hyperlanes ?? this.latestSnapshot.hyperlanes,
            factions: parsed.factions ?? this.latestSnapshot.factions,
            starOwnership: parsed.starOwnership ?? this.latestSnapshot.starOwnership,
            visibleStarIds,
            knownStarIds,
            ships: parsed.ships ?? this.latestSnapshot.ships,
            shipDesigns: parsed.shipDesigns ?? this.latestSnapshot.shipDesigns,
            fleets: parsed.fleets ?? this.latestSnapshot.fleets,
            starbases: parsed.starbases ?? this.latestSnapshot.starbases,
            battles: parsed.battles ?? this.latestSnapshot.battles,
            recentCombatContacts: parsed.recentCombatContacts ?? this.latestSnapshot.recentCombatContacts,
          };
          for (const handler of this.snapshotHandlers) handler(this.latestSnapshot, parsed.changed);
          return;
        }

        if (parsed.type === "systemDetails") {
          const pending = this.systemDetailsRequests.get(parsed.star.id);
          if (pending) {
            this.systemDetailsRequests.delete(parsed.star.id);
            pending.resolve(parsed);
          }
          return;
        }

        if (parsed.type === "planetDetails") {
          const pending = this.planetDetailsRequests.get(parsed.planet.id);
          if (pending) {
            this.planetDetailsRequests.delete(parsed.planet.id);
            pending.resolve(parsed);
          }
          for (const handler of this.planetDetailsHandlers) handler(parsed);
          return;
        }

        if (parsed.type === "commandResult") {
          for (const handler of this.messageHandlers) handler(parsed.message, parsed.ok);
          if (!parsed.ok) {
            this.rejectOldestPendingRequest(new Error(parsed.message));
          }
        }
      });

      socket.addEventListener("error", () => {
        if (!resolved) reject(new Error("Could not connect to game server at ws://localhost:8787"));
      });

      socket.addEventListener("close", () => {
        if (!resolved) reject(new Error("Game server connection closed before snapshot arrived"));
      });
    });
  }

  onSnapshot(handler: SnapshotHandler): () => void {
    this.snapshotHandlers.add(handler);
    if (this.latestSnapshot) handler(this.latestSnapshot);
    return () => this.snapshotHandlers.delete(handler);
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onPlanetDetails(handler: PlanetDetailsHandler): () => void {
    this.planetDetailsHandlers.add(handler);
    return () => this.planetDetailsHandlers.delete(handler);
  }

  send(command: ClientCommand): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(command));
  }

  requestSystemDetails(starId: number): Promise<SystemDetailsEvent> {
    return this.requestDetails(this.systemDetailsRequests, starId, { type: "requestSystemDetails", starId });
  }

  requestPlanetDetails(planetId: string): Promise<PlanetDetailsEvent> {
    return this.requestDetails(this.planetDetailsRequests, planetId, { type: "requestPlanetDetails", planetId });
  }

  getSnapshot(): GameSnapshot | null {
    return this.latestSnapshot;
  }

  dispose(): void {
    this.snapshotHandlers.clear();
    this.messageHandlers.clear();
    this.planetDetailsHandlers.clear();
    this.rejectAllPendingRequests(new Error("Game server client disposed."));
    this.socket?.close();
    this.socket = null;
  }

  private requestDetails<K, T>(
    requests: Map<K, PendingRequest<T>>,
    key: K,
    command: ClientCommand,
  ): Promise<T> {
    if (requests.has(key)) {
      return new Promise((resolve, reject) => {
        const previous = requests.get(key)!;
        requests.set(key, {
          resolve: (event) => {
            previous.resolve(event);
            resolve(event);
          },
          reject: (error) => {
            previous.reject(error);
            reject(error);
          },
        });
      });
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        requests.delete(key);
        reject(new Error("Timed out waiting for server details."));
      }, 8_000);
      requests.set(key, {
        resolve: (event) => {
          window.clearTimeout(timeout);
          resolve(event);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          reject(error);
        },
      });
      this.send(command);
    });
  }

  private rejectOldestPendingRequest(error: Error): void {
    const systemEntry = this.systemDetailsRequests.entries().next();
    if (!systemEntry.done) {
      this.systemDetailsRequests.delete(systemEntry.value[0]);
      systemEntry.value[1].reject(error);
      return;
    }
    const planetEntry = this.planetDetailsRequests.entries().next();
    if (!planetEntry.done) {
      this.planetDetailsRequests.delete(planetEntry.value[0]);
      planetEntry.value[1].reject(error);
    }
  }

  private rejectAllPendingRequests(error: Error): void {
    for (const [, pending] of this.systemDetailsRequests) pending.reject(error);
    for (const [, pending] of this.planetDetailsRequests) pending.reject(error);
    this.systemDetailsRequests.clear();
    this.planetDetailsRequests.clear();
  }
}

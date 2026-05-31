import type {
  AdminCommandContext,
  AdminCommandResult,
} from "./AdminCommands";
import type {
  ClientCommand,
  GameDetailEvent,
  GameDetailPayload,
  GameDetailScope,
  GameSnapshot,
  PlanetDetailPayload,
  PlanetDetailsEvent,
  ServerEvent,
  ServerUpdateField,
  SystemDetailPayload,
  SystemDetailsEvent,
} from "./GameProtocol";

type SnapshotHandler = (snapshot: GameSnapshot, changed?: ServerUpdateField[]) => void;
type MessageHandler = (message: string, ok: boolean) => void;
type PlanetDetailsHandler = (event: PlanetDetailsEvent) => void;
type DetailHandler<T extends GameDetailPayload = GameDetailPayload> = (event: GameDetailEvent & { payload?: T }) => void;
type AdminCommandHandler = (event: AdminCommandResult) => void;
type PendingRequest<T> = {
  resolve: (event: T) => void;
  reject: (error: Error) => void;
};

interface CachedDetail {
  event: GameDetailEvent;
  payload?: GameDetailPayload;
}

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

function getWebSocketUrl(gameId?: string): string {
  // Support VITE_WS_URL env var for production (set at build time by Vite)
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_URL) {
    return appendGameId(import.meta.env.VITE_WS_URL, gameId);
  }
  return appendGameId('ws://localhost:8787', gameId);
}

function appendGameId(baseUrl: string, gameId?: string): string {
  if (!gameId) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set("gameId", gameId);
  return url.toString();
}

function createDetailKey(scope: GameDetailScope, id?: string | number | null): string {
  return `${scope}:${id ?? ""}`;
}

export class GameServerClient {
  private socket: WebSocket | null = null;
  private latestSnapshot: GameSnapshot | null = null;
  private snapshotHandlers = new Set<SnapshotHandler>();
  private messageHandlers = new Set<MessageHandler>();
  private planetDetailsHandlers = new Set<PlanetDetailsHandler>();
  private detailHandlers = new Map<string, Set<DetailHandler>>();
  private adminCommandHandlers = new Set<AdminCommandHandler>();
  private systemDetailsRequests = new Map<number, PendingRequest<SystemDetailsEvent>>();
  private planetDetailsRequests = new Map<string, PendingRequest<PlanetDetailsEvent>>();
  private detailRequests = new Map<string, PendingRequest<GameDetailEvent>>();
  private detailCache = new Map<string, CachedDetail>();
  private adminCommandRequests = new Map<string, PendingRequest<AdminCommandResult>>();

  constructor(gameId?: string, private readonly url = getWebSocketUrl(gameId)) {}

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
            technologies: parsed.technologies ?? this.latestSnapshot.technologies,
            leaders: parsed.leaders ?? this.latestSnapshot.leaders,
            governments: parsed.governments ?? this.latestSnapshot.governments,
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

        if (parsed.type === "detail") {
          const key = createDetailKey(parsed.scope, parsed.id);
          const cached = this.detailCache.get(key);
          const event: GameDetailEvent = parsed.status === "notModified" && cached
            ? { ...parsed, payload: cached.payload }
            : parsed;
          if (event.status === "full" && event.payload) {
            this.detailCache.set(key, { event, payload: event.payload });
          } else if (event.status === "notModified" && cached) {
            this.detailCache.set(key, { event, payload: cached.payload });
          }

          const pending = this.detailRequests.get(key);
          if (pending) {
            this.detailRequests.delete(key);
            pending.resolve(event);
          }
          for (const handler of this.detailHandlers.get(key) ?? []) handler(event);
          return;
        }

        if (parsed.type === "commandResult") {
          for (const handler of this.messageHandlers) handler(parsed.message, parsed.ok);
          if (!parsed.ok) {
            this.rejectOldestPendingRequest(new Error(parsed.message));
          }
          return;
        }

        if (parsed.type === "adminCommandResult") {
          if (parsed.requestId) {
            const pending = this.adminCommandRequests.get(parsed.requestId);
            if (pending) {
              this.adminCommandRequests.delete(parsed.requestId);
              pending.resolve(parsed);
            }
          }
          for (const handler of this.adminCommandHandlers) handler(parsed);
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

  onAdminCommand(handler: AdminCommandHandler): () => void {
    this.adminCommandHandlers.add(handler);
    return () => this.adminCommandHandlers.delete(handler);
  }

  send(command: ClientCommand): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(command));
  }

  requestSystemDetails(starId: number): Promise<SystemDetailsEvent> {
    const cached = this.getCachedDetail<SystemDetailPayload>("system", starId);
    return this.requestDetail<SystemDetailPayload>("system", starId).then((event) => {
      const payload = event.payload ?? cached;
      if (!payload || !("star" in payload)) throw new Error("System details are unavailable.");
      return { type: "systemDetails", star: payload.star, planetStates: payload.planetStates };
    });
  }

  requestPlanetDetails(planetId: string): Promise<PlanetDetailsEvent> {
    const cached = this.getCachedDetail<PlanetDetailPayload>("planet", planetId);
    return this.requestDetail<PlanetDetailPayload>("planet", planetId).then((event) => {
      const payload = event.payload ?? cached;
      if (!payload || !("planetState" in payload)) throw new Error("Planet details are unavailable.");
      return {
        type: "planetDetails",
        starId: payload.starId,
        planet: payload.planet,
        planetState: payload.planetState,
      };
    });
  }

  requestDetail<T extends GameDetailPayload>(
    scope: GameDetailScope,
    id?: string | number | null,
  ): Promise<GameDetailEvent & { payload?: T }> {
    const key = createDetailKey(scope, id);
    const cached = this.detailCache.get(key);
    return this.requestDetails(this.detailRequests, key, {
      type: "requestDetails",
      scope,
      id,
      knownRevision: cached?.event.revision ?? null,
    }).then((event) => event as GameDetailEvent & { payload?: T });
  }

  subscribeDetail<T extends GameDetailPayload>(
    scope: GameDetailScope,
    id: string | number | null | undefined,
    handler: DetailHandler<T>,
  ): () => void {
    const normalizedId = id ?? null;
    const key = createDetailKey(scope, normalizedId);
    const handlers = this.detailHandlers.get(key) ?? new Set<DetailHandler>();
    handlers.add(handler as DetailHandler);
    this.detailHandlers.set(key, handlers);

    const cached = this.detailCache.get(key);
    if (cached) {
      window.setTimeout(() => handler(cached.event as GameDetailEvent & { payload?: T }), 0);
    }
    this.send({
      type: "subscribeDetails",
      scope,
      id: normalizedId,
      knownRevision: cached?.event.revision ?? null,
    });

    return () => {
      const current = this.detailHandlers.get(key);
      current?.delete(handler as DetailHandler);
      if (current && current.size === 0) {
        this.detailHandlers.delete(key);
        this.send({ type: "unsubscribeDetails", scope, id: normalizedId });
      }
    };
  }

  getCachedDetail<T extends GameDetailPayload>(scope: GameDetailScope, id?: string | number | null): T | null {
    return (this.detailCache.get(createDetailKey(scope, id))?.payload as T | undefined) ?? null;
  }

  getSnapshot(): GameSnapshot | null {
    return this.latestSnapshot;
  }

  executeAdminCommand(input: string, context?: AdminCommandContext): Promise<AdminCommandResult> {
    const requestId = `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return this.requestDetails(this.adminCommandRequests, requestId, {
      type: "adminCommand",
      input,
      context,
      requestId,
    });
  }

  dispose(): void {
    this.snapshotHandlers.clear();
    this.messageHandlers.clear();
    this.planetDetailsHandlers.clear();
    this.detailHandlers.clear();
    this.adminCommandHandlers.clear();
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
      return;
    }
    const adminEntry = this.adminCommandRequests.entries().next();
    if (!adminEntry.done) {
      this.adminCommandRequests.delete(adminEntry.value[0]);
      adminEntry.value[1].reject(error);
      return;
    }
    const detailEntry = this.detailRequests.entries().next();
    if (!detailEntry.done) {
      this.detailRequests.delete(detailEntry.value[0]);
      detailEntry.value[1].reject(error);
    }
  }

  private rejectAllPendingRequests(error: Error): void {
    for (const [, pending] of this.systemDetailsRequests) pending.reject(error);
    for (const [, pending] of this.planetDetailsRequests) pending.reject(error);
    for (const [, pending] of this.detailRequests) pending.reject(error);
    for (const [, pending] of this.adminCommandRequests) pending.reject(error);
    this.systemDetailsRequests.clear();
    this.planetDetailsRequests.clear();
    this.detailRequests.clear();
    this.adminCommandRequests.clear();
  }
}

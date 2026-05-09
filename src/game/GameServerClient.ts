import type { GalaxyPerspective } from "../data/Factions";
import type { ClientCommand, GameSnapshot, ServerEvent } from "./GameProtocol";

type SnapshotHandler = (snapshot: GameSnapshot) => void;
type MessageHandler = (message: string, ok: boolean) => void;

function perspectivesMatch(a: GameSnapshot["perspective"], b: GameSnapshot["perspective"]): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "observer" && b.mode === "observer") return true;
  return a.mode === "faction" && b.mode === "faction" && a.factionId === b.factionId;
}

export class GameServerClient {
  private socket: WebSocket | null = null;
  private latestSnapshot: GameSnapshot | null = null;
  private snapshotHandlers = new Set<SnapshotHandler>();
  private messageHandlers = new Set<MessageHandler>();

  constructor(
    private readonly perspective: GalaxyPerspective,
    private readonly url = "ws://localhost:8787",
  ) {}

  async connect(): Promise<GameSnapshot> {
    if (this.latestSnapshot) return this.latestSnapshot;

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      let resolved = false;

      socket.addEventListener("open", () => {
        this.send({ type: "join", perspective: this.perspective });
      });

      socket.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data)) as ServerEvent;
        if (parsed.type === "snapshot") {
          this.latestSnapshot = parsed;
          for (const handler of this.snapshotHandlers) handler(parsed);
          if (!resolved && perspectivesMatch(parsed.perspective, this.perspective)) {
            resolved = true;
            resolve(parsed);
          }
          return;
        }

        if (parsed.type === "update") {
          if (!this.latestSnapshot) return;
          this.latestSnapshot = {
            ...this.latestSnapshot,
            type: "snapshot",
            perspective: parsed.perspective,
            clock: parsed.clock,
            planetStates: parsed.planetStates,
            factionEconomies: parsed.factionEconomies,
            hyperlanes: parsed.hyperlanes,
            factions: parsed.factions,
            starOwnership: parsed.starOwnership,
            visibleStarIds: parsed.visibleStarIds,
            knownStarIds: parsed.knownStarIds,
            ships: parsed.ships,
            starbases: parsed.starbases,
          };
          for (const handler of this.snapshotHandlers) handler(this.latestSnapshot);
          return;
        }

        if (parsed.type === "commandResult") {
          for (const handler of this.messageHandlers) handler(parsed.message, parsed.ok);
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

  send(command: ClientCommand): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(command));
  }

  getSnapshot(): GameSnapshot | null {
    return this.latestSnapshot;
  }

  dispose(): void {
    this.snapshotHandlers.clear();
    this.messageHandlers.clear();
    this.socket?.close();
    this.socket = null;
  }
}

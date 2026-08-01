import { getPlayerProfile } from "@/auth/client";
import type { PlayerProfile } from "@/auth/types";
import type { ClientCommand, CommandResultEvent, GameSnapshot } from "./GameProtocol";
import { GameServerClient } from "./GameServerClient";
import { GameSessionStore } from "./GameSessionStore";

export interface ConnectedGameSession {
  snapshot: GameSnapshot;
  darkMatter: number;
}

export class GameSessionController {
  readonly client: GameServerClient;
  readonly store = new GameSessionStore();
  private releases: Array<() => void> = [];
  private connectPromise: Promise<ConnectedGameSession> | null = null;
  private disposed = false;

  constructor(gameId?: string, client = new GameServerClient(gameId)) {
    this.client = client;
    this.releases.push(
      client.onSnapshot((snapshot, changed) => this.store.applySnapshot(snapshot, changed)),
      client.onPlanetDetails((event) => this.store.materializePlanetDetails(event)),
      client.onAccountResources((darkMatter) => this.store.setDarkMatter(darkMatter)),
    );
  }

  connect(): Promise<ConnectedGameSession> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = (async () => {
      const profilePromise = this.refreshProfile().catch(() => null);
      const snapshot = await this.client.connect();
      this.store.applySnapshot(snapshot);
      const profile = await profilePromise;
      return {
        snapshot,
        darkMatter: profile?.darkMatter ?? this.store.getDarkMatter(),
      };
    })();
    return this.connectPromise;
  }

  async refreshProfile(): Promise<PlayerProfile> {
    const profile = await getPlayerProfile();
    this.store.setDarkMatter(profile.darkMatter);
    return profile;
  }

  send(command: ClientCommand): void {
    this.client.send(command);
  }

  executeCommand(command: ClientCommand): Promise<CommandResultEvent> {
    return this.client.executeCommand(command);
  }

  onDisconnect(handler: () => void): () => void {
    return this.client.onDisconnect(handler);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.releases.splice(0).reverse()) release();
    this.client.dispose();
  }
}

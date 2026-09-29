import type { ClientCommand } from "../../src/game/GameProtocol";
import type { GalaxyPerspective } from "../../src/data/Factions";
import type { CommandOutcome } from "./mutation-coordinator";

export type GameAction = Exclude<ClientCommand, { type: "join" | "adminCommand" | "requestDetails" | "subscribeDetails" | "unsubscribeDetails" | "setSpeedMultiplier" }>;
export type GameActor =
  | Readonly<{ kind: "human"; accountId: number; factionId: number }>
  | Readonly<{ kind: "ai"; controllerId: string; factionId: number }>
  | Readonly<{ kind: "observer" }>;

/** These identities are issued inside a game runtime, never decoded from clients. */
export interface CommandReply { outcome?: CommandOutcome }
export interface ActionSession { actor: GameActor; perspective: GalaxyPerspective; reply: CommandReply }
export function accept(reply: CommandReply, message: string): void {
  reply.outcome = { ok: true, message, effects: {} };
}
export function reject(reply: CommandReply, message: string): void {
  reply.outcome = { ok: false, message };
}

export const ADAPTER_COMMANDS = new Set<ClientCommand["type"]>([
  "join", "adminCommand", "requestDetails", "subscribeDetails", "unsubscribeDetails", "setSpeedMultiplier",
]);

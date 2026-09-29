import { createHash } from "node:crypto";
import { createGameCore } from "../game-runtime";
import type { GameRuntimeAuthPort, StoredGame } from "../auth-store";
import type { GameState } from "./types";
import type { GameActor } from "./actions";
import { createAiObservation } from "./ai-observation";
import { restoreState } from "./state-bootstrap";


export interface MemoryAccounts {
  owners: Record<number, number>;
  balances: Record<number, number>;
}
export function createMemoryAuth(accounts: MemoryAccounts = { owners: {}, balances: {} }): GameRuntimeAuthPort {
  return {
    getAccountIdForGameFaction: (_gameId, factionId) => accounts.owners[factionId] ?? null,
    getPlayerDarkMatter: (accountId) => accounts.balances[accountId] ?? 0,
    spendPlayerDarkMatter: (accountId, amount) => {
      const balance = accounts.balances[accountId] ?? 0;
      if (!Number.isFinite(amount) || amount < 0 || balance < amount) return null;
      return accounts.balances[accountId] = balance - amount;
    },
    isAdminAccount: () => false,
    listGameMemberships: () => [],
    recordGameEnter: () => undefined,
    recordGameStateVersions: () => undefined,
  };
}

export interface GameCheckpoint {
  formatVersion: 1;
  game: StoredGame;
  nowMs: number;
  accounts: MemoryAccounts;
  state: GameState;
}
export interface HeadlessGameOptions {
  worldSeed?: number;
  initialWorld?: { starCount: number; factionCount: number };
  simulationSeed?: number;
  epochMs?: number;
  stepMs?: number;
  checkpoint?: GameCheckpoint;
  accounts?: MemoryAccounts;
}

/** Full authoritative serialization digest. JSON checkpoints preserve property order. */
export function stateDigest(state: GameState): string {
  const { codeVersion: _code, protocolVersion: _protocol, ...gameplay } = state as GameState & { codeVersion?: string; protocolVersion?: number };
  return createHash("sha256").update(JSON.stringify(gameplay)).digest("hex");
}

export function createHeadlessGame(options: HeadlessGameOptions = {}) {
  for (const seed of [options.worldSeed, options.simulationSeed]) {
    if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) throw new Error("Laboratory seeds must be uint32 values.");
  }
  if (options.checkpoint && options.checkpoint.formatVersion !== 1) throw new Error("Unsupported checkpoint format.");
  if (options.initialWorld && (!Number.isSafeInteger(options.initialWorld.starCount) || options.initialWorld.starCount < 2 || !Number.isSafeInteger(options.initialWorld.factionCount) || options.initialWorld.factionCount < 2 || options.initialWorld.factionCount > options.initialWorld.starCount)) throw new Error("Invalid laboratory world dimensions.");
  const stepMs = options.stepMs ?? 100;
  if (!Number.isSafeInteger(stepMs) || stepMs <= 0) throw new Error("Step duration must be positive and finite.");
  let nowMs = options.checkpoint?.nowMs ?? options.epochMs ?? 1_700_000_000_000;
  if (!Number.isSafeInteger(nowMs)) throw new Error("Invalid laboratory clock.");
  const game: StoredGame = options.checkpoint?.game ?? {
    id: "laboratory", name: "AI laboratory", seed: options.worldSeed ?? 42, countryCapacity: 15,
    createdAt: nowMs, versionId: "dev", status: "active", schemaVersion: 30, protocolVersion: 11,
  };
  const accounts = structuredClone(options.checkpoint?.accounts ?? options.accounts ?? { owners: {}, balances: {} });
  const core = createGameCore(game, createMemoryAuth(accounts), {
    now: () => nowMs, simulationSeed: options.simulationSeed ?? 42, initialWorld: options.initialWorld,
    initialState: options.checkpoint ? structuredClone(options.checkpoint.state) : undefined,
  });
  // New worlds are canonicalized too, so restoring a checkpoint is idempotent.
  core.context.state = restoreState(core.context, structuredClone(core.context.state));
  return {
    createAiActor: core.createAiActor,
    createHumanActor: core.createHumanActor,
    createObserverActor: core.createObserverActor,
    act: (actor: GameActor, action: unknown) => core.executeGameCommand(actor, action),
    observe: (factionId: number) => createAiObservation(core.context, factionId),
    /** Pass this restricted interface to a controller; retain checkpoints in the laboratory. */
    controllerAccess: (factionId: number, controllerId = "scripted") => {
      const actor = core.createAiActor(factionId, controllerId);
      return Object.freeze({
        observe: () => createAiObservation(core.context, factionId),
        executeGameCommand: (action: unknown) => core.executeGameCommand(actor, action),
      });
    },
    now: () => nowMs,
    step: (elapsedMs = stepMs) => {
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || !Number.isSafeInteger(nowMs + elapsedMs)) throw new Error("Elapsed duration must be nonnegative and finite.");
      const target = nowMs + elapsedMs;
      while (nowMs < target) {
        nowMs = Math.min(target, nowMs + stepMs);
        core.context.advanceState(nowMs);
      }
    },
    digest: () => stateDigest(core.context.state),
    exportCheckpoint: (): GameCheckpoint => structuredClone({ formatVersion: 1, game, nowMs, accounts, state: core.context.state }),
  };
}
export type HeadlessGame = ReturnType<typeof createHeadlessGame>;

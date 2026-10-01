import { createHash } from "node:crypto";
import { createGameCore } from "../game-runtime";
import type { GameRuntimeAuthPort, StoredGame } from "../auth-store";
import type { GameState } from "./types";
import type { GameActor } from "./actions";
import type { GameAction } from "./actions";
import type { CommandOutcome } from "./mutation-coordinator";
import { createAiObservation } from "./ai-observation";
import { restoreState } from "./state-bootstrap";
import { CURRENT_PROTOCOL_VERSION } from "../versionManifest";


export interface MemoryAccounts {
  owners: Record<number, number>;
  balances: Record<number, number>;
  activities?: Record<number, number>;
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
    listGameMemberships: (gameId) => Object.entries(accounts.owners).map(([factionId, accountId]) => ({
      gameId, accountId, factionId: Number(factionId), countryName: `Faction ${factionId}`,
      flagDesign: null, speciesSetup: null, joinedAt: accounts.activities?.[Number(factionId)] ?? 0,
      lastActivityAt: accounts.activities?.[Number(factionId)] ?? 0,
    })),
    recordGameActivity: (_gameId, accountId, atMs) => {
      const faction = Object.entries(accounts.owners).find(([, owner]) => owner === accountId);
      if (!faction || !Number.isSafeInteger(atMs)) return false;
      const id = Number(faction[0]);
      accounts.activities ??= {};
      if ((accounts.activities[id] ?? 0) >= atMs) return false;
      accounts.activities[id] = atMs;
      return true;
    },
    recordGameEnter: () => undefined,
    recordGameStateVersions: () => undefined,
  };
}

export interface GameCheckpoint {
  formatVersion: 1;
  game: StoredGame;
  nowMs: number;
  realNowMs?: number;
  enablePassiveAi?: boolean;
  accounts: MemoryAccounts;
  state: GameState;
}
export interface HeadlessGameOptions {
  worldSeed?: number;
  initialWorld?: { starCount: number; factionCount: number };
  simulationSeed?: number;
  epochMs?: number;
  realEpochMs?: number;
  stepMs?: number;
  checkpoint?: GameCheckpoint;
  accounts?: MemoryAccounts;
  onCaretakerAction?: (record: { factionId: number; action: GameAction; outcome: CommandOutcome }) => void;
  onAiAction?: (record: { factionId: number; mode: "caretaker" | "passive"; action: GameAction; outcome: CommandOutcome }) => void;
  /** Scripted laboratory fixtures opt in; production enables passive by default. */
  enablePassiveAi?: boolean;
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
  let realNowMs = options.checkpoint?.realNowMs ?? options.realEpochMs ?? nowMs;
  if (!Number.isSafeInteger(nowMs)) throw new Error("Invalid laboratory clock.");
  const game: StoredGame = options.checkpoint?.game ?? {
    id: "laboratory", name: "AI laboratory", seed: options.worldSeed ?? 42, countryCapacity: 15,
    createdAt: nowMs, versionId: "dev", status: "active", schemaVersion: 30, protocolVersion: CURRENT_PROTOCOL_VERSION,
  };
  const accounts = structuredClone(options.checkpoint?.accounts ?? options.accounts ?? { owners: {}, balances: {} });
  accounts.activities ??= {};
  for (const factionId of Object.keys(accounts.owners)) accounts.activities[Number(factionId)] ??= realNowMs;
  const core = createGameCore(game, createMemoryAuth(accounts), {
    now: () => nowMs, realNow: () => realNowMs, simulationSeed: options.simulationSeed ?? 42, initialWorld: options.initialWorld,
    initialState: options.checkpoint ? structuredClone(options.checkpoint.state) : undefined,
    enablePassiveAi: options.enablePassiveAi ?? options.checkpoint?.enablePassiveAi ?? false,
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
    realNow: () => realNowMs,
    advanceRealTime: (elapsedMs: number) => {
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || !Number.isSafeInteger(realNowMs + elapsedMs)) throw new Error("Invalid real-time advance.");
      realNowMs += elapsedMs;
      for (const record of core.processAiControllers()) {
        options.onAiAction?.(record);
        if (record.mode === "caretaker") options.onCaretakerAction?.(record);
      }
    },
    recordPlayerActivity: (accountId: number, factionId: number) => core.recordPlayerActivity(accountId, factionId),
    step: (elapsedMs = stepMs) => {
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || !Number.isSafeInteger(nowMs + elapsedMs)) throw new Error("Elapsed duration must be nonnegative and finite.");
      const target = nowMs + elapsedMs;
      while (nowMs < target) {
        nowMs = Math.min(target, nowMs + stepMs);
        core.context.advanceState(nowMs);
        for (const record of core.processAiControllers()) {
          options.onAiAction?.(record);
          if (record.mode === "caretaker") options.onCaretakerAction?.(record);
        }
      }
    },
    digest: () => stateDigest(core.context.state),
    /** Laboratory orchestration only. Never hand this full-state view to a decision callback. */
    diagnosticState: (): Readonly<GameState> => core.context.state,
    exportCheckpoint: (): GameCheckpoint => structuredClone({ formatVersion: 1, game, nowMs, realNowMs, accounts,
      enablePassiveAi: options.enablePassiveAi ?? options.checkpoint?.enablePassiveAi ?? false, state: core.context.state }),
  };
}
export type HeadlessGame = ReturnType<typeof createHeadlessGame>;

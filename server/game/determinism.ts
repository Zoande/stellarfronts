import { randomBytes } from "node:crypto";
import type { RuntimeContext } from "./types";

export type RandomStream = "combat" | "leaders" | "events";
export interface DeterministicState {
  version: 1;
  streams: Record<RandomStream, number>;
  idCounter: number;
}

/** The same LCG previously used by the combat laboratory, with explicit state. */
export function createSeededRandom(seed: number): (() => number) & { state: () => number; restore: (state: number) => void } {
  let state = seed >>> 0;
  return Object.assign(() => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  }, { state: () => state, restore: (value: number) => { state = value >>> 0; } });
}

export function createDeterministicState(seed = randomBytes(4).readUInt32LE()): DeterministicState {
  return { version: 1, streams: { combat: seed >>> 0, leaders: (seed ^ 0x9e3779b9) >>> 0, events: (seed ^ 0x85ebca6b) >>> 0 }, idCounter: 0 };
}

export function normalizeDeterministicState(value: unknown, seed?: number): DeterministicState {
  if (value === undefined) return createDeterministicState(seed);
  const state = value as DeterministicState;
  if (!state || state.version !== 1 || !state.streams ||
    ![state.streams.combat, state.streams.leaders, state.streams.events].every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff) ||
    !Number.isSafeInteger(state.idCounter) || state.idCounter < 0) throw new Error("Invalid deterministic simulation state.");
  return state;
}

/** Reserve deterministic IDs already present when upgrading a legacy checkpoint. */
export function recoverRuntimeIdCounter(value: unknown): number {
  let maximum = 0;
  function visit(item: unknown): void {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (key === "id" && typeof child === "string") {
        const match = /-sim1-([0-9a-z]+)$/.exec(child);
        if (match) {
          const counter = Number.parseInt(match[1], 36);
          if (Number.isSafeInteger(counter)) maximum = Math.max(maximum, counter);
        }
      } else if (child && typeof child === "object") visit(child);
    }
  }
  visit(value);
  return maximum;
}

export function random(ctx: RuntimeContext, stream: RandomStream): number {
  const state = ctx.state.determinism ??= createDeterministicState(ctx.services?.simulationSeed);
  state.streams[stream] = (Math.imul(state.streams[stream], 1664525) + 1013904223) >>> 0;
  ctx.hasDirtyState = true;
  return state.streams[stream] / 0x1_0000_0000;
}

export function nextRuntimeId(ctx: RuntimeContext, prefix: string, parts: Array<string | number | undefined> = []): string {
  const state = ctx.state.determinism ??= createDeterministicState(ctx.services?.simulationSeed);
  if (state.idCounter >= Number.MAX_SAFE_INTEGER) throw new Error("Runtime ID sequence exhausted.");
  state.idCounter++;
  ctx.hasDirtyState = true;
  return `${prefix}-${parts.filter((part) => part !== undefined && part !== "").join("-")}-sim1-${state.idCounter.toString(36)}`;
}

import { VERSION_MANIFEST, canMigrateFromSchema } from "../versionManifest";
import type { GameState } from "./types";

export class GameStateLoadError extends Error {
  constructor(
    public readonly gameId: string,
    public readonly statePath: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GameStateLoadError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray(record: Record<string, unknown>, field: string): void {
  if (!Array.isArray(record[field])) {
    throw new Error(`Save is missing required array "${field}".`);
  }
}

/**
 * Validate only the durable envelope here. Domain normalizers validate and
 * backfill individual entities after the schema migration pipeline completes.
 */
export function validateGameStateEnvelope(value: unknown): asserts value is GameState {
  if (!isRecord(value)) throw new Error("Save root must be an object.");
  const schemaVersion = Number(value.schemaVersion);
  if (!Number.isInteger(schemaVersion)) throw new Error("Save has no valid schemaVersion.");
  for (const field of ["stars", "planetStates", "factions", "hyperlanes", "starbases", "ships"]) {
    requireArray(value, field);
  }
  if (!isRecord(value.clock) || !Number.isFinite(Number(value.clock.year))) {
    throw new Error("Save has no valid game clock.");
  }
}

type MutableGameStateEnvelope = Record<string, unknown> & { schemaVersion: number };
type Migration = (state: MutableGameStateEnvelope) => MutableGameStateEnvelope;

// Explicit steps make supported migration paths auditable and prevent a future
// schema bump from silently relying on one large opportunistic normalizer.
const MIGRATIONS = new Map<number, Migration>([
  [23, (state) => ({ ...state, schemaVersion: 24 })],
  [24, (state) => ({ ...state, schemaVersion: 25 })],
  [25, (state) => ({ ...state, schemaVersion: 26 })],
  [26, (state) => ({ ...state, schemaVersion: 27 })],
]);

export function migrateGameStateEnvelope(input: unknown): { state: GameState; originalSchema: number } {
  validateGameStateEnvelope(input);
  const originalSchema = Number(input.schemaVersion);
  if (!canMigrateFromSchema(VERSION_MANIFEST, originalSchema)) {
    throw new Error(
      `Schema ${originalSchema} is not supported by version ${VERSION_MANIFEST.versionId}; `
      + `accepted schemas: ${VERSION_MANIFEST.migratesFromSchema.join(", ")}.`,
    );
  }

  let current = structuredClone(input) as unknown as MutableGameStateEnvelope;
  while (current.schemaVersion !== VERSION_MANIFEST.schemaVersion) {
    const migration = MIGRATIONS.get(current.schemaVersion);
    if (!migration) {
      throw new Error(`No migration step exists from schema ${current.schemaVersion}.`);
    }
    current = migration(current);
  }
  validateGameStateEnvelope(current);
  return { state: current, originalSchema };
}

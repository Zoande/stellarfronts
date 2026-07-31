/**
 * Identity of THIS build of the game server, committed alongside the code so
 * that every git-worktree "version" reports its own protocol/schema and which
 * prior state schemas it can load. The orchestrator reads this (via
 * `--print-version`) to gate updates; the running server stamps it into saves.
 *
 * `versionId` is the deployment label (the git tag the orchestrator assigned,
 * or "dev" for the working tree); the schema/protocol numbers are the code's
 * committed identity.
 */

// Bump these in lockstep with GameState.schemaVersion and the snapshot protocol.
export const CURRENT_SCHEMA_VERSION = 27;
export const CURRENT_PROTOCOL_VERSION = 7;

export interface VersionManifest {
  versionId: string;
  protocolVersion: number;
  schemaVersion: number;
  /** Prior state schemaVersions this build can load/migrate from. */
  migratesFromSchema: number[];
}

export const VERSION_MANIFEST: VersionManifest = {
  versionId: process.env.SF_VERSION_ID ?? "dev",
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  // Intelligence v3 deliberately starts new games; legacy saves are not migrated.
  migratesFromSchema: [23, 24, 25, 26, CURRENT_SCHEMA_VERSION],
};

export function canMigrateFromSchema(manifest: VersionManifest, fromSchema: number): boolean {
  return manifest.migratesFromSchema.includes(fromSchema);
}

import path from "node:path";

const GAME_ID_PATTERN = /^[a-z0-9]+$/i;

/**
 * The single shared state directory holding the catalog DB (auth.sqlite) and all
 * per-game state. Every per-version subprocess runs with its own cwd (its git
 * worktree under versions/<id>), so paths MUST NOT be derived from process.cwd()
 * — that would give each version its own empty catalog and game state. The
 * orchestrator pins this to its own absolute server/state via SF_STATE_DIR when
 * spawning version processes; the working-tree/dev case falls back to cwd.
 */
export const STATE_ROOT = process.env.SF_STATE_DIR
  ? path.resolve(process.env.SF_STATE_DIR)
  : path.join(process.cwd(), "server", "state");

export const GAME_STATE_ROOT = path.join(STATE_ROOT, "games");

function assertGameId(gameId: string): string {
  if (!GAME_ID_PATTERN.test(gameId)) {
    throw new Error("Invalid game id.");
  }
  return gameId;
}

export function getGameStateDirectory(gameId: string): string {
  return path.join(GAME_STATE_ROOT, assertGameId(gameId));
}

export function getGameStatePath(gameId: string): string {
  return path.join(getGameStateDirectory(gameId), "game-state.json");
}

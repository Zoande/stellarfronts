import path from "node:path";

const GAME_ID_PATTERN = /^[a-z0-9]+$/i;

export const GAME_STATE_ROOT = path.join(process.cwd(), "server", "state", "games");

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

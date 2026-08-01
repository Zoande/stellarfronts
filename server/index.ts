import { AuthStore } from "./auth-store";
import { createGameRuntime } from "./game-runtime";
import { initServer } from "./game/server-bootstrap";
import { VERSION_MANIFEST } from "./versionManifest";

// Probe mode must not open SQLite or start any runtime infrastructure.
if (process.argv.includes("--print-version")) {
  process.stdout.write(`${JSON.stringify(VERSION_MANIFEST)}\n`);
  process.exit(0);
}

const authStore = new AuthStore();

try {
  await initServer(
    (game) => createGameRuntime(game, authStore),
    authStore,
  );
} catch (error) {
  authStore.close();
  console.error("[GameServer] Failed to start.", error);
  process.exitCode = 1;
}

import { CleanupRegistry } from "./CleanupRegistry";
import { GameSessionController } from "./GameSessionController";
import { startGameUi } from "./GameUiCoordinator";

export interface BootOptions {
  adminCommandsEnabled?: boolean;
  gameId?: string;
  onProgress?: (progress: number, detail: string) => void;
  onConnectionLost?: () => void;
}

export async function boot(
  container: HTMLDivElement,
  options: BootOptions = {},
): Promise<() => void> {
  if (!container.querySelector("#renderCanvas")) {
    throw new Error("Canvas not found in container");
  }

  const cleanup = new CleanupRegistry();
  try {
    const controller = new GameSessionController(options.gameId);
    cleanup.add(() => controller.dispose());
    cleanup.add(controller.onDisconnect(() => options.onConnectionLost?.()));

    await startGameUi(container, options, controller, cleanup);
    return () => cleanup.dispose();
  } catch (error) {
    cleanup.dispose();
    throw error;
  }
}

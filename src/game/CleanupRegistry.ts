export type CleanupTask = () => void;

/** Idempotent LIFO cleanup for partially-created client sessions. */
export class CleanupRegistry {
  private tasks: CleanupTask[] = [];
  private disposed = false;

  add(task: CleanupTask): CleanupTask {
    if (this.disposed) {
      task();
      return task;
    }
    this.tasks.push(task);
    return task;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let index = this.tasks.length - 1; index >= 0; index -= 1) {
      try {
        this.tasks[index]();
      } catch (error) {
        console.error("[GameClient] Cleanup failed.", error);
      }
    }
    this.tasks = [];
  }
}

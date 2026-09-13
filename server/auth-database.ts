import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initializeAuthSchema } from "./auth-schema";

export type AuthDatabaseConnection = InstanceType<typeof Database>;

/** Owns the shared SQLite connection and its cross-process safety settings. */
export class AuthDatabase {
  readonly connection: AuthDatabaseConnection;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.connection = new Database(dbPath);
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("busy_timeout = 5000");
  }

  close(): void {
    if (this.connection.open) this.connection.close();
  }

  initializeControlPlaneSchema(): void {
    initializeAuthSchema(this.connection);
  }
}

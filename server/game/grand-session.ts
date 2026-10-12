import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { GrandOptions } from "./grand-simulation";

function save(filename: string, value: unknown) {
  writeFileSync(filename + ".tmp", JSON.stringify(value, null, 2)); renameSync(filename + ".tmp", filename);
}
function diskBytes(directory: string): number {
  return readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const file = path.join(directory, entry.name);
    return sum + (entry.isDirectory() ? diskBytes(file) : entry.isFile() ? statSync(file).size : 0);
  }, 0);
}
interface Session {
  formatVersion: number; startedAtUTC: string; deadlineUTC: string; options: GrandOptions;
  segment: number; checkpoint?: string; completed?: boolean; stopReason?: string;
}
/** PM2 restarts this same session. Each attempt keeps its own immutable logs. */
export function openGrandSession(directory: string, requested: GrandOptions, now = Date.now()) {
  directory = path.resolve(directory); mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, "session.lock"), token = randomUUID();
  if (existsSync(lock)) {
    const owner = JSON.parse(readFileSync(lock, "utf8"));
    if (owner.host !== hostname()) throw new Error("Session locked on a different host; verify it is stopped before removing session.lock.");
    try { process.kill(owner.pid, 0); throw new Error("Session is already running."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    unlinkSync(lock);
  }
  const fd = openSync(lock, "wx");
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), token })); } finally { closeSync(fd); }
  const release = () => { if (JSON.parse(readFileSync(lock, "utf8")).token === token) unlinkSync(lock); };
  try {
    const filename = path.join(directory, "session.json");
    const session: Session = existsSync(filename) ? JSON.parse(readFileSync(filename, "utf8")) : {
      formatVersion: 1, startedAtUTC: new Date(now).toISOString(), deadlineUTC: new Date(now + requested.hours * 3600_000).toISOString(),
      options: requested, segment: 0,
    };
    const remainingHours = (Date.parse(session.deadlineUTC) - now) / 3600_000;
    const remainingGB = session.options.maxDataGB - diskBytes(directory) / 1e9;
    if (session.completed || remainingHours <= 0 || remainingGB <= 0.01) {
      session.completed = true; session.stopReason ??= remainingHours <= 0 ? "wall-time" : "data-limit";
      save(filename, session); release(); return undefined;
    }
    session.segment++;
    const output = path.join(directory, `segment-${String(session.segment).padStart(5, "0")}`);
    // A crash between checkpoint rename and session-pointer update must still recover it.
    let checkpoint = session.checkpoint ?? session.options.checkpoint;
    for (const entry of readdirSync(directory).filter(name => /^segment-\d+$/.test(name)).sort()) {
      const pointer = path.join(directory, entry, "latest-checkpoint.json");
      if (existsSync(pointer)) {
        const candidate = path.join(directory, entry, JSON.parse(readFileSync(pointer, "utf8")).filename);
        if (existsSync(candidate)) checkpoint = candidate;
      }
    }
    save(filename, session);
    return {
      options: { ...session.options, output, hours: remainingHours, maxDataGB: remainingGB, checkpoint,
        shouldStop: () => Date.now() >= Date.parse(session.deadlineUTC) ? "wall-time" : undefined,
        onCheckpoint: (file: string) => { session.checkpoint = file; save(filename, session); } } as GrandOptions,
      finish: (stopReason: string) => { session.completed = true; session.stopReason = stopReason; save(filename, session); },
      release,
    };
  } catch (error) { release(); throw error; }
}

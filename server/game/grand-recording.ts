import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { createGzip } from "node:zlib";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import path from "node:path";
import type { GameState } from "./types";

export type GrandLogLevel = "compact" | "detailed" | "forensic";
export type DeltaPath = Array<string | number>;
export interface StateDelta { set: Array<[DeltaPath, unknown]>; remove: DeltaPath[] }

/** Lossless JSON-value deltas. Cached values are detached from mutable game
 * state. Paths are arrays, so dots/slashes in intelligence IDs are unambiguous. */
export function createStateDelta() {
  let previous: any;
  return (current: unknown): StateDelta => {
    const delta: StateDelta = { set: [], remove: [] };
    function visit(value: any, prior: any, at: DeltaPath): any {
      if (value === null || typeof value !== "object") {
        if (value !== prior) delta.set.push([at, value]);
        return value;
      }
      if (!prior || typeof prior !== "object" || Array.isArray(value) !== Array.isArray(prior)
        || Array.isArray(value) && value.length !== prior.length) {
        delta.set.push([at, value]);
        return JSON.parse(JSON.stringify(value));
      }
      for (const key of Object.keys(prior)) if (!(key in value) || value[key] === undefined) {
        delete prior[key]; delta.remove.push([...at, key]);
      }
      for (const key of Object.keys(value)) if (value[key] !== undefined) prior[key] = visit(value[key], prior[key], [...at, Array.isArray(value) ? Number(key) : key]);
      return prior;
    }
    previous = visit(current, previous, []);
    return delta;
  };
}

export function applyStateDelta(previous: any, delta: StateDelta): any {
  for (const [at, value] of delta.set) {
    const copy = structuredClone(value);
    if (!at.length) { previous = copy; continue; }
    let parent = previous; for (const key of at.slice(0, -1)) parent = parent[key];
    parent[at.at(-1)!] = copy;
  }
  for (const at of delta.remove) {
    let parent = previous; for (const key of at.slice(0, -1)) parent = parent[key];
    delete parent[at.at(-1)!];
  }
  return previous;
}

/** Detailed captures every dynamic gameplay field. Static world geometry and
 * uninhabited planets are in full checkpoints. Forensic includes everything,
 * including each country's complete intelligence ledger on every tick. */
export function grandStateView(state: Readonly<GameState>, level: GrandLogLevel): unknown {
  if (level === "forensic") return state;
  const { stars: _stars, nebulae: _nebulae, hyperlanes: _hyperlanes, adjacency: _adjacency,
    intelligenceByFaction: _intel, planetStates, ...dynamic } = state;
  return { ...dynamic, planetStates: planetStates.filter((planet) => planet.isHabited || planet.constructionQueue.length) };
}

interface Channel {
  gzip: ReturnType<typeof createGzip>; file: ReturnType<typeof createWriteStream>;
  filename: string; raw: number; totalRaw: number; records: number; part: number;
  blocked: boolean; flushCount: number; firstTick: number;
}
export interface CompletedGrandChunk {
  filename: string; name: string; part: number; compressedBytes: number;
  tier: "fast" | "strong" | "reduced";
  firstTick: number;
}

/** Asynchronous gzip + file streams with bounded backpressure. No silent drops.
 * Chunks rotate after 64 MiB of uncompressed JSONL; completed chunks can be
 * inspected while the next chunk is still being written. */
export function createGrandLog(directory: string, chunkBytes = 64 * 1024 * 1024) {
  mkdirSync(directory, { recursive: true });
  const channels = new Map<string, Channel>();
  let completedBytes = 0;
  const completed: CompletedGrandChunk[] = [];
  let error: unknown;
  let closedStats: { rawBytes: number; compressedBytes: number; channels: Record<string, { records: number; rawBytes: number; parts: number }> } | undefined;
  function open(name: string, part: number, totalRaw = 0, records = 0): Channel {
    const filename = path.join(directory, `${name}-${String(part).padStart(5, "0")}.jsonl.gz`);
    const file = createWriteStream(filename, { flags: "wx" });
    const gzip = createGzip({ level: 1, chunkSize: 64 * 1024 });
    file.on("error", (reason) => { error = reason; gzip.destroy(reason); });
    gzip.on("error", (reason) => { error = reason; file.destroy(reason); });
    gzip.pipe(file);
    return { gzip, file, filename, raw: 0, totalRaw, records, part, blocked: false, flushCount: 0, firstTick: 0 };
  }
  async function finish(channel: Channel) {
    channel.gzip.end();
    await Promise.all([finished(channel.gzip), finished(channel.file)]);
    const compressedBytes = statSync(channel.filename).size;
    completedBytes += compressedBytes;
    completed.push({ filename: channel.filename, name: path.basename(channel.filename).replace(/-\d+\.jsonl\.gz$/, ""),
      part: channel.part, compressedBytes, tier: "fast", firstTick: channel.firstTick });
  }
  return {
    write(name: string, value: unknown) {
      if (closedStats) throw new Error("Recording already closed.");
      if (error) throw error;
      let channel = channels.get(name);
      if (!channel) { channel = open(name, 0); channels.set(name, channel); }
      const line = JSON.stringify(value) + "\n", bytes = Buffer.byteLength(line);
      if (channel.raw === 0) channel.firstTick = Number((value as { tick?: number })?.tick ?? 0);
      channel.raw += bytes; channel.totalRaw += bytes; channel.records++;
      channel.blocked = !channel.gzip.write(line) || channel.blocked;
    },
    async drain() {
      if (error) throw error;
      for (const [name, channel] of channels) {
        if (channel.blocked && channel.gzip.writableNeedDrain) await once(channel.gzip, "drain");
        channel.blocked = false;
        if (channel.raw >= chunkBytes) {
          await finish(channel);
          channels.set(name, open(name, channel.part + 1, channel.totalRaw, channel.records));
        }
      }
      if (error) throw error;
    },
    async flush() {
      await this.drain();
      for (const channel of channels.values()) if (channel.flushCount !== channel.records) {
        await new Promise<void>((resolve, reject) => {
          const failed = (reason: Error) => reject(reason);
          channel.gzip.once("error", failed);
          channel.gzip.flush(() => { channel.gzip.removeListener("error", failed); resolve(); });
        });
        channel.flushCount = channel.records;
      }
      if (error) throw error;
    },
    /** Finish open chunks before a storage-maintenance pass. */
    async seal() {
      await this.drain();
      for (const [name, channel] of channels) if (channel.raw > 0) {
        await finish(channel);
        channels.set(name, open(name, channel.part + 1, channel.totalRaw, channel.records));
      }
    },
    completedChunks: () => completed.map((chunk) => ({ ...chunk })),
    replacedChunk(filename: string, compressedBytes: number, tier: CompletedGrandChunk["tier"]) {
      const chunk = completed.find((item) => item.filename === filename);
      if (!chunk) throw new Error("Cannot compact an open or unknown chunk.");
      completedBytes += compressedBytes - chunk.compressedBytes;
      chunk.compressedBytes = compressedBytes; chunk.tier = tier;
    },
    stats() {
      if (closedStats) return closedStats;
      return { rawBytes: [...channels.values()].reduce((sum, channel) => sum + channel.totalRaw, 0),
        compressedBytes: completedBytes
          + [...channels.values()].reduce((sum, channel) => sum + channel.file.bytesWritten, 0),
        channels: Object.fromEntries([...channels].map(([name, channel]) => [name, { records: channel.records, rawBytes: channel.totalRaw, parts: channel.part + 1 }])) };
    },
    async close() {
      if (closedStats) return;
      await this.flush(); const totals = this.stats();
      for (const channel of channels.values()) await finish(channel);
      channels.clear();
      closedStats = { ...totals, compressedBytes: completedBytes };
      if (error) throw error;
    },
    abort() {
      for (const channel of channels.values()) { channel.gzip.destroy(); channel.file.destroy(); }
    },
  };
}

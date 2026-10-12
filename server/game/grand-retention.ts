import { createReadStream, createWriteStream, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGunzip, createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { setImmediate } from "node:timers/promises";
import { StringDecoder } from "node:string_decoder";
import type { createGrandLog, CompletedGrandChunk, StateDelta } from "./grand-recording";

type GrandLog = ReturnType<typeof createGrandLog>;
const REDUCIBLE = new Set(["state", "observations"]);

/** Only old observer detail is expendable. All gameplay deltas, decisions,
 * commands, transactions, combat/events and checkpoints stay intact. */
export function reduceOldGrandRecord(name: string, row: any): any {
  if (name === "state") {
    const delta = row.delta as StateDelta;
    delta.set = delta.set.filter(([at]) => at[0] !== "intelligenceByFaction").map(([at, value]) => {
      if (at.length || !value || typeof value !== "object") return [at, value];
      const { intelligenceByFaction: _intel, ...gameplay } = value as Record<string, unknown>;
      return [at, gameplay];
    });
    delete delta.intelTimestamps;
    delta.remove = delta.remove.filter((at) => at[0] !== "intelligenceByFaction");
    row.projection = "gameplay-without-intelligence";
  } else if (name === "observations") {
    // These fields duplicate static checkpoints or the large intelligence
    // ledger. Keep materialized gameplay views, economy/jobs, fleets, trade,
    // society, diplomacy, and all decision-relevant numerical values.
    const snapshot = row.observation?.snapshot;
    if (snapshot) for (const field of ["intelligence", "stars", "nebulae", "hyperlanes", "adjacency"]) delete snapshot[field];
    row.projection = "observation-without-intelligence-and-static-map";
  }
  return row;
}

async function rewrite(chunk: CompletedGrandChunk, reduced: boolean) {
  const temporary = chunk.filename + ".compacting.tmp";
  const input = createReadStream(chunk.filename), output = createWriteStream(temporary, { flags: "wx" });
  try {
    if (reduced) {
      await pipeline(input, createGunzip(), async function* (source) {
        let pending = "";
        const decoder = new StringDecoder("utf8");
        for await (const buffer of source) {
          pending += decoder.write(buffer);
          let end: number;
          while ((end = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, end); pending = pending.slice(end + 1);
            if (line.trim()) yield JSON.stringify(reduceOldGrandRecord(chunk.name, JSON.parse(line))) + "\n";
          }
        }
        pending += decoder.end();
        if (pending.trim()) yield JSON.stringify(reduceOldGrandRecord(chunk.name, JSON.parse(pending))) + "\n";
      }, createGzip({ level: 9 }), output);
    } else await pipeline(input, createGunzip(), createGzip({ level: 9 }), output);
    const bytes = statSync(temporary).size;
    if (bytes < chunk.compressedBytes) { renameSync(temporary, chunk.filename); return { bytes, replaced: true }; }
    rmSync(temporary); return { bytes: chunk.compressedBytes, replaced: false };
  } catch (error) {
    // Never remove the original; the replacement must finish first.
    input.destroy(); output.destroy();
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function createGrandRetention(output: string, log: GrandLog) {
  const history: Array<{ filename: string; firstTick: number; atTick: number; beforeBytes: number; afterBytes: number;
    tier: "strong" | "reduced"; replaced: boolean; removedFields: string[] }> = [];
  let savedBytes = 0, maintenanceMs = 0, failedAttempts = 0;
  const attemptedReduction = new Set<string>();
  const summary = () => ({ savedBytes, maintenanceMs, failedAttempts, recompressedChunks: history.filter((item) => item.tier === "strong").length,
    reducedChunks: history.filter((item) => item.tier === "reduced" && item.replaced).length });
  function manifest() {
    const filename = path.join(output, "retention.json");
    writeFileSync(filename + ".tmp", JSON.stringify({ formatVersion: 1,
      triggerFraction: 0.9, targetFraction: 0.8, ...summary(), history,
      note: "Strong is lossless gzip recompression. Reduced state chunks omit intelligenceByFaction; reduced observations omit snapshot intelligence/static geometry. Every game tick still ran. To reconstruct gameplay across mixed tiers, omit intelligenceByFaction from ALL state deltas (including root values). Full intelligence replay requires an unmodified checkpoint and subsequent unreduced chunks. Checkpoints and core diagnostic channels are never pruned." }, null, 2));
    renameSync(filename + ".tmp", filename);
  }
  manifest();
  return {
    summary,
    /** Work is bounded in wall time and yields between files for signals. The
     * caller can repeat maintenance without advancing gameplay at the cap. */
    async maintain(limitBytes: number, otherBytes: number, tick: number, shouldStop: () => boolean = () => false, maxMs = 30_000) {
      if (log.stats().compressedBytes + otherBytes < limitBytes * 0.9) return { exhausted: false, changed: false };
      await log.seal();
      const started = performance.now();
      let changed = false, exhausted = false;
      while (log.stats().compressedBytes + otherBytes > limitBytes * 0.8 && !shouldStop()) {
        const chunks = log.completedChunks().sort((a, b) => a.firstTick - b.firstTick || a.filename.localeCompare(b.filename));
        const chunk = chunks.find((item) => item.tier === "fast")
          ?? chunks.find((item) => item.tier === "strong" && REDUCIBLE.has(item.name) && !attemptedReduction.has(item.filename));
        if (!chunk) { exhausted = true; break; }
        const reduced = chunk.tier === "strong", tier = reduced ? "reduced" : "strong";
        try {
          const result = await rewrite(chunk, reduced);
          if (reduced) attemptedReduction.add(chunk.filename);
          // If pruning did not save space, retain the complete original.
          log.replacedChunk(chunk.filename, result.bytes, reduced && !result.replaced ? "strong" : tier);
          savedBytes += chunk.compressedBytes - result.bytes; changed = true;
          history.push({ filename: path.relative(output, chunk.filename), firstTick: chunk.firstTick, atTick: tick,
            beforeBytes: chunk.compressedBytes, afterBytes: result.bytes, tier, replaced: result.replaced,
            removedFields: reduced && result.replaced ? chunk.name === "state" ? ["intelligenceByFaction"]
              : ["observation.snapshot.intelligence", "observation.snapshot.stars", "observation.snapshot.nebulae", "observation.snapshot.hyperlanes", "observation.snapshot.adjacency"] : [] });
        } catch (error) {
          failedAttempts++; console.warn("Log compaction failed; original preserved:", chunk.filename, String(error));
          // Do not endlessly retry a failed file. If storage becomes exhausted,
          // the caller saves a checkpoint and stops rather than deleting core data.
          log.replacedChunk(chunk.filename, chunk.compressedBytes, "strong"); attemptedReduction.add(chunk.filename);
        }
        await setImmediate();
        if (performance.now() - started >= maxMs) break;
      }
      maintenanceMs += performance.now() - started; manifest();
      return { exhausted, changed };
    },
  };
}

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StaticVersionManifest {
  protocolVersion: number;
  schemaVersion: number;
  migratesFromSchema: number[];
  runtimeApiVersion: number;
}

function assertManifest(value: unknown): StaticVersionManifest {
  if (!value || typeof value !== "object") throw new Error("Version manifest must be an object.");
  const record = value as Partial<StaticVersionManifest>;
  if (!Number.isInteger(record.protocolVersion) || !Number.isInteger(record.schemaVersion)) {
    throw new Error("Version manifest requires integer protocolVersion and schemaVersion.");
  }
  if (!Array.isArray(record.migratesFromSchema) || !record.migratesFromSchema.every(Number.isInteger)) {
    throw new Error("Version manifest requires an integer migratesFromSchema array.");
  }
  return {
    protocolVersion: record.protocolVersion!,
    schemaVersion: record.schemaVersion!,
    migratesFromSchema: record.migratesFromSchema,
    runtimeApiVersion: Number.isInteger(record.runtimeApiVersion) ? record.runtimeApiVersion! : 0,
  };
}

function parseLegacyTypeScriptManifest(source: string): StaticVersionManifest {
  const schema = Number(source.match(/CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
  const protocol = Number(source.match(/CURRENT_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1]);
  const arraySource = source.match(/migratesFromSchema\s*:\s*\[([^\]]+)\]/s)?.[1] ?? "";
  const migrations = arraySource
    .replace(/CURRENT_SCHEMA_VERSION/g, String(schema))
    .split(",")
    .map((part) => Number(part.trim()))
    .filter(Number.isInteger);
  return assertManifest({
    protocolVersion: protocol,
    schemaVersion: schema,
    migratesFromSchema: migrations,
    runtimeApiVersion: 0,
  });
}

/** Read version metadata without importing or executing historical server code. */
export async function readStaticVersionManifest(worktreePath: string): Promise<StaticVersionManifest> {
  const jsonPath = path.join(worktreePath, "server", "version-manifest.json");
  try {
    return assertManifest(JSON.parse(await readFile(jsonPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const source = await readFile(path.join(worktreePath, "server", "versionManifest.ts"), "utf8");
  return parseLegacyTypeScriptManifest(source);
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
    });
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function dependencyArtifactStatus(worktreePath: string): Promise<{
  ready: boolean;
  dependencyHash: string | null;
}> {
  try {
    const lock = await readFile(path.join(worktreePath, "package-lock.json"), "utf8");
    const expected = digest(lock);
    const actual = (await readFile(path.join(worktreePath, "node_modules", ".stellarfronts-lock-sha"), "utf8")).trim();
    await access(path.join(worktreePath, "node_modules", "tsx", "dist", "cli.mjs"));
    return { ready: actual === expected, dependencyHash: expected };
  } catch {
    return { ready: false, dependencyHash: null };
  }
}

/**
 * Materialize dependencies inside the pinned worktree. Node then resolves every
 * package from that version instead of inheriting the current root node_modules.
 */
export async function ensureVersionArtifact(worktreePath: string): Promise<string> {
  const lockPath = path.join(worktreePath, "package-lock.json");
  const lock = await readFile(lockPath, "utf8");
  const dependencyHash = digest(lock);
  const status = await dependencyArtifactStatus(worktreePath);
  if (status.ready && status.dependencyHash === dependencyHash) return dependencyHash;

  await mkdir(path.join(worktreePath, "node_modules"), { recursive: true });
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await run(npmCommand, ["ci", "--include=dev", "--no-audit", "--no-fund"], worktreePath);
  await writeFile(
    path.join(worktreePath, "node_modules", ".stellarfronts-lock-sha"),
    `${dependencyHash}\n`,
    "utf8",
  );
  return dependencyHash;
}

export function versionTsxImport(worktreePath: string): string {
  return path.join(worktreePath, "node_modules", "tsx", "dist", "loader.mjs");
}

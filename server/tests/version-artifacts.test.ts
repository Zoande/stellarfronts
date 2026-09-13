import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  dependencyArtifactStatus,
  readStaticVersionManifest,
  versionTsxImport,
} from "../version-artifacts";

test("static manifests are read without executing historical server code", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stellarfronts-manifest-"));
  try {
    await mkdir(path.join(directory, "server"), { recursive: true });
    await writeFile(path.join(directory, "server", "version-manifest.json"), JSON.stringify({
      protocolVersion: 7,
      schemaVersion: 27,
      migratesFromSchema: [23, 24, 25, 26, 27],
      runtimeApiVersion: 1,
    }), "utf8");
    assert.deepEqual(await readStaticVersionManifest(directory), {
      protocolVersion: 7,
      schemaVersion: 27,
      migratesFromSchema: [23, 24, 25, 26, 27],
      runtimeApiVersion: 1,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy TypeScript manifests remain readable when JSON is absent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stellarfronts-legacy-manifest-"));
  try {
    await mkdir(path.join(directory, "server"), { recursive: true });
    await writeFile(path.join(directory, "server", "versionManifest.ts"), `
      export const CURRENT_SCHEMA_VERSION = 20;
      export const CURRENT_PROTOCOL_VERSION = 4;
      export const VERSION_MANIFEST = { migratesFromSchema: [18, 19, CURRENT_SCHEMA_VERSION] };
    `, "utf8");
    assert.deepEqual(await readStaticVersionManifest(directory), {
      protocolVersion: 4,
      schemaVersion: 20,
      migratesFromSchema: [18, 19, 20],
      runtimeApiVersion: 0,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid present manifests fail closed instead of falling back", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stellarfronts-invalid-manifest-"));
  try {
    await mkdir(path.join(directory, "server"), { recursive: true });
    await writeFile(path.join(directory, "server", "version-manifest.json"), "{}", "utf8");
    await writeFile(path.join(directory, "server", "versionManifest.ts"), `
      export const CURRENT_SCHEMA_VERSION = 27;
      export const CURRENT_PROTOCOL_VERSION = 7;
      export const VERSION_MANIFEST = { migratesFromSchema: [27] };
    `, "utf8");
    await assert.rejects(readStaticVersionManifest(directory), /requires integer/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dependency readiness requires the matching lock hash and private tsx loader", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stellarfronts-artifact-"));
  try {
    assert.deepEqual(await dependencyArtifactStatus(directory), { ready: false, dependencyHash: null });
    const lock = '{"lockfileVersion":3}';
    const hash = createHash("sha256").update(lock).digest("hex");
    await mkdir(path.join(directory, "node_modules", "tsx", "dist"), { recursive: true });
    await writeFile(path.join(directory, "package-lock.json"), lock, "utf8");
    await writeFile(path.join(directory, "node_modules", ".stellarfronts-lock-sha"), `${hash}\n`, "utf8");
    await writeFile(path.join(directory, "node_modules", "tsx", "dist", "cli.mjs"), "", "utf8");
    assert.deepEqual(await dependencyArtifactStatus(directory), { ready: true, dependencyHash: hash });
    assert.equal(versionTsxImport(directory), path.join(directory, "node_modules", "tsx", "dist", "loader.mjs"));
    await access(path.join(directory, "node_modules", "tsx", "dist", "cli.mjs"));
    await writeFile(path.join(directory, "node_modules", ".stellarfronts-lock-sha"), "wrong\n", "utf8");
    assert.deepEqual(await dependencyArtifactStatus(directory), { ready: false, dependencyHash: hash });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

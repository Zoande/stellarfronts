import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createGameBackup, listGameBackups, restoreGameBackup, verifyGameBackup } from "../game-backups";
import { getGameStateDirectory, getGameStatePath } from "../game-state-path";
import { minimalRuntimeContext } from "./helpers/runtime-context";

function fixture(prefix: string) {
  const gameId = `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const directory = getGameStateDirectory(gameId);
  const statePath = getGameStatePath(gameId);
  return { gameId, directory, statePath, game: minimalRuntimeContext(statePath, gameId).game };
}

async function writeState(statePath: string, marker: string): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({
    schemaVersion: 27,
    protocolVersion: 7,
    codeVersion: "dev",
    marker,
  }), "utf8");
}

test("verified backups carry version metadata and restore exact state", async () => {
  const item = fixture("backup");
  try {
    await writeState(item.statePath, "before");
    const backup = await createGameBackup(item.game, "test");
    assert.ok(backup);
    assert.equal(backup.sourceVersionId, "dev");
    assert.equal(backup.schemaVersion, 27);
    assert.equal(backup.protocolVersion, 7);
    await verifyGameBackup(item.gameId, backup.id);
    await writeState(item.statePath, "after");
    await restoreGameBackup(item.gameId, backup.id);
    assert.equal(JSON.parse(await readFile(item.statePath, "utf8")).marker, "before");
    assert.equal((await listGameBackups(item.gameId)).length, 1);
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("missing and partial state files are never blessed as backups", async () => {
  const item = fixture("missingbackup");
  try {
    assert.equal(await createGameBackup(item.game, "test"), null);
    await mkdir(item.directory, { recursive: true });
    await writeFile(item.statePath, '{"schemaVersion":', "utf8");
    await assert.rejects(createGameBackup(item.game, "test"), SyntaxError);
    assert.deepEqual(await listGameBackups(item.gameId), []);
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("checksum failures cannot replace the live save", async () => {
  const item = fixture("tamper");
  try {
    await writeState(item.statePath, "safe");
    const backup = await createGameBackup(item.game, "test");
    assert.ok(backup);
    const backupState = path.join(item.directory, "backups", `${backup.id}.state.json`);
    await writeFile(backupState, JSON.stringify({ schemaVersion: 27, marker: "tampered" }), "utf8");
    await assert.rejects(verifyGameBackup(item.gameId, backup.id), /checksum/);
    await assert.rejects(restoreGameBackup(item.gameId, backup.id), /checksum/);
    assert.equal(JSON.parse(await readFile(item.statePath, "utf8")).marker, "safe");
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("backup identifiers cannot escape the game backup directory", async () => {
  const item = fixture("pathsafe");
  try {
    await assert.rejects(verifyGameBackup(item.gameId, "../game-state"));
    await assert.rejects(restoreGameBackup(item.gameId, "..\\game-state"));
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("retention uses the documented setting and removes oldest backup pairs", async () => {
  const item = fixture("retention");
  const previous = process.env.GAME_BACKUP_RETENTION_COUNT;
  process.env.GAME_BACKUP_RETENTION_COUNT = "2";
  try {
    for (const marker of ["one", "two", "three"]) {
      await writeState(item.statePath, marker);
      await createGameBackup(item.game, marker);
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    const backups = await listGameBackups(item.gameId);
    assert.equal(backups.length, 2);
    assert.deepEqual(backups.map((backup) => backup.reason), ["three", "two"]);
  } finally {
    if (previous === undefined) delete process.env.GAME_BACKUP_RETENTION_COUNT;
    else process.env.GAME_BACKUP_RETENTION_COUNT = previous;
    await rm(item.directory, { recursive: true, force: true });
  }
});

test("backup listing ignores malformed manifests", async () => {
  const item = fixture("manifest");
  try {
    const backupDirectory = path.join(item.directory, "backups");
    await mkdir(backupDirectory, { recursive: true });
    await writeFile(path.join(backupDirectory, "broken.manifest.json"), "{", "utf8");
    await writeFile(path.join(backupDirectory, "wrong.manifest.json"), "{}", "utf8");
    assert.deepEqual(await listGameBackups(item.gameId), []);
  } finally {
    await rm(item.directory, { recursive: true, force: true });
  }
});

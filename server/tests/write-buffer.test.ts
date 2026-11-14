import assert from "node:assert/strict";
import test from "node:test";
import { writeSnapshotBuffer } from "../game/write-buffer";

test("large UTF-8 snapshots survive short writes with correct file offsets", async () => {
  const payload = Buffer.from("🌌星".repeat(200_000));
  const disk = Buffer.alloc(payload.length);
  let calls = 0;
  await writeSnapshotBuffer({ write: async (buffer, offset, length, position) => {
    calls++;
    const bytesWritten = Math.min(length, 131_071);
    buffer.copy(disk, position, offset, offset + bytesWritten);
    return { bytesWritten };
  } }, payload);
  assert.ok(calls > 1);
  assert.deepEqual(disk, payload);
});

test("a large normal write is submitted once and a stalled write fails instead of looping", async () => {
  let calls = 0;
  const payload = Buffer.alloc(2 * 1024 * 1024);
  await writeSnapshotBuffer({ write: async (_buffer, _offset, length) => {
    calls++; return { bytesWritten: length };
  } }, payload);
  assert.equal(calls, 1);
  await assert.rejects(writeSnapshotBuffer({ write: async () => ({ bytesWritten: 0 }) }, payload), /no progress/);
  const diskFailure = new Error("disk failure");
  await assert.rejects(writeSnapshotBuffer({ write: async () => { throw diskFailure; } }, payload), diskFailure);
});
